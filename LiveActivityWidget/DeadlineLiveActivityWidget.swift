import ActivityKit
import SwiftUI
import WidgetKit

private let activityAccent = Color(red: 0.64, green: 0.72, blue: 1)

private struct DeadlineTimerText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let startedAt: Date
    let dueDate: Date
    let isStale: Bool
    var body: some View {
        // Archived timer text is horizontally flexible. A hidden static sample provides
        // a finite, content-sized proposal; text alignment controls the digits inside it.
        Text(widthSample).hidden().fixedSize()
            .overlay(alignment: .trailing) {
                animatedTimer.multilineTextAlignment(.trailing)
            }
            .monospacedDigit()
            .lineLimit(1).minimumScaleFactor(0.85)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(isStale ? "已到截止" : "距离截止")
            .accessibilityValue(isStale ? Text("零") : Text(dueDate, style: .relative))
    }
    private var widthSample: String {
        let duration = dueDate.timeIntervalSince(startedAt)
        if isStale || duration <= 0 { return "0:00" }
        if duration >= 3600 { return "8:88:88" }
        if duration >= 600 { return "88:88" }
        return "8:88"
    }
    private var animatedTimer: some View {
        Group {
            if isStale || dueDate <= startedAt { Text("0:00") }
            else if reduceMotion { timer }
            else { timer.contentTransition(.numericText(countsDown: true)) }
        }
    }
    private var timer: Text {
        // A bounded interval stops at zero instead of counting upwards after the deadline.
        Text(timerInterval: startedAt...dueDate, countsDown: true, showsHours: true)
    }
}

private struct DeadlineProgressRing: View {
    let startedAt: Date
    let dueDate: Date
    let isStale: Bool
    let diameter: CGFloat
    var body: some View {
        ZStack {
            Group {
                if isStale || dueDate <= startedAt { ProgressView(value: 0) }
                else {
                    ProgressView(timerInterval: startedAt...dueDate, countsDown: true) {
                        EmptyView()
                    } currentValueLabel: {
                        EmptyView()
                    }
                }
            }
            .progressViewStyle(.circular).tint(activityAccent).labelsHidden()
            Image(systemName: isStale ? "flag.checkered" : "hourglass")
                .font(.system(size: diameter * 0.38, weight: .semibold))
                .foregroundStyle(activityAccent)
        }
        .frame(width: diameter, height: diameter)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isStale ? "DDL 已到截止" : "DDL 剩余时间进度")
        .accessibilityValue(isStale ? Text("零") : Text(dueDate, style: .relative))
    }
}

private struct DeadlineCompactTime: View {
    let timer: DeadlineTimerText
    var body: some View {
        timer
            .font(.system(.caption, design: .rounded, weight: .semibold))
            .foregroundStyle(activityAccent)
    }
}

// New SDKs expose the narrow landscape presentation; older SDKs retain the iOS 17 layout.
#if compiler(>=6.4)
@available(iOS 27.0, *)
private struct DeadlineWidthAwareCompactTime: View {
    @Environment(\.isDynamicIslandLimitedInWidth) private var limitedInWidth
    let time: DeadlineCompactTime
    var body: some View {
        if !limitedInWidth { time }
    }
}
#endif

struct DeadlineLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DeadlineActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center) {
                    identity(context, diameter: 32)
                    Spacer(minLength: 12)
                    timer(context).font(.system(.title, design: .rounded, weight: .semibold))
                        .foregroundStyle(activityAccent)
                }
                details(context)
            }
            .padding(16)
            .foregroundStyle(.white)
            .activityBackgroundTint(Color(red: 0.06, green: 0.07, blue: 0.11))
            .activitySystemActionForegroundColor(activityAccent)
            .widgetURL(url(context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    identity(context, diameter: 28)
                }
                DynamicIslandExpandedRegion(.trailing, priority: 1) {
                    timer(context).font(.system(.title3, design: .rounded, weight: .semibold))
                        .foregroundStyle(activityAccent)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    details(context).padding(.top, 6)
                }
            } compactLeading: {
                ring(context, diameter: 22)
            } compactTrailing: {
                compactTime(context)
            } minimal: {
                ring(context, diameter: 22)
            }
            .contentMargins(.horizontal, 24, for: .expanded)
            .contentMargins(.bottom, 20, for: .expanded)
            .widgetURL(url(context)).keylineTint(activityAccent)
        }
    }
    private func timer(_ context: ActivityViewContext<DeadlineActivityAttributes>) -> DeadlineTimerText {
        DeadlineTimerText(startedAt: context.attributes.startedAt, dueDate: context.state.dueDate, isStale: context.isStale)
    }
    private func ring(_ context: ActivityViewContext<DeadlineActivityAttributes>, diameter: CGFloat) -> some View {
        DeadlineProgressRing(startedAt: context.attributes.startedAt, dueDate: context.state.dueDate, isStale: context.isStale, diameter: diameter)
    }
    private func identity(_ context: ActivityViewContext<DeadlineActivityAttributes>, diameter: CGFloat) -> some View {
        HStack(spacing: 7) {
            ring(context, diameter: diameter)
            Text("DDL").font(.caption.weight(.semibold)).foregroundStyle(activityAccent)
        }
    }
    private func details(_ context: ActivityViewContext<DeadlineActivityAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(context.state.title).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true).privacySensitive()
            HStack {
                Text(context.isStale ? "已到截止" : "距离截止")
                Spacer(minLength: 8)
                Text("截止 ") + Text(context.state.dueDate, style: .time)
            }
            .font(.caption.weight(.medium)).foregroundStyle(.white.opacity(0.65))
            .lineLimit(1).minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    @ViewBuilder private func compactTime(_ context: ActivityViewContext<DeadlineActivityAttributes>) -> some View {
        let time = DeadlineCompactTime(timer: timer(context))
        #if compiler(>=6.4)
        if #available(iOS 27.0, *) { DeadlineWidthAwareCompactTime(time: time) }
        else { time }
        #else
        time
        #endif
    }
    private func url(_ context: ActivityViewContext<DeadlineActivityAttributes>) -> URL {
        URL(string: "guangyi-workspace://record/\(context.attributes.recordID.uuidString)")!
    }
}
@main struct DeadlineWidgetBundle: WidgetBundle {
    var body: some Widget { DeadlineLiveActivityWidget() }
}

#if DEBUG
private enum DeadlineActivityPreview {
    static let now = Date()
    static let attributes = DeadlineActivityAttributes(recordID: UUID(), startedAt: now.addingTimeInterval(-1800))
    static let short = DeadlineActivityAttributes.ContentState(title: "提交课程报告", dueDate: now.addingTimeInterval(5400))
    static let long = DeadlineActivityAttributes.ContentState(
        title: "提交本周课程报告与实验记录，附研究摘要和下一阶段的行动计划", dueDate: now.addingTimeInterval(65))
}

#Preview("紧凑", as: .dynamicIsland(.compact), using: DeadlineActivityPreview.attributes) {
    DeadlineLiveActivityWidget()
} contentStates: {
    DeadlineActivityPreview.short
    DeadlineActivityPreview.long
}

#Preview("展开", as: .dynamicIsland(.expanded), using: DeadlineActivityPreview.attributes) {
    DeadlineLiveActivityWidget()
} contentStates: {
    DeadlineActivityPreview.short
    DeadlineActivityPreview.long
}

#Preview("最小", as: .dynamicIsland(.minimal), using: DeadlineActivityPreview.attributes) {
    DeadlineLiveActivityWidget()
} contentStates: {
    DeadlineActivityPreview.short
    DeadlineActivityPreview.long
}

#Preview("锁屏", as: .content, using: DeadlineActivityPreview.attributes) {
    DeadlineLiveActivityWidget()
} contentStates: {
    DeadlineActivityPreview.short
    DeadlineActivityPreview.long
}
#endif
