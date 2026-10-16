import SwiftUI

struct RecordEditorView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: WorkspaceRecord
    private enum Field: Hashable { case title, summary, body, category, tags }
    @FocusState private var focusedField: Field?
    @State private var previewing = false
    @State private var confirmed = false
    @State private var localError: String?
    @State private var repeats = false
    @State private var recurrenceRule = RecurrenceRule(frequency: .daily)
    private let expectedVersion: Int?
    private let originalStatus: String?
    init(kind: ItemKind, record: WorkspaceRecord? = nil, projectID: UUID? = nil, areaID: UUID? = nil) {
        var value = record ?? WorkspaceRecord(kind: kind.creationKind)
        if record == nil { value.projectID = projectID; value.areaID = areaID }
        if record == nil && kind == .deadline { value.dueDate = Date().addingTimeInterval(86400) }
        _draft = State(initialValue: value); expectedVersion = record?.version; originalStatus = record?.status
    }
    var body: some View {
        Form {
            identitySection
            relationshipSection
            dateSection
            notificationSection
            recurrenceSection
            contentSection
            if draft.kind == .project && draft.status == "COMPLETED" && originalStatus != "COMPLETED" {
                Section { Toggle("确认完成项目组（保留未完成事项）", isOn: $confirmed) }
            }
            if let localError { Section { Text(localError).foregroundStyle(.red) } }
        }
        .formStyle(.grouped)
        .navigationTitle((expectedVersion == nil ? "新建" : "编辑") + draft.kind.title)
        .toolbar {
            #if os(iOS)
            ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("完成") { focusedField = nil } }
            #endif
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.keyboardShortcut(.cancelAction) }
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") {
                    do { try store.save(draft, expectedVersion: expectedVersion, confirmRemaining: confirmed,
                        recurrenceRule: repeats ? recurrenceRule : nil); dismiss() }
                    catch { localError = error.localizedDescription }
                }.disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                    (repeats && RecurrenceEngine.validationError(record: draft, rule: recurrenceRule) != nil)).keyboardShortcut("s")
            }
        }
        .nativeEditorPresentation()
        .workspaceInlineTitle()
        .workspaceSelectionFeedback(trigger: draft.status)
        .workspaceSelectionFeedback(trigger: draft.projectID)
        .workspaceSelectionFeedback(trigger: draft.areaID)
        .workspaceSelectionFeedback(trigger: draft.pinned)
        .workspaceSelectionFeedback(trigger: draft.dateOnly)
        .workspaceSelectionFeedback(trigger: draft.notificationsEnabled)
        .workspaceSelectionFeedback(trigger: draft.notificationLeadMinutes)
        .workspaceSelectionFeedback(trigger: previewing)
        .workspaceSelectionFeedback(trigger: repeats)
        .sensoryFeedback(.error, trigger: localError) { _, value in UserDefaults.standard.object(forKey: "hapticsEnabled") as? Bool != false && value != nil }
        .scrollDismissesKeyboard(.interactively)
        .task {
            if expectedVersion == nil {
                // Wait until the sheet's navigation and keyboard toolbar are installed.
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled else { return }
                focusedField = .title
            }
        }
        .onAppear { if expectedVersion == nil { draft.timezone = store.state.profile.timezone } }
    }
    private var identitySection: some View {
        Section("基本信息") {
            TextField("标题", text: $draft.title, axis: .vertical).focused($focusedField, equals: .title)
            if draft.kind != .knowledge && draft.kind != .area {
                Picker("状态", selection: $draft.status) {
                    ForEach(draft.kind.states, id: \.self) { Text(StateLabels.title($0)).tag($0) }
                }
            }
            if draft.kind.isItem { Toggle("关键事项", systemImage: "star.fill", isOn: $draft.pinned) }
            if draft.kind.isProjectGroup {
                Picker("分类", selection: $draft.projectKind) {
                    ForEach(["RESEARCH", "PAPER", "VERTICAL_PROJECT", "INDUSTRY_PROJECT", "LEARNING", "ADMINISTRATIVE", "PERSONAL"], id: \.self) { key in
                        Text(projectKindLabel(key)).tag(key)
                    }
                }
            }
        }
    }
    @ViewBuilder private var relationshipSection: some View {
        if draft.kind.isItem || draft.kind == .deadline {
            Section("关联") {
                Picker("项目组", selection: groupSelection) {
                    Text("独立事项").tag(UUID?.none)
                    ForEach(WorkspaceLogic.projectGroupRecords(in: store.state)) { Text($0.title).tag(Optional($0.id)) }
                }
                if let related = draft.milestoneID.flatMap(store.record) {
                    LabeledContent("关联事项", value: related.title)
                    Button("解除事项关联") { draft.milestoneID = nil }
                }
            }
        }
        if draft.kind.isProjectGroup, let parent = draft.areaID.flatMap(store.record) {
            Section("所属项目组") {
                Text(parent.title)
                Button("移出此项目组") { draft.areaID = nil }
            }
        }
    }
    private var groupSelection: Binding<UUID?> {
        Binding(get: { draft.projectID ?? draft.areaID }, set: { id in
            let group = id.flatMap(store.record)
            let projectID = group?.kind == .project ? id : nil
            if draft.projectID != projectID { draft.milestoneID = nil }
            draft.projectID = projectID
            draft.areaID = group?.kind == .area ? id : nil
        })
    }
    @ViewBuilder private var dateSection: some View {
        if draft.kind.isProjectGroup {
            Section("分组日期") {
                optionalDate("开始日期", date: $draft.startDate, time: false)
                optionalDate("目标日期", date: $draft.targetDate, time: false)
            }
        }
        if draft.kind.isItem {
            Section("计划") {
                optionalDate("计划时间", date: $draft.scheduledAt, time: true)
                Text("打算什么时候处理这件事。只做安排，不会自动发送通知。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        if draft.kind.isItem || draft.kind == .deadline {
            Section(draft.kind.isItem ? "截止（可选）" : "截止日期") {
                if draft.kind != .deadline { Toggle("有完成期限", isOn: presence($draft.dueDate)) }
                if draft.dueDate != nil || draft.kind == .deadline {
                    Toggle("仅日期", isOn: $draft.dateOnly)
                    DatePicker("截止", selection: date($draft.dueDate), displayedComponents: draft.dateOnly ? .date : [.date, .hourAndMinute])
                        .environment(\.timeZone, draft.calendar.timeZone)
                }
                if draft.kind.isItem { Text("最晚什么时候完成。没有明确期限可以不设置。")
                    .font(.caption).foregroundStyle(.secondary) }
            }
        }
        if draft.kind.isProjectGroup || draft.kind.isItem || draft.kind == .deadline {
            Section("时区") {
                Picker("时区", selection: $draft.timezone) {
                    ForEach(timezoneChoices, id: \.self) { Text($0).tag($0) }
                }
            }
        }
    }
    @ViewBuilder private var notificationSection: some View {
        if draft.kind.isItem || draft.kind == .deadline {
            Section("系统提醒") {
                Toggle("发送系统通知", isOn: $draft.notificationsEnabled)
                if draft.notificationsEnabled {
                    if draft.kind.isItem {
                        Toggle("自定义提醒时间", isOn: presence($draft.remindAt))
                        if draft.remindAt != nil {
                            DatePicker("通知时间", selection: date($draft.remindAt), displayedComponents: [.date, .hourAndMinute])
                                .environment(\.timeZone, draft.calendar.timeZone)
                            Text("按此时间发送通知，不再额外提前，也不改变计划或截止。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if !draft.kind.isItem || draft.remindAt == nil {
                        if draft.dueDate != nil || draft.scheduledAt != nil {
                            LabeledContent("提醒依据", value: draft.dueDate != nil ? "截止日期" : "计划时间")
                            Picker("提前提醒", selection: $draft.notificationLeadMinutes) {
                                Text("准时").tag(0); Text("提前 5 分钟").tag(5); Text("提前 15 分钟").tag(15); Text("提前 30 分钟").tag(30); Text("提前 1 小时").tag(60); Text("提前 1 天").tag(1440)
                            }
                            if draft.dateOnly && draft.dueDate != nil {
                                Text("仅日期截止以当天09:00为提醒基准，再按所选提前量通知。")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        } else {
                            Text("先设置计划时间或截止日期，也可以开启自定义提醒时间。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if let at = draft.notificationDate {
                        LabeledContent("实际通知时间") {
                            Text(at, format: notificationDateStyle)
                        }
                    }
                    if let snooze = draft.snoozedUntil {
                        LabeledContent("稍后提醒", value: snooze.formatted(date: .abbreviated, time: .shortened))
                        Button("清除稍后提醒") { draft.snoozedUntil = nil }
                    }
                    Text("发送提醒还需要在设置中开启本机提醒，并允许系统通知。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
    private var notificationDateStyle: Date.FormatStyle {
        var style = Date.FormatStyle.dateTime.month().day().hour().minute()
        style.timeZone = draft.calendar.timeZone
        return style
    }
    @ViewBuilder private var recurrenceSection: some View {
        if draft.kind.isItem || draft.kind == .deadline {
            if draft.recurrenceSeriesID != nil {
                Section("重复") {
                    Text("当前编辑只影响这一次。重复规则和停止后续重复可在事项详情中查看。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else if !draft.isFinished {
                Section("重复") { Toggle("周期重复", isOn: $repeats) }
                if repeats { RecurrenceRuleFields(rule: $recurrenceRule, record: draft) }
            }
        }
    }
    @ViewBuilder private var contentSection: some View {
        if draft.kind == .knowledge {
            Section("笔记信息") {
                TextField("摘要", text: $draft.summary, axis: .vertical).focused($focusedField, equals: .summary)
                TextField("分类", text: $draft.category).focused($focusedField, equals: .category)
                TextField("标签（逗号分隔）", text: Binding(get: { draft.tags.joined(separator: ", ") }, set: {
                    draft.tags = Array(Set($0.replacingOccurrences(of: "，", with: ",").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })).sorted()
                })).focused($focusedField, equals: .tags)
                Toggle("置顶", isOn: $draft.pinned)
            }
            Section("Markdown 正文") {
                Picker("正文模式", selection: $previewing) { Text("编辑").tag(false); Text("预览").tag(true) }.pickerStyle(.segmented)
                if previewing { MarkdownDocumentView(source: draft.body) }
                else { TextEditor(text: $draft.body).focused($focusedField, equals: .body).font(.body.monospaced()).frame(minHeight: 280) }
            }
        } else {
            Section(draft.kind == .project || draft.kind == .area ? "说明" : "备注") {
                TextField("简短说明", text: $draft.summary, axis: .vertical).focused($focusedField, equals: .summary)
                TextEditor(text: $draft.body).focused($focusedField, equals: .body).frame(minHeight: 130)
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
