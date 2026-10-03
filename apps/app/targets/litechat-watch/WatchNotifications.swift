import Foundation
import WatchKit
import UserNotifications

final class WatchApplicationDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var model: WatchModel?
    private var currentToken: String?
    private var registrationInFlight = false
    private var uploadedSession: String?
    private var uploadedToken: String?
    private var authorizationInFlight = false
    private var pendingConversation: Int64?
    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
    }
    @MainActor func attach(_ model: WatchModel) {
        self.model = model
        model.registerNotifications = { [weak self] in
            Task { @MainActor in await self?.requestPermission() }
        }
        if let id = pendingConversation { pendingConversation = nil; model.notification(id) }
        Task { await requestPermission() }
    }
    @MainActor func requestPermission() async {
        guard let model, model.user != nil, model.active, !authorizationInFlight else { return }
        authorizationInFlight = true
        defer { authorizationInFlight = false }
        let center = UNUserNotificationCenter.current()
        do {
            var settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                _ = try await center.requestAuthorization(options:[.alert,.sound,.badge])
                settings = await center.notificationSettings()
            }
            guard model.user != nil, model.active else { return }
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                model.notificationStatus = WatchL10n.text("Notifications are disabled. Enable LiteChat notifications in Settings.")
                return
            }
            if settings.alertSetting != .enabled {
                model.notificationStatus = WatchL10n.text("Notification alerts are disabled. Enable alerts in Settings.")
            } else {
                model.notificationStatus = nil
            }
            WKApplication.shared().registerForRemoteNotifications()
            upload()
        } catch {
            model.notificationStatus = WatchL10n.text("Could not enable notifications. Please try again.")
        }
    }
    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format:"%02x",$0) }.joined()
        Task { @MainActor in currentToken = token; uploadedSession = nil; upload() }
    }
    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        Task { @MainActor in
            model?.notificationStatus = WatchL10n.text("Could not register this Watch for notifications. Please try again.")
        }
    }
    @MainActor func registerOnActivation() { Task { await requestPermission() } }
    @MainActor private func upload() {
        guard let model, model.user != nil, let token = currentToken, !registrationInFlight else { return }
        guard let session = try? WatchSessionStore.read() else {
            model.notificationStatus = WatchL10n.text("Cannot access secure storage. Unlock your Watch and try again.")
            return
        }
        guard uploadedSession != session || uploadedToken != token else { return }
        // CNG supplies the distribution environment; archive verification checks it against
        // the actual signed entitlement. No private Security/SecTask APIs on watchOS.
        guard let value = Bundle.main.object(forInfoDictionaryKey:"LiteChatAPNsEnvironment") as? String,
              ["sandbox","production"].contains(value) else {
            model.notificationStatus = WatchL10n.text("Could not read app settings.")
            return
        }
        registrationInFlight = true
        Task { @MainActor in
            defer {
                registrationInFlight = false
                // A new APNs token/session may arrive while the request is in flight.
                if currentToken != token || (try? WatchSessionStore.read()) != session { upload() }
            }
            do {
                let _: OK = try await model.api.request("/api/watch/push/register",method:"POST",
                    body:JSONEncoder().encode(PushBody(token:token,environment:value)), bearer:session)
                guard currentToken == token, (try? WatchSessionStore.read()) == session else { return }
                uploadedSession = session; uploadedToken = token
            } catch {
                guard currentToken == token, (try? WatchSessionStore.read()) == session else { return }
                model.notificationStatus = WatchL10n.text("Could not register notifications with the server. Open the app to retry.")
            }
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
