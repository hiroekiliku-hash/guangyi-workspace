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
