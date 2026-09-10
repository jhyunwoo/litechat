import Foundation

struct WatchSnapshot: Codable {
    let user: PublicUser
    var conversations: [ConversationSummary]
    var chats: [String: ChatCache]
    var pending: [PendingMessage]
}
actor WatchCacheStore {
    private let file: URL
    init() {
        file = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("watch-content.json")
    }
    func load() -> WatchSnapshot? {
        guard let data = try? Data(contentsOf: file), data.count <= 4 * 1024 * 1024 else { return nil }
        return try? JSONDecoder().decode(WatchSnapshot.self, from: data)
    }
    func save(_ snapshot: WatchSnapshot) throws {
        var bounded = snapshot
        bounded.conversations = Array(snapshot.conversations.prefix(100))
        let recent = snapshot.chats.sorted { ($0.value.messages.last?.ts ?? 0) > ($1.value.messages.last?.ts ?? 0) }.prefix(10)
        bounded.chats = Dictionary(uniqueKeysWithValues: recent.map { key, value in
            var chat = value; chat.messages = Array(value.messages.suffix(100)); return (key, chat)
        })
        bounded.pending = Array(snapshot.pending.suffix(50)).map { var p = $0; p.sending = false; return p }
        let data = try JSONEncoder().encode(bounded)
        guard data.count <= 4 * 1024 * 1024 else { throw WatchError.storage }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file, options: [.atomic, .completeFileProtection])
        var url = file; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }
    func clear() { try? FileManager.default.removeItem(at: file) }
}
