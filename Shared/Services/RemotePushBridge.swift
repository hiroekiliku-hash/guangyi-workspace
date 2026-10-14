import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
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
