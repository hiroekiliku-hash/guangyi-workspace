import Foundation
import Observation
import PDFKit

@MainActor @Observable final class WorkspaceStore {
    private(set) var state: WorkspaceState
    var errorMessage: String?
    var information: String?
    var navigation = AppDestination.overview
    var openedRecordID: UUID?
    var createKind: ItemKind?
    var pendingImport: WorkspaceState?
    var importDescription = ""
    let notifications = NotificationCoordinator()
    let backend = BackendService()
    @ObservationIgnored private let repository: SwiftDataRepository

    init(repository: SwiftDataRepository) throws {
        self.repository = repository; state = try repository.load()
        notifications.store = self
        try commit { RecurrenceEngine.materialize(&$0) }
    }
    func record(_ id: UUID) -> WorkspaceRecord? { state.records.first { $0.id == id } }
    func records(_ kind: ItemKind, includeArchived: Bool = false) -> [WorkspaceRecord] {
        state.records.filter { $0.kind == kind && $0.deletedAt == nil && (includeArchived || WorkspaceLogic.visible($0, in: state)) }
            .sorted { left, right in
                if left.pinned != right.pinned { return left.pinned }
                if kind == .deadline || kind == .reminder {
                    if left.isFinished != right.isFinished { return !left.isFinished }
                    let a = left.dueDate ?? left.remindAt ?? .distantFuture
                    let b = right.dueDate ?? right.remindAt ?? .distantFuture
                    if a != b { return a < b }
                }
                return left.updatedAt > right.updatedAt
            }
    }
    func perform(_ action: () throws -> Void) {
        do { try action() } catch { errorMessage = error.localizedDescription }
    }
    func commit(_ update: (inout WorkspaceState) throws -> Void) throws {
        var draft = state
        try update(&draft)
        try WorkspaceLogic.validate(draft)
        try repository.save(draft)
        state = draft
        notifications.reschedule(draft)
    }
    private func log(_ record: WorkspaceRecord, _ message: String, in draft: inout WorkspaceState) {
        draft.activities.append(ActivityEntry(entityID: record.id, projectID: record.kind == .project ? record.id : record.projectID,
            title: record.title, message: message))
    }
    func save(_ value: WorkspaceRecord, expectedVersion: Int?, confirmRemaining: Bool = false) throws {
        var value = value
        value.title = value.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.title.isEmpty else { throw WorkspaceFailure.invalid("请填写标题。") }
        if value.kind == .deadline && value.dueDate == nil { throw WorkspaceFailure.invalid("请选择截止日期。") }
        if value.kind == .project && value.status == "COMPLETED" && record(value.id)?.status != "COMPLETED" && !confirmRemaining {
            let count = state.records.filter { $0.kind == .task && $0.projectID == value.id && $0.isLive && !$0.isFinished }.count
            if count > 0 { throw WorkspaceFailure.remainingTasks(count) }
        }
        try commit { draft in
            if let parent = value.projectID, !draft.records.contains(where: { $0.id == parent && $0.kind == .project && $0.isLive }) {
                throw WorkspaceFailure.missingParent
            }
            let index = draft.records.firstIndex { $0.id == value.id }
            if let index {
                guard draft.records[index].version == expectedVersion else { throw WorkspaceFailure.conflict }
                guard draft.records[index].archivedAt == nil && draft.records[index].deletedAt == nil else {
                    throw WorkspaceFailure.invalid("请先恢复归档或回收站中的记录。")
                }
                if draft.records[index].dueDate != value.dueDate || draft.records[index].remindAt != value.remindAt ||
                    draft.records[index].scheduledAt != value.scheduledAt || draft.records[index].dateOnly != value.dateOnly {
                    value.snoozedUntil = nil
                }
                value.version = draft.records[index].version + 1; value.createdAt = draft.records[index].createdAt
                if value.recurrenceSeriesID != nil { value.isException = true }
                value.updatedAt = Date()
                if value.kind == .knowledge {
                    draft.revisions.append(KnowledgeRevision(record: draft.records[index], action: "修改前"))
                }
                draft.records[index] = value
            } else {
                guard expectedVersion == nil else { throw WorkspaceFailure.conflict }
                value.version = 1; value.createdAt = Date(); value.updatedAt = value.createdAt
                draft.records.append(value)
            }
            if let index = draft.records.firstIndex(where: { $0.id == value.id }) {
                if ["DONE", "COMPLETED"].contains(value.status) { draft.records[index].completedAt = value.completedAt ?? Date() }
                else { draft.records[index].completedAt = nil }
                draft.records[index].cancelledAt = value.status == "CANCELLED" ? value.cancelledAt ?? Date() : nil
            }
            log(value, index == nil ? "创建\(value.kind.title)" : "修改\(value.kind.title)", in: &draft)
        }
    }
    func setStatus(_ id: UUID, _ status: String) throws {
        guard var value = record(id) else { return }
        guard WorkspaceLogic.visible(value, in: state) else {
            throw WorkspaceFailure.invalid("请先恢复此记录或所属项目的归档状态。")
        }
        value.status = status
        try save(value, expectedVersion: value.version)
    }
    func archive(_ id: UUID, restore: Bool = false) throws {
        try commit { draft in
            guard let index = draft.records.firstIndex(where: { $0.id == id }) else { return }
            draft.records[index].archivedAt = restore ? nil : Date()
            draft.records[index].version += 1; draft.records[index].updatedAt = Date()
            log(draft.records[index], restore ? "恢复归档" : "归档", in: &draft)
        }
    }
    func deletionPreview(_ id: UUID) throws -> DeletionPreview {
        guard let value = record(id) else { throw WorkspaceFailure.invalid("记录不存在。") }
        return try WorkspaceLogic.preview(value, in: state)
    }
    func delete(_ preview: DeletionPreview) throws {
        try commit { draft in
            if preview.root.kind == .knowledge { draft.revisions.append(KnowledgeRevision(record: preview.root, action: "移入回收站前")) }
            try WorkspaceLogic.delete(preview, from: &draft)
            log(preview.root, "移入回收站（\(preview.records.count) 项）", in: &draft)
        }
    }
    func restore(_ batch: TrashBatch) throws {
        try commit { draft in
            try WorkspaceLogic.restore(batch, in: &draft)
            if let root = draft.records.first(where: { $0.id == batch.rootID }) { log(root, "从回收站恢复", in: &draft) }
        }
    }
    func createRecurrence(_ id: UUID, rule: RecurrenceRule) throws {
        try commit { draft in
            guard let index = draft.records.firstIndex(where: { $0.id == id }),
                  draft.records[index].kind == .deadline, draft.records[index].isLive,
                  draft.records[index].status == "OPEN", draft.records[index].dueDate != nil,
                  draft.records[index].recurrenceSeriesID == nil else {
                throw WorkspaceFailure.invalid("只能为未完成的独立截止事项设置循环。")
            }
            let series = DeadlineSeries(template: draft.records[index], rule: rule)
            draft.series.append(series)
            draft.records[index].recurrenceSeriesID = series.id
            draft.records[index].occurrenceDate = WorkspaceDates.dayKey(draft.records[index].dueDate!, timezone: draft.records[index].timezone)
            draft.records[index].version += 1; draft.records[index].updatedAt = Date()
            RecurrenceEngine.materialize(&draft)
            log(draft.records[index], "设置循环：\(rule.label)", in: &draft)
        }
    }
    func stopRecurrence(_ seriesID: UUID) throws {
        try commit { draft in
            guard let series = draft.series.firstIndex(where: { $0.id == seriesID }) else { return }
            draft.series[series].stoppedAt = Date()
            for index in draft.records.indices where draft.records[index].recurrenceSeriesID == seriesID &&
                draft.records[index].status == "OPEN" && draft.records[index].dueDate.map({ draft.records[index].effectiveDueDate($0) >= Date() }) == true {
                draft.records[index].status = "CANCELLED"; draft.records[index].cancelledAt = Date()
                draft.records[index].version += 1; draft.records[index].updatedAt = Date()
                log(draft.records[index], "停止后续循环", in: &draft)
            }
        }
    }
    func restoreRevision(_ revision: KnowledgeRevision) throws {
        guard var current = record(revision.record.id) else { return }
        current.title = revision.record.title; current.body = revision.record.body
        current.summary = revision.record.summary; current.category = revision.record.category
        current.tags = revision.record.tags; current.pinned = revision.record.pinned
        try save(current, expectedVersion: current.version)
    }
    func attachPDF(_ url: URL, to id: UUID) throws {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 10 * 1024 * 1024 else { throw WorkspaceFailure.tooLarge }
        let bytes = try Data(contentsOf: url)
        guard bytes.count <= 10 * 1024 * 1024, PDFDocument(data: bytes) != nil else { throw WorkspaceFailure.invalid("请选择有效的 PDF 文件。") }
        try commit { draft in
            guard draft.records.contains(where: { $0.id == id && $0.kind == .knowledge && $0.deletedAt == nil }) else { throw WorkspaceFailure.missingParent }
            draft.assets.append(WorkspaceAsset(ownerID: id, name: url.lastPathComponent, data: bytes))
        }
    }
    func importState(_ incoming: WorkspaceState, preferIncoming: Bool) throws {
        try WorkspaceLogic.validate(incoming)
        try commit { draft in
            var records = Dictionary(uniqueKeysWithValues: draft.records.map { ($0.id, $0) })
            for record in incoming.records where records[record.id] == nil || preferIncoming { records[record.id] = record }
            draft.records = Array(records.values)
            func merge<T: Identifiable>(_ old: [T], _ new: [T]) -> [T] where T.ID == UUID {
                var map = Dictionary(uniqueKeysWithValues: old.map { ($0.id, $0) })
                for value in new where map[value.id] == nil || preferIncoming { map[value.id] = value }
                return Array(map.values)
            }
            draft.assets = merge(draft.assets, incoming.assets)
            draft.series = merge(draft.series, incoming.series)
            draft.revisions = merge(draft.revisions, incoming.revisions)
            draft.activities = merge(draft.activities, incoming.activities)
            draft.trash = merge(draft.trash, incoming.trash)
            if preferIncoming { draft.profile = incoming.profile }
            // A batch restored on either device must not retain an unrelated stale batch.
            draft.trash = draft.trash.filter { batch in draft.records.contains { $0.trashBatchID == batch.id } }
            RecurrenceEngine.materialize(&draft)
        }
    }
    func refresh() {
        perform { try commit { RecurrenceEngine.materialize(&$0) } }
        Task { await notifications.refreshAuthorization() }
        if backend.signedIn && Bundle.main.object(forInfoDictionaryKey: "RemotePushEnabled") as? Bool == true {
            do { try RemotePushBridge.registerWithApple() } catch { errorMessage = error.localizedDescription }
        }
    }
}
