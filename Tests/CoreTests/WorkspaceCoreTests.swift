import XCTest
#if SWIFT_PACKAGE
@testable import WorkspaceCore
#endif

final class WorkspaceCoreTests: XCTestCase {
    private func date(_ text: String) -> Date { WorkspaceDates.parse(text)! }
    func testMonthlyRecurrenceClampsWithoutDrifting() {
        let dates = RecurrenceEngine.dates(anchor: date("2028-01-31"), rule: RecurrenceRule(frequency: .monthly),
            from: date("2028-01-31"), through: date("2028-03-31"), timezone: "Asia/Shanghai")
        XCTAssertEqual(dates.map { WorkspaceDates.dayKey($0, timezone: "Asia/Shanghai") }, ["2028-01-31", "2028-02-29", "2028-03-31"])
    }
    func testWeeklyRuleAnchorsToMondayAndPreservesExtraFirst() {
        let dates = RecurrenceEngine.dates(anchor: date("2026-10-16"), rule: RecurrenceRule(frequency: .weekly, interval: 2, weekdays: [1, 3]),
            from: date("2026-10-16"), through: date("2026-10-31"), timezone: "Asia/Shanghai")
        XCTAssertEqual(dates.map { WorkspaceDates.dayKey($0, timezone: "Asia/Shanghai") }, ["2026-10-16", "2026-10-26", "2026-10-28"])
    }
    func testMaterializationIsIdempotentAndBounded() {
        var record = WorkspaceRecord(kind: .deadline, title: "每日检查")
        record.dueDate = date("2026-10-14")
        let series = DeadlineSeries(template: record, rule: RecurrenceRule(frequency: .daily))
        record.recurrenceSeriesID = series.id; record.occurrenceDate = "2026-10-14"
        var state = WorkspaceState(records: [record], series: [series])
        RecurrenceEngine.materialize(&state, now: date("2026-10-14"))
        let count = state.records.count
        XCTAssertGreaterThan(count, 1000); XCTAssertLessThanOrEqual(count, 1200)
        RecurrenceEngine.materialize(&state, now: date("2026-10-14"))
        XCTAssertEqual(state.records.count, count)
        XCTAssertEqual(Set(state.records.compactMap(\.occurrenceDate)).count, count)
    }
    func testStoppedRecurrenceDoesNotGenerate() {
        var record = WorkspaceRecord(kind: .deadline, title: "已停止")
        record.dueDate = date("2026-10-14")
        let series = DeadlineSeries(template: record, rule: RecurrenceRule(frequency: .daily), stoppedAt: date("2026-10-14"))
        var state = WorkspaceState(series: [series])
        RecurrenceEngine.materialize(&state, now: date("2026-10-14"))
        XCTAssertTrue(state.records.isEmpty)
    }
    func testInstantRecurrencePreservesWallClockAcrossDST() {
        var record = WorkspaceRecord(kind: .deadline, title: "晨间检查")
        record.timezone = "America/New_York"; record.dateOnly = false
        record.dueDate = date("2026-03-07T09:00:00-05:00")
        let series = DeadlineSeries(template: record, rule: RecurrenceRule(frequency: .daily, until: date("2026-03-10T12:00:00Z")))
        var state = WorkspaceState(series: [series])
        RecurrenceEngine.materialize(&state, now: record.dueDate!)
        XCTAssertEqual(state.records.count, 4)
        XCTAssertTrue(state.records.allSatisfy { record.calendar.component(.hour, from: $0.dueDate!) == 9 })
    }
    func testCascadeTrashRestoresRelationships() throws {
        let project = WorkspaceRecord(kind: .project, title: "研究")
        var milestone = WorkspaceRecord(kind: .milestone, title: "里程碑"); milestone.projectID = project.id
        var task = WorkspaceRecord(kind: .task, title: "行动"); task.projectID = project.id; task.milestoneID = milestone.id
        var state = WorkspaceState(records: [project, milestone, task])
        let preview = try WorkspaceLogic.preview(project, in: state)
        try WorkspaceLogic.delete(preview, from: &state)
        XCTAssertTrue(state.records.allSatisfy { $0.deletedAt != nil })
        try WorkspaceLogic.restore(state.trash[0], in: &state)
        XCTAssertTrue(state.records.allSatisfy { $0.deletedAt == nil })
        XCTAssertEqual(state.records.first { $0.id == task.id }?.milestoneID, milestone.id)
        try WorkspaceLogic.validate(state)
    }
    func testPreviewRejectsNewChildAndMakesNoChanges() throws {
        let project = WorkspaceRecord(kind: .project, title: "项目")
        var state = WorkspaceState(records: [project])
        let preview = try WorkspaceLogic.preview(project, in: state)
        var child = WorkspaceRecord(kind: .task, title: "另一个窗口新增"); child.projectID = project.id
        state.records.append(child)
        XCTAssertThrowsError(try WorkspaceLogic.delete(preview, from: &state))
        XCTAssertTrue(state.records.allSatisfy { $0.deletedAt == nil })
        XCTAssertTrue(state.trash.isEmpty)
    }
    func testTrashExpiryPreservesExactBoundary() throws {
        let record = WorkspaceRecord(kind: .task, title: "边界")
        let now = Date()
        var state = WorkspaceState(records: [record])
        try WorkspaceLogic.delete(WorkspaceLogic.preview(record, in: state), from: &state, now: now)
        let batch = state.trash[0]
        var expired = state
        XCTAssertThrowsError(try WorkspaceLogic.restore(batch, in: &expired, now: batch.expiresAt!.addingTimeInterval(1)))
        try WorkspaceLogic.restore(batch, in: &state, now: batch.expiresAt!)
        XCTAssertNil(state.records[0].deletedAt)
    }
    func testKnowledgeTrashHasNoThirtyDayLimit() throws {
        let note = WorkspaceRecord(kind: .knowledge, title: "笔记")
        var state = WorkspaceState(records: [note])
        try WorkspaceLogic.delete(WorkspaceLogic.preview(note, in: state), from: &state)
        XCTAssertNil(state.trash[0].expiresAt)
        try WorkspaceLogic.restore(state.trash[0], in: &state, now: Date().addingTimeInterval(365 * 86400))
    }
    func testSnoozeDoesNotChangeDeadline() {
        var record = WorkspaceRecord(kind: .deadline, title: "不改期")
        record.notificationsEnabled = true; record.dueDate = date("2040-10-14"); record.snoozedUntil = date("2040-10-14T12:00:00+08:00")
        XCTAssertEqual(record.notificationDate, record.snoozedUntil)
        XCTAssertEqual(record.dueDate, date("2040-10-14"))
        record.status = "DONE"
        XCTAssertNil(record.notificationDate)
    }
    func testMalformedRelationshipsAndDuplicateIDsAreRejected() {
        var record = WorkspaceRecord(kind: .task, title: "关联缺失"); record.projectID = UUID()
        XCTAssertThrowsError(try WorkspaceLogic.validate(WorkspaceState(records: [record])))
        record.projectID = nil
        XCTAssertThrowsError(try WorkspaceLogic.validate(WorkspaceState(records: [record, record])))
    }
    func testDateOnlyDeadlineEndsAtWorkspaceMidnight() {
        var record = WorkspaceRecord(kind: .deadline, title: "仅日期")
        record.dueDate = date("2026-10-14")
        XCTAssertEqual(record.calendar.component(.hour, from: record.effectiveDueDate(record.dueDate!)), 23)
        XCTAssertEqual(record.calendar.component(.minute, from: record.effectiveDueDate(record.dueDate!)), 59)
    }
    func testJSONExportRoundingIsNotAContentConflict() throws {
        var record = WorkspaceRecord(kind: .knowledge, title: "保留内容")
        record.body = "**原生笔记**\n数学源码：$x^2$"
        let data = try WorkspaceCoding.encoder().encode(record)
        let decoded = try WorkspaceCoding.decoder().decode(WorkspaceRecord.self, from: data)
        XCTAssertTrue(WorkspaceCoding.equivalent(record, decoded))
        var edited = decoded; edited.body += "不同的修改"
        XCTAssertFalse(WorkspaceCoding.equivalent(record, edited))
    }
}

final class WorkspaceSyncMergeTests: XCTestCase {
    func testDisjointOfflineEditsAndNewRecordsArePreserved() throws {
        let first = WorkspaceRecord(kind: .task, title: "行动一")
        let second = WorkspaceRecord(kind: .deadline, title: "DDL 二")
        let base = WorkspaceState(records: [first, second])
        var local = base, remote = base
        local.records[0].title = "本机修改"; local.records[0].version += 1
        remote.records[1].title = "其他设备修改"; remote.records[1].version += 1
        remote.records.append(WorkspaceRecord(kind: .task, title: "远程新增"))
        let merged = try WorkspaceSyncMerge.reconcile(base: base, local: local, remote: remote)
        XCTAssertEqual(Set(merged.records.map(\.title)), ["本机修改", "其他设备修改", "远程新增"])
    }
    func testConcurrentSameVersionEditsRequireReview() throws {
        let base = WorkspaceState(records: [WorkspaceRecord(kind: .task, title: "原始")])
        var local = base, remote = base
        local.records[0].title = "本机"; local.records[0].version += 1
        remote.records[0].title = "远程"; remote.records[0].version += 1
        XCTAssertThrowsError(try WorkspaceSyncMerge.reconcile(base: base, local: local, remote: remote))
        XCTAssertEqual(local.records[0].title, "本机")
        XCTAssertEqual(remote.records[0].title, "远程")
    }
    func testRemoteDeletionOnlyWinsWhenLocalIsUnchanged() throws {
        let base = WorkspaceState(records: [WorkspaceRecord(kind: .task, title: "原始")])
        let remote = WorkspaceState()
        XCTAssertTrue(try WorkspaceSyncMerge.reconcile(base: base, local: base, remote: remote).records.isEmpty)
        var local = base; local.records[0].title = "离线修改"
        XCTAssertThrowsError(try WorkspaceSyncMerge.reconcile(base: base, local: local, remote: remote))
    }
    func testFirstSyncDoesNotOverwriteCollidingLocalContent() throws {
        let local = WorkspaceState(records: [WorkspaceRecord(kind: .task, title: "本机")])
        var remote = local; remote.records[0].title = "服务器"
        XCTAssertThrowsError(try WorkspaceSyncMerge.reconcile(base: nil, local: local, remote: remote))
    }
}

@MainActor final class WorkspaceSyncDriverTests: XCTestCase {
    func testTwoDeviceRoundTripPreservesOfflineChanges() async throws {
        let initial = WorkspaceState(records: [WorkspaceRecord(kind: .task, title: "初始")])
        var server = VersionedWorkspace(revision: 0, snapshot: initial)
        var phone = initial, mac = initial
        phone.records.append(WorkspaceRecord(kind: .task, title: "手机新增"))
        mac.records[0].title = "Mac 修改"
        func sync(_ local: inout WorkspaceState) async throws {
            // Value captured outside the inout access mirrors each device's store.
            var current = local
            try await WorkspaceSyncDriver.run(base: initial, readLocal: { current }, isCurrentAccount: { true },
                download: { server }, upload: { value, revision in
                    guard revision == server.revision else { throw WorkspaceSyncError.revisionChanged }
                    server = VersionedWorkspace(revision: revision + 1, snapshot: value); return server
                }, apply: { value, _ in current = value })
            local = current
        }
        try await sync(&phone)
        try await sync(&mac)
        XCTAssertEqual(Set(server.snapshot.records.map(\.title)), ["手机新增", "Mac 修改"])
        XCTAssertEqual(Set(mac.records.map(\.title)), ["手机新增", "Mac 修改"])
    }
    func testVersionConflictDownloadsAgainBeforeRetrying() async throws {
        let base = WorkspaceState()
        var current = WorkspaceState(records: [WorkspaceRecord(kind: .task, title: "本机")])
        var server = VersionedWorkspace(revision: 0, snapshot: base)
        var attempts = 0, downloads = 0
        try await WorkspaceSyncDriver.run(base: base, readLocal: { current }, isCurrentAccount: { true }, download: {
            downloads += 1; return server
        }, upload: { value, revision in
            attempts += 1
            if attempts == 1 {
                server.snapshot.records.append(WorkspaceRecord(kind: .task, title: "另一设备")); server.revision += 1
                throw WorkspaceSyncError.revisionChanged
            }
            XCTAssertEqual(revision, server.revision)
            server = VersionedWorkspace(revision: revision + 1, snapshot: value); return server
        }, apply: { value, _ in current = value })
        XCTAssertEqual(downloads, 2)
        XCTAssertEqual(Set(current.records.map(\.title)), ["本机", "另一设备"])
    }
    func testEditingDuringUploadRemainsPendingWithoutLosingLocalEdit() async throws {
        let base = WorkspaceState()
        var current = WorkspaceState(records: [WorkspaceRecord(kind: .task, title: "已上传版本")])
        var checkpoint: VersionedWorkspace?
        try await WorkspaceSyncDriver.run(base: base, readLocal: { current }, isCurrentAccount: { true }, download: {
            VersionedWorkspace(revision: 0, snapshot: base)
        }, upload: { value, _ in
            current.records[0].title = "上传期间继续编辑"
            return VersionedWorkspace(revision: 1, snapshot: value)
        }, apply: { value, remote in current = value; checkpoint = remote })
        XCTAssertEqual(current.records[0].title, "上传期间继续编辑")
        XCTAssertEqual(checkpoint?.snapshot.records[0].title, "已上传版本")
    }
    func testAccountChangeRejectsResponseAndNoopSkipsUpload() async throws {
        let empty = WorkspaceState()
        var isCurrent = true, applied = false, uploaded = false
        do {
            try await WorkspaceSyncDriver.run(base: empty, readLocal: { empty }, isCurrentAccount: { isCurrent }, download: {
                isCurrent = false; return VersionedWorkspace(revision: 0, snapshot: empty)
            }, upload: { _, _ in uploaded = true; return VersionedWorkspace(revision: 1, snapshot: empty) }, apply: { _, _ in applied = true })
            XCTFail("Must reject old-account response")
        } catch WorkspaceSyncError.accountChanged { }
        XCTAssertFalse(applied); XCTAssertFalse(uploaded)
        try await WorkspaceSyncDriver.run(base: empty, readLocal: { empty }, isCurrentAccount: { true }, download: {
            VersionedWorkspace(revision: 0, snapshot: empty)
        }, upload: { _, _ in uploaded = true; return VersionedWorkspace(revision: 1, snapshot: empty) }, apply: { _, _ in applied = true })
        XCTAssertTrue(applied); XCTAssertFalse(uploaded)
    }
}

final class DeadlineTrackingPolicyTests: XCTestCase {
    func testEligibilityAndEightHourBoundary() {
        let now = Date(timeIntervalSince1970: 1791964800)
        var record = WorkspaceRecord(kind: .deadline, title: "测试")
        record.dateOnly = false; record.dueDate = now.addingTimeInterval(8 * 3600)
        var state = WorkspaceState(records: [record])
        XCTAssertEqual(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now), record.dueDate)
        record.dueDate = now.addingTimeInterval(8 * 3600 + 1); state.records = [record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
        record.dueDate = now; state.records = [record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
        record.dueDate = nil; state.records = [record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
    }
    func testHiddenFinishedAndUnsupportedRecordsAreIneligible() {
        let now = Date()
        var project = WorkspaceRecord(kind: .project, title: "项目")
        var record = WorkspaceRecord(kind: .task, title: "行动")
        record.dateOnly = false; record.dueDate = now.addingTimeInterval(60); record.projectID = project.id
        var state = WorkspaceState(records: [project, record])
        XCTAssertNotNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
        project.archivedAt = now; state.records = [project, record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
        record.projectID = nil; record.status = "DONE"; state.records = [record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
        record.status = "TODO"; record.kind = .reminder; state.records = [record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
    }
    func testDateOnlyUsesRecordTimezoneAndRescheduleDoesNotExtendActivityLifetime() {
        let now = Date(timeIntervalSince1970: 1791964800)
        var record = WorkspaceRecord(kind: .deadline, title: "仅日期")
        record.timezone = "Asia/Shanghai"; record.dueDate = now
        var state = WorkspaceState(records: [record])
        XCTAssertEqual(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now), record.effectiveDueDate(now))
        record.dateOnly = false; record.dueDate = now.addingTimeInterval(3600); state.records = [record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now, startedAt: now.addingTimeInterval(-8 * 3600)))
    }
}

extension DeadlineTrackingPolicyTests {
    func testCancelledArchivedDeletedAndPastDeadlineCannotStart() {
        let now = Date()
        var record = WorkspaceRecord(kind: .deadline, title: "资格")
        record.dateOnly = false; record.dueDate = now.addingTimeInterval(60)
        for status in ["DONE", "CANCELLED"] {
            record.status = status
            XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: WorkspaceState(records: [record]), now: now))
        }
        record.status = "OPEN"; record.archivedAt = now
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: WorkspaceState(records: [record]), now: now))
        record.archivedAt = nil; record.deletedAt = now
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: WorkspaceState(records: [record]), now: now))
        record.deletedAt = nil; record.dueDate = now.addingTimeInterval(-1)
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: WorkspaceState(records: [record]), now: now))
    }
}
