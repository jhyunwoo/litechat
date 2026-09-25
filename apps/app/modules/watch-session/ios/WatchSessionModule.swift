import ExpoModulesCore
import Security

/// Mirrors the phone's session token into an iCloud-synchronizable keychain
/// item so the independent watchOS app can adopt it. The item lives in this
/// app's default keychain group; the watch declares that group in its own
/// keychain-access-groups entitlement and reads the synced copy.
public final class WatchSessionModule: Module {
    private static let service = "kr.moveto.litechat.watch.session"
    private static let account = "session"

    public func definition() -> ModuleDefinition {
        Name("WatchSession")

        Function("publishSessionToken") { (token: String?) in
            if let token, !token.isEmpty {
                Self.upsert(token)
            } else {
                Self.delete()
            }
        }
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        ]
    }

    private static func upsert(_ token: String) {
        let data = Data(token.utf8)
        let status = SecItemUpdate(
            baseQuery() as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if status == errSecItemNotFound {
            var attributes = baseQuery()
            attributes[kSecAttrSynchronizable as String] = true
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
            attributes[kSecValueData as String] = data
            SecItemAdd(attributes as CFDictionary, nil)
        }
    }

    private static func delete() {
        SecItemDelete(baseQuery() as CFDictionary)
    }
}
