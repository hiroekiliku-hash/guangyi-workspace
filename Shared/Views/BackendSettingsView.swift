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
                    Text("通常请先通过密码登录，再添加一枚新的通行密钥。").font(.caption).foregroundStyle(.secondary)
                    Text("若密码遗失且还没有通行密钥，服务器本机管理员可以生成十分钟有效的一次性登记链接；恢复不会重建账号或覆盖资料。")
                        .font(.caption).foregroundStyle(.secondary)
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
                Toggle("自动同步", isOn: Binding(get: { store.automaticSync }, set: { store.automaticSync = $0 }))
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
                Text("合并两台设备的改动。同一条记录同时修改时会暂停同步，保留双方版本供比较。应用运行时会在修改后和定时自动同步；iPhone 进入后台时会向系统申请短时刷新，执行时机由 iOS 决定。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("通知与同步") {
                if RemotePushBridge.isEnabled {
                    LabeledContent("远程提醒", value: backend.deviceRegistrationStatus)
                    Button("启用此设备的远程提醒", systemImage: "antenna.radiowaves.left.and.right") {
                        run { try await store.notifications.requestAuthorization(); try RemotePushBridge.registerWithApple() }
                    }.disabled(!backend.signedIn || busy)
                }
                Text("允许通知后，已安排的本机提醒由系统发送。其他设备的改动会在前台自动同步或系统批准的后台刷新后更新提醒安排。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).navigationTitle("账号与同步")
            .onChange(of: backend.accountScope) { _, _ in passkeys = [] }
            .confirmationDialog("将本机资料与当前登录账号合并？首次连接会把本机独有记录同步到此账号，并开启自动同步。", isPresented: $confirmingSync, titleVisibility: .visible) {
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
