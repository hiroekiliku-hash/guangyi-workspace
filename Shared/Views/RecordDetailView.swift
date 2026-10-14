import SwiftUI
import UniformTypeIdentifiers

struct RecordDetailView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: UUID
    var embedded = false
    @State private var editing = false
    @State private var recurrence = false
    @State private var preview: DeletionPreview?
    @State private var pickingPDF = false
    @State private var stoppingSeries = false
    @State private var childKind: ItemKind?
    var body: some View {
        Group {
            if let record = store.record(id), record.deletedAt == nil {
                detail(record)
                    .navigationTitle(record.title)
                    .toolbar {
                        ToolbarItem(placement: .primaryAction) { Button("编辑", systemImage: "pencil") { editing = true }.disabled(record.archivedAt != nil) }
                        ToolbarItem { actions(record) }
                    }
                    .sheet(isPresented: $editing) { NavigationStack { RecordEditorView(kind: record.kind, record: record) }.nativeEditorPresentation() }
                    .sheet(isPresented: $recurrence) { NavigationStack { RecurrenceEditorView(record: record) }.nativeSheetSize() }
                    .sheet(item: $childKind) { kind in NavigationStack { RecordEditorView(kind: kind, projectID: record.id) }.nativeEditorPresentation() }
                    .sheet(item: $preview) { preview in
                        NavigationStack { DeleteReviewView(preview: preview, onDeleted: { if !embedded { dismiss() } }) }.nativeSheetSize()
                    }
                    .fileImporter(isPresented: $pickingPDF, allowedContentTypes: [.pdf]) { result in
                        store.perform { try store.attachPDF(result.get(), to: id) }
                    }
                    .confirmationDialog("停止后续循环？", isPresented: $stoppingSeries, titleVisibility: .visible) {
                        Button("停止并取消未来未完成实例", role: .destructive) {
                            if let series = record.recurrenceSeriesID { store.perform { try store.stopRecurrence(series) } }
                        }
                    }
            } else { ContentUnavailableView("记录已移入回收站", systemImage: "trash", description: Text("可在更多或侧栏的回收站中恢复。")) }
        }
    }
    private func detail(_ record: WorkspaceRecord) -> some View {
        List {
            Section {
                Text(record.title).font(.title2.bold()).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if record.kind != .knowledge && record.kind != .area { LabeledContent("状态", value: StateLabels.title(record.status)) }
                if let due = record.dueDate { LabeledContent("截止", value: formatted(due, record: record)) }
                if let reminder = record.remindAt { LabeledContent("提醒", value: formatted(reminder, record: record, time: true)) }
                if let scheduled = record.scheduledAt { LabeledContent("安排", value: formatted(scheduled, record: record, time: true)) }
                if let project = record.projectID.flatMap(store.record) {
                    NavigationLink { RecordDetailView(id: project.id) } label: { LabeledContent("行动组", value: project.title) }
                }
                if let area = record.areaID.flatMap(store.record) { LabeledContent("领域", value: area.title) }
                if let milestone = record.milestoneID.flatMap(store.record) { LabeledContent("里程碑", value: milestone.title) }
                if record.kind == .project {
                    LabeledContent("类型", value: projectKindLabel(record.projectKind))
                    if let date = record.startDate { LabeledContent("开始", value: formatted(date, record: record)) }
                    if let date = record.targetDate { LabeledContent("目标", value: formatted(date, record: record)) }
                }
                if record.archivedAt != nil { Label("已归档", systemImage: "archivebox").foregroundStyle(.secondary) }
                if !record.isFinished && [.task, .deadline, .reminder].contains(record.kind) && record.archivedAt == nil {
                    Button("标记完成", systemImage: "checkmark.circle") { store.perform { try store.setStatus(id, "DONE") } }.buttonStyle(.borderedProminent)
                }
            }
            #if os(iOS)
            if [.task, .deadline].contains(record.kind) { DeadlineLiveActivitySection(record: record) }
            #endif
            if record.kind == .deadline, let due = record.dueDate, !record.isFinished {
                Section("倒计时") {
                    DeadlineCountdownView(target: record.effectiveDueDate(due))
                }
            }
            if !record.summary.isEmpty { Section("说明") { Text(record.summary).textSelection(.enabled) } }
            if !record.body.isEmpty { Section(record.kind == .knowledge ? "正文" : "备注") { MarkdownDocumentView(source: record.body) } }
            if record.kind == .knowledge { knowledgeSections(record) }
            if record.kind == .project { projectSections(record) }
            if let seriesID = record.recurrenceSeriesID,
               let series = store.state.series.first(where: { $0.id == seriesID }) {
                Section("循环") {
                    LabeledContent("规则", value: series.rule.label)
                    if record.isException { Label("已单独修改的实例", systemImage: "pencil.circle") }
                    if series.stoppedAt != nil { Text("后续循环已停止").foregroundStyle(.secondary) }
                    ForEach(store.records(.deadline).filter { $0.recurrenceSeriesID == seriesID }.prefix(8)) { occurrence in
                        NavigationLink { RecordDetailView(id: occurrence.id) } label: { RecordRow(record: occurrence) }
                    }
                }
            }
            Section("历史记录") {
                ForEach(store.state.activities.filter { $0.entityID == id || (record.kind == .project && $0.projectID == id) }.sorted { $0.date > $1.date }.prefix(100)) { activity in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(activity.message)
                        Text(activity.date, format: .dateTime.month().day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                    }
                }
                LabeledContent("版本", value: "\(record.version)")
            }
        }
    }
    @ViewBuilder private func knowledgeSections(_ record: WorkspaceRecord) -> some View {
        Section("分类与标签") {
            LabeledContent("分类", value: record.category)
            if !record.tags.isEmpty { Text(record.tags.map { "#" + $0 }.joined(separator: "  ")) }
        }
        Section("PDF 附件") {
            ForEach(store.state.assets.filter { $0.ownerID == id }) { asset in
                NavigationLink { PDFDocumentView(asset: asset) } label: {
                    Label(asset.name, systemImage: "doc.richtext")
                }
            }
            Button("添加 PDF", systemImage: "paperclip") { pickingPDF = true }.disabled(record.archivedAt != nil)
        }
        Section("笔记版本") {
            ForEach(store.state.revisions.filter { $0.record.id == id }.sorted { $0.date > $1.date }.prefix(100)) { revision in
                NavigationLink {
                    RevisionDetailView(revision: revision)
                } label: { LabeledContent("版本 \(revision.record.version)", value: revision.date.formatted(date: .abbreviated, time: .shortened)) }
            }
        }
    }
    @ViewBuilder private func projectSections(_ record: WorkspaceRecord) -> some View {
        Section("里程碑") {
            ForEach(store.records(.milestone).filter { $0.projectID == id }) { milestone in
                NavigationLink { RecordDetailView(id: milestone.id) } label: { RecordRow(record: milestone) }
            }
            Button("添加里程碑", systemImage: "plus") { childKind = .milestone }.disabled(record.archivedAt != nil)
        }
        Section("行动") {
            ForEach(store.records(.task).filter { $0.projectID == id }) { task in
                NavigationLink { RecordDetailView(id: task.id) } label: { RecordRow(record: task) }
            }
            Button("添加行动", systemImage: "plus") { childKind = .task }.disabled(record.archivedAt != nil)
        }
        Section("截止事项") {
            ForEach(store.records(.deadline).filter { $0.projectID == id }.prefix(30)) { deadline in
                NavigationLink { RecordDetailView(id: deadline.id) } label: { RecordRow(record: deadline) }
            }
            Button("添加截止事项", systemImage: "plus") { childKind = .deadline }.disabled(record.archivedAt != nil)
        }
    }
    private func actions(_ record: WorkspaceRecord) -> some View {
        Menu {
            if record.isFinished && [.task, .deadline, .reminder].contains(record.kind) {
                Button("重新打开", systemImage: "arrow.counterclockwise") { store.perform { try store.setStatus(id, record.kind == .task ? "TODO" : "OPEN") } }
            }
            if record.kind == .deadline && record.status == "OPEN" {
                Button("取消此次截止事项", systemImage: "xmark.circle") { store.perform { try store.setStatus(id, "CANCELLED") } }
                if record.recurrenceSeriesID == nil { Button("设置循环", systemImage: "repeat") { recurrence = true } }
                else { Button("停止后续循环", systemImage: "repeat.circle") { stoppingSeries = true } }
            }
            if record.kind == .knowledge {
                Button(record.pinned ? "取消置顶" : "置顶", systemImage: "pin") {
                    var value = record; value.pinned.toggle()
                    store.perform { try store.save(value, expectedVersion: record.version) }
                }
            }
            if record.dueDate != nil || record.scheduledAt != nil || record.targetDate != nil {
                Button("加入系统日历", systemImage: "calendar.badge.plus") {
                    Task {
                        do {
                            _ = try await SystemCalendarService.add(record)
                            store.information = "已保存到系统日历。"
                        } catch { store.errorMessage = error.localizedDescription }
                    }
                }
            }
            Button(record.archivedAt == nil ? "归档" : "恢复归档", systemImage: "archivebox") {
                store.perform { try store.archive(id, restore: record.archivedAt != nil) }
            }
            Divider()
            Button("移入回收站", systemImage: "trash", role: .destructive) { store.perform { preview = try store.deletionPreview(id) } }
        } label: { Label("更多操作", systemImage: "ellipsis.circle") }
    }
    private func formatted(_ date: Date, record: WorkspaceRecord, time: Bool = false) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.timeZone = record.calendar.timeZone
        formatter.dateFormat = time || !record.dateOnly ? "yyyy年M月d日 HH:mm" : "yyyy年M月d日"
        return formatter.string(from: date)
    }
    private func countdown(to target: Date, now: Date) -> String {
        let duration = Int(abs(target.timeIntervalSince(now)))
        return (target < now ? "已逾期 " : "还剩 ") + "\(duration / 86400) 天 \(duration / 3600 % 24) 时 \(duration / 60 % 60) 分 \(duration % 60) 秒"
    }
}
struct DeleteReviewView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let preview: DeletionPreview
    var onDeleted: () -> Void
    var body: some View {
        List {
            Section { Text("以下 \(preview.records.count) 项将一起移入回收站。关联关系会保留，确认后仍可在恢复期限内恢复。") }
            ForEach(preview.records) { RecordRow(record: $0) }
        }.navigationTitle("确认删除范围")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("移入回收站", role: .destructive) {
                    do { try store.delete(preview); dismiss(); onDeleted() } catch { store.errorMessage = error.localizedDescription }
                } }
            }
    }
}
struct RevisionDetailView: View {
    @Environment(WorkspaceStore.self) private var store
    let revision: KnowledgeRevision
    @State private var confirming = false
    var body: some View {
        ScrollView { MarkdownDocumentView(source: revision.record.body).padding().frame(maxWidth: .infinity, alignment: .leading) }
            .navigationTitle("版本 \(revision.record.version)")
            .toolbar { Button("恢复此版本", systemImage: "arrow.counterclockwise") { confirming = true } }
            .confirmationDialog("恢复后将生成新版本，当前内容仍保留在历史记录中。", isPresented: $confirming, titleVisibility: .visible) {
                Button("恢复此版本") { store.perform { try store.restoreRevision(revision) } }
            }
    }
}
struct RecurrenceEditorView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let record: WorkspaceRecord
    @State private var rule = RecurrenceRule()
    var body: some View {
        Form {
            Section("循环规则") {
                Picker("频率", selection: $rule.frequency) { ForEach(RecurrenceRule.Frequency.allCases) { Text("每\($0.title)").tag($0) } }
                Stepper("每 \(rule.interval) \(rule.frequency.title)", value: $rule.interval, in: 1...365)
                if rule.frequency == .weekly {
                    ForEach(1...7, id: \.self) { day in
                        Toggle(WorkspaceDates.weekdayName(day), isOn: Binding(get: { rule.weekdays.contains(day) }, set: { enabled in
                            rule.weekdays.removeAll { $0 == day }; if enabled { rule.weekdays.append(day) }
                        }))
                    }
                }
                Toggle("设置结束日期", isOn: Binding(get: { rule.until != nil }, set: { rule.until = $0 ? Date().addingTimeInterval(86400 * 90) : nil }))
                if rule.until != nil { DatePicker("结束", selection: Binding(get: { rule.until ?? Date() }, set: { rule.until = $0 }), displayedComponents: .date).environment(\.timeZone, record.calendar.timeZone) }
            }
            Section {
                Text("循环实例预生成到未来三年。每次打开应用会补齐窗口。每个实例可单独改期、完成或取消；月末日期会自动适应短月份。")
                    .foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).navigationTitle("设置循环")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("保存") {
                    do { try store.createRecurrence(record.id, rule: rule); dismiss() } catch { store.errorMessage = error.localizedDescription }
                }.disabled(rule.frequency == .weekly && rule.weekdays.isEmpty) }
            }
            .onAppear {
                if let due = record.dueDate { rule.weekdays = [(record.calendar.component(.weekday, from: due) + 5) % 7 + 1] }
            }
    }
}
