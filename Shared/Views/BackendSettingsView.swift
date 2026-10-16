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
        let backend = store.backend
        Form {
            ProfileSettingsSection()
            Section("账号") {
                if backend.signedIn {
                    LabeledContent("账号", value: backend.accountName)
                    if NativeCapabilities.passkeysEnabled {
                        Button("添加新的通行密钥", systemImage: "person.badge.key") {
                            run { try await backend.addPasskey(using: authorization); passkeys = try await backend.registeredPasskeys().credentials; store.information = "通行密钥已添加，可在其他设备使用同一账号登录。" }
                        }.disabled(busy || store.syncing)
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
                    Button("退出登录", role: .destructive) {
                        run { defer { store.accountSessionChanged() }; try await backend.signOut() }
                    }.disabled(busy || store.syncing)
                } else {
                    Button(busy ? "正在登录…" : "登录工作坊", systemImage: "person.crop.circle") {
                        run {
                            try await backend.signInWithWeb(using: webAuthorization)
                            password = ""
                            try await store.completeAccountSignIn()
                        }
                    }.buttonStyle(WorkspacePrimaryButtonStyle()).disabled(busy || store.syncing)
                    if NativeCapabilities.passkeysEnabled {
                        Button("使用通行密钥登录", systemImage: "person.badge.key") {
                            run {
                                try await backend.signInWithPasskey(using: authorization)
                                try await store.completeAccountSignIn()
                            }
                        }.disabled(busy || store.syncing)
                    }
                    DisclosureGroup("使用账号密码") {
                        TextField("账号（邮箱）", text: $email).autocorrectionDisabled().nativeEmailInput()
                        SecureField("密码", text: $password)
                        Button(busy ? "正在登录…" : "登录", systemImage: "person.crop.circle.badge.checkmark") {
                            run {
                                try await backend.signIn(email: email, password: password)
                                password = ""
                                try await store.completeAccountSignIn()
                            }
                        }.disabled(busy || store.syncing || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                    }.disabled(busy || store.syncing)
                }
                if !backend.signedIn {
                    Text("登录后，你的内容会在设备间自动同步。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if backend.signedIn { Section("云同步") {
                LabeledContent("状态", value: store.syncStatus)
                Toggle("自动同步", isOn: Binding(get: { store.automaticSync }, set: { store.automaticSync = $0 }))
                    .disabled(!backend.signedIn || store.syncing)
                Button(syncActionTitle, systemImage: "arrow.triangle.2.circlepath") {
                    run {
                        if let review = store.pendingSyncReview { store.pendingImport = review.remote.snapshot }
                        else { try await store.synchronize() }
                    }
                }.buttonStyle(WorkspacePrimaryButtonStyle()).disabled(busy || store.syncing || !backend.signedIn)
                if let sync = backend.lastSync { LabeledContent("最近同步", value: sync.formatted(date: .abbreviated, time: .shortened)) }
            } }
            if RemotePushBridge.isEnabled && backend.signedIn {
                Section("通知") {
                    LabeledContent("远程提醒", value: backend.deviceRegistrationStatus)
                    Button("启用此设备的远程提醒", systemImage: "antenna.radiowaves.left.and.right") {
                        run { try await store.notifications.requestAuthorization(); try RemotePushBridge.registerWithApple() }
                    }.disabled(!backend.signedIn || busy)
                }
            }
        }.formStyle(.grouped).navigationTitle("个人资料与账号")
            .workspaceSelectionFeedback(trigger: backend.signedIn)
            .onChange(of: backend.accountScope) { _, _ in
                passkeys = []
                store.accountSessionChanged()
            }
    }
    private var syncActionTitle: String {
        if store.syncing { return "正在同步…" }
        if store.pendingSyncReview != nil { return "继续比较冲突" }
        if store.syncNeedsRetry { return "重试同步" }
        return "立即同步"
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
    @ViewBuilder func nativeEmailInput() -> some View {
        #if os(iOS)
        self.keyboardType(.emailAddress).textInputAutocapitalization(.never).textContentType(.username)
        #else
        self
        #endif
    }
}
