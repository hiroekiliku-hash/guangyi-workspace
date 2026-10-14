import SwiftUI

@main @MainActor struct GuangyiWorkspaceApp: App {
    @State private var store: WorkspaceStore?
    private var startupError: String?
    #if os(macOS)
    @NSApplicationDelegateAdaptor(NativePlatformDelegate.self) private var delegate
    #else
    @UIApplicationDelegateAdaptor(NativePlatformDelegate.self) private var delegate
    #endif
    init() {
        do {
            let store = try WorkspaceStore(repository: SwiftDataRepository())
            _store = State(initialValue: store)
            RemotePushBridge.shared.store = store
        } catch {
            _store = State(initialValue: nil); startupError = error.localizedDescription
        }
    }
    var body: some Scene {
        #if os(macOS)
        mainWindow.commands { if let store { WorkspaceCommands(store: store) } }
        Settings {
            if let store { NavigationStack { SettingsView() }.environment(store).frame(width: 660, height: 700) }
            else { startupFailure }
        }
        #else
        mainWindow
        #endif
    }
    private var mainWindow: some Scene {
        WindowGroup {
            if let store {
                WorkspaceRootView().environment(store).nativeWindowSize()
            } else { startupFailure }
        }
    }
    private var startupFailure: some View {
        ContentUnavailableView("无法打开本机资料库", systemImage: "externaldrive.badge.exclamationmark",
            description: Text((startupError ?? "未知存储错误") + "\n原有数据没有被删除。请保留资料库并联系维护者。"))
            .padding().frame(minWidth: 320, minHeight: 300)
    }
}
extension View {
    @ViewBuilder func nativeWindowSize() -> some View {
        #if os(macOS)
        self.frame(minWidth: 820, minHeight: 580)
        #else
        self
        #endif
    }
}
#if os(macOS)
@MainActor struct WorkspaceCommands: Commands {
    let store: WorkspaceStore
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("新建\(store.navigation.creationKind.title)") { store.createKind = store.navigation.creationKind }.keyboardShortcut("n")
        }
        CommandMenu("工作空间") {
            Button("概览") { store.navigation = .overview }.keyboardShortcut("1")
            Button("项目") { store.navigation = .projects }.keyboardShortcut("2")
            Button("行动") { store.navigation = .actions }.keyboardShortcut("3")
            Button("截止事项") { store.navigation = .deadlines }.keyboardShortcut("4")
            Button("知识库") { store.navigation = .knowledge }.keyboardShortcut("5")
            Divider()
            Button("日历") { store.navigation = .calendar }
            Button("时间线") { store.navigation = .timeline }
            Button("回收站") { store.navigation = .trash }
            Button("刷新循环与通知") { store.refresh() }.keyboardShortcut("r")
        }
    }
}
#endif
