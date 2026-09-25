import Foundation
import SwiftUI
import Network

@MainActor final class WatchModel: ObservableObject {
    @Published var user: PublicUser?
    @Published var ready = false
    @Published var conversations: [ConversationSummary] = []
    @Published var chats: [Int64: ChatCache] = [:]
    @Published var pending: [PendingMessage] = []
    @Published var path: [Int64] = []
    @Published var status: String?
    @Published var error: String?
    @Published var active = true
    let api: WatchAPIClient
    private let cache = WatchCacheStore()
    private let monitor = NWPathMonitor()
    private var poll: Task<Void, Never>?
    private var readTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    private var online = true
    private var pendingReads: [Int64:Int64] = [:]
    private var activeChat: Int64?
    private var booted = false
    private var sessionGeneration = 0
    private var notificationConversation: Int64?
    var registerNotifications: (() -> Void)?

    init() {
        let raw = Bundle.main.object(forInfoDictionaryKey: "LiteChatAPIURL") as? String ?? ""
        api = WatchAPIClient(base: URL(string: raw) ?? URL(string: "https://invalid.invalid")!)
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let restored = !self.online && path.status == .satisfied
                self.online = path.status == .satisfied
                if !self.online { self.status = WatchL10n.text("Offline"); self.poll?.cancel() }
                if restored && self.active && self.booted { await self.refresh(); self.startPolling() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "LiteChat.Watch.Network"))
    }
    func bootstrap() async {
        guard !booted else { return }; booted = true
        defer { ready = true }
        do {
            let local = try WatchSessionStore.read()
            let shared = local == nil ? try? SharedSessionLink.read() : nil
            if let shared { try? WatchSessionStore.save(shared) }
            guard let token = local ?? shared else { startSharePolling(); return }
            await api.setToken(token)
            if let saved = await cache.load() {
                user = saved.user; conversations = saved.conversations
                chats = Dictionary(uniqueKeysWithValues: saved.chats.compactMap { key, value in Int64(key).map { ($0,value) } })
                pending = saved.pending.map { var p = $0; p.sending = false; return p }
            }
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
    /// iCloud Keychain delivers the phone's published token on its own
    /// schedule; retry while signed out so a fresh install still adopts it.
    private var sharePoll: Task<Void, Never>?
    private func startSharePolling() {
        sharePoll?.cancel()
        sharePoll = Task { [weak self] in
            for _ in 0..<30 {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                guard !Task.isCancelled, let self, self.user == nil else { return }
                if let token = try? SharedSessionLink.read() { await self.adopt(token); return }
            }
        }
    }
    private func adopt(_ token: String) async {
        try? WatchSessionStore.save(token)
        sessionGeneration += 1
        await api.setToken(token)
        registerNotifications?()
        await refresh()
    }
    func signIn(username: String, password: String, nickname: String?) async throws {
        await finishPendingLogout()
        let response: AuthResponse = try await api.request("/api/watch/auth/\(nickname == nil ? "login" : "register")", method: "POST",
            body: JSONEncoder().encode(Credentials(username: username, password: password, nickname: nickname)))
        sessionGeneration += 1
        try WatchSessionStore.save(response.token)
        if user?.id != response.user.id { conversations = []; chats = [:]; pending = []; await cache.clear() }
        await api.setToken(response.token); user = response.user; error = nil
        registerNotifications?(); await refresh()
    }
    func refresh() async {
        guard active else { return }
        let generation = sessionGeneration
        do {
            let identity: IdentityResponse = try await api.request("/api/watch/auth/me")
            guard generation == sessionGeneration else { return }
            user = identity.user
            let data: ConversationsResponse = try await api.request("/api/watch/conversations")
            guard generation == sessionGeneration else { return }
            conversations = data.conversations
            // Permissions can change on another client; remove inaccessible cached conversations.
            let ids = Set(data.conversations.map(\.id))
            chats = chats.filter { ids.contains($0.key) }
            if let id = path.last, !ids.contains(id) { path = [] }
            status = nil; persist(); registerNotifications?()
            if let id = notificationConversation {
                notificationConversation = nil
                if ids.contains(id) { path = [id] } else { error = WatchL10n.text("This conversation is unavailable.") }
            }
        } catch { if generation == sessionGeneration { await handle(error) } }
    }
    func setActive(_ value: Bool) {
        active = value
        guard ready else { return }
        if value {
            Task { await refresh(); startPolling() }
            if user == nil { startSharePolling() }
        }
        else { poll?.cancel(); readTask?.cancel(); persist() }
    }
    func open(_ id: Int64) {
        activeChat = id; startPolling()
    }
    func close(_ id: Int64) {
        guard activeChat == id else { return }; activeChat = nil; poll?.cancel(); readTask?.cancel(); persist()
    }
    func notification(_ id: Int64) {
        guard id > 0 else { return }
        notificationConversation = id
        if user != nil { Task { await refresh() } }
    }
    func receivedNotification(_ id: Int64) {
        // The foreground poll supplies messages; a push only invalidates the list.
        if active { Task { await refresh() } }
    }
    private func startPolling() {
        poll?.cancel()
        guard active, online, user != nil, let id = activeChat else { return }
        let generation = sessionGeneration
        poll = Task { [weak self] in
            guard let self else { return }
            var delay: UInt64 = 2
            while !Task.isCancelled && self.active && self.activeChat == id && self.user != nil {
                let chat = self.chats[id] ?? ChatCache()
                let cursor = chat.messages.last?.id
                let query = cursor.map { "after=\($0)&wait=20&pr=\(chat.peerRead)&mr=\(chat.read)&limit=30" } ?? "limit=30"
                do {
                    let response: MessagesResponse = try await self.api.request("/api/watch/conversations/\(id)/messages?\(query)", timeout: 35)
                    try Task.checkCancellation()
                    guard generation == self.sessionGeneration else { return }
                    self.merge(response, id: id); self.status = nil; delay = 2
                    // Empty conversations must use after=0 long polling after their initial load.
                    if cursor == nil && response.messages.isEmpty {
                        let empty: MessagesResponse = try await self.api.request("/api/watch/conversations/\(id)/messages?after=0&wait=20&pr=\(response.peerRead)&mr=\(response.read)",timeout:35)
                        try Task.checkCancellation()
                        guard generation == self.sessionGeneration else { return }
                        self.merge(empty,id:id)
                    }
                } catch {
                    if Task.isCancelled || generation != self.sessionGeneration { return }
                    if case WatchError.server(let code, _) = error, code == 403 || code == 404 {
                        self.chats.removeValue(forKey:id); self.path = []; self.error = error.localizedDescription; return
                    }
                    await self.handle(error)
                    if self.user == nil { return }
                    let pause = UInt64.random(in: delay...max(delay,delay*2))
                    do { try await Task.sleep(nanoseconds: pause * 1_000_000_000) } catch { return }
                    delay = min(delay * 2, 30)
                }
            }
        }
    }
    private func merge(_ response: MessagesResponse, id: Int64) {
        var chat = chats[id] ?? ChatCache(); chat.merge(response)
        // Keep a bounded UI window. Older-page loads use a separate bounded history window.
        chat.messages = Array(chat.messages.suffix(200)); chats[id] = chat
        let confirmed = Set((response.acks ?? []).map(\.i)); pending.removeAll { confirmed.contains($0.id) }
        if let index = conversations.firstIndex(where: { $0.id == id }) {
            conversations[index].peerRead = chat.peerRead
            if let last = response.messages.last, last.id > (conversations[index].last?.id ?? 0) { conversations[index].last = last }
        }
        persist()
    }
    func older(_ id: Int64) async {
        let generation = sessionGeneration
        guard let oldest = chats[id]?.messages.first?.id, (chats[id]?.messages.count ?? 0) < 200 else { return }
        do {
            let response: MessagesResponse = try await api.request("/api/watch/conversations/\(id)/messages?before=\(oldest)&limit=30")
            guard generation == sessionGeneration else { return }
            var chat = chats[id] ?? ChatCache(); chat.merge(response)
            // Retain at most 200 rows while navigating older history.
            chats[id] = chat
            if chat.messages.count > 200 { chats[id]?.messages = Array(chat.messages.suffix(200)) }
            persist()
        } catch { if generation == sessionGeneration { await handle(error) } }
    }
    func send(_ text: String, in id: Int64) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf16.count <= 2000, pending.count < 50 else { error = WatchL10n.text("Messages must be 2,000 characters or fewer."); return }
        let item = PendingMessage(id: UUID().uuidString.lowercased(),conversation:id,text:trimmed,createdAt:Date())
        pending.append(item)
        guard await saveNow() else { return } // Persist the retry key before the request.
        await retry(item.id)
    }
    func retry(_ pendingID: String) async {
        guard let index = pending.firstIndex(where: { $0.id == pendingID }), !pending[index].sending else { return }
        let generation = sessionGeneration
        let item = pending[index]; pending[index].sending = true
        do {
            let response: SendResponse = try await api.request("/api/watch/conversations/\(item.conversation)/messages",method:"POST",
                body:JSONEncoder().encode(SendBody(i:item.id,k:"t",x:item.text)))
            guard generation == sessionGeneration else { return }
            pending.removeAll { $0.id == response.i }
            var chat = chats[item.conversation] ?? ChatCache()
            if !chat.messages.contains(where: { $0.id == response.message.id }) { chat.messages.append(response.message); chat.messages.sort { $0.id < $1.id } }
            chat.messages = Array(chat.messages.suffix(200))
            chats[item.conversation] = chat; persist()
        } catch {
            guard generation == sessionGeneration else { return }
            if let i = pending.firstIndex(where: { $0.id == pendingID }) { pending[i].sending = false }
            await handle(error); persist()
        }
    }
    func discard(_ id: String) { pending.removeAll { $0.id == id }; persist() }
    func saw(_ message: WireMessage) {
        guard active, activeChat == message.c, message.s != user?.id, message.id > (chats[message.c]?.read ?? 0) else { return }
        pendingReads[message.c] = max(pendingReads[message.c] ?? 0,message.id)
        let highest = pendingReads[message.c]!
        let generation = sessionGeneration
        readTask?.cancel()
        readTask = Task {
            do {
                try await Task.sleep(nanoseconds:600_000_000)
                let response: ReadResponse = try await api.request("/api/watch/conversations/\(message.c)/read",method:"POST",body:JSONEncoder().encode(ReadBody(m:highest)))
                guard generation == sessionGeneration, !Task.isCancelled else { return }
                chats[message.c]?.read = max(chats[message.c]?.read ?? 0,response.watermark)
                if (pendingReads[message.c] ?? 0) <= response.watermark { pendingReads.removeValue(forKey:message.c) }
                if let i = conversations.firstIndex(where: { $0.id == message.c }) { conversations[i].unread = 0 }
                persist()
            } catch { if !Task.isCancelled && generation == sessionGeneration { await handle(error) } }
        }
    }
    func logout() async {
        // If offline, keep a revocation-only credential in Keychain to retry next activation.
        if let token = try? WatchSessionStore.read() { try? WatchSessionStore.save(token,account:"pendingLogout") }
        let _: OK? = try? await api.request("/api/watch/auth/logout",method:"POST")
        await clearSession()
    }
    func finishPendingLogout() async {
        guard let token = try? WatchSessionStore.read("pendingLogout") else { return }
        let cleanup = WatchAPIClient(base: URL(string:Bundle.main.object(forInfoDictionaryKey:"LiteChatAPIURL") as? String ?? "https://invalid.invalid")!)
        await cleanup.setToken(token)
        do { let _: OK = try await cleanup.request("/api/watch/auth/logout",method:"POST"); try? WatchSessionStore.delete("pendingLogout") }
        catch WatchError.unauthorized { try? WatchSessionStore.delete("pendingLogout") }
        catch { /* Retry only on next activation; never restore this credential for chat. */ }
    }
    func deleteAccount(password: String) async throws {
        let _: OK = try await api.request("/api/watch/auth/account",method:"DELETE",body:JSONEncoder().encode(DeleteBody(password:password)))
        await clearSession()
    }
    private func clearSession() async {
        sessionGeneration += 1
        poll?.cancel(); readTask?.cancel(); saveTask?.cancel(); sharePoll?.cancel()
        await api.setToken(nil); try? WatchSessionStore.delete(); SharedSessionLink.deleteShared()
        user = nil; conversations=[]; chats=[:]; pending=[]; pendingReads=[:]; path=[]; activeChat=nil
        await cache.clear()
    }
    private func handle(_ error: Error) async {
        if case WatchError.unauthorized = error { await clearSession(); self.error = error.localizedDescription }
        else { status = WatchL10n.text("Waiting for connection…") }
    }
    private func persist() {
        saveTask?.cancel()
        saveTask = Task { do { try await Task.sleep(nanoseconds:500_000_000); _ = await saveNow() } catch {} }
    }
    private func saveNow() async -> Bool {
        guard let user else { return false }
        let snapshot = WatchSnapshot(user:user,conversations:conversations,chats:Dictionary(uniqueKeysWithValues:chats.map { (String($0.key),$0.value) }),pending:pending)
        do { try await cache.save(snapshot); return true } catch { self.error = WatchL10n.text("Could not save conversations on this device."); return false }
    }
}
