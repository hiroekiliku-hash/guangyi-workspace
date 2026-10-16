import SwiftUI
import AuthenticationServices

struct BackendSettingsView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var authorization = PasskeyAuthorization()
    @State private var webAuthorization = WebLoginAuthorization()
    @State private var passkeys: [RegisteredPasskeys.Credential] = []
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
                    LabeledContent("账号", value: backend.accountName)
                    if NativeCapabilities.passkeysEnabled {
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
                    }
                    Button("退出登录并注销远程设备", role: .destructive) {
                        run { defer { store.accountSessionChanged() }; try await backend.signOut() }
                    }.disabled(busy || store.syncing)
                } else {
                    Button(busy ? "正在连接…" : "通过网页登录", systemImage: "globe") {
                        run {
                            try await backend.signInWithWeb(using: webAuthorization)
                            password = ""
                            try await store.completeAccountSignIn()
                        }
                    }.buttonStyle(WorkspacePrimaryButtonStyle()).disabled(busy || store.syncing)
                    Text("在安全的网页登录页面使用通行密钥或账号密码，完成验证后返回工作坊。")
                        .font(.caption).foregroundStyle(.secondary)
                    if NativeCapabilities.passkeysEnabled {
                        Button("使用通行密钥登录", systemImage: "person.badge.key") {
                            run {
                                try await backend.signInWithPasskey(using: authorization)
                                try await store.completeAccountSignIn()
                            }
                        }.disabled(busy || store.syncing)
                        Text("通常请先通过密码登录，再添加一枚新的通行密钥。").font(.caption).foregroundStyle(.secondary)
                        Text("若密码遗失且还没有通行密钥，服务器本机管理员可以生成十分钟有效的一次性登记链接；恢复不会重建账号或覆盖资料。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("在 App 内使用账号密码登录") {
                        TextField("账号（邮箱）", text: $email).autocorrectionDisabled().nativeEmailInput()
                        SecureField("密码", text: $password)
                        Button(busy ? "正在登录并合并…" : "登录并合并", systemImage: "person.crop.circle.badge.checkmark") {
                            run {
                                try await backend.signIn(email: email, password: password)
                                password = ""
                                try await store.completeAccountSignIn()
                            }
                        }.disabled(busy || store.syncing || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                    }.disabled(busy || store.syncing)
                }
                Text("登录后自动合并本机与云端内容，并开启自动同步；有冲突时保留双方版本供比较。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("同账号同步") {
                LabeledContent("状态", value: store.syncStatus)
                Toggle("自动同步", isOn: Binding(get: { store.automaticSync }, set: { store.automaticSync = $0 }))
                    .disabled(!backend.signedIn || store.syncing)
                Button(syncActionTitle, systemImage: "arrow.triangle.2.circlepath") {
                    run {
                        if let review = store.pendingSyncReview { store.pendingImport = review.remote.snapshot }
                        else { try await store.synchronize() }
                    }
                }.buttonStyle(WorkspacePrimaryButtonStyle()).disabled(busy || store.syncing || !backend.signedIn)
                Button("比较并解决同步冲突", systemImage: "arrow.left.arrow.right") {
                    run { try await store.reviewSyncConflicts() }
                }.disabled(busy || store.syncing || !backend.signedIn)
                if let sync = backend.lastSync { LabeledContent("最近同步", value: sync.formatted(date: .abbreviated, time: .shortened)) }
                Text("应用运行时会在修改后和定时自动同步；iPhone 进入后台时会向系统申请短时刷新，执行时机由 iOS 决定。")
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
            .workspaceSelectionFeedback(trigger: backend.signedIn)
            .onChange(of: backend.accountScope) { _, _ in
                passkeys = []
                store.accountSessionChanged()
            }
    }
    private var syncActionTitle: String {
        if store.syncing { return "正在合并…" }
        if store.pendingSyncReview != nil { return "继续比较冲突" }
        if store.syncNeedsRetry { return "重试合并" }
        return store.hasAccountSyncBaseline ? "立即同步" : "连接并同步"
    }
    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task { do { try await operation() } catch {
                let failure = error as NSError
                let authorizationCanceled = failure.domain == ASAuthorizationError.errorDomain && failure.code == ASAuthorizationError.canceled.rawValue
                let webLoginCanceled = failure.domain == ASWebAuthenticationSessionError.errorDomain && failure.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
                if !(error is CancellationError) && !authorizationCanceled && !webLoginCanceled { store.errorMessage = error.localizedDescription }
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
