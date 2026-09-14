import Foundation

enum WatchL10n {
    // Match the phone's primary-language rule, including ko-KR and ko_KR.
    static func language(for preferredLanguages: [String]) -> String {
        let primary = preferredLanguages.first ?? "en"
        return primary.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first == "ko" ? "ko" : "en"
    }

    static var language: String { language(for: Locale.preferredLanguages) }
    static var locale: Locale { Locale(identifier: language == "ko" ? "ko_KR" : "en_US") }

    static func text(_ key: String, language: String = WatchL10n.language) -> String {
        #if SWIFT_PACKAGE
        let resources = Bundle.module
        #else
        let resources = Bundle.main
        #endif
        guard let path = resources.path(forResource: language == "ko" ? "ko" : "en", ofType: "lproj"),
              let bundle = Bundle(path: path) else { return key }
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }
}
