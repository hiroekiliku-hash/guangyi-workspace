import SwiftUI

struct RecordRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let record: WorkspaceRecord
    var showsCountdown = true
    var body: some View {
        HStack(alignment: dynamicTypeSize.isAccessibilitySize ? .top : .center, spacing: 12) {
            Image(systemName: record.isKeyItem ? "star.fill" : record.pinned ? "pin.fill" : record.isFinished ? "checkmark.circle.fill" : record.kind.symbol)
                .foregroundStyle(record.isKeyItem ? Color.orange : record.isOverdue ? Color.red : Color.indigo)
                .font(.title3).frame(width: 28)
                .accessibilityLabel(record.isKeyItem ? "关键事项" : record.kind.title)
            VStack(alignment: .leading, spacing: 4) {
                Text(record.title)
                    .font(record.kind == .deadline ? .title3.weight(.semibold) : .headline)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                if record.kind == .knowledge {
                    Text(record.category + (record.summary.isEmpty ? "" : " · " + record.summary))
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                } else if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 4) { statusAndDate }
                        .font(.caption).foregroundStyle(record.isOverdue ? .red : .secondary)
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 6) { statusAndDate }
                        VStack(alignment: .leading, spacing: 4) { statusAndDate }
                    }.font(.caption).foregroundStyle(record.isOverdue ? .red : .secondary)
                }
                if showsCountdown, record.kind == .deadline, let due = record.dueDate, !record.isFinished {
                    DeadlineCountdownView(target: record.effectiveDueDate(due))
                }
            }
            Spacer(minLength: 4)
        }.padding(.vertical, 4).frame(minHeight: 44)
    }
    @ViewBuilder private var statusAndDate: some View {
        if record.isKeyItem { Text("关键事项").fontWeight(.semibold) }
        Text(StateLabels.title(record.status))
        if record.isOverdue { Text("已逾期") }
        if let date = record.dueDate ?? record.remindAt ?? record.scheduledAt { Text(date, format: rowDateStyle) }
        if record.recurrenceSeriesID != nil { Image(systemName: "repeat").accessibilityLabel("重复事项") }
    }
    private var rowDateStyle: Date.FormatStyle {
        var style: Date.FormatStyle = record.dateOnly && record.dueDate != nil ? .dateTime.month().day() : .dateTime.month().day().hour().minute()
        style.timeZone = record.calendar.timeZone
        return style
    }
}
enum RecordSort: String, CaseIterable, Identifiable {
    case standard = "默认", updated = "最近编辑", title = "标题", date = "日期"
    var id: String { rawValue }
}
struct RecordListView: View {
    @Environment(WorkspaceStore.self) private var store
    let kind: ItemKind
    var selection: Binding<UUID?>? = nil
    var includedKinds: [ItemKind] = []
    @State private var keyOnly = false
    @State private var sort = RecordSort.standard
    @State private var query = ""
    @State private var status = "all"
    @State private var category = "all"
    @State private var seriesOnly = true
    @State private var creating = false
    private var filtered: [WorkspaceRecord] {
        let source = kind.isProjectGroup ? WorkspaceLogic.projectGroupRecords(in: store.state) : kind.isItem ? WorkspaceLogic.actionRecords(in: store.state) : store.records(kind)
        var values = source.filter { record in
            (!keyOnly || record.isKeyItem) &&
            (status == "all" || StateLabels.title(record.status) == status) && (category == "all" || record.category == category) &&
            (query.isEmpty || "\(record.title) \(record.summary) \(record.body) \(record.tags.joined(separator: " "))".localizedCaseInsensitiveContains(query))
        }
        if (kind.isItem || kind == .deadline) && seriesOnly {
            var seen: Set<UUID> = []
            values = values.filter { record in record.recurrenceSeriesID.map { seen.insert($0).inserted } ?? true }
        }
        if sort != .standard {
            values.sort { a, b in
                if kind == .knowledge && a.pinned != b.pinned { return a.pinned }
                switch sort {
                case .standard: return false
                case .updated: return a.updatedAt == b.updatedAt ? a.id.uuidString < b.id.uuidString : a.updatedAt > b.updatedAt
                case .title: return a.title == b.title ? a.id.uuidString < b.id.uuidString : a.title.localizedStandardCompare(b.title) == .orderedAscending
                case .date:
                    let x = a.dueDate ?? a.remindAt ?? a.scheduledAt ?? a.targetDate ?? .distantFuture
                    let y = b.dueDate ?? b.remindAt ?? b.scheduledAt ?? b.targetDate ?? .distantFuture
                    return x == y ? a.id.uuidString < b.id.uuidString : x < y
                }
            }
        }
        return values
    }
    private var deadlineGroups: [DeadlineCountdownGroup] {
        let values = filtered
        let groups = WorkspaceLogic.deadlineCountdownGroups(values, timezone: store.state.profile.timezone)
        guard sort == .title || sort == .updated else { return groups }
        let positions = Dictionary(uniqueKeysWithValues: values.enumerated().map { ($0.element.id, $0.offset) })
        return groups.sorted {
            $0.records.compactMap { positions[$0.id] }.min()! < $1.records.compactMap { positions[$0.id] }.min()!
        }
    }
    private var ungroupedDeadlines: [WorkspaceRecord] { filtered.filter { $0.isFinished || $0.dueDate == nil } }
    var body: some View {
        List(selection: selection ?? .constant(nil)) {
            if kind == .deadline {
                ForEach(deadlineGroups) { group in
                    Section {
                        DeadlineCountdownView(group: group).listRowSeparator(.hidden)
                        ForEach(group.records) { record in recordCell(record, showsCountdown: false) }
                    } header: { Text("\(group.records.count) 项截止事项") }
                }
                if !ungroupedDeadlines.isEmpty {
                    Section("其他截止事项") {
                        ForEach(ungroupedDeadlines) { record in recordCell(record) }
                    }
                }
            } else {
                ForEach(filtered) { record in recordCell(record) }
            }
        }
        .overlay {
            if filtered.isEmpty {
                ContentUnavailableView {
                    Label(hasFilters ? "没有匹配的记录" : "还没有\(kind.title)", systemImage: hasFilters ? "magnifyingglass" : kind.symbol)
                } description: {
                    Text(hasFilters ? "调整搜索或清除筛选后再试。" : "创建第一条记录，开始安排工作空间。")
                } actions: {
                    if hasFilters { Button("清除筛选") { clearFilters() } }
                    else { Button("新建\(kind.title)", systemImage: "plus") { creating = true } }
                }
            }
        }
        .safeAreaInset(edge: .top) {
            if hasFilters {
                HStack { Label("已应用筛选", systemImage: "line.3.horizontal.decrease.circle"); Spacer(); Button("清除") { clearFilters() } }
                    .font(.caption).padding(8).background(.bar)
            }
        }
        .onChange(of: filtered.map(\.id)) { _, ids in
            if let id = selection?.wrappedValue, !ids.contains(id) { selection?.wrappedValue = nil }
        }
        .navigationTitle(kind == .knowledge ? "知识库" : kind.title)
        .searchable(text: $query, prompt: kind == .knowledge ? "搜索标题、正文和标签" : "搜索\(kind.title)")
        .workspaceSelectionFeedback(trigger: keyOnly)
        .workspaceSelectionFeedback(trigger: sort)
        .workspaceSelectionFeedback(trigger: status)
        .workspaceSelectionFeedback(trigger: seriesOnly)
        .toolbar {
            ToolbarItem { Menu {
                if kind.isItem { Toggle("只看关键事项", isOn: $keyOnly) }
                Picker("排序", selection: $sort) { ForEach(RecordSort.allCases) { Text($0.rawValue).tag($0) } }
                Divider()
                if kind != .knowledge && kind != .area {
                    Picker("状态", selection: $status) {
                        Text("全部状态").tag("all")
                        ForEach(Array(Set((includedKinds.isEmpty ? [kind] : includedKinds).flatMap(\.states).map(StateLabels.title))).sorted(), id: \.self) { value in Text(value).tag(value) }
                    }
                }
                if kind == .knowledge {
                    Picker("分类", selection: $category) {
                        Text("全部分类").tag("all")
                        ForEach(Array(Set(store.records(.knowledge).map(\.category))).sorted(), id: \.self) { Text($0).tag($0) }
                    }
                }
                if kind.isItem || kind == .deadline { Toggle("每组重复显示一条", isOn: $seriesOnly) }
            } label: { Label("筛选", systemImage: "line.3.horizontal.decrease.circle") } }
            ToolbarItem(placement: .primaryAction) {
                Button("新建\(kind.title)", systemImage: "plus") { store.createKind = kind.creationKind }
            }
        }
        .sheet(isPresented: $creating) { NavigationStack { RecordEditorView(kind: kind) }.nativeEditorPresentation() }
        .refreshable { store.refresh() }
    }
    private var hasFilters: Bool { keyOnly || !query.isEmpty || status != "all" || category != "all" || !seriesOnly }
    private func clearFilters() { keyOnly = false; query = ""; status = "all"; category = "all"; seriesOnly = true }
    private func recordCell(_ record: WorkspaceRecord, showsCountdown: Bool = true) -> some View {
        recordLink(record, showsCountdown: showsCountdown)
            .tag(record.id)
            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                if record.kind.isItem {
                    Button(record.pinned ? "取消标星" : "标星", systemImage: record.pinned ? "star.slash" : "star") {
                        store.perform { try store.toggleKeyItem(record.id) }
                    }.tint(.orange)
                }
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if !record.isFinished && (record.kind.isItem || record.kind == .deadline) {
                    Button("完成", systemImage: "checkmark") { store.perform { try store.setStatus(record.id, "DONE") } }.tint(.green)
                }
                Button("归档", systemImage: "archivebox") { store.perform { try store.archive(record.id) } }.tint(.orange)
            }
            .contextMenu {
                Button("打开", systemImage: "arrow.up.forward.app") { store.openedRecordID = record.id }
                if record.kind.isItem {
                    Button(record.pinned ? "取消标星" : "标为关键事项", systemImage: record.pinned ? "star.slash" : "star") {
                        store.perform { try store.toggleKeyItem(record.id) }
                    }
                }
                Button("归档", systemImage: "archivebox") { store.perform { try store.archive(record.id) } }
            }
    }
    @ViewBuilder private func recordLink(_ record: WorkspaceRecord, showsCountdown: Bool) -> some View {
        if selection != nil { RecordRow(record: record, showsCountdown: showsCountdown) }
        else { NavigationLink { RecordDetailView(id: record.id) } label: { RecordRow(record: record, showsCountdown: showsCountdown) } }
    }

}
struct ActionsView: View {
    var selection: Binding<UUID?>? = nil
    var body: some View {
        RecordListView(kind: .task, selection: selection, includedKinds: [.task, .reminder, .milestone])
    }
}
struct ProjectGroupsView: View {
    var selection: Binding<UUID?>? = nil
    var body: some View { RecordListView(kind: .project, selection: selection, includedKinds: [.project, .area]) }
}
struct ArchivesView: View {
    @Environment(WorkspaceStore.self) private var store
    var body: some View {
        List {
            ForEach(store.state.records.filter { $0.archivedAt != nil && $0.deletedAt == nil }.sorted { $0.updatedAt > $1.updatedAt }) { record in
                HStack {
                    NavigationLink { RecordDetailView(id: record.id) } label: { RecordRow(record: record) }
                    Button("恢复", systemImage: "arrow.counterclockwise") { store.perform { try store.archive(record.id, restore: true) } }
                }
            }
        }.navigationTitle("归档")
    }
}
struct TrashView: View {
    @Environment(WorkspaceStore.self) private var store
    var body: some View {
        List {
            Section {
                Text("项目组等记录可在删除后 30 天内恢复。知识笔记不设恢复期限。恢复会保留关联关系。")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(store.state.trash.sorted { $0.deletedAt > $1.deletedAt }) { batch in
                VStack(alignment: .leading, spacing: 8) {
                    Text(batch.title).font(.headline)
                    Text("\(batch.itemIDs.count) 项 · \(batch.deletedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                    if let expires = batch.expiresAt { Text("恢复期限：\(expires.formatted(date: .abbreviated, time: .omitted))").font(.caption) }
                    Button("恢复此批次", systemImage: "arrow.counterclockwise") { store.perform { try store.restore(batch) } }
                        .disabled(batch.expiresAt.map { $0 < Date() } ?? false)
                }.padding(.vertical, 4)
            }
        }.navigationTitle("回收站")
    }
}

#Preview("记录行") {
    RecordRow(record: WorkspaceRecord(kind: .task, title: "整理待办事项与项目组安排", id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)).padding()
}

struct DeadlineCountdownView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let target: Date
    private var group: DeadlineCountdownGroup?
    init(target: Date) { self.target = target }
    init(group: DeadlineCountdownGroup) { self.target = group.dueDates[0]; self.group = group }
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let target = group?.countdownDate(at: context.date) ?? self.target
            let overdue = target <= context.date
            let title = overdue ? "已逾期" : (group?.records.count ?? 1) > 1 ? "距离下一项截止" : "距离截止"
            let duration = durationDescription(to: target, from: context.date)
            VStack(alignment: .leading, spacing: 4) {
                Label(title, systemImage: overdue ? "exclamationmark.circle.fill" : "timer")
                    .font(.caption.weight(.semibold))
                Group {
                    if reduceMotion { Text(target, style: .timer) }
                    else { Text(target, style: .timer).contentTransition(.numericText()) }
                }
                .font(.system(.largeTitle, design: .rounded, weight: .semibold).monospacedDigit())
            }
            .foregroundStyle(overdue ? Color.red : Color.primary)
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(overdue ? Color.red.opacity(0.08) : Color.indigo.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title)
            .accessibilityValue(duration)
        }
    }
    private func durationDescription(to target: Date, from now: Date) -> String {
        var seconds = Int(abs(target.timeIntervalSince(now)))
        let days = seconds / 86_400; seconds %= 86_400
        let hours = seconds / 3_600; seconds %= 3_600
        let minutes = seconds / 60; seconds %= 60
        return (days > 0 ? "\(days)天 " : "") + "\(hours)小时 \(minutes)分 \(seconds)秒"
    }
}
