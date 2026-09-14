import XCTest
@testable import WatchCore

final class WatchCoreTests: XCTestCase {
    func testPrimaryLanguageAndEnglishFallback() {
        for primary in ["ko", "ko-KR", "ko_KR", "KO-kr"] {
            XCTAssertEqual(WatchL10n.language(for: [primary, "en"]), "ko")
        }
        for languages in [["en-US", "ko"], ["ja-JP", "ko-KR"], ["fr"], []] {
            XCTAssertEqual(WatchL10n.language(for: languages), "en")
        }
    }
    func testNativeResourcesAndUntranslatedUserContent() {
        XCTAssertEqual(WatchL10n.text("Send message", language: "ko"), "메시지 보내기")
        XCTAssertEqual(WatchL10n.text("Send message", language: "en"), "Send message")
        XCTAssertEqual(WatchL10n.text("Read", language: "ko"), "읽음")
        XCTAssertEqual(WatchL10n.text("Please sign in again.", language: "ko"), "다시 로그인해 주세요.")
        let message = WireMessage(id: 1, c: 1, s: 2, k: "t", x: "안녕, Alex!", ts: 1, im: nil, r: nil)
        XCTAssertEqual(message.preview, "안녕, Alex!")
    }
    func testCompactWireModelsAndQuoteIsolation() throws {
        let json = #"{"messages":[{"id":8,"c":2,"s":3,"k":"i","x":"img","ts":100,"im":{"id":"img","w":80,"h":80,"tb":200,"ob":4000},"r":7}],"refs":[{"id":7,"s":1,"k":"t","x":"truncated"}],"read":0,"peerRead":8,"acks":[{"i":"local","id":8}]}"#
        let response = try JSONDecoder().decode(MessagesResponse.self,from:Data(json.utf8))
        var cache = ChatCache(); cache.merge(response); cache.merge(response)
        XCTAssertEqual(cache.messages.count,1)
        XCTAssertEqual(cache.messages.first?.im?.tb,200)
        XCTAssertEqual(cache.refs.first?.id,7)
        XCTAssertFalse(cache.messages.contains { $0.id == 7 })
        XCTAssertEqual(cache.peerRead,8)
    }
    func testWatermarksNeverRegressAndMessagesSort() throws {
        func response(_ id:Int,_ read:Int) throws -> MessagesResponse {
            try JSONDecoder().decode(MessagesResponse.self,from:Data("{\"messages\":[{\"id\":\(id),\"c\":1,\"s\":2,\"k\":\"t\",\"x\":\"hi\",\"ts\":1}],\"read\":\(read),\"peerRead\":\(read)}".utf8))
        }
        var cache=ChatCache();cache.merge(try response(9,9));cache.merge(try response(4,1))
        XCTAssertEqual(cache.messages.map(\.id),[4,9]);XCTAssertEqual(cache.peerRead,9);XCTAssertEqual(cache.read,9)
    }
    func testFailedSendIdentitySurvivesSerialization() throws {
        let draft=PendingMessage(id:"same-retry-key",conversation:12,text:"👋",createdAt:Date())
        let restored=try JSONDecoder().decode(PendingMessage.self,from:JSONEncoder().encode(draft))
        XCTAssertEqual(restored.id,draft.id);XCTAssertEqual(restored.text,"👋");XCTAssertFalse(restored.sending)
    }
}
