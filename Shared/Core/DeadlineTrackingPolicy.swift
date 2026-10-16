import Foundation

enum DeadlineTrackingPolicy {
    static let maximumDuration: TimeInterval = 8 * 3600
    static func dueDate(for record: WorkspaceRecord, in state: WorkspaceState, now: Date = Date(), startedAt: Date? = nil) -> Date? {
        guard (record.kind.isItem || record.kind == .deadline), !record.isFinished,
              WorkspaceLogic.visible(record, in: state), let date = record.dueDate else { return nil }
        let due = record.effectiveDueDate(date)
        guard due > now, due.timeIntervalSince(now) <= maximumDuration,
              startedAt.map({ due <= $0.addingTimeInterval(maximumDuration) }) ?? true else { return nil }
        return due
    }
    static func explanation(for record: WorkspaceRecord, in state: WorkspaceState, now: Date = Date()) -> String {
        if !record.kind.isItem && record.kind != .deadline { return "实时活动用于有截止时间的事项和截止事项。" }
        if record.isFinished || !WorkspaceLogic.visible(record, in: state) { return "完成、取消或归档的事项不能开始追踪。" }
        guard let date = record.dueDate else { return "设置截止时间后可开始追踪。" }
        if record.effectiveDueDate(date) <= now { return "此事项已到截止时间。" }
        if record.effectiveDueDate(date).timeIntervalSince(now) > maximumDuration { return "截止前 8 小时内可开始锁屏追踪。" }
        return "标题与倒计时会显示在锁屏和灵动岛，点击可回到详情。"
    }
}
