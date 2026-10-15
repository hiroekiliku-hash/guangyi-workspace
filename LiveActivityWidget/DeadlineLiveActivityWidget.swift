import ActivityKit
import SwiftUI
import WidgetKit

private struct DeadlineTimerText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let dueDate: Date
    let isStale: Bool
    var body: some View {
        Group {
            if isStale { Text("00:00") }
            else if reduceMotion { Text(dueDate, style: .timer) }
            else { Text(dueDate, style: .timer).contentTransition(.numericText(countsDown: true)) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isStale ? "已到截止" : "距离截止")
        .accessibilityValue(isStale ? Text("零") : Text(dueDate, style: .relative))
    }
}

struct DeadlineLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DeadlineActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 10) {
                Label("广益 · DDL", systemImage: "hourglass").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(context.state.title).font(.headline).lineLimit(2).privacySensitive()
                HStack(alignment: .firstTextBaseline) {
                    Text(context.isStale ? "已到截止" : "距离截止").font(.subheadline)
                    Spacer()
                    DeadlineTimerText(dueDate: context.state.dueDate, isStale: context.isStale)
                        .font(.title.bold().monospacedDigit())
                }
                ProgressView(timerInterval: context.attributes.startedAt...context.state.dueDate, countsDown: false)
                    .tint(.indigo)
                    .labelsHidden()
                    .accessibilityHidden(true)
            }.padding(16)
                .activityBackgroundTint(Color(.secondarySystemBackground))
                .activitySystemActionForegroundColor(.indigo)
                .widgetURL(url(context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Label("DDL", systemImage: "hourglass").foregroundStyle(.indigo) }
                DynamicIslandExpandedRegion(.trailing) {
                    DeadlineTimerText(dueDate: context.state.dueDate, isStale: context.isStale)
                        .font(.headline.monospacedDigit()).frame(width: 110)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(context.state.title).font(.headline).lineLimit(2).privacySensitive()
                        Text(context.isStale ? "已到截止，点击查看事项" : "点击返回事项详情").font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: "hourglass").foregroundStyle(.indigo).accessibilityHidden(true)
            } compactTrailing: {
                DeadlineTimerText(dueDate: context.state.dueDate, isStale: context.isStale)
                    .font(.caption.monospacedDigit()).frame(width: 62)
            } minimal: {
                Image(systemName: context.isStale ? "exclamationmark" : "hourglass")
                    .foregroundStyle(.indigo)
                    .accessibilityLabel(context.isStale ? "DDL 已到截止" : "DDL 倒计时")
            }.widgetURL(url(context)).keylineTint(.indigo)
        }
    }
    private func url(_ context: ActivityViewContext<DeadlineActivityAttributes>) -> URL {
        URL(string: "guangyi-workspace://record/\(context.attributes.recordID.uuidString)")!
    }
}
@main struct DeadlineWidgetBundle: WidgetBundle {
    var body: some Widget { DeadlineLiveActivityWidget() }
}
