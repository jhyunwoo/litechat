import Foundation
import Security

/// Reads the session token the companion iOS app mirrors into its own
/// keychain access group with iCloud synchronization enabled. The watch
/// declares `<teamID>.kr.moveto.litechat` in keychain-access-groups, so the
/// synced copy is readable here once iCloud Keychain delivers it.
enum SharedSessionLink {
    private static let service = "kr.moveto.litechat.watch.session"
    private static let account = "session"
    private static let groupName = "kr.moveto.litechat"

    static func read() throws -> String? {
        guard let group = accessGroup() else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: group,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw WatchError.storage }
        return String(data: data, encoding: .utf8)
    }

    /// Removes the shared copy so a deliberate sign-out on the watch is not
    /// immediately re-adopted from the still-signed-in phone.
    static func deleteShared() {
        guard let group = accessGroup() else { return }
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: group,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        ] as CFDictionary)
    }

    /// The phone app's access group shares this app's team prefix: the default
    /// group resolves to `<teamID>.kr.moveto.litechat.watch`, the companion's
    /// group swaps the bundle suffix for `kr.moveto.litechat`.
    private static func accessGroup() -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: "bundleSeedID",
            kSecAttrService as String: "",
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        var status = SecItemCopyMatching(query as CFDictionary, &result)
        var created = false
        if status == errSecItemNotFound {
            status = SecItemAdd(query as CFDictionary, &result)
            created = status == errSecSuccess
        }
        defer {
            if created {
                query.removeValue(forKey: kSecReturnAttributes as String)
                SecItemDelete(query as CFDictionary)
            }
        }
        guard status == errSecSuccess,
              let attributes = result as? [String: Any],
              let group = attributes[kSecAttrAccessGroup as String] as? String,
              let dot = group.firstIndex(of: ".") else { return nil }
        return "\(group[..<dot]).\(groupName)"
    }
}
