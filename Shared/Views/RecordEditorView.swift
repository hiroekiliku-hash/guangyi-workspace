import SwiftUI

struct RecordEditorView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: WorkspaceRecord
    @State private var confirmed = false
    @State private var localError: String?
    private let expectedVersion: Int?
    private let originalStatus: String?
    init(kind: ItemKind, record: WorkspaceRecord? = nil, projectID: UUID? = nil) {
        var value = record ?? WorkspaceRecord(kind: kind)
        if record == nil { value.projectID = projectID }
        if record == nil && kind == .deadline { value.dueDate = Date().addingTimeInterval(86400) }
        _draft = State(initialValue: value); expectedVersion = record?.version; originalStatus = record?.status
    }
    var body: some View {
        Form {
            identitySection
            relationshipSection
            dateSection
            notificationSection
            contentSection
            if draft.kind == .project && draft.status == "COMPLETED" && originalStatus != "COMPLETED" {
                Section { Toggle("确认完成项目（保留未完成行动）", isOn: $confirmed) }
            }
            if let localError { Section { Text(localError).foregroundStyle(.red) } }
        }
        .formStyle(.grouped)
        .navigationTitle((expectedVersion == nil ? "新建" : "编辑") + draft.kind.title)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.keyboardShortcut(.cancelAction) }
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") {
                    do { try store.save(draft, expectedVersion: expectedVersion, confirmRemaining: confirmed); dismiss() }
                    catch { localError = error.localizedDescription }
                }.disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).keyboardShortcut("s")
            }
        }
        .nativeSheetSize()
        .onAppear { if expectedVersion == nil { draft.timezone = store.state.profile.timezone } }
    }
    private var identitySection: some View {
        Section("基本信息") {
            TextField("标题", text: $draft.title, axis: .vertical)
            if draft.kind != .knowledge && draft.kind != .area {
                Picker("状态", selection: $draft.status) {
                    ForEach(draft.kind.states, id: \.self) { Text(StateLabels.title($0)).tag($0) }
                }
            }
            if draft.kind == .project {
                Picker("项目类型", selection: $draft.projectKind) {
                    ForEach(["RESEARCH", "PAPER", "VERTICAL_PROJECT", "INDUSTRY_PROJECT", "LEARNING", "ADMINISTRATIVE", "PERSONAL"], id: \.self) { key in
                        Text(projectKindLabel(key)).tag(key)
                    }
                }
            }
        }
    }
    @ViewBuilder private var relationshipSection: some View {
        if [.task, .deadline, .milestone].contains(draft.kind) {
            Section("关联") {
                Picker("项目", selection: $draft.projectID) {
                    Text("独立事项").tag(UUID?.none)
                    ForEach(store.records(.project)) { Text($0.title).tag(Optional($0.id)) }
                }.onChange(of: draft.projectID) { _, _ in draft.milestoneID = nil }
                if draft.kind == .task, let projectID = draft.projectID {
                    Picker("里程碑", selection: $draft.milestoneID) {
                        Text("不关联里程碑").tag(UUID?.none)
                        ForEach(store.records(.milestone).filter { $0.projectID == projectID }) { Text($0.title).tag(Optional($0.id)) }
                    }
                }
            }
        }
        if draft.kind == .project {
            Section("领域") {
                Picker("归属领域", selection: $draft.areaID) {
                    Text("未分类").tag(UUID?.none)
                    ForEach(store.records(.area)) { Text($0.title).tag(Optional($0.id)) }
                }
            }
        }
    }
    @ViewBuilder private var dateSection: some View {
        if draft.kind == .project {
            Section("项目日期") {
                optionalDate("开始日期", date: $draft.startDate, time: false)
                optionalDate("目标日期", date: $draft.targetDate, time: false)
            }
        }
        if [.task, .deadline, .milestone].contains(draft.kind) {
            Section("截止日期") {
                if draft.kind != .deadline { Toggle("设置截止日期", isOn: presence($draft.dueDate)) }
                if draft.dueDate != nil || draft.kind == .deadline {
                    Toggle("仅日期", isOn: $draft.dateOnly)
                    DatePicker("截止", selection: date($draft.dueDate), displayedComponents: draft.dateOnly ? .date : [.date, .hourAndMinute])
                        .environment(\.timeZone, draft.calendar.timeZone)
                    if draft.recurrenceSeriesID != nil { Text("此修改只影响当前循环实例，原循环模板保持不变。").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
        if draft.kind == .task {
            Section("安排") { optionalDate("行动时间", date: $draft.scheduledAt, time: true) }
        }
        if draft.kind == .reminder {
            Section("提醒时间") { optionalDate("具体时间", date: $draft.remindAt, time: true) }
        }
        if [.project, .task, .deadline, .reminder, .milestone].contains(draft.kind) {
            Section("时区") {
                Picker("时区", selection: $draft.timezone) {
                    ForEach(timezoneChoices, id: \.self) { Text($0).tag($0) }
                }
            }
        }
    }
    @ViewBuilder private var notificationSection: some View {
        if [.task, .deadline, .reminder].contains(draft.kind) {
            Section("系统提醒") {
                Toggle("发送系统通知", isOn: $draft.notificationsEnabled)
                if draft.notificationsEnabled {
                    Picker("提前提醒", selection: $draft.notificationLeadMinutes) {
                        Text("准时").tag(0); Text("提前 15 分钟").tag(15); Text("提前 1 小时").tag(60); Text("提前 1 天").tag(1440)
                    }
                    if draft.dateOnly && draft.dueDate != nil { Text("仅日期截止事项在当天 09:00 提醒。请在设置中允许系统通知。").font(.caption).foregroundStyle(.secondary) }
                    if let snooze = draft.snoozedUntil {
                        LabeledContent("稍后提醒", value: snooze.formatted(date: .abbreviated, time: .shortened))
                        Button("清除稍后提醒") { draft.snoozedUntil = nil }
                    }
                }
            }
        }
    }
    @ViewBuilder private var contentSection: some View {
        if draft.kind == .knowledge {
            Section("笔记信息") {
                TextField("摘要", text: $draft.summary, axis: .vertical)
                TextField("分类", text: $draft.category)
                TextField("标签（逗号分隔）", text: Binding(get: { draft.tags.joined(separator: ", ") }, set: {
                    draft.tags = Array(Set($0.replacingOccurrences(of: "，", with: ",").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })).sorted()
                }))
                Toggle("置顶", isOn: $draft.pinned)
            }
            Section("Markdown 正文") { TextEditor(text: $draft.body).font(.body.monospaced()).frame(minHeight: 280) }
            Section("预览") { MarkdownDocumentView(source: draft.body) }
        } else {
            Section(draft.kind == .project || draft.kind == .area ? "说明" : "备注") {
                TextField("简短说明", text: $draft.summary, axis: .vertical)
                TextEditor(text: $draft.body).frame(minHeight: 130)
            }
        }
    }
    @ViewBuilder private func optionalDate(_ title: String, date value: Binding<Date?>, time: Bool) -> some View {
        Toggle(title, isOn: presence(value))
        if value.wrappedValue != nil {
            DatePicker(title, selection: date(value), displayedComponents: time ? [.date, .hourAndMinute] : .date)
                .environment(\.timeZone, draft.calendar.timeZone)
        }
    }
    private func presence(_ value: Binding<Date?>) -> Binding<Bool> {
        Binding(get: { value.wrappedValue != nil }, set: { value.wrappedValue = $0 ? value.wrappedValue ?? Date() : nil })
    }
    private func date(_ value: Binding<Date?>) -> Binding<Date> {
        Binding(get: { value.wrappedValue ?? Date() }, set: { value.wrappedValue = $0 })
    }
    private var timezoneChoices: [String] { Array(Set([draft.timezone, "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York", TimeZone.current.identifier])).sorted() }
}
func projectKindLabel(_ key: String) -> String {
    ["RESEARCH": "科研", "PAPER": "论文", "VERTICAL_PROJECT": "纵向项目", "INDUSTRY_PROJECT": "横向项目",
     "LEARNING": "学习", "ADMINISTRATIVE": "日常事务", "PERSONAL": "个人"][key] ?? key
}
