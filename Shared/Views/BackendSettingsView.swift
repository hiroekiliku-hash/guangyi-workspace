import SwiftUI

struct BackendSettingsView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var confirmingUpload = false
    var body: some View {
        @Bindable var backend = store.backend
        Form {
            Section("服务器地址") {
                TextField("https://workspace.example.com", text: $backend.address)
                    .autocorrectionDisabled()
                    .nativeURLInput()
                Text("需实现工程里的 /api/native/v1 接口契约。此处连接你自己的服务器，不使用 Sites 服务凭据。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("登录") {
                if backend.signedIn {
                    LabeledContent("账号", value: backend.displayName)
                    Button("退出登录并注销远程设备", role: .destructive) { run { try await backend.signOut() } }
                } else {
                    TextField("邮箱", text: $email).autocorrectionDisabled().nativeEmailInput()
                    SecureField("密码", text: $password)
                    Button(busy ? "正在登录…" : "登录") {
                        run {
                            try await backend.signIn(email: email, password: password)
                            password = ""; store.information = "已登录自建服务器。"
                        }
                    }.disabled(busy || email.isEmpty || password.isEmpty)
                }
            }
            Section("手动同步") {
                Button("下载并审阅服务器数据", systemImage: "arrow.down.circle") {
                    run { store.pendingImport = try await backend.download(); store.importDescription = "服务器：\(backend.address)" }
                }.disabled(busy || !backend.signedIn)
                Button("上传本机快照", systemImage: "arrow.up.circle") { confirmingUpload = true }
                    .disabled(busy || !backend.signedIn || backend.revision == nil)
                if let sync = backend.lastSync { LabeledContent("最近传输", value: sync.formatted(date: .abbreviated, time: .shortened)) }
                Text("先下载审阅，再上传。服务器必须原子检查版本；其他设备已经更新时会拒绝覆盖。本版默认手动同步，尚未启用自动后台合并。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("远程通知") {
                LabeledContent("设备注册", value: backend.deviceRegistrationStatus)
                Button("注册此设备接收 APNs", systemImage: "antenna.radiowaves.left.and.right") {
                    run {
                        try await store.notifications.requestAuthorization()
                        try RemotePushBridge.registerWithApple()
                    }
                }.disabled(!backend.signedIn || busy)
                Text("需要在 Xcode 配置签名与 Push Notifications 能力，并在服务器配置 APNs。项目默认使用本地通知。接入步骤见 README。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).navigationTitle("自建服务器")
            .confirmationDialog("上传将以本机完整快照更新服务器。请确认已审阅服务器数据。", isPresented: $confirmingUpload, titleVisibility: .visible) {
                Button("确认上传") { run { try await backend.upload(store.state); store.information = "服务器快照已更新。" } }
            }
    }
    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task { do { try await operation() } catch { store.errorMessage = error.localizedDescription }; busy = false }
    }
}
extension View {
    @ViewBuilder func nativeURLInput() -> some View {
        #if os(iOS)
        self.keyboardType(.URL).textInputAutocapitalization(.never)
        #else
        self
        #endif
    }
    @ViewBuilder func nativeEmailInput() -> some View {
        #if os(iOS)
        self.keyboardType(.emailAddress).textInputAutocapitalization(.never).textContentType(.username)
        #else
        self
        #endif
    }
}
