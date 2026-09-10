import Foundation
import WatchKit
import UserNotifications

final class WatchApplicationDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var model: WatchModel?
    private var currentToken: String?
    private var registrationInFlight = false
    private var uploadedSession: String?
    private var pendingConversation: Int64?
    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
        WKApplication.shared().registerForRemoteNotifications()
    }
    @MainActor func attach(_ model: WatchModel) {
        self.model = model
        model.registerNotifications = { [weak self] in self?.upload() }
        if let id = pendingConversation { pendingConversation = nil; model.notification(id) }
        upload()
    }
    @MainActor func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound,.badge])
        WKApplication.shared().registerForRemoteNotifications()
    }
    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format:"%02x",$0) }.joined()
        Task { @MainActor in currentToken = token; uploadedSession = nil; upload() }
    }
    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        // Launch/activation retries registration. Do not log device tokens or credentials.
    }
    @MainActor func registerOnActivation() { WKApplication.shared().registerForRemoteNotifications() }
    @MainActor private func upload() {
        guard let model, model.user != nil, let token = currentToken, !registrationInFlight,
              let session = try? WatchSessionStore.read(), uploadedSession != session else { return }
        // CNG supplies the distribution environment; archive verification checks it against
        // the actual signed entitlement. No private Security/SecTask APIs on watchOS.
        guard let value = Bundle.main.object(forInfoDictionaryKey:"LiteChatAPNsEnvironment") as? String,
              ["sandbox","production"].contains(value) else { return }
        registrationInFlight = true
        Task { @MainActor in
            defer { registrationInFlight = false }
            do {
                let _: OK = try await model.api.request("/api/watch/push/register",method:"POST",
                    body:JSONEncoder().encode(PushBody(token:token,environment:value)))
                uploadedSession = session
            } catch { /* Retry on activation or next successful refresh. */ }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let id = (notification.request.content.userInfo["c"] as? NSNumber)?.int64Value
        Task { @MainActor in
            if let id { model?.receivedNotification(id) }
            // The active chat already renders its update; other conversations may show a banner.
            completionHandler(model?.path.last == id ? [] : [.banner,.sound])
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = (response.notification.request.content.userInfo["c"] as? NSNumber)?.int64Value
        Task { @MainActor in
            if let id { if let model { model.notification(id) } else { pendingConversation = id } }
            completionHandler()
        }
    }
}
