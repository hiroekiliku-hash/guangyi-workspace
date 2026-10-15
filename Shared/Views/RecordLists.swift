import SwiftUI

struct RecordRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let record: WorkspaceRecord
    var body: some View {
        HStack(alignment: dynamicTypeSize.isAccessibilitySize ? .top : .center, spacing: 12) {
            Image(systemName: record.pinned ? "pin.fill" : record.isFinished ? "checkmark.circle.fill" : record.kind.symbol)
                .foregroundStyle(record.isOverdue ? Color.red : Color.indigo)
                .font(.title3).frame(width: 28)
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
                if record.kind == .deadline, let due = record.dueDate, !record.isFinished {
                    DeadlineCountdownView(target: record.effectiveDueDate(due))
                }
            }
            Spacer(minLength: 4)
        }.padding(.vertical, 4).frame(minHeight: 44)
    }
    @ViewBuilder private var statusAndDate: some View {
        if [.project, .milestone, .reminder].contains(record.kind) { Text(record.kind.title).fontWeight(.semibold) }
        Text(StateLabels.title(record.status))
        if record.isOverdue { Text("已逾期") }
        if let date = record.dueDate ?? record.remindAt ?? record.scheduledAt { Text(date, format: rowDateStyle) }
        if record.recurrenceSeriesID != nil { Image(systemName: "repeat").accessibilityLabel("循环事项") }
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
    @State private var type = "all"
    @State private var sort = RecordSort.standard
    @State private var query = ""
    @State private var status = "all"
    @State private var category = "all"
    @State private var seriesOnly = false
    @State private var creating = false
    private var filtered: [WorkspaceRecord] {
        let source = includedKinds.isEmpty ? store.records(kind) : WorkspaceLogic.actionRecords(in: store.state)
        var values = source.filter { record in
            (type == "all" || record.kind.rawValue == type) &&
            (status == "all" || record.status == status) && (category == "all" || record.category == category) &&
            (query.isEmpty || "\(record.title) \(record.summary) \(record.body) \(record.tags.joined(separator: " "))".localizedCaseInsensitiveContains(query))
        }
        if kind == .deadline && seriesOnly {
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
    var body: some View {
        List(selection: selection ?? .constant(nil)) {
            if !filtered.isEmpty {
                ForEach(filtered) { record in
                    recordLink(record)
                        .tag(record.id)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !record.isFinished && [.task, .deadline, .reminder].contains(record.kind) {
                                Button("完成", systemImage: "checkmark") { store.perform { try store.setStatus(record.id, "DONE") } }.tint(.green)
                            }
                            Button("归档", systemImage: "archivebox") { store.perform { try store.archive(record.id) } }.tint(.orange)
                        }
                        .contextMenu {
                            Button("打开", systemImage: "arrow.up.forward.app") { store.openedRecordID = record.id }
                            Button("归档", systemImage: "archivebox") { store.perform { try store.archive(record.id) } }
                        }
                }
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
        .toolbar {
            ToolbarItem { Menu {
                if !includedKinds.isEmpty {
                    Picker("类型", selection: $type) {
                        Text("全部行动").tag("all")
                        ForEach(includedKinds) { Text($0.title).tag($0.rawValue) }
                    }
                }
                Picker("排序", selection: $sort) { ForEach(RecordSort.allCases) { Text($0.rawValue).tag($0) } }
                Divider()
                if kind != .knowledge && kind != .area {
                    Picker("状态", selection: $status) {
                        Text("全部状态").tag("all")
                        ForEach(Array(Set((includedKinds.isEmpty ? [kind] : includedKinds).flatMap(\.states))).sorted(), id: \.self) { value in Text(StateLabels.title(value)).tag(value) }
                    }
                }
                if kind == .knowledge {
                    Picker("分类", selection: $category) {
                        Text("全部分类").tag("all")
                        ForEach(Array(Set(store.records(.knowledge).map(\.category))).sorted(), id: \.self) { Text($0).tag($0) }
                    }
                }
                if kind == .deadline { Toggle("每个循环显示一条", isOn: $seriesOnly) }
            } label: { Label("筛选", systemImage: "line.3.horizontal.decrease.circle") } }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    ForEach(includedKinds.isEmpty ? [kind] : includedKinds) { value in
                        Button("新建\(value.title)", systemImage: value.symbol) { store.createKind = value }
                    }
                } label: { Label("新建", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $creating) { NavigationStack { RecordEditorView(kind: kind) }.nativeEditorPresentation() }
        .refreshable { store.refresh() }
    }
    private var hasFilters: Bool { type != "all" || !query.isEmpty || status != "all" || category != "all" || seriesOnly }
    private func clearFilters() { type = "all"; query = ""; status = "all"; category = "all"; seriesOnly = false }
    @ViewBuilder private func recordLink(_ record: WorkspaceRecord) -> some View {
        if selection != nil { RecordRow(record: record) }
        else { NavigationLink { RecordDetailView(id: record.id) } label: { RecordRow(record: record) } }
    }

}
struct ActionsView: View {
    var selection: Binding<UUID?>? = nil
    var body: some View {
        RecordListView(kind: .task, selection: selection, includedKinds: [.task, .project, .reminder, .milestone])
    }
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
                Text("项目等记录可在删除后 30 天内恢复。知识笔记不设恢复期限。恢复会保留关联关系。")
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
    RecordRow(record: WorkspaceRecord(kind: .task, title: "整理下一步行动与项目安排", id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)).padding()
}

struct DeadlineCountdownView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let target: Date
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let overdue = target <= context.date
            let duration = durationDescription(from: context.date)
            VStack(alignment: .leading, spacing: 4) {
                Label(overdue ? "已逾期" : "距离截止", systemImage: overdue ? "exclamationmark.circle.fill" : "timer")
                    .font(.caption.weight(.semibold))
                Group {
                    if reduceMotion { Text(target, style: .timer) }
                    else { Text(target, style: .timer).contentTransition(.numericText()) }
                }
                .font(.title2.bold().monospacedDigit())
            }
            .foregroundStyle(overdue ? Color.red : Color.primary)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(overdue ? Color.red.opacity(0.1) : Color.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(overdue ? "已逾期" : "距离截止")
            .accessibilityValue(duration)
        }
    }
    private func durationDescription(from now: Date) -> String {
        var seconds = Int(abs(target.timeIntervalSince(now)))
        let days = seconds / 86_400; seconds %= 86_400
        let hours = seconds / 3_600; seconds %= 3_600
        let minutes = seconds / 60; seconds %= 60
        return (days > 0 ? "\(days)天 " : "") + "\(hours)小时 \(minutes)分 \(seconds)秒"
    }
}
