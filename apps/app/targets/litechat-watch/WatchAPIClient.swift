import Foundation

enum WatchError: Error, LocalizedError {
    case unauthorized, storage, configuration, invalidResponse, server(Int, String), offline
    var errorDescription: String? {
        switch self {
        case .unauthorized: return WatchL10n.text("Please sign in again.")
        case .storage: return WatchL10n.text("Cannot access secure storage. Unlock your Watch and try again.")
        case .configuration: return WatchL10n.text("Could not read app settings.")
        case .invalidResponse: return WatchL10n.text("Could not read the response. Please try again.")
        case .offline: return WatchL10n.text("Waiting for connection…")
        case .server(_, let code):
            switch code {
            case "INVALID_CREDENTIALS": return WatchL10n.text("Incorrect username or password.")
            case "USERNAME_TAKEN": return WatchL10n.text("This username is already taken.")
            case "FORBIDDEN", "NOT_FOUND": return WatchL10n.text("This conversation is unavailable.")
            case "RATE_LIMITED", "POLL_LIMIT": return WatchL10n.text("Please try again shortly.")
            default: return WatchL10n.text("Could not complete the request. Please try again.")
            }
        }
    }
}

actor WatchAPIClient {
    private let base: URL
    private let session: URLSession
    private var token: String?
    init(base: URL) {
        self.base = base
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.urlCache = nil
        config.httpShouldSetCookies = false; config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 35; config.timeoutIntervalForResource = 40
        config.waitsForConnectivity = false; config.allowsCellularAccess = true
        self.session = URLSession(configuration: config, delegate: SameOriginDelegate(base: base), delegateQueue: nil)
    }
    func setToken(_ value: String?) { token = value }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, timeout: TimeInterval = 15) async throws -> T {
        let data = try await bytes(path, method: method, body: body, timeout: timeout)
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw WatchError.invalidResponse }
    }
    func bytes(_ path: String, method: String = "GET", body: Data? = nil, timeout: TimeInterval = 15) async throws -> Data {
        guard base.scheme == "https", let url = URL(string: path, relativeTo: base)?.absoluteURL,
              url.host == base.host, url.scheme == "https" else { throw WatchError.configuration }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse else { throw WatchError.invalidResponse }
        if response.statusCode == 401 {
            struct Failure: Decodable { let error: String }
            if (try? JSONDecoder().decode(Failure.self, from:data).error) == "INVALID_CREDENTIALS" {
                throw WatchError.server(401,"INVALID_CREDENTIALS")
            }
            throw WatchError.unauthorized
        }
        guard (200..<300).contains(response.statusCode) else {
            struct Failure: Decodable { let error: String }
            let code = (try? JSONDecoder().decode(Failure.self, from: data).error) ?? "INTERNAL"
            throw WatchError.server(response.statusCode, code)
        }
        guard data.count <= 2 * 1024 * 1024 else { throw WatchError.invalidResponse }
        return data
    }
}

private final class SameOriginDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let base: URL
    init(base: URL) { self.base = base }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // No redirects for authenticated requests, including same-host paths outside the Watch API.
        completionHandler(nil)
    }
}
