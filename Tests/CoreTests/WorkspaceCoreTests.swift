import XCTest
#if SWIFT_PACKAGE
@testable import WorkspaceCore
#endif

final class WorkspaceCoreTests: XCTestCase {
    private func date(_ text: String) -> Date { WorkspaceDates.parse(text)! }
    func testWebLoginUsesRFC7636SHA256Challenge() throws {
        let request = try WebLoginRequest(state: String(repeating: "s", count: 43),
            codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        XCTAssertEqual(request.codeChallenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
    func testWebLoginCreatesFreshSecretsWithoutDisclosingVerifier() throws {
        let request = WebLoginRequest(), other = WebLoginRequest()
        for value in [request.state, request.codeVerifier, other.state, other.codeVerifier] {
            XCTAssertNotNil(value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression))
        }
        XCTAssertNotEqual(request.state, other.state)
        XCTAssertNotEqual(request.codeVerifier, other.codeVerifier)
        XCTAssertNotEqual(request.state, request.codeVerifier)
        for server in ["https://workspace.example", "https://workspace.example/"] {
            let url = try request.authorizationURL(server: XCTUnwrap(URL(string: server)))
            let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
            XCTAssertEqual(components.scheme, "https")
            XCTAssertEqual(components.host, "workspace.example")
            XCTAssertEqual(components.path, "/native-login")
            let query = try XCTUnwrap(components.queryItems)
            XCTAssertEqual(query.count, 3)
            XCTAssertEqual(query.first { $0.name == "code_challenge" }?.value, request.codeChallenge)
            XCTAssertEqual(query.first { $0.name == "code_challenge_method" }?.value, "S256")
            XCTAssertEqual(query.first { $0.name == "state" }?.value, request.state)
            XCTAssertFalse(url.absoluteString.contains(request.codeVerifier))
            XCTAssertFalse(query.contains { $0.name == "code_verifier" })
        }
    }
    func testWebLoginAcceptsBoundCallbackAndRejectsForgedCallbacks() throws {
        let state = String(repeating: "s", count: 43), code = String(repeating: "c", count: 43)
        let request = try WebLoginRequest(state: state, codeVerifier: String(repeating: "v", count: 43))
        let callback = "guangyi-workspace://auth/callback?code=\(code)&state=\(state)"
        XCTAssertEqual(try request.authorizationCode(from: XCTUnwrap(URL(string: callback))), code)
        XCTAssertEqual(try request.authorizationCode(from: XCTUnwrap(URL(string:
            "guangyi-workspace://auth/callback?state=\(state)&code=\(code)"))), code)
        let invalidCallbacks = [
            callback.replacingOccurrences(of: "guangyi-workspace:", with: "https:"),
            callback.replacingOccurrences(of: "://auth/", with: "://attacker/"),
            callback.replacingOccurrences(of: "/callback?", with: "/callback/extra?"),
            callback.replacingOccurrences(of: "://auth/", with: "://intruder@auth/"),
            callback.replacingOccurrences(of: "://auth/", with: "://auth:443/"),
            callback + "#fragment", callback + "&code=\(code)", callback + "&state=\(state)",
            callback + "&unexpected=value",
            callback.replacingOccurrences(of: "state=\(state)", with: "state=\(String(repeating: "t", count: 43))"),
            callback.replacingOccurrences(of: "&state=\(state)", with: ""),
            callback.replacingOccurrences(of: "code=\(code)", with: "code=short"),
            callback.replacingOccurrences(of: "code=\(code)", with: "code=\(String(repeating: "c", count: 42))%2B")
        ]
        for callback in invalidCallbacks {
            XCTAssertThrowsError(try request.authorizationCode(from: XCTUnwrap(URL(string: callback))), callback)
        }
    }
    func testWebLoginRejectsMalformedInputsAndUnsafeServerURLs() throws {
        let state = String(repeating: "s", count: 43), verifier = String(repeating: "v", count: 43)
        for invalidState in ["", String(repeating: "s", count: 42), String(repeating: "s", count: 44),
                             String(repeating: "s", count: 42) + "+"] {
            XCTAssertThrowsError(try WebLoginRequest(state: invalidState, codeVerifier: verifier))
        }
        for invalidVerifier in ["", String(repeating: "v", count: 42), String(repeating: "v", count: 129),
                                String(repeating: "v", count: 42) + "+"] {
            XCTAssertThrowsError(try WebLoginRequest(state: state, codeVerifier: invalidVerifier))
        }
        XCTAssertNoThrow(try WebLoginRequest(state: state, codeVerifier: String(repeating: "v", count: 124) + "._~-"))
        let request = try WebLoginRequest(state: state, codeVerifier: verifier)
        for server in ["http://workspace.example", "file:///tmp/workspace", "https://user:secret@workspace.example",
                       "https://workspace.example/path", "https://workspace.example?query=value",
                       "https://workspace.example#fragment"] {
            XCTAssertThrowsError(try request.authorizationURL(server: XCTUnwrap(URL(string: server))), server)
        }
    }
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
    func testUnifiedActionsSortAcrossKindsByImportance() {
        let now = date("2026-10-15T12:00:00Z")
        var task = WorkspaceRecord(kind: .task, title: "普通行动")
        task.updatedAt = now.addingTimeInterval(20)
        var project = WorkspaceRecord(kind: .project, title: "行动组")
        project.updatedAt = now.addingTimeInterval(30)
        var reminder = WorkspaceRecord(kind: .reminder, title: "有时间的提醒")
        reminder.remindAt = now.addingTimeInterval(3_600)
        var milestone = WorkspaceRecord(kind: .milestone, title: "置顶里程碑")
        milestone.pinned = true
        var completed = WorkspaceRecord(kind: .task, title: "已完成行动")
        completed.status = "DONE"; completed.updatedAt = now.addingTimeInterval(60)
        var deadline = WorkspaceRecord(kind: .deadline, title: "不属于行动入口")
        deadline.dueDate = now.addingTimeInterval(1_800)
        let sorted = WorkspaceLogic.actionRecords(in: WorkspaceState(records: [task, project, reminder, milestone, completed, deadline]))
        XCTAssertEqual(sorted.map(\.title), ["置顶里程碑", "有时间的提醒", "普通行动", "已完成行动"])
    }
    func testUnifiedGroupsAndItemsRetainLegacyRelationships() throws {
        let area = WorkspaceRecord(kind: .area, title: "学习")
        var project = WorkspaceRecord(kind: .project, title: "课程报告")
        project.areaID = area.id
        var task = WorkspaceRecord(kind: .task, title: "写正文"); task.projectID = project.id
        var reminder = WorkspaceRecord(kind: .reminder, title: "查通知"); reminder.areaID = area.id
        var milestone = WorkspaceRecord(kind: .milestone, title: "完成初稿"); milestone.projectID = project.id
        let state = WorkspaceState(records: [area, project, task, reminder, milestone])
        try WorkspaceLogic.validate(state)
        XCTAssertEqual(Set(WorkspaceLogic.projectGroupRecords(in: state).map(\.id)), [area.id, project.id])
        XCTAssertEqual(Set(WorkspaceLogic.actionRecords(in: state).map(\.id)), [task.id, reminder.id, milestone.id])
        XCTAssertEqual(Set(WorkspaceLogic.members(of: area, in: state).map(\.id)), [project.id, reminder.id])
        XCTAssertEqual(Set(WorkspaceLogic.members(of: project, in: state).map(\.id)), [task.id, milestone.id])
        XCTAssertFalse(milestone.isKeyItem)
    }
    func testArchivedGroupHidesNestedGroupsAndItems() {
        var area = WorkspaceRecord(kind: .area, title: "学习")
        area.archivedAt = Date()
        var group = WorkspaceRecord(kind: .project, title: "报告"); group.areaID = area.id
        var item = WorkspaceRecord(kind: .task, title: "正文"); item.projectID = group.id
        var state = WorkspaceState(records: [area, group, item])
        XCTAssertTrue(WorkspaceLogic.projectGroupRecords(in: state).isEmpty)
        XCTAssertTrue(WorkspaceLogic.actionRecords(in: state).isEmpty)
        state.records[0].archivedAt = nil
        XCTAssertEqual(WorkspaceLogic.projectGroupRecords(in: state).count, 2)
        XCTAssertEqual(WorkspaceLogic.actionRecords(in: state).map(\.id), [item.id])
    }
    func testManualItemStarsSurviveSnapshotRoundTrip() throws {
        var records = [ItemKind.task, .reminder, .milestone].map { WorkspaceRecord(kind: $0, title: "事项") }
        XCTAssertTrue(records.allSatisfy { !$0.isKeyItem })
        records[1].pinned = true
        let data = try WorkspaceCoding.encoder().encode(WorkspaceState(records: records))
        let decoded = try WorkspaceCoding.decoder().decode(WorkspaceState.self, from: data)
        XCTAssertEqual(decoded.records.map(\.id), records.map(\.id))
        XCTAssertEqual(decoded.records.map(\.kind), records.map(\.kind))
        XCTAssertEqual(decoded.records.map(\.isKeyItem), [false, true, false])
    }
    func testMergedItemsUseExplicitReminderBeforeTheirDeadline() {
        for kind in [ItemKind.task, .reminder, .milestone] {
            var item = WorkspaceRecord(kind: kind, title: "事项")
            item.notificationsEnabled = true; item.dateOnly = false
            item.dueDate = date("2026-10-16T12:00:00Z")
            item.remindAt = date("2026-10-16T10:00:00Z")
            XCTAssertEqual(item.notificationDate, item.remindAt)
        }
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

extension WorkspaceCoreTests {
    private func countdownDeadline(_ title: String, _ stamp: String, id: UUID = UUID()) -> WorkspaceRecord {
        var record = WorkspaceRecord(kind: .deadline, title: title, id: id)
        record.dateOnly = false; record.dueDate = date(stamp)
        return record
    }

    func testCountdownGroupsMergeTodayAndFutureCalendarDays() {
        let todayEarly = countdownDeadline("今日上午", "2026-10-16T08:00:00+08:00")
        let todayLate = countdownDeadline("今日晚上", "2026-10-16T23:00:00+08:00")
        let tomorrowEarly = countdownDeadline("明日中午", "2026-10-17T12:00:00+08:00")
        let tomorrowLate = countdownDeadline("明日晚上", "2026-10-17T22:00:00+08:00")
        let now = date("2026-10-16T12:00:00+08:00")
        let groups = WorkspaceLogic.deadlineCountdownGroups(
            [tomorrowLate, todayLate, tomorrowEarly, todayEarly], now: now)

        XCTAssertEqual(groups.map { $0.records.map(\.id) },
            [[todayEarly.id, todayLate.id], [tomorrowEarly.id, tomorrowLate.id]])
        XCTAssertEqual(groups.first?.countdownDate(at: now), todayLate.dueDate)
    }

    func testCountdownGroupsBoundPastClustersToFirstDeadlineIncludingOneHour() {
        let first = countdownDeadline("起点", "2026-10-15T08:00:00+08:00")
        let boundary = countdownDeadline("一小时整", "2026-10-15T09:00:00+08:00")
        let outside = countdownDeadline("超过一秒", "2026-10-15T09:00:01+08:00")
        let neighbor = countdownDeadline("后续近邻", "2026-10-15T09:40:00+08:00")
        let groups = WorkspaceLogic.deadlineCountdownGroups([neighbor, boundary, outside, first],
            now: date("2026-10-16T12:00:00+08:00"))

        XCTAssertEqual(groups.map { $0.records.map(\.id) },
            [[first.id, boundary.id], [outside.id, neighbor.id]])
        XCTAssertEqual(groups.first?.dueDates, [first.dueDate!, boundary.dueDate!])
    }

    func testCountdownGroupsMergeAcrossMidnightOnlyWhenWholeDayFits() {
        let beforeMidnight = countdownDeadline("昨日深夜", "2026-10-15T23:40:00+08:00")
        let afterMidnight = countdownDeadline("今日凌晨", "2026-10-16T00:10:00+08:00")
        let tonight = countdownDeadline("今日晚上", "2026-10-16T23:00:00+08:00")
        let now = date("2026-10-16T12:00:00+08:00")
        let nearGroups = WorkspaceLogic.deadlineCountdownGroups([afterMidnight, beforeMidnight], now: now)
        XCTAssertEqual(nearGroups.map { $0.records.map(\.id) }, [[beforeMidnight.id, afterMidnight.id]])

        let wholeDayGroups = WorkspaceLogic.deadlineCountdownGroups([tonight, afterMidnight, beforeMidnight], now: now)
        XCTAssertEqual(wholeDayGroups.map { $0.records.map(\.id) },
            [[beforeMidnight.id], [afterMidnight.id, tonight.id]])
    }

    func testCountdownGroupAdvancesAndUsesLastDeadlineWhenAllArePast() throws {
        let first = countdownDeadline("第一项", "2026-10-16T10:00:00+08:00")
        let second = countdownDeadline("第二项", "2026-10-16T11:00:00+08:00")
        let last = countdownDeadline("第三项", "2026-10-16T12:00:00+08:00")
        let records = [last, first, second]
        let group = try XCTUnwrap(WorkspaceLogic.deadlineCountdownGroups(records,
            now: date("2026-10-16T09:00:00+08:00")).first)

        XCTAssertEqual(group.countdownDate(at: date("2026-10-16T09:00:00+08:00")), first.dueDate)
        XCTAssertEqual(group.countdownDate(at: date("2026-10-16T10:30:00+08:00")), second.dueDate)
        XCTAssertEqual(group.countdownDate(at: date("2026-10-16T11:30:00+08:00")), last.dueDate)
        XCTAssertEqual(group.countdownDate(at: date("2026-10-16T13:00:00+08:00")), last.dueDate)
        let reordered = try XCTUnwrap(WorkspaceLogic.deadlineCountdownGroups(Array(records.reversed()),
            now: date("2026-10-16T13:00:00+08:00")).first)
        XCTAssertEqual(group.id, reordered.id)
    }

    func testCountdownGroupsFilterAndSortEffectiveDateOnlyDeadlines() throws {
        let now = date("2026-10-16T12:00:00+08:00")
        var dateOnly = countdownDeadline("当日截止", "2026-10-16T00:00:00+08:00",
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
        dateOnly.dateOnly = true
        let exact = countdownDeadline("同刻截止", "2026-10-16T23:59:59+08:00",
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
        var task = countdownDeadline("非 DDL", "2026-10-16T13:00:00+08:00"); task.kind = .task
        var done = countdownDeadline("已完成", "2026-10-16T13:00:00+08:00"); done.status = "DONE"
        var cancelled = countdownDeadline("已取消", "2026-10-16T13:00:00+08:00"); cancelled.status = "CANCELLED"
        var archived = countdownDeadline("已归档", "2026-10-16T13:00:00+08:00"); archived.archivedAt = now
        var deleted = countdownDeadline("已删除", "2026-10-16T13:00:00+08:00"); deleted.deletedAt = now
        let undated = WorkspaceRecord(kind: .deadline, title: "未设日期")
        let groups = WorkspaceLogic.deadlineCountdownGroups(
            [dateOnly, task, done, cancelled, archived, deleted, undated, exact], now: now)
        let group = try XCTUnwrap(groups.first)

        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(group.records.map(\.id), [exact.id, dateOnly.id])
        XCTAssertEqual(group.dueDates.first, dateOnly.effectiveDueDate(dateOnly.dueDate!))
        XCTAssertEqual(group.countdownDate(at: now), exact.dueDate)
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
        record.status = "OPEN"; record.kind = .knowledge; state.records = [record]
        XCTAssertNil(DeadlineTrackingPolicy.dueDate(for: record, in: state, now: now))
    }
    func testAllMergedItemKindsCanTrackTheirDeadline() {
        let now = Date()
        for kind in [ItemKind.task, .reminder, .milestone] {
            var item = WorkspaceRecord(kind: kind, title: "事项")
            item.dateOnly = false; item.dueDate = now.addingTimeInterval(300)
            XCTAssertEqual(DeadlineTrackingPolicy.dueDate(for: item, in: WorkspaceState(records: [item]), now: now), item.dueDate)
        }
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

extension WorkspaceSyncMergeTests {
    func testReviewResolutionOnlySelectsConflictsAndKeepsNonconflictingEdits() throws {
        let a = WorkspaceRecord(kind: .task, title: "冲突原始")
        let b = WorkspaceRecord(kind: .task, title: "另一记录")
        let c = WorkspaceRecord(kind: .task, title: "服务器删除")
        let base = WorkspaceState(records: [a,b,c])
        var local = base, remote = base
        local.records[0].title = "本机冲突"
        remote.records[0].title = "服务器冲突"
        remote.records[1].title = "服务器独有改动"
        remote.records.removeAll { $0.id == c.id }
        local.records.append(WorkspaceRecord(kind: .task, title: "本机新增"))
        let keepLocal = try WorkspaceSyncMerge.reconcile(base: base, local: local, remote: remote, resolution: .local)
        XCTAssertEqual(Set(keepLocal.records.map(\.title)), ["本机冲突","服务器独有改动","本机新增"])
        let keepRemote = try WorkspaceSyncMerge.reconcile(base: base, local: local, remote: remote, resolution: .remote)
        XCTAssertEqual(Set(keepRemote.records.map(\.title)), ["服务器冲突","服务器独有改动","本机新增"])
    }
}

extension WorkspaceCoreTests {
    func testNewDeadlineReminderIsEnabledAndStopsAfterCompletion() {
        var record = WorkspaceRecord(kind: .deadline, title: "DDL")
        record.dateOnly = false; record.dueDate = date("2040-10-14T12:00:00+08:00")
        record.notificationLeadMinutes = 30
        XCTAssertTrue(record.notificationsEnabled)
        XCTAssertEqual(record.notificationDate, record.dueDate?.addingTimeInterval(-1800))
        record.status = "DONE"
        XCTAssertNil(record.notificationDate)
        record.status = "CANCELLED"
        XCTAssertNil(record.notificationDate)
    }
    func testNotificationActionsRejectStaleDisabledAndRescheduledAlerts() {
        var record = WorkspaceRecord(kind: .deadline, title: "DDL")
        record.dateOnly = false; record.dueDate = date("2040-10-14T12:00:00+08:00")
        record.notificationLeadMinutes = 30
        let scheduled = record.notificationDate!.timeIntervalSince1970 * 1000
        XCTAssertTrue(WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: scheduled))
        XCTAssertTrue(WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: scheduled + 500))
        record.dueDate = record.dueDate!.addingTimeInterval(3600)
        XCTAssertFalse(WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: scheduled))
        record.dueDate = date("2040-10-14T12:00:00+08:00"); record.notificationsEnabled = false
        XCTAssertFalse(WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: scheduled))
        record.notificationsEnabled = true; record.status = "DONE"
        XCTAssertFalse(WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: scheduled))
        XCTAssertFalse(WorkspaceNotificationPolicy.isCurrentAction(for: record, scheduledAtMilliseconds: nil))
    }
}

extension WorkspaceCoreTests {
    func testItemRepeatsWithoutRequiringADeadline() throws {
        var item = WorkspaceRecord(kind: .task, title: "每天读书")
        item.scheduledAt = date("2026-10-16T19:00:00+08:00")
        var state = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .daily, until: date("2026-10-18")),
            in: &state, now: date("2026-10-16"))
        XCTAssertEqual(state.records.count, 3)
        XCTAssertTrue(state.records.allSatisfy { $0.status == "TODO" && $0.dueDate == nil })
        XCTAssertEqual(state.records.compactMap(\.occurrenceDate).sorted(), ["2026-10-16", "2026-10-17", "2026-10-18"])
        try WorkspaceLogic.validate(state)
    }
    func testAllItemKindsGenerateValidInitialStates() throws {
        for kind in [ItemKind.task, .milestone, .reminder] {
            var item = WorkspaceRecord(kind: kind, title: "重复事项")
            item.remindAt = date("2026-10-16T09:00:00+08:00")
            var state = WorkspaceState(records: [item])
            try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .daily, until: date("2026-10-17")),
                in: &state, now: date("2026-10-16"))
            XCTAssertEqual(state.records.count, 2)
            XCTAssertTrue(state.records.allSatisfy { $0.status == kind.states.first })
            try WorkspaceLogic.validate(state)
        }
    }
    func testRepeatingItemShiftsAllThreeTimesAcrossDST() throws {
        var item = WorkspaceRecord(kind: .task, title: "上午实验")
        item.timezone = "America/New_York"; item.dateOnly = false
        item.scheduledAt = date("2026-03-07T09:00:00-05:00")
        item.dueDate = date("2026-03-08T17:00:00-04:00")
        item.remindAt = date("2026-03-06T20:00:00-05:00")
        item.notificationsEnabled = true; item.notificationLeadMinutes = 30
        item.snoozedUntil = date("2026-03-07T10:00:00-05:00")
        var state = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .daily, until: date("2026-03-09T12:00:00Z")),
            in: &state, now: date("2026-03-07T00:00:00-05:00"))
        let next = try XCTUnwrap(state.records.first { $0.occurrenceDate == "2026-03-08" })
        XCTAssertEqual(next.scheduledAt, date("2026-03-08T09:00:00-04:00"))
        XCTAssertEqual(next.dueDate, date("2026-03-09T17:00:00-04:00"))
        XCTAssertEqual(next.remindAt, date("2026-03-07T20:00:00-05:00"))
        XCTAssertEqual(next.notificationDate, next.remindAt)
        XCTAssertNil(next.snoozedUntil)
        try WorkspaceLogic.validate(state)
    }
    func testCustomReminderIsExactAndRelativeReminderHasVisiblePrecedence() {
        var item = WorkspaceRecord(kind: .task, title: "分清三个时间")
        item.notificationsEnabled = true; item.dateOnly = false; item.notificationLeadMinutes = 15
        item.scheduledAt = date("2026-10-16T09:00:00+08:00")
        XCTAssertEqual(item.notificationDate, date("2026-10-16T08:45:00+08:00"))
        item.dueDate = date("2026-10-16T18:00:00+08:00")
        XCTAssertEqual(item.notificationDate, date("2026-10-16T17:45:00+08:00"))
        item.remindAt = date("2026-10-16T10:00:00+08:00")
        XCTAssertEqual(item.notificationDate, item.remindAt)
        item.status = "DONE"
        XCTAssertNil(item.notificationDate)
    }
    func testOddAndEvenWeeksContinueAcrossNewYearFromAcademicReference() {
        let start = date("2026-12-28")
        let odd = RecurrenceRule(frequency: .oddWeeks, weekdays: [1], weekOneStart: date("2026-12-21"))
        let even = RecurrenceRule(frequency: .evenWeeks, weekdays: [1], weekOneStart: date("2026-12-21"))
        func keys(_ rule: RecurrenceRule) -> [String] {
            RecurrenceEngine.dates(anchor: start, rule: rule, from: start, through: date("2027-01-18"), timezone: "Asia/Shanghai")
                .map { WorkspaceDates.dayKey($0, timezone: "Asia/Shanghai") }
        }
        XCTAssertEqual(keys(odd), ["2027-01-04", "2027-01-18"])
        XCTAssertEqual(keys(even), ["2026-12-28", "2027-01-11"])
    }
    func testChinaWorkdaysSkipSpringFestivalAndIncludeMakeupSaturdays() {
        let days = RecurrenceEngine.dates(anchor: date("2026-02-13"), rule: RecurrenceRule(frequency: .workdays),
            from: date("2026-02-13"), through: date("2026-03-02"), timezone: "Asia/Shanghai")
        XCTAssertEqual(days.map { WorkspaceDates.dayKey($0, timezone: "Asia/Shanghai") },
            ["2026-02-13", "2026-02-14", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", "2026-03-02"])
    }
    func testChinaCalendarCoversOfficialMakeupDaysAndRejectsUnknownYears() {
        let calendar = WorkspaceDates.calendar()
        for key in ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10", "2025-09-28"] {
            XCTAssertEqual(ChinaWorkCalendar.isWorkday(date(key), calendar: calendar), true, key)
        }
        for key in ["2026-01-01", "2026-01-02", "2026-02-16", "2026-04-06", "2026-05-04", "2026-06-19", "2026-09-25", "2026-10-07", "2025-10-08"] {
            XCTAssertEqual(ChinaWorkCalendar.isWorkday(date(key), calendar: calendar), false, key)
        }
        XCTAssertNil(ChinaWorkCalendar.isWorkday(date("2027-01-04"), calendar: calendar))
        let ordinary = RecurrenceEngine.dates(anchor: date("2026-10-01"), rule: RecurrenceRule(frequency: .weekdays),
            from: date("2026-10-01"), through: date("2026-10-04"), timezone: "Asia/Shanghai")
        XCTAssertEqual(ordinary.count, 2)
    }
    func testWorkdayGenerationKeepsUnverifiedFutureYearsResumable() throws {
        var item = WorkspaceRecord(kind: .task, title: "工作日签到")
        item.scheduledAt = date("2026-12-30T09:00:00+08:00")
        var state = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .workdays), in: &state, now: date("2026-12-30"))
        XCTAssertEqual(state.records.compactMap(\.occurrenceDate).sorted(), ["2026-12-30", "2026-12-31"])
        XCTAssertEqual(state.series[0].generatedThrough, date("2026-12-31"))
        let before = state
        RecurrenceEngine.materialize(&state, now: date("2027-01-04"))
        XCTAssertEqual(state, before)
    }
    func testHolidayFirstItemIsPreservedAsAnException() throws {
        var item = WorkspaceRecord(kind: .task, title: "保留手动首次日期")
        item.scheduledAt = date("2026-10-01T09:00:00+08:00")
        var state = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .workdays, until: date("2026-10-11")),
            in: &state, now: date("2026-10-01"))
        XCTAssertEqual(state.records.compactMap(\.occurrenceDate).sorted(), ["2026-10-01", "2026-10-08", "2026-10-09", "2026-10-10"])
        XCTAssertTrue(try XCTUnwrap(state.records.first { $0.id == item.id }).isException)
    }
    func testStopRepetitionPreservesPastAndCompletedItemsAndDisablesFutureReminders() throws {
        var item = WorkspaceRecord(kind: .task, title: "停止重复")
        item.scheduledAt = date("2026-10-16T09:00:00+08:00"); item.notificationsEnabled = true
        var state = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .daily, until: date("2026-10-18")),
            in: &state, now: date("2026-10-15"))
        let completed = try XCTUnwrap(state.records.firstIndex { $0.occurrenceDate == "2026-10-18" })
        state.records[completed].status = "DONE"
        let seriesID = state.series[0].id
        RecurrenceEngine.stop(seriesID, in: &state, now: date("2026-10-16T10:00:00+08:00"))
        XCTAssertEqual(state.records.first { $0.id == item.id }?.status, "TODO")
        let cancelled = try XCTUnwrap(state.records.first { $0.occurrenceDate == "2026-10-17" })
        XCTAssertEqual(cancelled.status, "CANCELLED"); XCTAssertNil(cancelled.notificationDate)
        XCTAssertEqual(state.records[completed].status, "DONE")
        let count = state.records.count
        RecurrenceEngine.materialize(&state, now: date("2026-10-20"))
        XCTAssertEqual(state.records.count, count)
        try WorkspaceLogic.validate(state)
    }
    func testLegacyReminderStopArchivesFutureInstancesWithSupportedStatus() throws {
        var item = WorkspaceRecord(kind: .reminder, title: "旧提醒")
        item.remindAt = date("2026-10-16T09:00:00+08:00")
        var state = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .daily, until: date("2026-10-17")),
            in: &state, now: date("2026-10-15"))
        RecurrenceEngine.stop(state.series[0].id, in: &state, now: date("2026-10-16T10:00:00+08:00"))
        let future = try XCTUnwrap(state.records.first { $0.occurrenceDate == "2026-10-17" })
        XCTAssertNotNil(future.archivedAt); XCTAssertNil(future.notificationDate)
        try WorkspaceLogic.validate(state)
    }
    func testOfflineGenerationUsesStableIdentifiersAndMergesCacheProgress() throws {
        var item = WorkspaceRecord(kind: .task, title: "两设备重复")
        item.scheduledAt = date("2026-10-16T09:00:00+08:00")
        var base = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .daily), in: &base, now: date("2026-10-16"))
        var first = base, second = base
        RecurrenceEngine.materialize(&first, now: date("2026-10-17"))
        RecurrenceEngine.materialize(&second, now: date("2026-10-18"))
        let sharedDay = try XCTUnwrap(first.records.first { $0.occurrenceDate == "2029-10-17" })
        XCTAssertEqual(sharedDay, second.records.first { $0.occurrenceDate == "2029-10-17" })
        let merged = try WorkspaceSyncMerge.reconcile(base: base, local: first, remote: second)
        XCTAssertEqual(merged.records.filter { $0.occurrenceDate == "2029-10-17" }.count, 1)
        XCTAssertEqual(merged.series[0].generatedThrough, second.series[0].generatedThrough)
    }
    func testInvalidRecurrenceDoesNotPartiallyMutateState() {
        var item = WorkspaceRecord(kind: .task, title: "未覆盖年份")
        item.scheduledAt = date("2027-01-04T09:00:00+08:00")
        var state = WorkspaceState(records: [item]); let before = state
        XCTAssertThrowsError(try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .workdays), in: &state))
        XCTAssertEqual(state, before)
        let futureReference = RecurrenceRule(frequency: .oddWeeks, weekOneStart: date("2027-02-01"))
        XCTAssertNotNil(RecurrenceEngine.validationError(record: item, rule: futureReference))
    }
    func testRemoteStopClosesFutureInstancesGeneratedWhileOtherDeviceWasOffline() throws {
        var item = WorkspaceRecord(kind: .task, title: "离线期间停止重复")
        item.scheduledAt = date("2026-10-16T09:00:00+08:00"); item.notificationsEnabled = true
        var base = WorkspaceState(records: [item])
        try RecurrenceEngine.start(item.id, rule: RecurrenceRule(frequency: .daily), in: &base, now: date("2026-10-16"))
        var local = base, remote = base
        RecurrenceEngine.materialize(&local, now: date("2026-10-17"))
        RecurrenceEngine.stop(remote.series[0].id, in: &remote, now: date("2026-10-17"))
        let merged = try WorkspaceSyncMerge.reconcile(base: base, local: local, remote: remote)
        let extra = try XCTUnwrap(merged.records.first { $0.occurrenceDate == "2029-10-17" })
        XCTAssertEqual(extra.status, "CANCELLED"); XCTAssertNil(extra.notificationDate)
        XCTAssertEqual(merged.records.first { $0.id == item.id }?.status, "TODO")
    }
    func testOldRulesDecodeAndNewRulesRoundTrip() throws {
        let old = try WorkspaceCoding.decoder().decode(RecurrenceRule.self, from: Data(#"{"frequency":"WEEKLY","interval":2,"weekdays":[1,3]}"#.utf8))
        XCTAssertEqual(old.interval, 2); XCTAssertNil(old.weekOneStart)
        let rule = RecurrenceRule(frequency: .evenWeeks, weekdays: [2, 4], until: date("2027-01-20"), weekOneStart: date("2026-09-07"))
        let restored = try WorkspaceCoding.decoder().decode(RecurrenceRule.self, from: WorkspaceCoding.encoder().encode(rule))
        XCTAssertEqual(restored, rule)
    }
}
