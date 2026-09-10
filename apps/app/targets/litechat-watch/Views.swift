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
                        if model.conversations.isEmpty { Text("아직 대화가 없어요.").foregroundStyle(.secondary) }
                        ForEach(model.conversations) { conversation in
                            NavigationLink(value:conversation.id) {
                                VStack(alignment:.leading,spacing:3) {
                                    HStack {
                                        Text(conversation.peer.nickname).font(.headline).lineLimit(1)
                                        Spacer(minLength:2)
                                        if conversation.unread > 0 { Text(conversation.unread > 99 ? "99+" : "\(conversation.unread)").font(.caption2).foregroundStyle(.blue) }
                                    }
                                    Text(conversation.last?.preview ?? "대화를 시작해 보세요").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    if let last = conversation.last { Text(Date(timeIntervalSince1970:Double(last.ts)),style:.time).font(.caption2).foregroundStyle(.secondary) }
                                }
                            }
                        }
                        Button("새로고침") { Task { await model.refresh() } }
                        NavigationLink("계정 및 알림") { WatchAccountView() }
                    }
                    .navigationTitle("LiteChat")
                    .navigationDestination(for:Int64.self) { id in WatchConversationView(id:id) }
                }
            }
        }
        .alert("LiteChat",isPresented:Binding(get:{model.error != nil},set:{if !$0 {model.error=nil}})) {
            Button("확인") { model.error = nil }
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
                TextField("아이디",text:$username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("비밀번호",text:$password).textContentType(registering ? .newPassword : .password)
                if registering {
                    TextField("닉네임",text:$nickname).textContentType(.nickname)
                    Text("아이디 3–20자 (영문 소문자·숫자·_), 비밀번호 8–72자, 닉네임 20자 이내").font(.footnote)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                Button(busy ? "연결 중…" : (registering ? "계정 만들기" : "로그인")) {
                    busy = true; error = nil
                    Task {
                        defer { password = ""; busy = false }
                        do { try await model.signIn(username:username,password:password,nickname:registering ? nickname : nil) }
                        catch { self.error = error.localizedDescription }
                    }
                }.disabled(busy || username.isEmpty || password.isEmpty || (registering && nickname.isEmpty))
                Button(registering ? "기존 계정으로 로그인" : "계정 만들기") { registering.toggle(); password=""; error=nil }.disabled(busy)
                Text("Watch에서 직접 로그인할 수 있어요.").font(.footnote).foregroundStyle(.secondary)
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
    private var peer: String { model.conversations.first { $0.id == id }?.peer.nickname ?? "대화" }
    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment:.leading,spacing:8) {
                    if let status = model.status { Text(status).font(.caption2).foregroundStyle(.secondary) }
                    if !chat.messages.isEmpty {
                        Button(loadingOlder ? "불러오는 중…" : "이전 메시지") {
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
                                    Button("재시도") { Task { await model.retry(item.id) } }
                                    Button("삭제",role:.destructive) { model.discard(item.id) }
                                }.font(.caption2)
                            }
                        }.frame(maxWidth:.infinity,alignment:.trailing)
                    }
                    HStack {
                        TextField("메시지",text:$draft).accessibilityLabel("메시지 입력")
                        Button {
                            let text = draft; draft = ""
                            Task { await model.send(text,in:id) }
                        } label: { Image(systemName:"arrow.up.circle.fill") }
                        .disabled(draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || draft.utf16.count > 2000)
                        .accessibilityLabel("메시지 보내기")
                    }.id("composer")
                    if draft.utf16.count > 2000 { Text("2,000자 이내로 입력해 주세요.").font(.caption2) }
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
            if let quote { Text("↩ \(quote.k == "i" ? "📷 사진" : quote.x)").font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
            if message.k == "i", let image = message.im { WatchThumbnail(image:image,api:api) }
            else { Text(message.x).font(message.k == "e" ? .title2 : .body) }
            if mine { Text(read ? "읽음" : "전송됨").font(.caption2).foregroundStyle(.secondary) }
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
            if let decoded { Image(decorative:decoded,scale:1).resizable().scaledToFit().frame(maxHeight:120).accessibilityLabel("받은 사진") }
            else { Text(failed ? "사진을 불러오지 못했어요" : "📷 사진").font(.caption) }
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
            Button("알림 허용") { Task { await requestPermission() } }
            Button("로그아웃") { Task { await model.logout() } }
            Section("계정 삭제") {
                Text("모든 기기의 계정과 대화가 영구 삭제돼요.").font(.footnote)
                SecureField("비밀번호 확인",text:$password).textContentType(.password)
                Button("계정 삭제",role:.destructive) { confirmDelete=true }.disabled(password.isEmpty || busy)
            }
        }.navigationTitle("계정 및 알림")
        .confirmationDialog("계정을 영구 삭제할까요?",isPresented:$confirmDelete,titleVisibility:.visible) {
            Button("영구 삭제",role:.destructive) {
                busy=true
                Task {
                    defer {password="";busy=false}
                    do {try await model.deleteAccount(password:password)} catch {model.error=error.localizedDescription}
                }
            }
        }
    }
}
