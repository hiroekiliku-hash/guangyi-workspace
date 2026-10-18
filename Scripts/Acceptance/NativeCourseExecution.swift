import Foundation
import Darwin

private struct ExecutionAcceptanceFailure: Error { let code: String }
private func requireExecution(_ condition: @autoclosure () -> Bool, _ code: String) throws {
    if !condition() { throw ExecutionAcceptanceFailure(code: code) }
}
private struct ExecutionEnvelope<T: Decodable>: Decodable { let data: T }

/// Uses the shipping models, validation, result type and URLSessionBackend.
/// The fixture marker is required before transmitting even the disposable password.
@main struct NativeCourseExecutionAcceptance {
    static func main() async {
        do { try await run() }
        catch {
            let code = (error as? ExecutionAcceptanceFailure)?.code ?? "NATIVE_COURSE_EXECUTION_ACCEPTANCE_FAILED"
            let data = try? JSONSerialization.data(withJSONObject: ["ok": false, "error": code,
                "productionAccess": false, "keychainWrites": false], options: [.sortedKeys])
            FileHandle.standardOutput.write((data ?? Data("{\"ok\":false}".utf8)) + Data("\n".utf8))
            exit(1)
        }
    }

    @MainActor private static func run() async throws {
        let beginning = Date()
        let environment = ProcessInfo.processInfo.environment
        guard let address = environment["GUANGYI_ACCEPTANCE_ORIGIN"], let origin = URL(string: address),
              origin.scheme == "http", origin.host == "127.0.0.1", origin.port != nil,
              origin.path.isEmpty, origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil,
              let password = environment["GUANGYI_ACCEPTANCE_PASSWORD"], password.count >= 32 else {
            throw ExecutionAcceptanceFailure(code: "DISPOSABLE_LOOPBACK_FIXTURE_REQUIRED")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        let rawSession = URLSession(configuration: configuration)
        defer { rawSession.finishTasksAndInvalidate() }
        var healthRequest = URLRequest(url: origin.appendingPathComponent("health"))
        healthRequest.timeoutInterval = 10
        let (_, healthResponse) = try await rawSession.data(for: healthRequest)
        try requireExecution((healthResponse as? HTTPURLResponse)?.statusCode == 200 &&
            (healthResponse as? HTTPURLResponse)?.value(forHTTPHeaderField: "X-Workshop-Acceptance-Isolated") == "memory-course-execution-v1",
            "ISOLATED_MEMORY_FIXTURE_MARKER_MISSING")

        let transport = URLSessionBackend()
        let owner = try await transport.signIn(baseURL: origin, email: "native-course-execution@test.invalid", password: password)
        var checks = ["isolated memory fixture marker", "shipping password sign-in"]
        let pythonInteger = CourseBlock(type: .question, text: "填写整数 21。", questionType: .shortAnswer,
            input: CourseQuestionInput(kind: .integer, minLines: 2),
            execution: CourseExecutionConfiguration(language: "python", template: "n={{ANSWER}}\nprint(n*2)\n", expectedOutput: "42\n"))
        let pythonProgram = CourseBlock(type: .question, text: "从标准输入读取两个整数并输出和。", questionType: .shortAnswer,
            answerFormat: .code, input: CourseQuestionInput(kind: .code, language: "python", starterCode: "import sys\n", minLines: 3, maxLines: 12),
            execution: CourseExecutionConfiguration(language: "python", stdin: "12 30\n", expectedOutput: "42\n"))
        let cppInteger = CourseBlock(type: .question, text: "填写整数 21。", questionType: .shortAnswer,
            input: CourseQuestionInput(kind: .integer),
            execution: CourseExecutionConfiguration(language: "cpp", template: "#include <iostream>\nint main(){long long n={{ANSWER}};std::cout<<n*2<<\"\\n\";}\n", expectedOutput: "42\n"))
        let cppProgram = CourseBlock(type: .question, text: "输出两个输入整数的 GCD 与 LCM。", questionType: .shortAnswer,
            answerFormat: .code, input: CourseQuestionInput(kind: .code, language: "cpp", minLines: 3, maxLines: 12),
            execution: CourseExecutionConfiguration(language: "cpp", stdin: "24 36\n", expectedOutput: "12 72\n"))
        let decimal = CourseBlock(type: .question, text: "填写小数 +.5。", questionType: .shortAnswer,
            input: CourseQuestionInput(kind: .decimal),
            execution: CourseExecutionConfiguration(language: "python", template: "value={{ANSWER}}\nprint(value*2)\n", expectedOutput: "1.0\n"))
        let noExecution = CourseBlock(type: .question, text: "普通文字题不允许启动执行器。", questionType: .shortAnswer, acceptedAnswers: ["5"])
        let lesson = CourseLesson(title: "真实 Python 与 C++", blocks: [pythonInteger, pythonProgram, cppInteger, cppProgram, decimal, noExecution])
        var course = CourseDocument(title: "隔离运行验收", summary: "一次性内存数据", lessons: [lesson])
        try CourseValidation.validate(course)
        let publication = try await transport.publishCourse(baseURL: origin, token: owner.accessToken, workspaceID: nil,
            course: course, expectedRevision: nil, mutationID: UUID())
        try requireExecution(publication.revision == 1 && publication.id == course.id, "COURSE_PUBLICATION_FAILED")
        let edition = try await transport.courseEdition(baseURL: origin, token: owner.accessToken, workspaceID: nil, id: course.id)
        try requireExecution(edition.course == course, "COURSE_EXECUTION_CONFIGURATION_DID_NOT_ROUND_TRIP")
        checks.append("course publication and input/execution round-trip")

        for (block, good, bad) in [(pythonInteger, "-42", "4.2"), (decimal, "+.5", "1e3")] {
            try CourseValidation.validateAnswer(block: block, selected: [], text: good)
            do {
                try CourseValidation.validateAnswer(block: block, selected: [], text: bad)
                throw ExecutionAcceptanceFailure(code: "NATIVE_NUMERIC_VALIDATION_ACCEPTED_INVALID_INPUT")
            } catch let failure as ExecutionAcceptanceFailure { throw failure }
            catch { }
            do {
                _ = try await transport.runCourseAnswer(baseURL: origin, token: owner.accessToken, workspaceID: nil,
                    id: course.id, revision: 1, lessonID: lesson.id, blockID: block.id, text: bad, stdin: nil)
                throw ExecutionAcceptanceFailure(code: "SERVER_NUMERIC_VALIDATION_ACCEPTED_INVALID_INPUT")
            } catch NativeBackendError.status(422) { }
        }
        checks.append("integer and decimal validation in native model and server")

        let initial = try await transport.courseProgress(baseURL: origin, token: owner.accessToken, workspaceID: nil, id: course.id)
        try requireExecution(initial.answers.isEmpty && initial.completedLessonIDs.isEmpty, "INITIAL_PROGRESS_NOT_EMPTY")
        func run(_ block: CourseBlock, _ source: String, stdin: String? = nil, token: String? = nil,
                 workspaceID: String? = nil, revision: Int = 1) async throws -> CourseCodeRunResult {
            try await transport.runCourseAnswer(baseURL: origin, token: token ?? owner.accessToken, workspaceID: workspaceID,
                id: course.id, revision: revision, lessonID: lesson.id, blockID: block.id, text: source, stdin: stdin)
        }
        func completed(_ result: CourseCodeRunResult, output: String, grade: Bool?) throws {
            try requireExecution(result.status == "completed" && result.stdout == output && result.stderr.isEmpty && result.exitCode == 0,
                                 "REAL_CODE_RESULT_MISMATCH")
            try requireExecution(result.passed == grade, "OUTPUT_GRADE_MISMATCH")
        }
        try completed(await run(pythonInteger, "21"), output: "42\n", grade: true)
        try completed(await run(pythonInteger, "20"), output: "40\n", grade: false)
        checks.append("Python literal answer template and correct/incorrect output grade")
        let pythonSource = "import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n"
        try completed(await run(pythonProgram, pythonSource), output: "42\n", grade: true)
        try completed(await run(pythonProgram, pythonSource, stdin: "7 9\n"), output: "16\n", grade: nil)
        checks.append("Python complete program, default stdin and custom stdin without misleading grade")
        try completed(await run(cppInteger, "21"), output: "42\n", grade: true)
        let cppSource = "#include <bits/stdc++.h>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<std::gcd(a,b)<<\" \"<<std::lcm(a,b)<<\"\\n\";}\n"
        try completed(await run(cppProgram, cppSource), output: "12 72\n", grade: true)
        checks.append("C++ answer template and compiled bits/stdc++.h stdin program")
        try completed(await run(decimal, "+.5"), output: "1.0\n", grade: true)
        checks.append("decimal answer executes through its published template")
        let compileError = try await run(cppProgram, "int main( {")
        try requireExecution(compileError.status == "compileError" && !compileError.stderr.isEmpty && compileError.passed == nil,
                             "COMPILER_ERROR_NOT_TRANSPORTED")
        let runtimeError = try await run(pythonProgram, "raise ValueError('acceptance')\n")
        try requireExecution(runtimeError.status == "runtimeError" && runtimeError.stderr.contains("ValueError") && runtimeError.passed == nil,
                             "PYTHON_RUNTIME_ERROR_NOT_TRANSPORTED")
        checks.append("compiler and runtime diagnostics without output grade")

        let viewerEmail = "execution-viewer-\(UUID().uuidString.lowercased())@test.invalid"
        var registration = URLRequest(url: origin.appendingPathComponent("api/native/v1/accounts"))
        registration.httpMethod = "POST"; registration.timeoutInterval = 15
        registration.setValue("application/json", forHTTPHeaderField: "Content-Type")
        registration.httpBody = try JSONEncoder().encode(["email": viewerEmail, "password": password])
        let (registeredBody, registeredResponse) = try await rawSession.data(for: registration)
        try requireExecution((registeredResponse as? HTTPURLResponse)?.statusCode == 201, "DISPOSABLE_VIEWER_REGISTRATION_FAILED")
        let viewer = try ArchiveService.decoder().decode(ExecutionEnvelope<NativeSession>.self, from: registeredBody).data
        try await transport.changeLinkedAccountSharing(baseURL: origin, token: owner.accessToken, action: "invitations",
            values: ["email": viewerEmail, "role": "viewer"])
        let invitations = try await transport.linkedAccountSharing(baseURL: origin, token: viewer.accessToken)
        guard let invitation = invitations.incoming.first else { throw ExecutionAcceptanceFailure(code: "VIEWER_INVITATION_MISSING") }
        try await transport.changeLinkedAccountSharing(baseURL: origin, token: viewer.accessToken, action: "accept", values: ["id": invitation.id])
        let shared = try await transport.linkedAccountSharing(baseURL: origin, token: viewer.accessToken)
        try requireExecution(shared.workspaces.contains { $0.id == invitation.workspaceID && $0.role == "viewer" }, "VIEWER_SHARING_NOT_ACTIVE")
        let viewerBefore = try await transport.courseProgress(baseURL: origin, token: viewer.accessToken, workspaceID: invitation.workspaceID, id: course.id)
        try completed(await run(pythonInteger, "21", token: viewer.accessToken, workspaceID: invitation.workspaceID), output: "42\n", grade: true)
        do {
            _ = try await transport.publishCourse(baseURL: origin, token: viewer.accessToken, workspaceID: invitation.workspaceID,
                course: course, expectedRevision: 1, mutationID: UUID())
            throw ExecutionAcceptanceFailure(code: "READ_ONLY_VIEWER_MODIFIED_COURSE")
        } catch NativeBackendError.status(403) { }
        checks.append("read-only shared learner can run, cannot modify course")

        let ownerAfter = try await transport.courseProgress(baseURL: origin, token: owner.accessToken, workspaceID: nil, id: course.id)
        let viewerAfter = try await transport.courseProgress(baseURL: origin, token: viewer.accessToken, workspaceID: invitation.workspaceID, id: course.id)
        try requireExecution(ownerAfter == initial && viewerAfter == viewerBefore, "CODE_EXECUTION_CHANGED_LEARNING_PROGRESS")
        checks.append("running code writes no owner or shared learner answers/completion")
        do {
            _ = try await run(noExecution, "5")
            throw ExecutionAcceptanceFailure(code: "UNCONFIGURED_QUESTION_EXECUTED")
        } catch NativeBackendError.status(422) { }
        course.summary += " revision 2"
        let updated = try await transport.publishCourse(baseURL: origin, token: owner.accessToken, workspaceID: nil,
            course: course, expectedRevision: 1, mutationID: UUID())
        try requireExecution(updated.revision == 2, "REVISION_UPDATE_FAILED")
        do {
            _ = try await run(pythonInteger, "21", revision: 1)
            throw ExecutionAcceptanceFailure(code: "STALE_EDITION_EXECUTED")
        } catch is WorkspaceFailure { }
        checks.append("unconfigured question and stale course revision rejected")
        try await transport.signOut(baseURL: origin, token: owner.accessToken, deviceID: nil)
        do {
            _ = try await run(pythonInteger, "21", revision: 2)
            throw ExecutionAcceptanceFailure(code: "REVOKED_SESSION_EXECUTED")
        } catch NativeBackendError.authentication { }
        try await transport.signOut(baseURL: origin, token: viewer.accessToken, deviceID: nil)
        checks.append("revoked session cannot start execution")
        let report: [String: Any] = ["ok": true, "transport": "shipping URLSessionBackend.runCourseAnswer",
            "server": "shipping bundled Node API / isolated in-memory SQLite / real private runner", "checks": checks,
            "passed": checks.count, "realCodeRuns": 10, "languages": ["python", "cpp"],
            "elapsedMs": Int(Date().timeIntervalSince(beginning) * 1000), "productionAccess": false,
            "keychainWrites": false, "physicalDeviceAccess": false]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) + Data("\n".utf8))
    }
}
