import Foundation

enum WorkspaceLogic {
    static func visible(_ record: WorkspaceRecord, in state: WorkspaceState) -> Bool {
        guard record.isLive else { return false }
        return record.projectID.map { parent in state.records.contains { $0.id == parent && $0.isLive } } ?? true
    }
    static func descendants(of root: WorkspaceRecord, in state: WorkspaceState) -> [WorkspaceRecord] {
        state.records.filter { record in
            record.deletedAt == nil && (record.id == root.id || (root.kind == .project && record.projectID == root.id))
        }.sorted { $0.id.uuidString < $1.id.uuidString }
    }
    static func preview(_ root: WorkspaceRecord, in state: WorkspaceState) throws -> DeletionPreview {
        if root.kind == .area && state.records.contains(where: { $0.areaID == root.id && $0.deletedAt == nil }) {
            throw WorkspaceFailure.invalid("此领域仍有关联项目，请先迁移这些项目。")
        }
        if root.kind == .milestone && state.records.contains(where: { $0.milestoneID == root.id && $0.deletedAt == nil }) {
            throw WorkspaceFailure.invalid("此里程碑仍有关联行动，请先迁移这些行动。")
        }
        return DeletionPreview(root: root, records: descendants(of: root, in: state))
    }
    static func delete(_ preview: DeletionPreview, from state: inout WorkspaceState, now: Date = Date()) throws {
        let current = descendants(of: preview.root, in: state)
        guard now.timeIntervalSince(preview.createdAt) < 600,
              current.map(\.id) == preview.records.map(\.id),
              current.map(\.version) == preview.records.map(\.version) else { throw WorkspaceFailure.stalePreview }
        guard !current.isEmpty else { throw WorkspaceFailure.stalePreview }
        let batch = TrashBatch(rootID: preview.root.id, title: preview.root.title, itemIDs: current.map(\.id),
            deletedAt: now, expiresAt: preview.root.kind == .knowledge ? nil : now.addingTimeInterval(30 * 86400))
        let ids = Set(batch.itemIDs)
        for index in state.records.indices where ids.contains(state.records[index].id) {
            state.records[index].deletedAt = now; state.records[index].trashBatchID = batch.id
            state.records[index].version += 1; state.records[index].updatedAt = now
        }
        state.trash.append(batch)
    }
    static func restore(_ batch: TrashBatch, in state: inout WorkspaceState, now: Date = Date()) throws {
        if let expires = batch.expiresAt, now > expires { throw WorkspaceFailure.expiredTrash }
        let ids = Set(batch.itemIDs)
        for record in state.records where record.trashBatchID == batch.id {
            if let parent = record.projectID, !ids.contains(parent),
               !state.records.contains(where: { $0.id == parent && $0.deletedAt == nil }) { throw WorkspaceFailure.missingParent }
        }
        for index in state.records.indices where state.records[index].trashBatchID == batch.id {
            state.records[index].deletedAt = nil; state.records[index].trashBatchID = nil
            state.records[index].version += 1; state.records[index].updatedAt = now
        }
        state.trash.removeAll { $0.id == batch.id }
    }
    static func validate(_ state: WorkspaceState) throws {
        guard !state.profile.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              state.profile.name.count <= 80, TimeZone(identifier: state.profile.timezone) != nil,
              (state.profile.avatar?.count ?? 0) <= 5 * 1024 * 1024 else {
            throw WorkspaceFailure.invalid("个人资料的姓名、时区或头像无效。")
        }
        guard state.format == "guangyi-native", state.schemaVersion == 1,
              state.records.count <= 100_000, state.assets.count <= 10_000,
              Set(state.records.map(\.id)).count == state.records.count,
              Set(state.assets.map(\.id)).count == state.assets.count,
              Set(state.series.map(\.id)).count == state.series.count,
              Set(state.trash.map(\.id)).count == state.trash.count else {
            throw WorkspaceFailure.invalid("归档版本或记录标识无效，无法导入。")
        }
        guard Set(state.revisions.map(\.id)).count == state.revisions.count,
              Set(state.activities.map(\.id)).count == state.activities.count else {
            throw WorkspaceFailure.invalid("历史记录包含重复标识。")
        }
        let projects = Set(state.records.filter { $0.kind == .project }.map(\.id))
        let milestones = Dictionary(uniqueKeysWithValues: state.records.filter { $0.kind == .milestone }.map { ($0.id, $0) })
        let areas = Set(state.records.filter { $0.kind == .area }.map(\.id))
        let notes = Set(state.records.filter { $0.kind == .knowledge }.map(\.id))
        let series = Set(state.series.map(\.id))
        let batches = Set(state.trash.map(\.id))
        for record in state.records {
            guard !record.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  record.title.count <= 240, record.version > 0, record.body.count <= 250_000,
                  TimeZone(identifier: record.timezone) != nil, record.kind.states.contains(record.status) else {
                throw WorkspaceFailure.invalid("记录内容、状态或时区无效。")
            }
            if let id = record.projectID, !projects.contains(id) { throw WorkspaceFailure.missingParent }
            if let id = record.milestoneID, milestones[id]?.projectID != record.projectID || milestones[id] == nil { throw WorkspaceFailure.missingParent }
            if let id = record.areaID, !areas.contains(id) { throw WorkspaceFailure.missingParent }
            if let id = record.recurrenceSeriesID, !series.contains(id) { throw WorkspaceFailure.invalid("循环系列缺失。") }
            if let id = record.trashBatchID, !batches.contains(id) { throw WorkspaceFailure.invalid("删除批次缺失。") }
            if let start = record.startDate, let target = record.targetDate, target < start {
                throw WorkspaceFailure.invalid("项目目标日期不能早于开始日期。")
            }
        }
        for asset in state.assets {
            guard notes.contains(asset.ownerID), asset.data.count <= 10 * 1024 * 1024,
                  asset.data.starts(with: Data("%PDF-".utf8)) else { throw WorkspaceFailure.invalid("PDF 附件无效或超过 10 MB。") }
        }
        for series in state.series {
            guard series.template.kind == .deadline, series.template.dueDate != nil,
                  (1...365).contains(series.rule.interval), series.rule.weekdays.allSatisfy({ (1...7).contains($0) }) else {
                throw WorkspaceFailure.invalid("循环规则无效。")
            }
            if let until = series.rule.until, let anchor = series.template.dueDate,
               series.template.calendar.startOfDay(for: until) < series.template.calendar.startOfDay(for: anchor) {
                throw WorkspaceFailure.invalid("循环结束日期不能早于首个截止日期。")
            }
        }
    }
}

/// Three-way reconciliation for same-account devices. The acknowledged server
/// snapshot is the base; simultaneous edits to one entity require review.
enum WorkspaceSyncResolution: String, CaseIterable, Identifiable {
    case local = "保留本机冲突版本", remote = "使用服务器冲突版本"
    var id: String { rawValue }
}

enum WorkspaceSyncMerge {
    static func reconcile(base: WorkspaceState?, local: WorkspaceState, remote: WorkspaceState, resolution: WorkspaceSyncResolution? = nil) throws -> WorkspaceState {
        func normalized(_ state: WorkspaceState) throws -> WorkspaceState {
            try WorkspaceLogic.validate(state)
            return try WorkspaceCoding.decoder().decode(WorkspaceState.self, from: WorkspaceCoding.encoder().encode(state))
        }
        let local = try normalized(local), remote = try normalized(remote)
        let base = try base.map(normalized)
        var result = remote
        result.records = try entities(base?.records ?? [], local.records, remote.records, label: "记录", resolution: resolution)
        result.series = try entities(base?.series ?? [], local.series, remote.series, label: "循环规则", resolution: resolution)
        result.assets = try entities(base?.assets ?? [], local.assets, remote.assets, label: "附件", resolution: resolution)
        result.activities = try entities(base?.activities ?? [], local.activities, remote.activities, label: "历史", resolution: resolution)
        result.revisions = try entities(base?.revisions ?? [], local.revisions, remote.revisions, label: "笔记版本", resolution: resolution)
        result.trash = try entities(base?.trash ?? [], local.trash, remote.trash, label: "回收站", resolution: resolution)
        let initialProfile = base?.profile ?? WorkspaceProfile()
        if local.profile == remote.profile || local.profile == initialProfile { result.profile = remote.profile }
        else if remote.profile == initialProfile { result.profile = local.profile }
        else if let resolution { result.profile = resolution == .local ? local.profile : remote.profile }
        else { throw WorkspaceFailure.invalid("两台设备都修改了个人资料，请比较后选择要保留的版本。") }
        // Restoring a record on either side must remove an obsolete trash batch.
        result.trash = result.trash.filter { batch in result.records.contains { $0.trashBatchID == batch.id } }
        try WorkspaceLogic.validate(result)
        return result
    }
    private static func entities<T: Identifiable & Equatable>(_ base: [T], _ local: [T], _ remote: [T], label: String, resolution: WorkspaceSyncResolution?) throws -> [T] where T.ID == UUID {
        func index(_ values: [T]) throws -> [UUID: T] {
            var result: [UUID: T] = [:]
            for value in values {
                guard result[value.id] == nil else { throw WorkspaceFailure.invalid("同步数据包含重复的\(label)标识。") }
                result[value.id] = value
            }
            return result
        }
        let baseline = try index(base), ours = try index(local), theirs = try index(remote)
        let identifiers = Set(baseline.keys).union(ours.keys).union(theirs.keys)
        return try identifiers.sorted { $0.uuidString < $1.uuidString }.compactMap { id in
            let old = baseline[id], left = ours[id], right = theirs[id]
            if left == right { return left }
            if left == old { return right }
            if right == old { return left }
            if let resolution { return resolution == .local ? left : right }
            throw WorkspaceFailure.invalid("两台设备同时修改了同一\(label)（\(id.uuidString)）。同步已停止，双方数据保留，请先解决冲突。")
        }
    }
}

struct VersionedWorkspace: Codable { var revision: Int; var snapshot: WorkspaceState }
struct WorkspaceSyncCheckpoint: Codable {
    var scope: String
    var remote: VersionedWorkspace
}
enum WorkspaceSyncError: Error { case revisionChanged, accountChanged }

@MainActor enum WorkspaceSyncDriver {
    /// Re-read local state around awaits. Never apply a response from a different
    /// account, and preserve edits made while a PUT is in flight.
    static func run(base: WorkspaceState?, readLocal: () -> WorkspaceState,
                    isCurrentAccount: () -> Bool,
                    download: () async throws -> VersionedWorkspace,
                    upload: (WorkspaceState, Int) async throws -> VersionedWorkspace,
                    apply: (WorkspaceState, VersionedWorkspace) throws -> Void) async throws {
        for attempt in 0..<3 {
            guard isCurrentAccount() else { throw WorkspaceSyncError.accountChanged }
            let remote = try await download()
            guard isCurrentAccount() else { throw WorkspaceSyncError.accountChanged }
            let localBeforeUpload = readLocal()
            let merged = try WorkspaceSyncMerge.reconcile(base: base, local: localBeforeUpload, remote: remote.snapshot)
            let acknowledged: VersionedWorkspace
            if try equivalent(merged, remote.snapshot) { acknowledged = remote }
            else {
                do { acknowledged = try await upload(merged, remote.revision) }
                catch WorkspaceSyncError.revisionChanged {
                    if attempt < 2 { continue }
                    throw WorkspaceFailure.invalid("服务器持续有新改动，本机资料已保留，请稍后重试同步。")
                }
            }
            guard isCurrentAccount() else { throw WorkspaceSyncError.accountChanged }
            let current = try WorkspaceSyncMerge.reconcile(base: localBeforeUpload, local: readLocal(), remote: acknowledged.snapshot)
            try apply(current, acknowledged)
            return
        }
    }
    private static func equivalent(_ lhs: WorkspaceState, _ rhs: WorkspaceState) throws -> Bool {
        func sorted(_ value: WorkspaceState) -> WorkspaceState {
            var value = value
            value.records.sort { $0.id.uuidString < $1.id.uuidString }
            value.series.sort { $0.id.uuidString < $1.id.uuidString }
            value.assets.sort { $0.id.uuidString < $1.id.uuidString }
            value.activities.sort { $0.id.uuidString < $1.id.uuidString }
            value.revisions.sort { $0.id.uuidString < $1.id.uuidString }
            value.trash.sort { $0.id.uuidString < $1.id.uuidString }
            return value
        }
        return try WorkspaceCoding.encoder().encode(sorted(lhs)) == WorkspaceCoding.encoder().encode(sorted(rhs))
    }
}
