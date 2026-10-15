import SwiftUI
import Charts

struct OverviewView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(WorkspaceStore.self) private var store
    private var actions: [WorkspaceRecord] { store.records(.task).filter { !$0.isFinished } }
    private var deadlines: [WorkspaceRecord] { store.records(.deadline).filter { !$0.isFinished } }
    var body: some View {
        List {
            Section {
                Text(Date(), format: .dateTime.year().month().day().weekday()).font(.subheadline).foregroundStyle(.secondary)
                Text("\(store.state.profile.name)，今天从容安排。").font(.title2.bold())
                LazyVGrid(columns: typeSize.isAccessibilitySize ? [GridItem(.flexible())] : [GridItem(.adaptive(minimum: 120))], spacing: 12) {
                    metric("进行中行动组", value: store.records(.project).filter { $0.status == "ACTIVE" }.count, symbol: "folder", destination: .actions)
                    metric("待办行动", value: actions.count, symbol: "checkmark.circle", destination: .actions)
                    metric("待处理截止", value: deadlines.count, symbol: "hourglass", destination: .deadlines)
                }.padding(.vertical, 8)
            }
            if store.state.records.filter({ WorkspaceLogic.visible($0, in: store.state) }).isEmpty {
                Section("从这里开始") {
                    Button("创建行动组", systemImage: "folder.badge.plus") { store.createKind = .project }
                    Button("记录想法", systemImage: "square.and.pencil") { store.createKind = .knowledge }
                }
            }
            Section("最近截止") {
                if deadlines.isEmpty { Text("暂时没有待处理的截止事项。").foregroundStyle(.secondary) }
                Button("查看全部截止事项") { store.navigation = .deadlines }
                ForEach(deadlines.prefix(5)) { record in
                    NavigationLink { RecordDetailView(id: record.id) } label: { RecordRow(record: record) }
                }
            }
            Section("行动") {
                if actions.isEmpty { Text("记下下一步行动，让目标慢慢成形。").foregroundStyle(.secondary) }
                Button("查看全部行动") { store.navigation = .actions }
                ForEach(actions.prefix(5)) { record in NavigationLink { RecordDetailView(id: record.id) } label: { RecordRow(record: record) } }
            }
            Section("提醒") {
                ForEach(store.records(.reminder).filter { !$0.isFinished }.prefix(5)) { record in
                    NavigationLink { RecordDetailView(id: record.id) } label: { RecordRow(record: record) }
                }
            }
            Section("最近行动组") {
                ForEach(store.records(.project).prefix(5)) { project in
                    NavigationLink { RecordDetailView(id: project.id) } label: { RecordRow(record: project) }
                }
            }
        }
        .navigationTitle("广益 WorkSpace")
        .toolbar {
            ToolbarItem { NavigationLink { WorkspaceCalendarView() } label: { Label("日历", systemImage: "calendar") } }
            ToolbarItem(placement: .primaryAction) { Menu { ForEach([ItemKind.project, .task, .deadline, .reminder, .knowledge]) { kind in Button("新建\(kind.title)", systemImage: kind.symbol) { store.createKind = kind } } } label: { Label("新建", systemImage: "plus") } }
        }
        .refreshable { store.refresh() }
    }
    private func metric(_ title: String, value: Int, symbol: String, destination: AppDestination) -> some View {
        Button { store.navigation = destination } label: { MetricView(title: title, value: value, symbol: symbol) }.buttonStyle(.plain)
    }
}
struct MetricView: View {
    let title: String
    let value: Int
    let symbol: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol).font(.caption).foregroundStyle(.secondary)
            Text(value, format: .number).font(.largeTitle.bold().monospacedDigit())
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
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
            if let date = record.scheduledAt { entries.append(CalendarEntry(record: record, date: date, label: "行动")) }
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
        let projects = store.records(.project).filter { $0.startDate != nil || $0.targetDate != nil }
        let calendar = WorkspaceDates.calendar(store.state.profile.timezone)
        let today = calendar.startOfDay(for: Date())
        let horizon = calendar.date(byAdding: .year, value: 3, to: today) ?? today.addingTimeInterval(365 * 3 * 86400)
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("行动组时间线").font(.title2.bold())
                if projects.isEmpty {
                    ContentUnavailableView("为行动组设置日期", systemImage: "chart.bar.xaxis", description: Text("开始日期与目标日期会显示为原生图表。"))
                } else {
                    Chart {
                        ForEach(projects) { project in
                            let start = project.startDate ?? today
                            let end = max(start.addingTimeInterval(86400), project.targetDate ?? start.addingTimeInterval(86400 * 14))
                            if start <= horizon { BarMark(xStart: .value("开始", start), xEnd: .value("目标", min(end, horizon)), y: .value("行动组", project.title))
                                .foregroundStyle(by: .value("状态", StateLabels.title(project.status)))
                                .cornerRadius(4)
                            }
                        }
                        RuleMark(x: .value("今天", today)).foregroundStyle(.secondary).lineStyle(StrokeStyle(dash: [4, 4]))
                    }
                    .chartScrollableAxes(.horizontal)
                    .chartXVisibleDomain(length: 86400 * 60)
                    .frame(height: max(260, CGFloat(projects.count) * 50))
                    .accessibilityLabel("行动组时间线，可横向滚动查看日期。")
                    Text("横向滚动查看日期。展示窗口最长三年，超出范围的目标日期仍保留在行动组详情中。").font(.caption).foregroundStyle(.secondary)
                    ForEach(projects) { project in
                        NavigationLink { RecordDetailView(id: project.id) } label: { RecordRow(record: project) }
                    }
                }
            }.padding().frame(maxWidth: 1000).frame(maxWidth: .infinity)
        }.navigationTitle("时间线")
    }
}
