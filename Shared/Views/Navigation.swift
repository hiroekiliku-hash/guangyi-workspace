import SwiftUI

enum AppDestination: String, CaseIterable, Identifiable {
    case overview, projects, actions, deadlines, more, knowledge, calendar, timeline, archives, areas, settings, trash
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "概览"
        case .projects: "项目"
        case .actions: "行动"
        case .deadlines: "截止"
        case .more: "更多"
        case .knowledge: "知识库"
        case .calendar: "日历"
        case .timeline: "时间线"
        case .archives: "归档"
        case .areas: "领域"
        case .settings: "设置"
        case .trash: "回收站"
        }
    }
    var symbol: String {
        switch self {
        case .overview: "square.grid.2x2"
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
        switch self { case .projects: .project; case .deadlines: .deadline; case .knowledge: .knowledge; case .areas: .area; default: .task }
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
            .sheet(item: $store.createKind) { kind in NavigationStack { RecordEditorView(kind: kind) } }
            .sheet(item: route) { route in
                NavigationStack {
                    RecordDetailView(id: route.id)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { store.openedRecordID = nil } } }
                }
                .nativeSheetSize()
            }
            .sheet(isPresented: Binding(get: { store.pendingImport != nil }, set: { if !$0 { store.pendingImport = nil } })) {
                NavigationStack { ImportReviewView() }.nativeSheetSize()
            }
            .alert("操作未完成", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
                Button("好") { store.errorMessage = nil }
            } message: { Text(store.errorMessage ?? "") }
            .alert("广益 WorkSpace", isPresented: Binding(get: { store.information != nil }, set: { if !$0 { store.information = nil } })) {
                Button("好") { store.information = nil }
            } message: { Text(store.information ?? "") }
            .task { store.refresh() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { store.refresh() } }
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
        NavigationSplitView {
            List(selection: Binding(get: { Optional(store.navigation) }, set: { if let value = $0 { store.navigation = value } })) {
                Section("广益 WorkSpace") {
                    ForEach([AppDestination.overview, .projects, .actions, .deadlines, .knowledge]) { destination in
                        Label(destination.title, systemImage: destination.symbol).tag(destination)
                    }
                }
                Section("安排") {
                    ForEach([AppDestination.calendar, .timeline, .areas, .archives]) { destination in
                        Label(destination.title, systemImage: destination.symbol).tag(destination)
                    }
                }
                Section {
                    Label("设置", systemImage: "gearshape").tag(AppDestination.settings)
                    Label("回收站", systemImage: "trash").tag(AppDestination.trash)
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        } detail: { NavigationStack { DestinationView(destination: store.navigation).id(store.navigation) } }
        #else
        TabView(selection: Binding(get: {
            [AppDestination.overview, .projects, .actions, .deadlines].contains(store.navigation) ? store.navigation : .more
        }, set: { store.navigation = $0 })) {
            ForEach([AppDestination.overview, .projects, .actions, .deadlines, .more]) { destination in
                NavigationStack { DestinationView(destination: destination) }
                    .tabItem { Label(destination.title, systemImage: destination.symbol) }.tag(destination)
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
        case .projects: RecordListView(kind: .project)
        case .actions: ActionsView()
        case .deadlines: RecordListView(kind: .deadline)
        case .knowledge: RecordListView(kind: .knowledge)
        case .calendar: WorkspaceCalendarView()
        case .timeline: ProjectTimelineView()
        case .areas: RecordListView(kind: .area)
        case .archives: ArchivesView()
        case .settings: SettingsView()
        case .trash: TrashView()
        case .more: MoreView()
        }
    }
}
struct MoreView: View {
    var body: some View {
        List {
            Section("工作空间") {
                ForEach([AppDestination.knowledge, .calendar, .timeline, .areas, .archives]) { destination in
                    NavigationLink { DestinationView(destination: destination) } label: { Label(destination.title, systemImage: destination.symbol) }
                }
            }
            Section {
                NavigationLink { SettingsView() } label: { Label("设置", systemImage: "gearshape") }
                NavigationLink { TrashView() } label: { Label("回收站", systemImage: "trash") }
            }
        }.navigationTitle("更多")
    }
}
extension View {
    @ViewBuilder func nativeSheetSize() -> some View {
        #if os(macOS)
        self.frame(minWidth: 580, idealWidth: 640, minHeight: 520, idealHeight: 680)
        #else
        self
        #endif
    }
}
