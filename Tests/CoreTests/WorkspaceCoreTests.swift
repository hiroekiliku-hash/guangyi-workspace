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
