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
                    .navigationTitle(record.kind.title)
                    .workspaceInlineTitle()
                    .toolbar {
                        ToolbarItem(placement: .primaryAction) { Button("编辑", systemImage: "pencil") { editing = true }.disabled(record.archivedAt != nil) }
                        if record.kind.isItem {
                            ToolbarItem {
                                Button(record.pinned ? "取消标星" : "标为关键事项", systemImage: record.pinned ? "star.fill" : "star") {
                                    store.perform { try store.toggleKeyItem(record.id) }
                                }.tint(record.pinned ? .orange : .indigo).disabled(record.archivedAt != nil)
                            }
                        }
                        ToolbarItem { actions(record) }
                    }
                    .sheet(isPresented: $editing) { NavigationStack { RecordEditorView(kind: record.kind, record: record) }.nativeEditorPresentation() }
                    .workspaceSelectionFeedback(trigger: editing)
                    .workspaceSelectionFeedback(trigger: recurrence)
                    .workspaceSelectionFeedback(trigger: childKind)
                    .sheet(isPresented: $recurrence) { NavigationStack { RecurrenceEditorView(record: record) }.nativeSheetSize() }
                    .sheet(item: $childKind) { kind in NavigationStack {
                        RecordEditorView(kind: kind, projectID: record.kind == .project ? record.id : nil, areaID: record.kind == .area ? record.id : nil)
                    }.nativeEditorPresentation() }
                    .sheet(item: $preview) { preview in
                        NavigationStack { DeleteReviewView(preview: preview, onDeleted: { if !embedded { dismiss() } }) }.nativeSheetSize()
                    }
                    .fileImporter(isPresented: $pickingPDF, allowedContentTypes: [.pdf]) { result in
                        store.perform { try store.attachPDF(result.get(), to: id) }
                    }
                    .confirmationDialog("停止后续重复？", isPresented: $stoppingSeries, titleVisibility: .visible) {
                        Button("停止并关闭未来未完成事项", role: .destructive) {
                            if let series = record.recurrenceSeriesID { store.perform { try store.stopRecurrence(series) } }
                        }
                    }
            } else { ContentUnavailableView("记录已移入回收站", systemImage: "trash", description: Text("可在更多或侧栏的回收站中恢复。")) }
        }
    }
    private func detail(_ record: WorkspaceRecord) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    if record.kind != .knowledge && record.kind != .area {
                        Label(StateLabels.title(record.status), systemImage: record.isFinished ? "checkmark.circle.fill" : record.isOverdue ? "exclamationmark.circle.fill" : "circle.dotted")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(record.isFinished ? Color.green : record.isOverdue ? .red : .indigo)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(.quaternary, in: Capsule())
                    }
                    Text(record.title).font(.title2.bold()).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    if record.isKeyItem { Label("关键事项", systemImage: "star.fill").font(.subheadline.weight(.semibold)).foregroundStyle(.orange) }
                }.padding(.vertical, 6)
                if let due = record.dueDate { LabeledContent("截止", value: formatted(due, record: record)) }
                if let scheduled = record.scheduledAt { LabeledContent("计划时间", value: formatted(scheduled, record: record, time: true)) }
                if let reminder = record.notificationDate { LabeledContent("通知时间", value: formatted(reminder, record: record, time: true)) }
                if let project = record.projectID.flatMap(store.record) {
                    NavigationLink { RecordDetailView(id: project.id) } label: { LabeledContent("项目组", value: project.title) }
                }
                if record.projectID == nil, let area = record.areaID.flatMap(store.record) {
                    NavigationLink { RecordDetailView(id: area.id) } label: { LabeledContent("项目组", value: area.title) }
                }
                if let milestone = record.milestoneID.flatMap(store.record) { LabeledContent("关联事项", value: milestone.title) }
                if record.kind.isProjectGroup {
                    LabeledContent("类型", value: projectKindLabel(record.projectKind))
                    if let date = record.startDate { LabeledContent("开始", value: formatted(date, record: record)) }
                    if let date = record.targetDate { LabeledContent("目标", value: formatted(date, record: record)) }
                }
                if record.archivedAt != nil { Label("已归档", systemImage: "archivebox").foregroundStyle(.secondary) }
            }
            if record.kind == .deadline, let due = record.dueDate, !record.isFinished {
                Section {
                    DeadlineCountdownView(target: record.effectiveDueDate(due))
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
            if !record.isFinished && (record.kind.isItem || record.kind == .deadline) && record.archivedAt == nil {
                Section {
                    Button { store.perform { try store.setStatus(id, "DONE") } } label: {
                        Label("标记完成", systemImage: "checkmark")
                    }.buttonStyle(WorkspacePrimaryButtonStyle())
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
            #if os(iOS)
            if record.kind.isItem || record.kind == .deadline { DeadlineLiveActivitySection(record: record) }
            #endif
            if !record.summary.isEmpty { Section("说明") { Text(record.summary).textSelection(.enabled) } }
            if !record.body.isEmpty { Section(record.kind == .knowledge ? "正文" : "备注") { MarkdownDocumentView(source: record.body) } }
            if record.kind == .knowledge { knowledgeSections(record) }
            if record.kind.isProjectGroup { projectSections(record) }
            if let seriesID = record.recurrenceSeriesID,
               let series = store.state.series.first(where: { $0.id == seriesID }) {
                Section("重复") {
                    LabeledContent("规则", value: series.rule.label)
                    if series.rule.frequency.usesWeekParity, let first = series.rule.weekOneStart {
                        LabeledContent("第1周起始日", value: formatted(first, record: record))
                    }
                    if record.isException { Label("已单独修改的实例", systemImage: "pencil.circle") }
                    if series.stoppedAt != nil { Text("后续重复已停止").foregroundStyle(.secondary) }
                    if series.rule.frequency == .workdays { Text("调休日历覆盖2025—2026年；后续年份需更新日历后继续生成。")
                        .font(.caption).foregroundStyle(.secondary) }
                    ForEach(store.state.records.filter { $0.recurrenceSeriesID == seriesID && $0.id != record.id && $0.isLive &&
                        ($0.occurrenceDate ?? "") > (record.occurrenceDate ?? "") }
                        .sorted { ($0.occurrenceDate ?? "") < ($1.occurrenceDate ?? "") }.prefix(8)) { occurrence in
                        NavigationLink { RecordDetailView(id: occurrence.id) } label: { RecordRow(record: occurrence) }
                    }
                }
            }
            Section("历史记录") {
                ForEach(recordHistory(record).prefix(100)) { activity in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(activity.message)
                        Text(activity.date, format: .dateTime.month().day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                    }
                }
                LabeledContent("版本", value: "\(record.version)")
            }
        }
    }
    private func recordHistory(_ record: WorkspaceRecord) -> [ActivityEntry] {
        let memberIDs: Set<UUID> = record.kind.isProjectGroup ? Set(store.state.records.filter {
            $0.projectID == id || $0.areaID == id
        }.map(\.id)) : []
        return store.state.activities.filter {
            $0.entityID == id || (record.kind.isProjectGroup && ($0.projectID == id || memberIDs.contains($0.entityID)))
        }.sorted { $0.date > $1.date }
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
        let members = WorkspaceLogic.members(of: record, in: store.state)
        if members.contains(where: { $0.kind.isProjectGroup }) {
            Section("下属项目组") {
                ForEach(members.filter { $0.kind.isProjectGroup }) { group in
                    NavigationLink { RecordDetailView(id: group.id) } label: { RecordRow(record: group) }
                }
            }
        }
        Section("事项") {
            ForEach(members.filter { $0.kind.isItem }) { task in
                NavigationLink { RecordDetailView(id: task.id) } label: { RecordRow(record: task) }
            }
            Button("添加事项", systemImage: "plus") { childKind = .task }.disabled(record.archivedAt != nil)
        }
        Section("截止事项") {
            ForEach(members.filter { $0.kind == .deadline }.prefix(30)) { deadline in
                NavigationLink { RecordDetailView(id: deadline.id) } label: { RecordRow(record: deadline) }
            }
            Button("添加截止事项", systemImage: "plus") { childKind = .deadline }.disabled(record.archivedAt != nil)
        }
    }
    private func actions(_ record: WorkspaceRecord) -> some View {
        Menu {
            if record.isFinished && (record.kind.isItem || record.kind == .deadline) {
                Button("重新打开", systemImage: "arrow.counterclockwise") { store.perform { try store.setStatus(id, record.kind.states.first ?? "OPEN") } }
            }
            if record.kind == .deadline && record.status == "OPEN" {
                Button("取消此次截止事项", systemImage: "xmark.circle") { store.perform { try store.setStatus(id, "CANCELLED") } }
            }
            if (record.kind.isItem || record.kind == .deadline), record.isLive {
                if record.recurrenceSeriesID == nil && !record.isFinished {
                    Button("设置重复", systemImage: "repeat") { recurrence = true }
                } else if let seriesID = record.recurrenceSeriesID,
                          store.state.series.first(where: { $0.id == seriesID })?.stoppedAt == nil {
                    Button("停止后续重复", systemImage: "repeat.circle") { stoppingSeries = true }
                }
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
    @State private var localError: String?
    var body: some View {
        Form {
            RecurrenceRuleFields(rule: $rule, record: record)
            if let localError { Section { Text(localError).foregroundStyle(.red) } }
        }.formStyle(.grouped).navigationTitle("设置重复")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("保存") {
                    do { try store.createRecurrence(record.id, rule: rule); dismiss() }
                    catch { localError = error.localizedDescription }
                }.disabled(RecurrenceEngine.validationError(record: record, rule: rule) != nil) }
            }
            .nativeEditorPresentation()
    }
}

struct RecurrenceRuleFields: View {
    @Binding var rule: RecurrenceRule
    let record: WorkspaceRecord
    private var anchor: Date { record.recurrenceAnchor ?? Date() }
    private var firstMonday: Date { RecurrenceEngine.monday(containing: anchor, calendar: record.calendar) }
    private var previewDayStyle: Date.FormatStyle {
        var style = Date.FormatStyle.dateTime.year().month().day().weekday()
        style.timeZone = record.calendar.timeZone
        return style
    }
    private var previewTimeStyle: Date.FormatStyle {
        var style = Date.FormatStyle.dateTime.year().month().day().hour().minute()
        style.timeZone = record.calendar.timeZone
        return style
    }
    private var nextDates: [Date] {
        let from = max(record.calendar.startOfDay(for: anchor), record.calendar.startOfDay(for: Date()))
        let through = record.calendar.date(byAdding: .year, value: 3, to: from) ?? from
        return RecurrenceEngine.dates(anchor: anchor, rule: rule, from: from, through: through, timezone: record.timezone, limit: 5)
    }
    var body: some View {
        Group {
            Section("重复规则") {
                if let first = record.recurrenceAnchor {
                    LabeledContent("重复依据", value: record.kind.isItem && record.scheduledAt != nil ? "计划时间" : record.dueDate != nil ? "截止日期" : "自定义提醒时间")
                    LabeledContent("首次时间") {
                        Text(first, format: previewTimeStyle)
                    }
                }
                Picker("频率", selection: $rule.frequency) {
                    ForEach(RecurrenceRule.Frequency.allCases) { Text($0.title).tag($0) }
                }
                if rule.frequency.supportsInterval {
                    Stepper("每 \(rule.interval) \(rule.frequency.intervalUnit)", value: $rule.interval, in: 1...365)
                    if rule.frequency == .weekly && rule.interval == 2 {
                        Text("隔周重复，以首次日期所在周为起点。").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if rule.frequency.usesWeekdays {
                    ForEach(1...7, id: \.self) { day in
                        Toggle(WorkspaceDates.weekdayName(day), isOn: Binding(get: { rule.weekdays.contains(day) }, set: { enabled in
                            rule.weekdays.removeAll { $0 == day }; if enabled { rule.weekdays.append(day) }
                        }))
                    }
                    if rule.weekdays.isEmpty {
                        Text("未选择星期时，沿用首次日期的星期。").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if rule.frequency.usesWeekParity {
                Section("单双周基准") {
                    DatePicker("第1周起始日", selection: Binding(
                        get: { rule.weekOneStart ?? firstMonday },
                        set: { rule.weekOneStart = RecurrenceEngine.monday(containing: $0, calendar: record.calendar) }),
                        in: ...anchor, displayedComponents: .date)
                        .environment(\.timeZone, record.calendar.timeZone)
                    Text("以所选日期所在周的周一为第1周，连续计算，不在跨年时重置。按教学周使用时，请选择学期第1周。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("结束") {
                Toggle("设置结束日期", isOn: Binding(get: { rule.until != nil }, set: { enabled in
                    rule.until = enabled ? record.calendar.date(byAdding: .month, value: 3, to: anchor) : nil
                }))
                if rule.until != nil {
                    DatePicker("最后一天", selection: Binding(get: { rule.until ?? anchor }, set: { rule.until = $0 }),
                        in: record.calendar.startOfDay(for: anchor)..., displayedComponents: .date)
                        .environment(\.timeZone, record.calendar.timeZone)
                }
            }
            if let message = RecurrenceEngine.validationError(record: record, rule: rule) {
                Section { Text(message).foregroundStyle(.red) }
            } else {
                Section("接下来的重复日期") {
                    if nextDates.isEmpty { Text("所选范围内暂无重复日期。").foregroundStyle(.secondary) }
                    ForEach(nextDates, id: \.self) { day in
                        Text(day, format: previewDayStyle)
                    }
                }
            }
            Section {
                Text("当前事项保留。每次重复沿用原有时刻，计划、截止和自定义提醒会随日期一起移动；每次可以单独完成、改期或取消。")
                    .font(.caption).foregroundStyle(.secondary)
                if rule.frequency == .workdays {
                    Text("按中国大陆法定放假和调休，包含补班周末。内置日历覆盖2025—2026年；未覆盖年份暂停生成，更新调休日历后继续。学校另行调整的安排可单独修改实例。")
                        .font(.caption).foregroundStyle(.secondary)
                    Link("查看2026年官方调休安排", destination: URL(string: ChinaWorkCalendar.source2026)!)
                } else if rule.frequency == .weekdays {
                    Text("仅周一至周五，不调整法定节假日和周末补班。").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .onAppear { prepareWeekSelection() }
        .onChange(of: rule.frequency) { _, _ in
            if !rule.frequency.supportsInterval { rule.interval = 1 }
            prepareWeekSelection()
        }
        .workspaceSelectionFeedback(trigger: rule.frequency)
        .workspaceSelectionFeedback(trigger: rule.weekdays)
    }
    private func prepareWeekSelection() {
        if rule.frequency.usesWeekdays && rule.weekdays.isEmpty {
            rule.weekdays = [(record.calendar.component(.weekday, from: anchor) + 5) % 7 + 1]
        }
        if rule.frequency.usesWeekParity && rule.weekOneStart == nil { rule.weekOneStart = firstMonday }
    }
}
