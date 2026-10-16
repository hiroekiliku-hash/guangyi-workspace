import SwiftUI
import Charts

struct OverviewView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(WorkspaceStore.self) private var store
    private var actions: [WorkspaceRecord] { onePerSeries(WorkspaceLogic.actionRecords(in: store.state).filter { !$0.isFinished }) }
    private var deadlines: [WorkspaceRecord] { onePerSeries(store.records(.deadline).filter { !$0.isFinished }) }
    private var deadlineGroups: [DeadlineCountdownGroup] {
        WorkspaceLogic.deadlineCountdownGroups(deadlines, timezone: store.state.profile.timezone)
    }
    private var laterDeadlines: [WorkspaceRecord] { deadlineGroups.dropFirst().flatMap(\.records) }
    private func onePerSeries(_ values: [WorkspaceRecord]) -> [WorkspaceRecord] {
        var seen: Set<UUID> = []
        return values.filter { $0.recurrenceSeriesID.map { seen.insert($0).inserted } ?? true }
    }
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Date(), format: .dateTime.year().month().day().weekday())
                        .font(.subheadline).foregroundStyle(.secondary)
                    Text("\(store.state.profile.name)，今天从容安排。")
                        .font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
                }
            }
            .listRowSeparator(.hidden)

            Section {
                if let group = deadlineGroups.first {
                    if group.records.count == 1, let deadline = group.records.first {
                        NavigationLink { RecordDetailView(id: deadline.id) } label: {
                            HomeDeadlineCard(record: deadline)
                        }
                    } else {
                        DeadlineCountdownView(group: group)
                        ForEach(group.records) { record in
                            NavigationLink { RecordDetailView(id: record.id) } label: { HomeSummaryRow(record: record) }
                        }
                        if laterDeadlines.isEmpty {
                            Button("查看全部 截止事项（\(deadlines.count)）") { store.navigation = .deadlines }
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("没有待处理的 截止事项", systemImage: "checkmark.circle")
                            .font(.headline).foregroundStyle(.secondary)
                        Text("新增截止事项后，最近一项会在这里持续倒计时。")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button("新建 截止事项", systemImage: "plus") { store.createKind = .deadline }
                    }.padding(.vertical, 6)
                }
            } header: {
                Label("最近 截止事项", systemImage: "hourglass")
            }

            Section {
                Group {
                    if typeSize.isAccessibilitySize {
                        VStack(spacing: 12) { summaryMetrics }
                    } else {
                        HStack(spacing: 12) { summaryMetrics }
                    }
                }.padding(.vertical, 4)
            }
            .listRowSeparator(.hidden)

            Section("事项摘要") {
                if actions.isEmpty {
                    Text("暂无待办事项。").foregroundStyle(.secondary)
                    Button("新建事项", systemImage: "plus") { store.createKind = .task }
                } else {
                    ForEach(actions.prefix(3)) { record in
                        NavigationLink { RecordDetailView(id: record.id) } label: { HomeSummaryRow(record: record) }
                    }
                    Button("查看全部事项（\(actions.count)）") { store.navigation = .actions }
                }
            }

            if !laterDeadlines.isEmpty {
                Section("之后的 截止事项") {
                    ForEach(laterDeadlines.prefix(2)) { record in
                        NavigationLink { RecordDetailView(id: record.id) } label: { HomeSummaryRow(record: record) }
                    }
                    Button("查看全部 截止事项（\(deadlines.count)）") { store.navigation = .deadlines }
                }
            }
        }
        .navigationTitle("首页")
        .toolbar {
            ToolbarItem { NavigationLink { WorkspaceCalendarView() } label: { Label("日历", systemImage: "calendar") } }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("新建事项", systemImage: ItemKind.task.symbol) { store.createKind = .task }
                    Button("新建 截止事项", systemImage: ItemKind.deadline.symbol) { store.createKind = .deadline }
                } label: { Label("新建", systemImage: "plus") }
            }
        }
        .refreshable { store.refresh() }
    }
    @ViewBuilder private var summaryMetrics: some View {
        metric("待办事项", value: actions.count, symbol: "checkmark.circle", destination: .actions)
        metric("待处理 截止事项", value: deadlines.count, symbol: "hourglass", destination: .deadlines)
    }
    private func metric(_ title: String, value: Int, symbol: String, destination: AppDestination) -> some View {
        Button { store.navigation = destination } label: { HomeMetricView(title: title, value: value, symbol: symbol) }
            .buttonStyle(.plain)
    }
}
struct HomeMetricView: View {
    let title: String
    let value: Int
    let symbol: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol).font(.caption).foregroundStyle(.secondary)
            Text(value, format: .number).font(.largeTitle.bold().monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(Color.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title)，\(value) 项")
    }
}
struct HomeDeadlineCard: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let record: WorkspaceRecord
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(record.title)
                .font(.title2.bold()).foregroundStyle(.primary)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 3).fixedSize(horizontal: false, vertical: true)
            if !record.summary.isEmpty {
                Text(record.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            if let due = record.dueDate {
                DeadlineCountdownView(target: record.effectiveDueDate(due))
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) { dueLabel(due) }
                    VStack(alignment: .leading, spacing: 4) { dueLabel(due) }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 4)
    }
    @ViewBuilder private func dueLabel(_ date: Date) -> some View {
        Text(date, format: dueDateStyle)
        if record.dateOnly { Text("全天") }
    }
    private var dueDateStyle: Date.FormatStyle {
        var style: Date.FormatStyle = record.dateOnly ? .dateTime.year().month().day().weekday() : .dateTime.month().day().weekday().hour().minute()
        style.timeZone = record.calendar.timeZone
        return style
    }
}
struct HomeSummaryRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let record: WorkspaceRecord
    var body: some View {
        HStack(alignment: typeSize.isAccessibilitySize ? .top : .center, spacing: 10) {
            Image(systemName: record.pinned ? "pin.fill" : record.kind.symbol)
                .foregroundStyle(record.isOverdue ? Color.red : Color.indigo)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(record.title).font(.headline).foregroundStyle(.primary)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) { supportingDetails }
                    VStack(alignment: .leading, spacing: 2) { supportingDetails }
                }
                .font(.caption).foregroundStyle(record.isOverdue ? .red : .secondary)
            }
        }.padding(.vertical, 2)
    }
    @ViewBuilder private var supportingDetails: some View {
        if record.kind != .task && record.kind != .deadline { Text(record.kind.title).fontWeight(.semibold) }
        Text(StateLabels.title(record.status))
        if record.isOverdue { Text("已逾期") }
        if let date = record.dueDate ?? record.remindAt ?? record.scheduledAt ?? record.targetDate {
            Text(date, format: rowDateStyle)
        }
    }
    private var rowDateStyle: Date.FormatStyle {
        var style: Date.FormatStyle = record.dateOnly && record.dueDate != nil ? .dateTime.month().day() : .dateTime.month().day().hour().minute()
        style.timeZone = record.calendar.timeZone
        return style
    }
}
struct CalendarEntry: Identifiable {
    let record: WorkspaceRecord
    let date: Date
    let label: String
    var id: String { "\(record.id)-\(label)" }
}
enum CalendarEntries {
    static func entries(_ state: WorkspaceState) -> [CalendarEntry] {
        let displayCalendar = WorkspaceDates.calendar(state.profile.timezone)
        func displayedDay(_ date: Date, record: WorkspaceRecord) -> Date {
            // Date-only values keep their calendar day when the workspace timezone changes.
            displayCalendar.date(from: record.calendar.dateComponents([.year, .month, .day], from: date)) ?? date
        }
        return state.records.filter { WorkspaceLogic.visible($0, in: state) }.flatMap { record -> [CalendarEntry] in
            var entries: [CalendarEntry] = []
            if let due = record.dueDate { entries.append(CalendarEntry(record: record, date: record.dateOnly ? displayedDay(due, record: record) : due, label: "截止")) }
            if let date = record.scheduledAt { entries.append(CalendarEntry(record: record, date: date, label: "计划")) }
            if let date = record.remindAt { entries.append(CalendarEntry(record: record, date: date, label: "提醒")) }
            if let date = record.startDate { entries.append(CalendarEntry(record: record, date: displayedDay(date, record: record), label: "分组开始")) }
            if let date = record.targetDate { entries.append(CalendarEntry(record: record, date: displayedDay(date, record: record), label: "分组目标")) }
            return entries
        }.sorted { $0.date < $1.date }
    }
}
struct WorkspaceCalendarView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var selected = Date()
    var body: some View {
        let calendar = WorkspaceDates.calendar(store.state.profile.timezone)
        let entries = CalendarEntries.entries(store.state).filter { calendar.isDate($0.date, inSameDayAs: selected) }
        List {
            Section {
                DatePicker("查看日期", selection: $selected, displayedComponents: .date)
                    .datePickerStyle(.graphical).environment(\.timeZone, calendar.timeZone)
                    .frame(maxWidth: 560).frame(maxWidth: .infinity)
            }
            Section(selected.formatted(date: .complete, time: .omitted)) {
                if entries.isEmpty { Text("这一天没有安排。").foregroundStyle(.secondary) }
                ForEach(entries) { entry in
                    NavigationLink { RecordDetailView(id: entry.record.id) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.label).font(.caption).foregroundStyle(.secondary)
                            RecordRow(record: entry.record)
                        }
                    }
                }
            }
        }.navigationTitle("日历")
            .toolbar { Button("今天") { selected = Date() } }
    }
}
struct ProjectTimelineView: View {
    @Environment(WorkspaceStore.self) private var store
    var body: some View {
        let projects = WorkspaceLogic.projectGroupRecords(in: store.state).filter { $0.startDate != nil || $0.targetDate != nil }
        let calendar = WorkspaceDates.calendar(store.state.profile.timezone)
        let today = calendar.startOfDay(for: Date())
        let horizon = calendar.date(byAdding: .year, value: 3, to: today) ?? today.addingTimeInterval(365 * 3 * 86400)
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("项目组时间线").font(.title2.bold())
                if projects.isEmpty {
                    ContentUnavailableView("为项目组设置日期", systemImage: "chart.bar.xaxis", description: Text("开始日期与目标日期会显示为原生图表。"))
                } else {
                    Chart {
                        ForEach(projects) { project in
                            let start = project.startDate ?? today
                            let end = max(start.addingTimeInterval(86400), project.targetDate ?? start.addingTimeInterval(86400 * 14))
                            if start <= horizon { BarMark(xStart: .value("开始", start), xEnd: .value("目标", min(end, horizon)), y: .value("项目组", project.title))
                                .foregroundStyle(by: .value("状态", StateLabels.title(project.status)))
                                .cornerRadius(4)
                            }
                        }
                        RuleMark(x: .value("今天", today)).foregroundStyle(.secondary).lineStyle(StrokeStyle(dash: [4, 4]))
                    }
                    .chartScrollableAxes(.horizontal)
                    .chartXVisibleDomain(length: 86400 * 60)
                    .frame(height: max(260, CGFloat(projects.count) * 50))
                    .accessibilityLabel("项目组时间线，可横向滚动查看日期。")
                    Text("横向滚动查看日期。展示窗口最长三年，超出范围的目标日期仍保留在项目组详情中。").font(.caption).foregroundStyle(.secondary)
                    ForEach(projects) { project in
                        NavigationLink { RecordDetailView(id: project.id) } label: { RecordRow(record: project) }
                    }
                }
            }.padding().frame(maxWidth: 1000).frame(maxWidth: .infinity)
        }.navigationTitle("时间线")
    }
}
