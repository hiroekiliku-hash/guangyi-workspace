import SwiftUI
import AuthenticationServices
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct GettingStartedView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step = 0
    @State private var exampleCompleted = false
    @State private var busy = false
    @State private var loginError: String?
    @State private var authorization = WebLoginAuthorization()
    @State private var loginTask: Task<Void, Never>?
    var isReplay = false
    let finish: (_ signedIn: Bool) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if step > 0 {
                    Button { move(to: step - 1) } label: {
                        Label("上一步", systemImage: "chevron.left")
                    }
                } else {
                    Text("工作坊").font(.headline).foregroundStyle(.secondary)
                }
                Spacer()
                Button(isReplay ? "关闭" : "跳过") { finish(false) }
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.medium))
            .buttonStyle(.plain)
            .frame(minHeight: 44)
            .padding(.horizontal, 28)
            .disabled(busy)

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    illustration
                        .frame(height: 258)
                        .padding(.bottom, 10)
                    Text(title)
                        .font(.largeTitle.bold())
                        .tracking(-0.8)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text(subtitle)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if step == 2 && store.backend.signedIn {
                        Label(store.backend.accountName, systemImage: "checkmark.circle.fill")
                            .font(.subheadline).foregroundStyle(.indigo)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: 440, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 28)
                .padding(.vertical, 28)
            }
            .scrollIndicators(.hidden)

            VStack(spacing: 18) {
                HStack(spacing: 7) {
                    ForEach(0..<3) { index in
                        Capsule().fill(index == step ? Color.indigo : Color.secondary.opacity(0.2))
                            .frame(width: index == step ? 22 : 6, height: 6)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("教程，第 \(step + 1) 页，共 3 页")

                Button(action: primaryAction) {
                    HStack(spacing: 9) {
                        if busy { ProgressView().tint(.white) }
                        Text(primaryTitle)
                    }
                }
                .buttonStyle(WorkspacePrimaryButtonStyle())
                .disabled(busy)
                if step == 2 && !store.backend.signedIn {
                    Button("先直接使用") { finish(false) }
                        .font(.subheadline.weight(.medium))
                        .frame(minHeight: 34)
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .disabled(busy)
                }
            }
            .frame(maxWidth: 440)
            .padding(.horizontal, 28)
            .padding(.top, 16)
            .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(background)
        .tint(.indigo)
        .workspaceSelectionFeedback(trigger: step)
        .workspaceSelectionFeedback(trigger: exampleCompleted)
        .alert("暂时无法登录", isPresented: Binding(get: { loginError != nil }, set: { if !$0 { loginError = nil } })) {
            Button("好") { loginError = nil }
        } message: { Text(loginError ?? "") }
        .onDisappear { loginTask?.cancel() }
    }

    private var title: String {
        switch step {
        case 0: "欢迎来到\n工作坊"
        case 1: "从一件事\n开始"
        default: "在每台设备，\n接着做"
        }
    }
    private var subtitle: String {
        switch step {
        case 0: "记下要做的事，给每一天留一点从容。"
        case 1: "轻点圆圈，完成事项。为重要的事设置截止时间，也可以按周期重复。"
        default: "登录后，自动合并本机与云端的内容，在不同设备间同步。"
        }
    }
    private var primaryTitle: String {
        if step == 0 { return "开始" }
        if step == 1 { return "继续" }
        if busy { return "正在登录…" }
        return store.backend.signedIn ? (isReplay ? "完成" : "开始使用") : "登录并开始"
    }
    @ViewBuilder private var illustration: some View {
        switch step {
        case 0:
            ZStack {
                Circle().fill(.cyan.opacity(0.05)).frame(width: 246, height: 246)
                Circle().fill(.cyan.opacity(0.07)).frame(width: 194, height: 194)
                applicationIcon
                    .resizable().interpolation(.high).scaledToFit()
                    .frame(width: 124, height: 124)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .shadow(color: .cyan.opacity(0.2), radius: 18, y: 12)
            }
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
        case 1:
            VStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 18) {
                    Text("事项").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Button { exampleCompleted.toggle() } label: {
                        HStack(spacing: 12) {
                            Image(systemName: exampleCompleted ? "checkmark.circle.fill" : "circle")
                                .font(.title2).foregroundStyle(.indigo)
                            Text("整理课程笔记")
                                .strikethrough(exampleCompleted)
                                .foregroundStyle(exampleCompleted ? .secondary : .primary)
                            Spacer(minLength: 0)
                        }
                        .font(.body.weight(.medium)).frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("试一试：整理课程笔记")
                    .accessibilityValue(exampleCompleted ? "已完成" : "未完成")
                    .accessibilityHint("轻点切换完成状态，仅用于教程演示")
                }
                .padding(20).background(cardBackground, in: RoundedRectangle(cornerRadius: 24))
                HStack(spacing: 14) {
                    Image(systemName: "hourglass").font(.title2).foregroundStyle(.indigo)
                        .frame(width: 42, height: 48)
                        .background(.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 5) {
                        Text("课程报告").font(.body.weight(.medium))
                        Text("截止事项 · 今天 18:00").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(20).background(cardBackground, in: RoundedRectangle(cornerRadius: 24))
                .accessibilityElement(children: .combine)
            }
        default:
            VStack(spacing: 26) {
                Image(systemName: "icloud.fill")
                    .font(.system(size: 68, weight: .regular)).foregroundStyle(.indigo.gradient)
                HStack(spacing: 28) {
                    Image(systemName: "iphone")
                    Image(systemName: "arrow.triangle.2.circlepath").font(.title3).foregroundStyle(.tertiary)
                    Image(systemName: "laptopcomputer")
                }
                .font(.system(size: 38, weight: .light))
                Text("iPhone · Mac · 网页").font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(cardBackground, in: RoundedRectangle(cornerRadius: 28))
            .accessibilityHidden(true)
        }
    }
    /// Use the icon produced from AppIcon.icon, so future icon edits appear here too.
    private var applicationIcon: Image {
        #if os(iOS)
        let icons = Bundle.main.object(forInfoDictionaryKey: "CFBundleIcons") as? [String: Any]
        let primary = icons?["CFBundlePrimaryIcon"] as? [String: Any]
        let files = primary?["CFBundleIconFiles"] as? [String] ?? []
        for name in files.reversed() {
            if let image = UIImage(named: name) { return Image(uiImage: image) }
        }
        return Image("AppIcon")
        #else
        Image(nsImage: NSApplication.shared.applicationIconImage)
        #endif
    }
    private var background: Color {
        #if os(iOS)
        Color(uiColor: .systemGroupedBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }
    private var cardBackground: Color {
        #if os(iOS)
        Color(uiColor: .secondarySystemGroupedBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }
    private func move(to page: Int) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { step = page }
    }
    private func primaryAction() {
        guard step == 2 else { move(to: step + 1); return }
        guard !store.backend.signedIn else { finish(false); return }
        busy = true
        loginTask = Task { @MainActor in
            defer { busy = false }
            do {
                try await store.backend.signInWithWeb(using: authorization)
                try Task.checkCancellation()
                finish(true)
            } catch {
                let failure = error as NSError
                let canceled = failure.domain == ASWebAuthenticationSessionError.errorDomain && failure.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
                if !(error is CancellationError) && !canceled { loginError = error.localizedDescription }
            }
        }
    }
}

/// Finish dismissing the tutorial before a merge can present a conflict review.
private struct GettingStartedPresentation: ViewModifier {
    @Environment(WorkspaceStore.self) private var store
    @AppStorage("hasCompletedGettingStarted") private var completed = false
    @Binding var isPresented: Bool
    var isReplay: Bool
    @State private var mergeAfterDismissal = false

    func body(content: Content) -> some View {
        #if os(iOS)
        content.fullScreenCover(isPresented: $isPresented, onDismiss: didDismiss) { tutorial }
        #else
        content.sheet(isPresented: $isPresented, onDismiss: didDismiss) { tutorial }
        #endif
    }
    private var tutorial: some View {
        GettingStartedView(isReplay: isReplay) { signedIn in
            mergeAfterDismissal = signedIn
            completed = true
            isPresented = false
        }
        .environment(store)
        .nativeSheetSize()
        .interactiveDismissDisabled()
    }
    private func didDismiss() {
        guard mergeAfterDismissal else { return }
        mergeAfterDismissal = false
        Task { @MainActor in
            do { try await store.completeAccountSignIn() }
            catch { store.errorMessage = error.localizedDescription }
        }
    }
}

extension View {
    func gettingStarted(isPresented: Binding<Bool>, isReplay: Bool = false) -> some View {
        modifier(GettingStartedPresentation(isPresented: isPresented, isReplay: isReplay))
    }
}
