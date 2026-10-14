#if os(iOS)
import SwiftUI

struct DeadlineLiveActivitySection: View {
    @Environment(WorkspaceStore.self) private var store
    let record: WorkspaceRecord
    var body: some View {
        Section("锁屏与灵动岛") {
            TimelineView(.periodic(from: .now, by: 15)) { context in
                let coordinator = store.liveActivity
                let tracking = coordinator.activeRecordID == record.id
                VStack(alignment: .leading, spacing: 10) {
                    if tracking {
                        Label("正在追踪此事项", systemImage: "timer").font(.headline)
                        Button("结束追踪", systemImage: "stop.circle") { coordinator.end() }
                            .disabled(coordinator.working)
                    } else {
                        Button(coordinator.activeRecordID == nil ? "开始实时追踪" : "改为追踪此事项", systemImage: "timer") {
                            coordinator.start(record.id, in: store.state)
                        }.disabled(coordinator.working || !coordinator.enabled || DeadlineTrackingPolicy.dueDate(for: record, in: store.state, now: context.date) == nil)
                    }
                    Text(coordinator.enabled ? DeadlineTrackingPolicy.explanation(for: record, in: store.state, now: context.date) : "系统未允许实时活动，可在 iPhone 设置中开启。")
                        .font(.caption).foregroundStyle(.secondary)
                    if let message = coordinator.message { Text(message).font(.caption).foregroundStyle(.red) }
                }
            }
        }
    }
}
#endif
