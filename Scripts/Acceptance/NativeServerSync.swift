import Foundation
import Darwin

private struct AcceptanceFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw AcceptanceFailure(message: message) }
}
private struct WebAuthorizationResponse: Decodable {
    struct Payload: Decodable { let callbackURL: URL }
    let data: Payload
}

/// Uses the shipping HTTP transport and merge driver, without BackendService's Keychain or preferences.
@MainActor private final class TestDevice {
    let transport = URLSessionBackend()
    let origin: URL
    let token: String
    let id = UUID().uuidString
    var state: WorkspaceState
    var checkpoint: VersionedWorkspace?

    init(origin: URL, token: String, state: WorkspaceState) {
        self.origin = origin; self.token = token; self.state = state
    }
    func synchronize() async throws {
        try await WorkspaceSyncDriver.run(base: checkpoint?.snapshot, readLocal: { self.state },
            isCurrentAccount: { true },
            download: { try await self.transport.download(baseURL: self.origin, token: self.token) },
            upload: { state, revision in
                do {
                    return try await self.transport.upload(baseURL: self.origin, token: self.token,
                        snapshot: state, expectedRevision: revision, sourceDeviceID: self.id)
                } catch NativeBackendError.conflict { throw WorkspaceSyncError.revisionChanged }
            }, apply: { state, remote in self.state = state; self.checkpoint = remote })
    }
    func edit(_ id: UUID, title: String) throws {
        guard let index = state.records.firstIndex(where: { $0.id == id }) else {
            throw AcceptanceFailure(message: "Missing acceptance record")
        }
        state.records[index].title = title
        state.records[index].version += 1
        state.records[index].updatedAt = Date()
    }
}

@main struct NativeServerSyncAcceptance {
    static func main() async {
        do { try await run() }
        catch {
            // Do not print request bodies, tokens, credentials, or arbitrary server responses.
            FileHandle.standardError.write(Data("Native/server acceptance failed: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
    @MainActor private static func run() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let address = environment["GUANGYI_ACCEPTANCE_ORIGIN"], let origin = URL(string: address),
              origin.scheme == "http", origin.host == "127.0.0.1", origin.port != nil,
              origin.path.isEmpty, origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil,
              let password = environment["GUANGYI_ACCEPTANCE_PASSWORD"], password.count >= 32 else {
            throw AcceptanceFailure(message: "Only the isolated loopback fixture is allowed")
        }
        let transport = URLSessionBackend(), email = "native-acceptance@test.invalid"
        let browserSession = try await transport.signIn(baseURL: origin, email: email, password: password)
        let webLogin = WebLoginRequest()
        // Only this isolated HTTP fixture bypasses authorizationURL's HTTPS page requirement.
        var authorize = URLRequest(url: origin.appendingPathComponent("api/native/v1/web-auth/authorize"))
        authorize.httpMethod = "POST"; authorize.timeoutInterval = 45
        authorize.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize.setValue("Bearer \(browserSession.accessToken)", forHTTPHeaderField: "Authorization")
        authorize.httpBody = try JSONEncoder().encode(["codeChallenge": webLogin.codeChallenge, "state": webLogin.state])
        let browserConfiguration = URLSessionConfiguration.ephemeral
        browserConfiguration.httpShouldSetCookies = false
        let browser = URLSession(configuration: browserConfiguration)
        defer { browser.finishTasksAndInvalidate() }
        let (callbackBody, authorizationResponse) = try await browser.data(for: authorize)
        try require((authorizationResponse as? HTTPURLResponse)?.statusCode == 200, "Web authorization failed")
        let callback = try JSONDecoder().decode(WebAuthorizationResponse.self, from: callbackBody).data.callbackURL
        let code = try webLogin.authorizationCode(from: callback)
        let firstSession = try await transport.webLoginSession(baseURL: origin, code: code, codeVerifier: webLogin.codeVerifier)
        do {
            _ = try await transport.download(baseURL: origin, token: browserSession.accessToken)
            throw AcceptanceFailure(message: "Temporary browser session was not revoked")
        } catch NativeBackendError.authentication { }
        do {
            _ = try await transport.webLoginSession(baseURL: origin, code: code, codeVerifier: webLogin.codeVerifier)
            throw AcceptanceFailure(message: "Web authorization code was accepted twice")
        } catch NativeBackendError.authentication { }
        let secondSession = try await transport.signIn(baseURL: origin, email: email, password: password)
        try require(firstSession.account == email && secondSession.account == email, "Sessions are not account-scoped")
        try require(firstSession.accessToken != secondSession.accessToken, "Independent sessions must have independent tokens")
        let initial = try await transport.download(baseURL: origin, token: firstSession.accessToken)
        try require(initial.revision == 0 && initial.snapshot.records.isEmpty, "Fixture must start empty")
        let first = TestDevice(origin: origin, token: firstSession.accessToken, state: initial.snapshot)
        let second = TestDevice(origin: origin, token: secondSession.accessToken, state: initial.snapshot)

        let group = WorkspaceRecord(kind: .project, title: "验收行动组")
        var action = WorkspaceRecord(kind: .task, title: "Swift 创建的行动")
        action.projectID = group.id
        var deadline = WorkspaceRecord(kind: .deadline, title: "Swift 创建的日期型 DDL")
        deadline.dueDate = ISO8601DateFormatter().date(from: "2040-11-01T00:00:00Z")
        deadline.timezone = "America/New_York"; deadline.dateOnly = true
        first.state.records = [group, action, deadline]
        try await first.synchronize()
        try await second.synchronize()
        try require(second.state.records.count == 3 && second.checkpoint?.revision == 1, "Second session did not receive the Swift snapshot")
        let received = second.state.records.first { $0.id == deadline.id }
        try require(received?.dueDate == deadline.dueDate && received?.timezone == deadline.timezone && received?.dateOnly == true,
            "Date-only deadline changed during native/server encoding")
        try require(second.state.records.first { $0.id == action.id }?.projectID == group.id, "Parent linkage was lost")

        // Both devices work offline from the same baseline, then upload independently.
        try first.edit(action.id, title: "设备 A 离线修改")
        try second.edit(group.id, title: "设备 B 离线修改")
        let independent = WorkspaceRecord(kind: .task, title: "设备 B 独立新增")
        second.state.records.append(independent)
        try await second.synchronize()
        try await first.synchronize()
        try await second.synchronize()
        let expected = Set(["设备 A 离线修改", "设备 B 离线修改", deadline.title, independent.title])
        try require(Set(first.state.records.map(\.title)) == expected && Set(second.state.records.map(\.title)) == expected,
            "Two-way synchronization lost an independent edit")
        let beforeStaleUpload = try await transport.download(baseURL: origin, token: firstSession.accessToken)
        do {
            _ = try await transport.upload(baseURL: origin, token: secondSession.accessToken,
                snapshot: initial.snapshot, expectedRevision: 0, sourceDeviceID: second.id)
            throw AcceptanceFailure(message: "Server accepted a stale If-Match revision")
        } catch NativeBackendError.conflict { }
        let afterStaleUpload = try await transport.download(baseURL: origin, token: firstSession.accessToken)
        try require(afterStaleUpload.revision == beforeStaleUpload.revision && afterStaleUpload.snapshot.records.count == 4,
            "Rejected upload changed the server snapshot")

        try first.edit(action.id, title: "设备 A 冲突版本")
        try second.edit(action.id, title: "设备 B 冲突版本")
        try await second.synchronize()
        let preserved = try WorkspaceCoding.encoder().encode(first.state)
        do {
            try await first.synchronize()
            throw AcceptanceFailure(message: "Same-record conflict was silently accepted")
        } catch WorkspaceFailure.invalid(_) { }
        let afterConflict = try WorkspaceCoding.encoder().encode(first.state)
        try require(preserved == afterConflict, "Conflict changed the unreviewed local state")
        let conflictingRemote = try await transport.download(baseURL: origin, token: first.token)
        first.state = try WorkspaceSyncMerge.reconcile(base: first.checkpoint?.snapshot, local: first.state,
            remote: conflictingRemote.snapshot, resolution: .local)
        first.checkpoint = conflictingRemote
        try await first.synchronize()
        try await second.synchronize()
        try require(second.state.records.first { $0.id == action.id }?.title == "设备 A 冲突版本",
            "Explicit conflict resolution was not shared")
        try require(second.state.records.contains { $0.id == independent.id }, "Conflict resolution discarded an independent record")

        var recurring = WorkspaceRecord(kind: .task, title: "含调休的周期事项")
        recurring.dateOnly = false; recurring.notificationsEnabled = true; recurring.notificationLeadMinutes = 30
        recurring.scheduledAt = WorkspaceDates.parse("2026-10-16T09:00:00+08:00")
        recurring.dueDate = WorkspaceDates.parse("2026-10-16T17:00:00+08:00")
        recurring.remindAt = WorkspaceDates.parse("2026-10-15T20:00:00+08:00")
        first.state.records.append(recurring)
        try RecurrenceEngine.start(recurring.id, rule: RecurrenceRule(frequency: .workdays,
            until: WorkspaceDates.parse("2026-10-20")), in: &first.state, now: WorkspaceDates.parse("2026-10-16")!)
        var academic = WorkspaceRecord(kind: .task, title: "教学单周事项")
        academic.scheduledAt = recurring.scheduledAt
        first.state.records.append(academic)
        let academicRule = RecurrenceRule(frequency: .oddWeeks, weekdays: [5], until: WorkspaceDates.parse("2026-10-30"),
            weekOneStart: WorkspaceDates.parse("2026-09-07"))
        try RecurrenceEngine.start(academic.id, rule: academicRule, in: &first.state, now: WorkspaceDates.parse("2026-10-16")!)
        try await first.synchronize()
        try await second.synchronize()
        try require(second.state.series.count == 2 && second.state.series.contains { $0.rule == academicRule },
            "The API did not preserve academic week rules and their reference date")
        let expectedRecurring = first.state.records.filter { $0.recurrenceSeriesID != nil }
        let remoteRecurring = second.state.records.filter { $0.recurrenceSeriesID != nil }
        try require(Set(expectedRecurring.map(\.id)) == Set(remoteRecurring.map(\.id)) && remoteRecurring.count == 5,
            "The API changed recurrence identifiers or occurrence dates")
        let shifted = remoteRecurring.first { $0.title == recurring.title && $0.occurrenceDate == "2026-10-19" }
        try require(shifted?.scheduledAt == WorkspaceDates.parse("2026-10-19T09:00:00+08:00") &&
            shifted?.dueDate == WorkspaceDates.parse("2026-10-19T17:00:00+08:00") &&
            shifted?.notificationDate == WorkspaceDates.parse("2026-10-18T20:00:00+08:00"),
            "The native/API round trip lost a shifted planned, deadline or explicit reminder time")
        let workdaySeries = first.state.series.first { $0.rule.frequency == .workdays }!
        RecurrenceEngine.stop(workdaySeries.id, in: &first.state, now: WorkspaceDates.parse("2026-10-17")!)
        try await first.synchronize()
        try await second.synchronize()
        try require(second.state.records.filter { $0.recurrenceSeriesID == workdaySeries.id && ($0.occurrenceDate ?? "") > "2026-10-16" }
            .allSatisfy { $0.status == "CANCELLED" && $0.notificationDate == nil },
            "Stopping recurrence did not disable future reminders on the other session")
        let expectedFinalCount = first.state.records.count

        try await transport.signOut(baseURL: origin, token: first.token, deviceID: nil)
        do {
            _ = try await transport.download(baseURL: origin, token: first.token)
            throw AcceptanceFailure(message: "Revoked native session still has access")
        } catch NativeBackendError.authentication { }
        let final = try await transport.download(baseURL: origin, token: second.token)
        try require(final.snapshot.records.count == expectedFinalCount, "Revoking one session affected the other session's data")
        try await transport.signOut(baseURL: origin, token: second.token, deviceID: nil)

        let result: [String: Any] = ["status": "passed", "transport": "shipping URLSessionBackend",
            "server": "bundled Node API with in-memory SQLite", "sessions": 2, "finalRevision": final.revision,
            "checks": ["PKCE web login callback", "temporary browser session revocation", "authorization code replay rejection",
                "account-scoped login", "Swift/JSON date and relationship round trip", "two-way offline merge",
                "stale revision rejection without mutation", "same-record conflict preserves local state",
                "explicit conflict resolution", "independent record preservation", "session revocation isolation",
                "workday and academic recurrence rule round trip", "recurrence identifiers and all three shifted times",
                "remote recurrence stop disables future reminders"],
            "productionAccess": false, "keychainWrites": false, "physicalDeviceAccess": false]
        let bytes = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        FileHandle.standardOutput.write(bytes + Data("\n".utf8))
    }
}
