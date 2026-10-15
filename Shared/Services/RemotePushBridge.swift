import Foundation
#if os(macOS)
import AppKit
#else
import BackgroundTasks
import UIKit
#endif

#if os(iOS)
@MainActor enum WorkspaceBackgroundSync {
    static let taskIdentifier = "com.guangyi.workspace.native.ios.refresh"

    static func updateSchedule(for store: WorkspaceStore?) {
        guard let store, store.canAutomaticallySync else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    static func perform(_ store: WorkspaceStore?) async {
        guard let store, store.canAutomaticallySync else {
            updateSchedule(for: store)
            return
        }
        // Schedule the next opportunity before starting so cancellation does not
        // silently disable future refreshes. The system decides the actual time.
        updateSchedule(for: store)
        guard !store.syncing else { return }
        try? await store.synchronize()
    }
}
#endif

@MainActor final class RemotePushBridge {
    static let shared = RemotePushBridge()
    weak var store: WorkspaceStore?
    static func registerWithApple() throws {
        guard Bundle.main.object(forInfoDictionaryKey: "RemotePushEnabled") as? Bool == true else {
            throw WorkspaceFailure.invalid("请先在 Xcode 为目标添加 Push Notifications，并将 Info.plist 的 RemotePushEnabled 改为 YES。当前本地通知不需要此能力。")
        }
        #if os(macOS)
        NSApplication.shared.registerForRemoteNotifications()
        #else
        UIApplication.shared.registerForRemoteNotifications()
        #endif
    }
    func registered(_ token: Data) {
        Task {
            do { try await store?.backend.registerDevice(token); store?.information = "APNs 设备已向你的服务器注册。" }
            catch { store?.errorMessage = error.localizedDescription }
        }
    }
    func failed(_ error: Error) {
        store?.errorMessage = "APNs 注册失败：\(error.localizedDescription)。请检查签名与 Push Notifications 能力。"
    }
}
#if os(macOS)
@MainActor final class NativePlatformDelegate: NSObject, NSApplicationDelegate {
    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        RemotePushBridge.shared.registered(deviceToken)
    }
    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        RemotePushBridge.shared.failed(error)
    }
}
#else
@MainActor final class NativePlatformDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        RemotePushBridge.shared.registered(deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        RemotePushBridge.shared.failed(error)
    }
}
#endif
