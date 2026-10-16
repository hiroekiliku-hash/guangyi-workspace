import SwiftUI

enum AppDestination: String, CaseIterable, Identifiable {
    case overview, projects, actions, deadlines, more, knowledge, calendar, timeline, archives, areas, settings, trash
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "首页"
        case .projects: "项目组"
        case .actions: "事项"
        case .deadlines: "截止事项"
        case .more: "更多"
        case .knowledge: "知识库"
        case .calendar: "日历"
        case .timeline: "时间线"
        case .archives: "归档"
        case .areas: "项目组"
        case .settings: "设置"
        case .trash: "回收站"
        }
    }
    var symbol: String {
        switch self {
        case .overview: "house"
        case .projects: "folder"
        case .actions: "checklist"
        case .deadlines: "hourglass"
        case .more: "ellipsis.circle"
        case .knowledge: "book.closed"
        case .calendar: "calendar"
        case .timeline: "chart.bar.xaxis"
        case .archives: "archivebox"
        case .areas: "square.stack.3d.up"
        case .settings: "gearshape"
        case .trash: "trash"
        }
    }
    var creationKind: ItemKind {
        switch self { case .projects, .areas: .project; case .deadlines: .deadline; case .knowledge: .knowledge; default: .task }
    }
}
struct RecordRoute: Identifiable { var id: UUID }

struct WorkspaceRootView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        @Bindable var store = store
        platformNavigation
            .tint(.indigo)
            .environment(\.locale, Locale(identifier: "zh_CN"))
            .environment(\.timeZone, WorkspaceDates.calendar(store.state.profile.timezone).timeZone)
            .preferredColorScheme(appearance)
            .sheet(item: $store.createKind) { kind in NavigationStack { RecordEditorView(kind: kind) }.nativeEditorPresentation() }
            .sheet(item: route) { route in
                NavigationStack {
                    RecordDetailView(id: route.id)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { store.openedRecordID = nil } } }
                }
                .nativeSheetSize()
            }
            .sheet(isPresented: Binding(get: { store.pendingImport != nil }, set: { if !$0 { store.cancelSyncReview() } })) {
                NavigationStack { ImportReviewView() }.nativeSheetSize()
            }
            .alert("操作未完成", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
                Button("好") { store.errorMessage = nil }
            } message: { Text(store.errorMessage ?? "") }
            .alert("工作坊", isPresented: Binding(get: { store.information != nil }, set: { if !$0 { store.information = nil } })) {
                Button("好") { store.information = nil }
            } message: { Text(store.information ?? "") }
            .modifier(WorkspaceFeedbackModifier())
            .task {
                store.refresh(); store.scheduleSync()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(30)) } catch { break }
                    if scenePhase == .active {
                        store.scheduleSync()
                        #if os(iOS)
                        store.liveActivity.synchronize(store.state)
                        #endif
                    }
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { store.refresh(); store.scheduleSync() }
                #if os(iOS)
                if phase == .background { WorkspaceBackgroundSync.updateSchedule(for: store) }
                #endif
            }
            .onOpenURL { url in
                if url.scheme == "guangyi-workspace", let id = UUID(uuidString: url.lastPathComponent), store.record(id) != nil {
                    store.openedRecordID = id
                } else if url.isFileURL {
                    store.importDescription = "文件：\(url.lastPathComponent)"
                    store.perform { store.pendingImport = try ArchiveService.read(url: url, password: nil) }
                }
            }
    }
    @AppStorage("appearance") private var appearanceRaw = "system"
    private var appearance: ColorScheme? { appearanceRaw == "light" ? .light : appearanceRaw == "dark" ? .dark : nil }
    private var route: Binding<RecordRoute?> {
        Binding(get: { store.openedRecordID.map { RecordRoute(id: $0) } }, set: { store.openedRecordID = $0?.id })
    }
    @ViewBuilder private var platformNavigation: some View {
        #if os(macOS)
        MacWorkspaceNavigation()
        #else
        TabView(selection: Binding(get: {
            switch store.navigation {
            case .overview, .projects, .actions, .deadlines: store.navigation
            case .areas: .projects
            default: .overview
            }
        }, set: { store.navigation = $0 })) {
            ForEach([AppDestination.overview, .projects, .actions, .deadlines]) { destination in
                NavigationStack { DestinationView(destination: destination)
                    .toolbar { ToolbarItem { NavigationLink { SettingsView() } label: { Label("设置", systemImage: "gearshape") } } }
                }
                    .tabItem { Label(destination.title, systemImage: destination.symbol) }.tag(destination)
                    .badge(destination == .deadlines ? store.records(.deadline).filter { $0.isOverdue }.count : 0)
            }
        }
        #endif
    }
}

struct DestinationView: View {
    let destination: AppDestination
    @ViewBuilder var body: some View {
        switch destination {
        case .overview: OverviewView()
        case .projects: ProjectGroupsView()
        case .actions: ActionsView()
        case .deadlines: RecordListView(kind: .deadline)
        case .knowledge: RecordListView(kind: .knowledge)
        case .calendar: WorkspaceCalendarView()
        case .timeline: ProjectTimelineView()
        case .areas: ProjectGroupsView()
        case .archives: ArchivesView()
        case .settings, .more: SettingsView()
        case .trash: TrashView()
        }
    }
}
extension View {
    @ViewBuilder func workspaceInlineTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
    func workspaceSelectionFeedback<T: Equatable>(trigger: T) -> some View {
        modifier(WorkspaceSelectionFeedback(trigger: trigger))
    }
    @ViewBuilder func nativeSheetSize() -> some View {
        #if os(macOS)
        self.frame(minWidth: 580, idealWidth: 640, minHeight: 520, idealHeight: 680)
        #else
        self
        #endif
    }
}

private struct WorkspaceFeedbackModifier: ViewModifier {
    @Environment(WorkspaceStore.self) private var store
    @AppStorage("hapticsEnabled") private var enabled = true
    func body(content: Content) -> some View {
        content
            .sensoryFeedback(.selection, trigger: store.navigation) { _, _ in enabled }
            .sensoryFeedback(.success, trigger: store.feedbackSequence) { _, _ in enabled }
            .sensoryFeedback(.error, trigger: store.errorMessage) { _, value in enabled && value != nil }
            .sensoryFeedback(.impact(weight: .light, intensity: 0.55), trigger: store.createKind) { _, value in enabled && value != nil }
            .sensoryFeedback(.selection, trigger: store.openedRecordID) { _, value in enabled && value != nil }
            .sensoryFeedback(.success, trigger: store.information) { _, value in enabled && value != nil }
    }
}

private struct WorkspaceSelectionFeedback<T: Equatable>: ViewModifier {
    @AppStorage("hapticsEnabled") private var enabled = true
    let trigger: T
    func body(content: Content) -> some View {
        content.sensoryFeedback(.selection, trigger: trigger) { _, _ in enabled }
    }
}

/// Full-width in-content actions keep a readable label even inside a List or Form.
struct WorkspacePrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    var tint: Color = .indigo
    var prominent = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(.titleAndIcon)
            .font(.body.weight(.semibold))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 24)
            .padding(.horizontal, 18).padding(.vertical, 13)
            .foregroundStyle(prominent ? Color.white : tint)
            .background(prominent ? AnyShapeStyle(tint.gradient) : AnyShapeStyle(tint.opacity(0.08)), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(tint.opacity(prominent ? 0 : 0.14), lineWidth: 1) }
            .opacity(enabled ? (configuration.isPressed ? 0.82 : 1) : 0.4)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light, intensity: 0.55), trigger: configuration.isPressed) { _, pressed in
                hapticsEnabled && enabled && pressed
            }
    }
}

struct WorkspaceCreationContext {
    var kind: ItemKind
    var create: () -> Void
}
private struct WorkspaceCreationKey: FocusedValueKey {
    typealias Value = WorkspaceCreationContext
}
extension FocusedValues {
    var workspaceCreation: WorkspaceCreationContext? {
        get { self[WorkspaceCreationKey.self] }
        set { self[WorkspaceCreationKey.self] = newValue }
    }
}
#if os(macOS)
struct MacWorkspaceNavigation: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var selection: UUID?
    private var listKind: ItemKind? {
        switch store.navigation {
        case .projects: .project
        case .actions: .task
        case .deadlines: .deadline
        case .knowledge: .knowledge
        case .areas: .project
        default: nil
        }
    }
    var body: some View {
        Group {
            if let kind = listKind {
                NavigationSplitView {
                    sidebar
                } content: {
                    VStack(spacing: 0) {
                        if store.navigation == .actions {
                            ActionsView(selection: $selection)
                        } else if store.navigation == .projects || store.navigation == .areas {
                            ProjectGroupsView(selection: $selection)
                        } else { RecordListView(kind: kind, selection: $selection).id(kind) }
                    }.navigationSplitViewColumnWidth(min: 260, ideal: 340, max: 500)
                } detail: {
                    NavigationStack {
                        if let selection { RecordDetailView(id: selection, embedded: true) }
                        else { ContentUnavailableView("选择一条记录", systemImage: "sidebar.right", description: Text("从列表选择记录以查看详情。")) }
                    }.id(selection)
                }
            } else {
                NavigationSplitView { sidebar } detail: {
                    NavigationStack { DestinationView(destination: store.navigation).id(store.navigation) }
                }
            }
        }
        .onChange(of: store.navigation) { _, _ in selection = nil }
        .onChange(of: store.state.records) { _, _ in
            if let id = selection, !store.state.records.contains(where: { $0.id == id && WorkspaceLogic.visible($0, in: store.state) }) { selection = nil }
        }
        .focusedSceneValue(\.workspaceCreation, WorkspaceCreationContext(kind: listKind ?? .task, create: { store.createKind = listKind ?? .task }))
    }
    private var sidebar: some View {
        List(selection: Binding(get: { Optional(store.navigation) }, set: { if let value = $0 { store.navigation = value } })) {
            Section("工作坊") {
                ForEach([AppDestination.overview, .projects, .actions, .deadlines]) { destination in
                    Label(destination.title, systemImage: destination.symbol).tag(destination)
                }
            }
            Section("安排") {
                ForEach([AppDestination.knowledge, .calendar, .timeline, .archives]) { destination in
                    Label(destination.title, systemImage: destination.symbol).tag(destination)
                }
            }
            Section {
                SettingsLink { Label("设置", systemImage: "gearshape") }.buttonStyle(.borderless)
                Label("回收站", systemImage: "trash").tag(AppDestination.trash)
            }
        }.listStyle(.sidebar).navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
    }
}
#endif
extension View {
    @ViewBuilder func nativeEditorPresentation() -> some View {
        #if os(iOS)
        self.presentationDetents([.large]).presentationDragIndicator(.visible)
        #else
        self.nativeSheetSize()
        #endif
    }
}
