#if os(iOS)
import ActivityKit
import Observation
import Foundation

@MainActor @Observable final class DeadlineLiveActivityCoordinator {
    private(set) var activeRecordID: UUID?
    private(set) var working = false
    private(set) var message: String?
    var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }
    @ObservationIgnored private var latestState = WorkspaceState()
    @ObservationIgnored private var queue: Task<Void, Never>?
    @ObservationIgnored private var watchers: [String: Task<Void, Never>] = [:]

    private var active: [Activity<DeadlineActivityAttributes>] {
        Activity<DeadlineActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
    }
    func start(_ id: UUID, in state: WorkspaceState) {
        latestState = state
        submit {
            guard self.enabled else { throw WorkspaceFailure.invalid("请在系统设置中允许工作坊的实时活动。") }
            let now = Date()
            guard let record = self.latestState.records.first(where: { $0.id == id }),
                  let due = DeadlineTrackingPolicy.dueDate(for: record, in: self.latestState, now: now) else {
                throw WorkspaceFailure.invalid("此事项当前不符合实时活动追踪条件。")
            }
            for old in Activity<DeadlineActivityAttributes>.activities { await old.end(nil, dismissalPolicy: .immediate) }
            let activity = try Activity.request(attributes: DeadlineActivityAttributes(recordID: id, startedAt: now),
                content: ActivityContent(state: .init(title: record.title, dueDate: due), staleDate: due), pushType: nil)
            self.watch(activity)
            self.activeRecordID = id
        }
    }
    func end() {
        submit {
            for activity in Activity<DeadlineActivityAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
            self.activeRecordID = nil
        }
    }
    func synchronize(_ state: WorkspaceState) {
        latestState = state
        submit {
            let values = self.active.sorted { $0.attributes.startedAt > $1.attributes.startedAt }
            for duplicate in values.dropFirst() { await duplicate.end(nil, dismissalPolicy: .immediate) }
            guard let activity = values.first else { self.activeRecordID = nil; return }
            self.watch(activity)
            guard let record = self.latestState.records.first(where: { $0.id == activity.attributes.recordID }),
                  let due = DeadlineTrackingPolicy.dueDate(for: record, in: self.latestState, startedAt: activity.attributes.startedAt) else {
                await activity.end(nil, dismissalPolicy: .immediate); self.activeRecordID = nil; return
            }
            let content = DeadlineActivityAttributes.ContentState(title: record.title, dueDate: due)
            if content != activity.content.state { await activity.update(ActivityContent(state: content, staleDate: due)) }
            self.activeRecordID = activity.attributes.recordID
        }
    }
    private func submit(_ operation: @escaping @MainActor () async throws -> Void) {
        let previous = queue
        queue = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            self.working = true; self.message = nil
            do { try await operation() } catch { self.message = error.localizedDescription }
            self.activeRecordID = self.active.first?.attributes.recordID
            self.working = false
        }
    }
    private func watch(_ activity: Activity<DeadlineActivityAttributes>) {
        guard watchers[activity.id] == nil else { return }
        watchers[activity.id] = Task { [weak self] in
            for await status in activity.activityStateUpdates {
                guard let self else { return }
                if status == .ended || status == .dismissed {
                    self.activeRecordID = self.active.first?.attributes.recordID
                    self.watchers[activity.id] = nil
                    return
                }
            }
        }
    }
}
#endif
