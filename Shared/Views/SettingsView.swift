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
    @State private var name = ""
    @State private var zone = "Asia/Shanghai"
    @State private var photo: PhotosPickerItem?
    @State private var showExport = false
    @State private var showImport = false
    @AppStorage("appearance") private var appearance = "system"
    var body: some View {
        Form {
            Section("个人资料") {
                HStack(spacing: 16) {
                    AvatarView(data: store.state.profile.avatar).frame(width: 64, height: 64).clipShape(Circle())
                    PhotosPicker(selection: $photo, matching: .images) { Label("选择头像", systemImage: "person.crop.circle") }
                    if store.state.profile.avatar != nil { Button("移除") { store.perform { try store.commit { $0.profile.avatar = nil } } } }
                }
                TextField("姓名", text: $name)
                Picker("默认时区", selection: $zone) {
                    ForEach(Array(Set([zone, "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York", TimeZone.current.identifier])).sorted(), id: \.self) { Text($0).tag($0) }
                }
                Button("保存资料", systemImage: "checkmark") {
                    store.perform {
                        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WorkspaceFailure.invalid("请填写姓名。") }
                        try store.commit { $0.profile.name = name.trimmingCharacters(in: .whitespacesAndNewlines); $0.profile.timezone = zone }
                        store.information = "个人资料已保存。"
                    }
                }
            }
            Section("外观") {
                Picker("主题", selection: $appearance) { Text("跟随系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark") }
            }
            NotificationSettingsSection()
            Section("导入与导出") {
                LabeledContent("本机记录", value: "\(store.state.records.count) 项")
                LabeledContent("PDF 附件", value: "\(store.state.assets.count) 个")
                Button("导出归档", systemImage: "square.and.arrow.up") { showExport = true }
                Button("导入归档", systemImage: "square.and.arrow.down") { showImport = true }
                Text("通过加密归档或 JSON 在 iPhone 与 Mac 之间迁移。默认本机存储；SwiftUI 不会自动同步设备数据。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("自建服务器") {
                NavigationLink { BackendSettingsView() } label: { Label("登录与设备同步", systemImage: "server.rack") }
                Text("服务器地址由你提供。配置前所有功能仍可离线使用；登录凭据只保存在本机 Keychain 中。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("关于") {
                LabeledContent("应用", value: "广益 WorkSpace")
                LabeledContent("版本", value: "1.0")
                Link("打开原网站", destination: URL(string: "https://guangyi-workspace-sites.cleverfir5.chatgpt.site/app")!)
            }
        }.formStyle(.grouped).navigationTitle("设置")
            .onAppear { name = store.state.profile.name; zone = store.state.profile.timezone }
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
            .sheet(isPresented: $showExport) { NavigationStack { ExportArchiveView() }.nativeSheetSize() }
            .sheet(isPresented: $showImport) { NavigationStack { ImportArchiveView() }.nativeSheetSize() }
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
        Section("系统通知") {
            LabeledContent("系统权限", value: authorizationLabel)
            Toggle("本机到期提醒", isOn: Binding(get: { store.notifications.enabled }, set: { enabled in
                if enabled {
                    Task { do { try await store.notifications.requestAuthorization() } catch { store.errorMessage = error.localizedDescription } }
                } else { store.notifications.enabled = false; store.notifications.reschedule(store.state) }
            }))
            LabeledContent("已安排", value: "\(store.notifications.pendingCount) 条")
            if store.notifications.unscheduledCount > 0 {
                Text("还有 \(store.notifications.unscheduledCount) 条后续提醒。应用只安排最近 60 条，重新打开时会补齐。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Button("发送测试通知", systemImage: "bell.badge") {
                Task {
                    do { try await store.notifications.requestAuthorization(); try await store.notifications.sendTest(); store.information = "三秒后发送测试通知，请查看通知中心。" }
                    catch { store.errorMessage = error.localizedDescription }
                }
            }
            Button("打开系统通知设置", systemImage: "gearshape") { openNotificationSettings() }
            Text("安排好的本地通知由系统触发，应用关闭时仍能提醒。长时间不打开应用时，超过已安排队列的未来提醒不会自动补齐；自建服务器上线后可接入 APNs。")
                .font(.caption).foregroundStyle(.secondary)
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
                Text("包含项目、行动、截止事项、循环规则、提醒、知识笔记、历史记录、PDF 和个人资料。登录凭据与通知授权不导出。")
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
                defaultFilename: "广益WorkSpace-\(WorkspaceDates.dayKey(Date(), timezone: store.state.profile.timezone))") { result in
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
                Text("先读取和校验文件，再确认合并策略。不会直接覆盖现有数据。网页 GWOS1/GWOS2 备份使用不同格式，不能直接导入。").font(.caption).foregroundStyle(.secondary)
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
    var body: some View {
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
                }.buttonStyle(.borderedProminent)
            }
        }.formStyle(.grouped).navigationTitle("确认导入")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { store.pendingImport = nil; dismiss() } } }
    }
}
