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
            #if DEBUG
            let smokeTest = ProcessInfo.processInfo.arguments.contains("--ui-smoke")
            #else
            let smokeTest = false
            #endif
            let store = try WorkspaceStore(repository: SwiftDataRepository(inMemory: smokeTest))
            #if DEBUG
            if smokeTest {
                var project = WorkspaceRecord(kind: .project, title: "原生界面验收项目", id: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!)
                project.status = "ACTIVE"
                try store.save(project, expectedVersion: nil)
                var action = WorkspaceRecord(kind: .task, title: "整理课程资料并完成下一步行动", id: UUID(uuidString: "10000000-0000-0000-0000-000000000002")!)
                action.projectID = project.id
                try store.save(action, expectedVersion: nil)
                var deadline = WorkspaceRecord(kind: .deadline, title: "提交本周课程报告：完整标题和重要截止内容", id: UUID(uuidString: "10000000-0000-0000-0000-000000000003")!)
                deadline.dateOnly = false; deadline.dueDate = Date().addingTimeInterval(7200)
                try store.save(deadline, expectedVersion: nil)
                var overdue = WorkspaceRecord(kind: .deadline, title: "已逾期事项，优先处理", id: UUID(uuidString: "10000000-0000-0000-0000-000000000004")!)
                overdue.dateOnly = false; overdue.dueDate = Date().addingTimeInterval(-600)
                try store.save(overdue, expectedVersion: nil)
            }
            #endif
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
            if let store { NavigationStack { SettingsView() }.environment(store).frame(width: 660, height: 700)
                .environment(\.locale, Locale(identifier: "zh_CN"))
                .environment(\.timeZone, WorkspaceDates.calendar(store.state.profile.timezone).timeZone)
                .preferredColorScheme(settingsAppearance) }
            else { startupFailure }
        }
        #else
        mainWindow
        #endif
    }
    @AppStorage("appearance") private var appearanceRaw = "system"
    private var settingsAppearance: ColorScheme? { appearanceRaw == "light" ? .light : appearanceRaw == "dark" ? .dark : nil }
    private var mainWindow: some Scene {
        WindowGroup {
            if let store {
                WorkspaceRootView().environment(store).nativeWindowSize()
            } else { startupFailure }
        }.defaultSize(width: 1180, height: 780)
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
        self.frame(minWidth: 920, minHeight: 600)
        #else
        self
        #endif
    }
}
#if os(macOS)
@MainActor struct WorkspaceCommands: Commands {
    let store: WorkspaceStore
    @FocusedValue(\.workspaceCreation) private var creation
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("新建\((creation?.kind ?? store.navigation.creationKind).title)") {
                if let creation { creation.create() } else { store.createKind = store.navigation.creationKind }
            }.keyboardShortcut("n")
        }
        CommandMenu("工作空间") {
            Button("行动") { store.navigation = .actions }.keyboardShortcut("1")
            Button("DDL") { store.navigation = .deadlines }.keyboardShortcut("2")
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
