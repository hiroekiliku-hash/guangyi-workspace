import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct SettingsView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var showGettingStarted = false
    @AppStorage("appearance") private var appearance = "system"
    var body: some View {
        Form {
            Section {
                NavigationLink { BackendSettingsView() } label: {
                    HStack(spacing: 14) {
                        AvatarView(data: store.state.profile.avatar).frame(width: 56, height: 56).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 5) {
                            Text(store.state.profile.name).font(.title3.weight(.semibold)).foregroundStyle(.primary)
                            Text(store.backend.signedIn ? store.backend.accountName : "登录工作坊，同步你的内容")
                                .font(.subheadline).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }.padding(.vertical, 6)
                }
            }
            Section {
                NavigationLink { AppearancePreferencesView() } label: {
                    SettingsEntry(title: AppearancePreferencesView.title, symbol: "paintpalette", color: .indigo)
                }
                NavigationLink { ReminderPreferencesView() } label: {
                    SettingsEntry(title: "提醒", symbol: "bell", color: .orange)
                }
            }
            Section {
                #if os(iOS)
                NavigationLink { WorkspaceLibraryView() } label: {
                    SettingsEntry(title: "工作空间", symbol: "square.grid.2x2", color: .blue)
                }
                #endif
                NavigationLink { BackupPreferencesView() } label: {
                    SettingsEntry(title: "数据与备份", symbol: "externaldrive", color: .teal)
                }
            }
            Section {
                Button { showGettingStarted = true } label: {
                    SettingsEntry(title: "使用教程", symbol: "play", color: .indigo)
                }
                NavigationLink { AboutWorkspaceView() } label: {
                    SettingsEntry(title: "关于工作坊", symbol: "info", color: .gray)
                }
            }
        }.formStyle(.grouped).navigationTitle("设置")
            #if os(iOS)
            .toolbar(.hidden, for: .tabBar)
            #endif
            .environment(\.locale, Locale(identifier: "zh_CN"))
            .environment(\.timeZone, WorkspaceDates.calendar(store.state.profile.timezone).timeZone)
            .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
            .gettingStarted(isPresented: $showGettingStarted, isReplay: true)
    }
}

private struct SettingsEntry: View {
    let title: String
    let symbol: String
    let color: Color
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white).frame(width: 30, height: 30)
                .background(color.gradient, in: RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
            Text(title).foregroundStyle(.primary)
        }.padding(.vertical, 3)
    }
}

private struct AppearancePreferencesView: View {
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    static var title: String {
        #if os(iOS)
        "外观与触感"
        #else
        "外观"
        #endif
    }
    var body: some View {
        Form {
            Section("主题") {
                Picker("主题", selection: $appearance) {
                    Text("跟随系统").tag("system")
                    Text("浅色").tag("light")
                    Text("深色").tag("dark")
                }.pickerStyle(.segmented)
            }
            #if os(iOS)
            Section { Toggle("操作触感反馈", isOn: $hapticsEnabled) }
            #endif
        }.formStyle(.grouped).navigationTitle(Self.title).workspaceInlineTitle()
            .workspaceSelectionFeedback(trigger: appearance)
    }
}

private struct ReminderPreferencesView: View {
    var body: some View {
        Form { NotificationSettingsSection() }
            .formStyle(.grouped).navigationTitle("提醒").workspaceInlineTitle()
    }
}

private struct BackupPreferencesView: View {
    @State private var showExport = false
    @State private var showImport = false
    var body: some View {
        Form {
            Section {
                Button("导出备份", systemImage: "square.and.arrow.up") { showExport = true }
                Button("导入备份", systemImage: "square.and.arrow.down") { showImport = true }
            }
        }.formStyle(.grouped).navigationTitle("数据与备份").workspaceInlineTitle()
            .workspaceSelectionFeedback(trigger: showExport)
            .workspaceSelectionFeedback(trigger: showImport)
            .sheet(isPresented: $showExport) { NavigationStack { ExportArchiveView() }.nativeSheetSize() }
            .sheet(isPresented: $showImport) { NavigationStack { ImportArchiveView() }.nativeSheetSize() }
    }
}

#if os(iOS)
private struct WorkspaceLibraryView: View {
    var body: some View {
        Form {
            Section {
                ForEach([AppDestination.knowledge, .calendar, .timeline, .archives, .trash]) { destination in
                    NavigationLink { DestinationView(destination: destination) } label: {
                        Label(destination.title, systemImage: destination.symbol)
                    }
                }
            }
        }.formStyle(.grouped).navigationTitle("工作空间").workspaceInlineTitle()
    }
}
#endif

private struct AboutWorkspaceView: View {
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0" }
    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("工作坊").font(.title2.bold())
                    Text("WorkSpace · \(version)").font(.subheadline).foregroundStyle(.secondary)
                }.padding(.vertical, 12)
            }
            Section { Link("打开网页版", destination: BackendService.serviceURL) }
        }.formStyle(.grouped).navigationTitle("关于工作坊").workspaceInlineTitle()
    }
}

struct ProfileSettingsSection: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var name = ""
    @State private var zone = "Asia/Shanghai"
    @State private var photo: PhotosPickerItem?
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var hasChanges: Bool { trimmedName != store.state.profile.name || zone != store.state.profile.timezone }
    var body: some View {
        let avatar = store.state.profile.avatar
        Section("个人资料") {
            HStack(spacing: 16) {
                PhotosPicker(selection: $photo, matching: .images) {
                    HStack(spacing: 16) {
                        AvatarView(data: avatar)
                            .frame(width: 64, height: 64).clipShape(Circle())
                            .overlay(alignment: .bottomTrailing) {
                                Image(systemName: "camera.circle.fill").font(.title3)
                                    .symbolRenderingMode(.palette).foregroundStyle(.white, .indigo)
                            }
                        Text("更换头像").font(.subheadline)
                    }
                }.buttonStyle(.plain).accessibilityLabel("更换头像")
                Spacer()
                if store.state.profile.avatar != nil {
                    Button("移除头像", role: .destructive) { store.perform { try store.commit { $0.profile.avatar = nil } } }
                        .buttonStyle(.borderless).font(.caption)
                }
            }.padding(.vertical, 4)
            LabeledContent("姓名") { TextField("姓名", text: $name).multilineTextAlignment(.trailing).onSubmit(save) }
            Picker("时区", selection: $zone) {
                ForEach(Array(Set([zone, "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York", TimeZone.current.identifier])).sorted(), id: \.self) { value in
                    Text(zoneName(value)).tag(value)
                }
            }
            if hasChanges {
                Button("保存修改", systemImage: "checkmark", action: save).disabled(trimmedName.isEmpty)
            }
        }
        .onAppear { name = store.state.profile.name; zone = store.state.profile.timezone }
        .onChange(of: store.state.profile.name) { previous, current in if name == previous { name = current } }
        .onChange(of: store.state.profile.timezone) { previous, current in if zone == previous { zone = current } }
        .onChange(of: photo) { _, value in
            Task {
                do {
                    if let data = try await value?.loadTransferable(type: Data.self) {
                        guard data.count <= 5 * 1024 * 1024 else { throw WorkspaceFailure.tooLarge }
                        let avatar = try AvatarService.normalized(data)
                        try store.commit { $0.profile.avatar = avatar }
                    }
                } catch { store.errorMessage = error.localizedDescription }
            }
        }
    }
    private func save() {
        guard hasChanges else { return }
        store.perform {
            guard !trimmedName.isEmpty else { throw WorkspaceFailure.invalid("请填写姓名。") }
            try store.commit { $0.profile.name = trimmedName; $0.profile.timezone = zone }
            store.information = "个人资料已保存。"
        }
    }
    private func zoneName(_ value: String) -> String {
        switch value {
        case "Asia/Shanghai": "北京时间"
        case "Asia/Tokyo": "东京时间"
        case "Europe/London": "伦敦时间"
        case "America/New_York": "纽约时间"
        default: TimeZone(identifier: value)?.localizedName(for: .standard, locale: Locale(identifier: "zh_CN")) ?? value
        }
    }
}
struct AvatarView: View {
    var data: Data?
    var body: some View {
        #if os(macOS)
        if let data, let image = NSImage(data: data) { Image(nsImage: image).resizable().scaledToFill() }
        else { Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(.indigo) }
        #else
        if let data, let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFill() }
        else { Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(.indigo) }
        #endif
    }
}
struct NotificationSettingsSection: View {
    @Environment(WorkspaceStore.self) private var store
    var body: some View {
        Section {
            Toggle("到期提醒", isOn: Binding(get: { store.notifications.enabled }, set: { enabled in
                if enabled {
                    Task { do { try await store.notifications.requestAuthorization() } catch { store.errorMessage = error.localizedDescription } }
                } else { store.notifications.enabled = false; store.notifications.reschedule(store.state) }
            }))
            Button(action: openNotificationSettings) {
                HStack {
                    Text("系统通知")
                    Spacer()
                    Text(authorizationLabel).foregroundStyle(.secondary)
                }
            }.foregroundStyle(.primary)
        }
        Section {
            DisclosureGroup("检查提醒") {
                LabeledContent("已安排", value: "\(store.notifications.pendingCount) 条")
                if store.notifications.unscheduledCount > 0 {
                    Text("还有 \(store.notifications.unscheduledCount) 条后续提醒，打开应用后会继续安排。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button("测试提醒", systemImage: "bell.badge") {
                    Task {
                        do { try await store.notifications.requestAuthorization(); try await store.notifications.sendTest(); store.information = "三秒后发送测试通知，请查看通知中心。" }
                        catch { store.errorMessage = error.localizedDescription }
                    }
                }
            }
        }.task { await store.notifications.refreshAuthorization() }
    }
    private var authorizationLabel: String {
        switch store.notifications.authorization {
        case .authorized: "已允许"
        case .denied: "已拒绝"
        case .notDetermined: "尚未授权"
        case .provisional: "暂时允许"
        #if os(iOS)
        case .ephemeral: "临时允许"
        #endif
        @unknown default: "由系统管理"
        }
    }
    private func openNotificationSettings() {
        #if os(macOS)
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { NSWorkspace.shared.open(url) }
        #else
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
        #endif
    }
}
struct ExportArchiveView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var encrypted = true
    @State private var password = ""
    @State private var confirmation = ""
    @State private var document: ArchiveDocument?
    @State private var exporting = false
    @State private var preparing = false
    @State private var error: String?
    var body: some View {
        Form {
            Section("导出格式") {
                Toggle("使用密码加密", isOn: $encrypted)
                if encrypted { SecureField("至少 8 个字符", text: $password); SecureField("再次输入密码", text: $confirmation) }
                Text(encrypted ? "密码不会保存。请妥善保管，遗失后无法解密。" : "JSON 包含明文记录和附件，请存放在安全位置。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Text("包含项目组、事项、截止事项、循环规则、提醒设置、知识笔记、历史记录、PDF 和个人资料。登录凭据与通知授权不导出。")
                Button(preparing ? "正在准备…" : "选择保存位置", systemImage: "square.and.arrow.up") {
                    preparing = true
                    let snapshot = store.state, pass = encrypted ? password : nil
                    Task {
                        do { document = ArchiveDocument(data: try ArchiveService.encode(snapshot, password: pass)); exporting = true }
                        catch { self.error = error.localizedDescription }
                        preparing = false
                    }
                }.disabled(preparing || (encrypted && (password.count < 8 || password != confirmation)))
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }.formStyle(.grouped).navigationTitle("导出归档")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
            .fileExporter(isPresented: $exporting, document: document, contentType: encrypted ? .workspaceArchive : .json,
                defaultFilename: "工作坊-\(WorkspaceDates.dayKey(Date(), timezone: store.state.profile.timezone))") { result in
                switch result {
                case .success: password = ""; confirmation = ""; document = nil; dismiss()
                case .failure(let failure): error = failure.localizedDescription
                }
            }
    }
}
struct ImportArchiveView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var picking = false
    @State private var error: String?
    var body: some View {
        Form {
            Section("本机归档") {
                SecureField("归档密码（明文 JSON 可留空）", text: $password)
                Text("导入工作坊归档后，先预览内容，再确认合并。").font(.caption).foregroundStyle(.secondary)
                Button("选择归档", systemImage: "doc.badge.plus") { picking = true }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }.formStyle(.grouped).navigationTitle("导入归档")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.workspaceArchive, .json, .data]) { result in
                do {
                    let url = try result.get()
                    let state = try ArchiveService.read(url: url, password: password)
                    dismiss()
                    // Allow the importer sheet to dismiss before presenting the review sheet.
                    Task { try? await Task.sleep(for: .milliseconds(350)); store.importDescription = "文件：\(url.lastPathComponent)"; store.pendingImport = state }
                } catch { self.error = error.localizedDescription }
            }
    }
}
struct ImportReviewView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var preferIncoming = false
    @ViewBuilder var body: some View {
        if store.pendingSyncReview != nil { SyncConflictReviewView() }
        else { importForm }
    }
    private var importForm: some View {
        Form {
            if let incoming = store.pendingImport {
                let conflicts = incoming.records.filter { item in store.record(item.id).map { !WorkspaceCoding.equivalent($0, item) } ?? false }.count
                Section("已校验") {
                    Text(store.importDescription)
                    LabeledContent("记录", value: "\(incoming.records.count) 项")
                    LabeledContent("PDF", value: "\(incoming.assets.count) 个")
                    LabeledContent("同标识内容差异", value: "\(conflicts) 项")
                }
                Section("合并策略") {
                    Picker("重复内容", selection: $preferIncoming) { Text("保留本机版本").tag(false); Text("使用导入版本").tag(true) }
                    Text("新增记录会导入；重复标识按此选择处理。导入不会删除本机独有的记录。选择导入版本也会使用其个人资料。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button("确认合并", systemImage: "arrow.triangle.merge") {
                    do { try store.importState(incoming, preferIncoming: preferIncoming); store.pendingImport = nil; dismiss(); store.information = "归档已合并。" }
                    catch { store.errorMessage = error.localizedDescription }
                }.buttonStyle(WorkspacePrimaryButtonStyle())
            }
        }.formStyle(.grouped).navigationTitle("确认导入")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { store.cancelSyncReview(); dismiss() } } }
    }
}


struct SyncConflictReviewView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var resolution = WorkspaceSyncResolution.local
    private var differences: [UUID] {
        guard let remote = store.pendingSyncReview?.remote.snapshot else { return [] }
        let local = store.syncReviewLocal ?? store.state
        let left = Dictionary(uniqueKeysWithValues: local.records.map { ($0.id, $0) })
        let right = Dictionary(uniqueKeysWithValues: remote.records.map { ($0.id, $0) })
        return Set(left.keys).union(right.keys).filter { id in
            if let a = left[id], let b = right[id] { return !WorkspaceCoding.equivalent(a, b) }
            return true
        }.sorted { $0.uuidString < $1.uuidString }
    }
    var body: some View {
        List {
            Section("冲突选择") {
                Picker("同时修改的内容", selection: $resolution) {
                    ForEach(WorkspaceSyncResolution.allCases) { Text($0.rawValue).tag($0) }
                }
                Text("选择同时修改的内容要保留哪个版本，其他更改会自动合并。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let checkpoint = store.pendingSyncReview {
                Section("个人资料") {
                    LabeledContent("本机", value: (store.syncReviewLocal ?? store.state).profile.name + " · " + (store.syncReviewLocal ?? store.state).profile.timezone)
                    LabeledContent("云端", value: checkpoint.remote.snapshot.profile.name + " · " + checkpoint.remote.snapshot.profile.timezone)
                }
                Section("内容比较") {
                    if differences.isEmpty { Text("记录内容一致；请核对循环、附件或个人资料的变更。") }
                    ForEach(differences, id: \.self) { id in
                        VStack(alignment: .leading, spacing: 12) {
                            Label(isConflict(id) ? "双方同时修改：将按您的选择处理" : "单端改动：将自动合并", systemImage: isConflict(id) ? "exclamationmark.triangle" : "arrow.triangle.merge")
                                .font(.caption.weight(.semibold)).foregroundStyle(isConflict(id) ? Color.orange : Color.secondary)
                            version("本机", record: (store.syncReviewLocal ?? store.state).records.first { $0.id == id })
                            Divider()
                            version("云端", record: checkpoint.remote.snapshot.records.first { $0.id == id })
                        }.padding(.vertical, 6)
                    }
                }
                Section("其他资料") {
                    LabeledContent("本机循环 / 附件", value: "\((store.syncReviewLocal ?? store.state).series.count) / \((store.syncReviewLocal ?? store.state).assets.count)")
                    LabeledContent("云端循环 / 附件", value: "\(checkpoint.remote.snapshot.series.count) / \(checkpoint.remote.snapshot.assets.count)")
                }
            }
        }.navigationTitle("比较同步内容")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { store.cancelSyncReview(); dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("应用选择") {
                        do { try store.resolveSyncReview(resolution); dismiss(); store.information = "冲突选择已保存，可立即同步到其他设备。" }
                        catch { store.errorMessage = error.localizedDescription }
                    }
                }
            }
    }
    @ViewBuilder private func version(_ source: String, record: WorkspaceRecord?) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(source).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if let record {
                Text(record.title).font(.headline).textSelection(.enabled)
                Text(record.deletedAt != nil ? "已删除" : record.archivedAt != nil ? "已归档" : StateLabels.title(record.status)).font(.subheadline)
                if let due = record.dueDate { Text(dateLabel(due, record: record)).font(.caption) }
                if !record.summary.isEmpty { Text(record.summary).textSelection(.enabled) }
                if !record.body.isEmpty {
                    Text(record.body).lineLimit(6).textSelection(.enabled)
                    DisclosureGroup("查看完整正文") { Text(record.body).font(.body).textSelection(.enabled) }
                }
            } else { Text("此端没有这条记录").foregroundStyle(.secondary) }
        }
    }
    private func isConflict(_ id: UUID) -> Bool {
        let old = store.syncReviewBase?.records.first { $0.id == id }
        let local = (store.syncReviewLocal ?? store.state).records.first { $0.id == id }
        let remote = store.pendingSyncReview?.remote.snapshot.records.first { $0.id == id }
        func equivalent(_ a: WorkspaceRecord?, _ b: WorkspaceRecord?) -> Bool {
            if let a, let b { return WorkspaceCoding.equivalent(a, b) }
            return a == nil && b == nil
        }
        return !equivalent(local, remote) && !equivalent(local, old) && !equivalent(remote, old)
    }
    private func dateLabel(_ date: Date, record: WorkspaceRecord) -> String {
        var format: Date.FormatStyle = record.dateOnly ? .dateTime.year().month().day() : .dateTime.year().month().day().hour().minute()
        format.locale = Locale(identifier: "zh_CN"); format.timeZone = record.calendar.timeZone
        return format.format(date) + " · " + record.timezone
    }

}
