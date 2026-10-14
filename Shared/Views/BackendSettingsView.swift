import SwiftUI
import AuthenticationServices

struct BackendSettingsView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var authorization = PasskeyAuthorization()
    @State private var passkeys: [RegisteredPasskeys.Credential] = []
    @State private var confirmingSync = false
    var body: some View {
        @Bindable var backend = store.backend
        Form {
            Section("服务器地址") {
                TextField("https://workspace.example.com", text: $backend.address)
                    .autocorrectionDisabled()
                    .nativeURLInput().disabled(busy || store.syncing)
                Text("使用同一账号连接 iPhone 与 Mac，登录凭据保存在本机钥匙串。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("登录") {
                if backend.signedIn {
                    LabeledContent("账号", value: backend.displayName)
                    Button("添加新的通行密钥", systemImage: "person.badge.key") {
                        run { try await backend.addPasskey(using: authorization); passkeys = try await backend.registeredPasskeys().credentials; store.information = "通行密钥已添加，可在其他设备使用同一账号登录。" }
                    }.disabled(busy || store.syncing)
                    Text("通行密钥由系统钥匙串管理，私钥不会发送到服务器。").font(.caption).foregroundStyle(.secondary)
                    ForEach(passkeys) { credential in
                        HStack {
                            Text("通行密钥 · " + Date(timeIntervalSince1970: credential.created / 1000).formatted(date: .abbreviated, time: .omitted))
                            Spacer()
                            Button("撤销", role: .destructive) {
                                run { try await backend.revokePasskey(credential.id); passkeys = try await backend.registeredPasskeys().credentials }
                            }.disabled(busy)
                        }
                    }
                    Button("查看已注册通行密钥") { run { passkeys = try await backend.registeredPasskeys().credentials } }.disabled(busy)
                    Button("退出登录并注销远程设备", role: .destructive) { run { try await backend.signOut() } }.disabled(busy || store.syncing)
                } else {
                    Button("使用通行密钥登录", systemImage: "person.badge.key") {
                        run { try await backend.signInWithPasskey(using: authorization); store.information = "已使用通行密钥登录。" }
                    }.disabled(busy)
                    Text("首次使用请先通过密码登录，再添加一枚新的通行密钥。").font(.caption).foregroundStyle(.secondary)
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
            Section("同账号同步") {
                LabeledContent("状态", value: store.syncStatus)
                Toggle("打开应用时自动同步", isOn: Binding(get: { store.automaticSync }, set: { store.automaticSync = $0 }))
                    .disabled(!backend.signedIn || store.syncing)
                Button(store.syncing ? "正在同步…" : "立即同步", systemImage: "arrow.triangle.2.circlepath") {
                    run { try await store.synchronize() }
                }.disabled(busy || store.syncing || !backend.signedIn)
                Button("首次连接或更换账号", systemImage: "person.crop.circle.badge.checkmark") { confirmingSync = true }
                    .disabled(busy || store.syncing || !backend.signedIn)
                Button("比较并解决同步冲突", systemImage: "arrow.left.arrow.right") {
                    run { try await store.reviewSyncConflicts() }
                }.disabled(busy || store.syncing || !backend.signedIn)
                if let sync = backend.lastSync { LabeledContent("最近同步", value: sync.formatted(date: .abbreviated, time: .shortened)) }
                Text("合并两台设备的改动。同一条记录同时修改时会暂停同步，保留双方版本供比较。自动同步在应用运行时进行，离线修改会在重新打开后重试。")
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
        }.formStyle(.grouped).navigationTitle("账号与同步")
            .onChange(of: backend.accountScope) { _, _ in passkeys = [] }
            .confirmationDialog("将本机资料与当前登录账号合并？首次连接会把本机独有记录同步到此账号。", isPresented: $confirmingSync, titleVisibility: .visible) {
                Button("确认连接并合并") { run { try await store.synchronize(bindAccount: true) } }
            }
    }
    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task { do { try await operation() } catch {
                let failure = error as NSError
                if failure.domain != ASAuthorizationError.errorDomain || failure.code != ASAuthorizationError.canceled.rawValue { store.errorMessage = error.localizedDescription }
            }; busy = false }
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
