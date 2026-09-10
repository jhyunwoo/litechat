import Foundation

struct PublicUser: Codable, Identifiable, Equatable { let id: Int64; let username: String; let nickname: String }
struct WireImage: Codable, Equatable { let id: String; let w: Int; let h: Int; let tb: Int; let ob: Int }
struct WireMessage: Codable, Identifiable, Equatable {
    let id: Int64; let c: Int64; let s: Int64; let k: String; let x: String; let ts: Int64
    let im: WireImage?; let r: Int64?
    var preview: String { k == "i" ? "📷 사진" : x }
}
struct WireQuote: Codable, Identifiable { let id: Int64; let s: Int64; let k: String; let x: String }
struct ConversationSummary: Codable, Identifiable {
    let id: Int64; let peer: PublicUser; var last: WireMessage?; var unread: Int; var peerRead: Int64
}
struct AuthResponse: Decodable { let user: PublicUser; let token: String }
struct IdentityResponse: Decodable { let user: PublicUser }
struct ConversationsResponse: Decodable { let conversations: [ConversationSummary] }
struct SendResponse: Decodable { let i: String; let message: WireMessage }
struct Ack: Codable { let i: String; let id: Int64 }
struct MessagesResponse: Decodable {
    let messages: [WireMessage]; let refs: [WireQuote]?; let acks: [Ack]?
    let read: Int64; let peerRead: Int64
}
struct OK: Decodable { let ok: Bool }
struct ReadResponse: Decodable { let watermark: Int64 }
struct Credentials: Encodable { let username: String; let password: String; let nickname: String? }
struct ReadBody: Encodable { let m: Int64 }
struct DeleteBody: Encodable { let password: String }
struct PushBody: Encodable { let token: String; let environment: String }
struct PendingMessage: Codable, Identifiable {
    let id: String; let conversation: Int64; let text: String; let createdAt: Date
    var sending = false
}
struct SendBody: Encodable { let i: String; let k: String; let x: String }

// No wire messages are invented for local drafts. Canonical messages deduplicate by ID.
struct ChatCache: Codable {
    var messages: [WireMessage] = []; var refs: [WireQuote] = []
    var read: Int64 = 0; var peerRead: Int64 = 0
    mutating func merge(_ response: MessagesResponse) {
        var byID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        for message in response.messages { byID[message.id] = message }
        messages = byID.values.sorted { $0.id < $1.id }
        var quotes = Dictionary(refs.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        for quote in response.refs ?? [] { quotes[quote.id] = quote }
        refs = Array(quotes.values.suffix(200))
        read = max(read, response.read); peerRead = max(peerRead, response.peerRead)
    }
}
