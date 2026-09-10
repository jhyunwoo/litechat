import SwiftUI
import WatchKit

@main struct LiteChatWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchApplicationDelegate.self) private var delegate
    @StateObject private var model = WatchModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            WatchRootView().environmentObject(model)
                .task { delegate.attach(model); await model.finishPendingLogout(); await model.bootstrap() }
                .onChange(of: phase) { _, phase in
                    model.setActive(phase == .active)
                    if phase == .active { delegate.registerOnActivation(); Task { await model.finishPendingLogout() } }
                }
                .environment(\.requestWatchNotifications, { await delegate.requestPermission() })
        }
    }
}
private struct NotificationPermissionKey: EnvironmentKey {
    static let defaultValue: () async -> Void = {}
}
extension EnvironmentValues {
    var requestWatchNotifications: () async -> Void {
        get { self[NotificationPermissionKey.self] }
        set { self[NotificationPermissionKey.self] = newValue }
    }
}
