import SwiftUI
import ImageIO

struct WatchRootView: View {
    @EnvironmentObject private var model: WatchModel
    var body: some View {
        Group {
            if !model.ready { ProgressView("LiteChat") }
            else if model.user == nil { WatchSignInView() }
            else {
                NavigationStack(path:$model.path) {
                    List {
                        if let status = model.status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                        if model.conversations.isEmpty { Text(WatchL10n.text("No conversations yet.")).foregroundStyle(.secondary) }
                        ForEach(model.conversations) { conversation in
                            NavigationLink(value:conversation.id) {
                                VStack(alignment:.leading,spacing:3) {
                                    HStack {
                                        Text(conversation.peer.nickname).font(.headline).lineLimit(1)
                                        Spacer(minLength:2)
                                        if conversation.unread > 0 { Text(conversation.unread > 99 ? "99+" : "\(conversation.unread)").font(.caption2).foregroundStyle(.blue) }
                                    }
                                    Text(conversation.last?.preview ?? WatchL10n.text("Start a conversation")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    if let last = conversation.last { Text(Date(timeIntervalSince1970:Double(last.ts)),style:.time).font(.caption2).foregroundStyle(.secondary) }
                                }
                            }
                        }
                        Button(WatchL10n.text("Refresh")) { Task { await model.refresh() } }
                        NavigationLink(WatchL10n.text("Account & Notifications")) { WatchAccountView() }
                    }
                    .navigationTitle("LiteChat")
                    .navigationDestination(for:Int64.self) { id in WatchConversationView(id:id) }
                }
            }
        }
        .alert("LiteChat",isPresented:Binding(get:{model.error != nil},set:{if !$0 {model.error=nil}})) {
            Button(WatchL10n.text("OK")) { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}

struct WatchSignInView: View {
    @EnvironmentObject private var model: WatchModel
    @State private var username = ""
    @State private var password = ""
    @State private var nickname = ""
    @State private var registering = false
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                TextField(WatchL10n.text("Username"),text:$username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(WatchL10n.text("Password"),text:$password).textContentType(registering ? .newPassword : .password)
                if registering {
                    TextField(WatchL10n.text("Nickname"),text:$nickname).textContentType(.nickname)
                    Text(WatchL10n.text("Username: 3–20 lowercase letters, numbers or _. Password: 8–72 characters. Nickname: up to 20 characters.")).font(.footnote)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Button(busy ? WatchL10n.text("Connecting…") : (registering ? WatchL10n.text("Create Account") : WatchL10n.text("Sign In"))) {
                    busy = true; error = nil
                    Task {
                        defer { password = ""; busy = false }
                        do { try await model.signIn(username:username,password:password,nickname:registering ? nickname : nil) }
                        catch { self.error = error.localizedDescription }
                    }
                }.disabled(busy || username.isEmpty || password.isEmpty || (registering && nickname.isEmpty))
                Button(registering ? WatchL10n.text("Sign In to Existing Account") : WatchL10n.text("Create Account")) { registering.toggle(); password=""; error=nil }.disabled(busy)
                Text(WatchL10n.text("Sign in directly on your Watch.")).font(.footnote).foregroundStyle(.secondary)
            }.navigationTitle("LiteChat")
        }
    }
}

struct WatchConversationView: View {
    let id: Int64
    @EnvironmentObject private var model: WatchModel
    @State private var draft = ""
    @State private var loadingOlder = false
    private var chat: ChatCache { model.chats[id] ?? ChatCache() }
    private var peer: String { model.conversations.first { $0.id == id }?.peer.nickname ?? WatchL10n.text("Conversation") }
    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment:.leading,spacing:8) {
                    if let status = model.status { Text(status).font(.caption2).foregroundStyle(.secondary) }
                    if !chat.messages.isEmpty {
                        Button(loadingOlder ? WatchL10n.text("Loading…") : WatchL10n.text("Earlier Messages")) {
                            loadingOlder = true
                            Task { await model.older(id); loadingOlder = false }
                        }.disabled(loadingOlder || chat.messages.count >= 200)
                    }
                    ForEach(chat.messages) { message in
                        WatchMessageView(message:message,mine:message.s == model.user?.id,read:message.id <= chat.peerRead,
                            quote:chat.refs.first { $0.id == message.r },api:model.api)
                            .id(message.id).onAppear { model.saw(message) }
                    }
                    ForEach(model.pending.filter { $0.conversation == id }) { item in
                        VStack(alignment:.trailing) {
                            Text(item.text).foregroundStyle(.secondary)
                            if item.sending { ProgressView().controlSize(.mini) }
                            else {
                                HStack {
                                    Button(WatchL10n.text("Retry")) { Task { await model.retry(item.id) } }
                                    Button(WatchL10n.text("Delete"),role:.destructive) { model.discard(item.id) }
                                }.font(.caption2)
                            }
                        }.frame(maxWidth:.infinity,alignment:.trailing)
                    }
                    HStack {
                        TextField(WatchL10n.text("Message"),text:$draft).accessibilityLabel(WatchL10n.text("Enter message"))
                        Button {
                            let text = draft; draft = ""
                            Task { await model.send(text,in:id) }
                        } label: { Image(systemName:"arrow.up.circle.fill") }
                        .disabled(draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || draft.utf16.count > 2000)
                        .accessibilityLabel(WatchL10n.text("Send message"))
                    }.id("composer")
                    if draft.utf16.count > 2000 { Text(WatchL10n.text("Use 2,000 characters or fewer.")).font(.caption2) }
                }.padding(.horizontal,4)
            }
            .defaultScrollAnchor(.bottom)
            .navigationTitle(peer)
            .onAppear { model.open(id) }
            .onDisappear { model.close(id) }
        }
    }
}

struct WatchMessageView: View {
    let message: WireMessage; let mine: Bool; let read: Bool; let quote: WireQuote?; let api: WatchAPIClient
    var body: some View {
        VStack(alignment:mine ? .trailing : .leading,spacing:3) {
            if let quote { Text("↩ \(quote.k == "i" ? WatchL10n.text("📷 Photo") : quote.x)").font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
            if message.k == "i", let image = message.im { WatchThumbnail(image:image,api:api) }
            else { Text(message.x).font(message.k == "e" ? .title2 : .body) }
            if mine { Text(read ? WatchL10n.text("Read") : WatchL10n.text("Sent")).font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(8).background(mine ? Color.blue.opacity(0.25) : Color.gray.opacity(0.18),in:RoundedRectangle(cornerRadius:12))
        .frame(maxWidth:.infinity,alignment:mine ? .trailing : .leading)
        .accessibilityElement(children:.combine)
    }
}

@MainActor private enum ThumbnailMemory {
    static let data: NSCache<NSString, NSData> = {
        let cache=NSCache<NSString,NSData>();cache.totalCostLimit=4*1024*1024;cache.countLimit=16;return cache
    }()
}
struct WatchThumbnail: View {
    let image: WireImage; let api: WatchAPIClient
    @State private var decoded: CGImage?
    @State private var failed = false
    var body: some View {
        Group {
            if let decoded { Image(decoded,scale:1,label:Text(WatchL10n.text("Received photo"))).resizable().scaledToFit().frame(maxHeight:120) }
            else { Text(failed ? WatchL10n.text("Could not load photo") : WatchL10n.text("📷 Photo")).font(.caption) }
        }.task(id:image.id) {
            guard image.tb <= 2 * 1024 * 1024 else { failed = true; return }
            do {
                let data: Data
                if let cached = ThumbnailMemory.data.object(forKey:image.id as NSString) { data = cached as Data }
                else {
                    data = try await api.bytes("/api/watch/images/\(image.id)/thumb")
                    ThumbnailMemory.data.setObject(data as NSData,forKey:image.id as NSString,cost:data.count)
                }
                guard let source = CGImageSourceCreateWithData(data as CFData,nil) else { failed=true;return }
                decoded = CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,
                    kCGImageSourceThumbnailMaxPixelSize:320,kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary)
            } catch { failed=true }
        }.onDisappear { decoded = nil }
    }
}

struct WatchAccountView: View {
    @EnvironmentObject private var model: WatchModel
    @Environment(\.requestWatchNotifications) private var requestPermission
    @State private var password = ""
    @State private var confirmDelete = false
    @State private var busy = false
    var body: some View {
        Form {
            if let user = model.user { Text(user.nickname); Text("@\(user.username)").font(.caption) }
            Button(WatchL10n.text("Allow Notifications")) { Task { await requestPermission() } }
            Button(WatchL10n.text("Sign Out")) { Task { await model.logout() } }
            Section(WatchL10n.text("Delete Account")) {
                Text(WatchL10n.text("Your account and conversations will be permanently deleted on all devices.")).font(.footnote)
                SecureField(WatchL10n.text("Confirm Password"),text:$password).textContentType(.password)
                Button(WatchL10n.text("Delete Account"),role:.destructive) { confirmDelete=true }.disabled(password.isEmpty || busy)
            }
        }.navigationTitle(WatchL10n.text("Account & Notifications"))
        .confirmationDialog(WatchL10n.text("Permanently delete your account?"),isPresented:$confirmDelete,titleVisibility:.visible) {
            Button(WatchL10n.text("Delete Permanently"),role:.destructive) {
                busy=true
                Task {
                    defer {password="";busy=false}
                    do {try await model.deleteAccount(password:password)} catch {model.error=error.localizedDescription}
                }
            }
        }
    }
}
