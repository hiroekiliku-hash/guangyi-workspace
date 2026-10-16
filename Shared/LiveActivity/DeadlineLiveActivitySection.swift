#if os(iOS)
import SwiftUI

struct DeadlineLiveActivitySection: View {
    @Environment(WorkspaceStore.self) private var store
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    let record: WorkspaceRecord
    var body: some View {
        Section("锁屏与灵动岛") {
            TimelineView(.periodic(from: .now, by: 15)) { context in
                let coordinator = store.liveActivity
                let tracking = coordinator.activeRecordID == record.id
                let eligible = coordinator.enabled && DeadlineTrackingPolicy.dueDate(for: record, in: store.state, now: context.date) != nil
                VStack(alignment: .leading, spacing: 14) {
                    if tracking {
                        HStack(spacing: 10) {
                            Image(systemName: "waveform.path").foregroundStyle(.indigo)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("正在实时追踪").font(.headline)
                                Text("锁屏查看进度 · 长按灵动岛展开").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Button("结束追踪", systemImage: "stop.fill") { coordinator.end() }
                            .buttonStyle(WorkspacePrimaryButtonStyle(tint: .secondary, prominent: false))
                            .disabled(coordinator.working)
                    } else if eligible {
                        Button(coordinator.activeRecordID == nil ? "开始实时追踪" : "追踪此事项", systemImage: "waveform.path") {
                            coordinator.start(record.id, in: store.state)
                        }
                        .buttonStyle(WorkspacePrimaryButtonStyle(prominent: false))
                        .disabled(coordinator.working)
                    } else {
                        Label("实时追踪", systemImage: "waveform.path")
                            .font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                    }
                    Text(coordinator.enabled ? DeadlineTrackingPolicy.explanation(for: record, in: store.state, now: context.date) : "系统未允许实时活动，可在 iPhone 设置中开启。")
                        .font(.caption).foregroundStyle(.secondary)
                    if let message = coordinator.message { Text(message).font(.caption).foregroundStyle(.red) }
                }.padding(.vertical, 4)
            }
        }
        .sensoryFeedback(.success, trigger: store.liveActivity.activeRecordID) { _, _ in hapticsEnabled }
        .sensoryFeedback(.error, trigger: store.liveActivity.message) { _, value in hapticsEnabled && value != nil }
    }
}
#endif
