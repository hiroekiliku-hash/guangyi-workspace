import Foundation
import Observation
import UserNotifications

@MainActor @Observable final class NotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    @ObservationIgnored weak var store: WorkspaceStore?
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var pendingCount = 0
    private(set) var unscheduledCount = 0
    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "notificationsEnabled") }
        set { UserDefaults.standard.set(newValue, forKey: "notificationsEnabled") }
    }
    @ObservationIgnored private var scheduling: Task<Void, Never>?
    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        let complete = UNNotificationAction(identifier: "COMPLETE", title: "完成", options: .authenticationRequired)
        let snooze = UNNotificationAction(identifier: "SNOOZE", title: "十分钟后提醒", options: .authenticationRequired)
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "WORKSPACE_REMINDER", actions: [complete, snooze], intentIdentifiers: [])
        ])
    }
    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        pendingCount = await UNUserNotificationCenter.current().pendingNotificationRequests().filter { $0.identifier.hasPrefix("gw:") }.count
    }
    func requestAuthorization() async throws {
        let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        enabled = allowed
        await refreshAuthorization()
        if allowed, let store { reschedule(store.state) }
        if !allowed { throw WorkspaceFailure.invalid("系统未允许通知。请在系统通知设置中开启广益 WorkSpace。") }
    }
    func reschedule(_ state: WorkspaceState) {
        let previous = scheduling
        previous?.cancel()
        scheduling = Task { [weak self] in
            await previous?.value
            guard !Task.isCancelled, let self else { return }
            await self.applySchedule(state)
        }
    }
    private func applySchedule(_ state: WorkspaceState) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        guard !Task.isCancelled else { return }
        let owned = pending.filter { $0.identifier.hasPrefix("gw:") }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: owned)
        let liveRecords = Dictionary(uniqueKeysWithValues: state.records.filter { WorkspaceLogic.visible($0, in: state) }
            .map { ($0.id.uuidString, $0) })
        let delivered = await center.deliveredNotifications()
        let obsolete = delivered.filter { notification in
            let content = notification.request.content
            let managed = notification.request.identifier.hasPrefix("gw:") || content.categoryIdentifier == "WORKSPACE_REMINDER"
            guard managed, let id = content.userInfo["id"] as? String else { return false }
            guard let record = liveRecords[id] else { return true }
            let scheduledAt = (content.userInfo["scheduledAt"] as? NSNumber)?.doubleValue
            return !WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: scheduledAt)
        }.map { $0.request.identifier }
        center.removeDeliveredNotifications(withIdentifiers: obsolete)
        let overdue = state.records.filter { WorkspaceLogic.visible($0, in: state) && $0.isOverdue }.count
        try? await center.setBadgeCount(enabled ? overdue : 0)
        let candidates = state.records.compactMap { record -> (WorkspaceRecord, Date)? in
            guard WorkspaceLogic.visible(record, in: state), let date = record.notificationDate, date > Date() else { return nil }
            return (record, date)
        }.sorted { $0.1 < $1.1 }
        unscheduledCount = max(0, candidates.count - 60)
        guard enabled else { pendingCount = 0; return }
        for (record, date) in candidates.prefix(60) {
            guard !Task.isCancelled else { return }
            let content = UNMutableNotificationContent()
            content.title = "广益 WorkSpace · \(record.kind.title)"
            content.body = record.title
            content.sound = .default
            content.threadIdentifier = record.projectID?.uuidString ?? "workspace-\(record.kind.rawValue)"
            if [.task, .deadline, .reminder].contains(record.kind) { content.categoryIdentifier = "WORKSPACE_REMINDER" }
            if let due = record.dueDate {
                let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.timeZone = record.calendar.timeZone
                formatter.dateFormat = record.dateOnly ? "M月d日截止" : "M月d日 HH:mm截止"
                content.subtitle = formatter.string(from: due)
            }
            content.userInfo = ["id": record.id.uuidString, "scheduledAt": Int64((date.timeIntervalSince1970 * 1000).rounded())]
            var components = record.calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            components.timeZone = record.calendar.timeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            do { try await center.add(UNNotificationRequest(identifier: "gw:\(record.id)", content: content, trigger: trigger)) }
            catch { store?.errorMessage = "通知安排失败：\(error.localizedDescription)" }
        }
        await refreshAuthorization()
    }
    func sendTest() async throws {
        let content = UNMutableNotificationContent()
        content.title = "广益 WorkSpace · 通知测试"
        content.body = "系统通知已接通。提醒安排后，关闭应用也可以收到通知。"
        content.sound = .default
        try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "workspace-test",
            content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 3, repeats: false)))
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let rawID = response.notification.request.content.userInfo["id"] as? String
        let scheduledAt = (response.notification.request.content.userInfo["scheduledAt"] as? NSNumber)?.doubleValue
        let action = response.actionIdentifier
        guard let rawID, let id = UUID(uuidString: rawID) else { return }
        await handleNotification(id: id, action: action, scheduledAt: scheduledAt)
    }
    private func handleNotification(id: UUID, action: String, scheduledAt: Double?) async {
        guard let store else { return }
        if store.record(id) == nil, store.canAutomaticallySync {
            do { try await store.synchronize() }
            catch {
                store.errorMessage = "无法取得这项提醒的最新资料：\(error.localizedDescription)"
                return
            }
        }
        guard let record = store.record(id) else {
            store.information = "此提醒对应的记录尚未同步到本机。请确认已登录同一账号并开启自动同步。"
            return
        }
        if action == "COMPLETE" || action == "SNOOZE" {
            guard WorkspaceLogic.visible(record, in: store.state), !record.isFinished,
                  [.task, .deadline, .reminder].contains(record.kind),
                  WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: scheduledAt) else {
                store.information = "这项提醒已经完成、关闭或改期，旧通知没有修改当前记录。"
                return
            }
        }
        if action == "COMPLETE" { store.perform { try store.setStatus(id, record.kind == .project ? "COMPLETED" : "DONE") } }
        else if action == "SNOOZE" {
            var changed = record
            changed.snoozedUntil = Date().addingTimeInterval(600)
            store.perform { try store.save(changed, expectedVersion: record.version) }
        } else {
            store.navigation = record.kind == .knowledge ? .knowledge : record.kind == .deadline ? .deadlines : .actions
            store.openedRecordID = id
        }
    }
}
