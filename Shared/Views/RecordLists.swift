import SwiftUI

struct RecordRow: View {
    let record: WorkspaceRecord
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: record.pinned ? "pin.fill" : record.isFinished ? "checkmark.circle.fill" : record.kind.symbol)
                .foregroundStyle(record.isOverdue ? Color.red : Color.indigo)
                .font(.title3).frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(record.title).font(.headline).lineLimit(2)
                if record.kind == .knowledge {
                    Text(record.category + (record.summary.isEmpty ? "" : " · " + record.summary))
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                } else {
                    HStack(spacing: 6) {
                        Text(StateLabels.title(record.status))
                        if let date = record.dueDate ?? record.remindAt ?? record.scheduledAt {
                            Text("·")
                            Text(date, format: rowDateStyle)
                        }
                        if record.recurrenceSeriesID != nil { Image(systemName: "repeat") }
                    }.font(.caption).foregroundStyle(record.isOverdue ? .red : .secondary)
                }
            }
            Spacer(minLength: 4)
        }.padding(.vertical, 4).frame(minHeight: 44)
    }
    private var rowDateStyle: Date.FormatStyle {
        var style: Date.FormatStyle = record.dateOnly && record.dueDate != nil ? .dateTime.month().day() : .dateTime.month().day().hour().minute()
        style.timeZone = record.calendar.timeZone
        return style
    }
}
struct RecordListView: View {
    @Environment(WorkspaceStore.self) private var store
    let kind: ItemKind
    @State private var query = ""
    @State private var status = "all"
    @State private var category = "all"
    @State private var seriesOnly = false
    @State private var creating = false
    private var filtered: [WorkspaceRecord] {
        var values = store.records(kind).filter { record in
            (status == "all" || record.status == status) && (category == "all" || record.category == category) &&
            (query.isEmpty || "\(record.title) \(record.summary) \(record.body) \(record.tags.joined(separator: " "))".localizedCaseInsensitiveContains(query))
        }
        if kind == .deadline && seriesOnly {
            var seen: Set<UUID> = []
            values = values.filter { record in record.recurrenceSeriesID.map { seen.insert($0).inserted } ?? true }
        }
        return values
    }
    var body: some View {
        List {
            if !filtered.isEmpty {
                ForEach(filtered) { record in
                    NavigationLink { RecordDetailView(id: record.id) } label: { RecordRow(record: record) }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !record.isFinished && [.task, .deadline, .reminder].contains(kind) {
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
        .overlay { if filtered.isEmpty { ContentUnavailableView.search(text: query).overlay(alignment: .bottom) {
            if query.isEmpty { Button("新建\(kind.title)", systemImage: "plus") { creating = true }.padding(.bottom, 30) }
        } } }
        .navigationTitle(kind == .knowledge ? "知识库" : kind.title)
        .searchable(text: $query, prompt: kind == .knowledge ? "搜索标题、正文和标签" : "搜索\(kind.title)")
        .toolbar {
            ToolbarItem { Menu {
                if kind != .knowledge && kind != .area {
                    Picker("状态", selection: $status) {
                        Text("全部状态").tag("all")
                        ForEach(kind.states, id: \.self) { value in Text(StateLabels.title(value)).tag(value) }
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
                Button("新建\(kind.title)", systemImage: "plus") { creating = true }.keyboardShortcut("n")
            }
        }
        .sheet(isPresented: $creating) { NavigationStack { RecordEditorView(kind: kind) }.nativeSheetSize() }
        .refreshable { store.refresh() }
    }
}
struct ActionsView: View {
    @State private var reminders = false
    var body: some View {
        RecordListView(kind: reminders ? .reminder : .task)
            .id(reminders)
            .safeAreaInset(edge: .top) {
                Picker("行动类型", selection: $reminders) {
                    Text("行动事项").tag(false); Text("提醒").tag(true)
                }.pickerStyle(.segmented).padding(.horizontal).padding(.vertical, 8)
                    .background(.bar)
            }
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
