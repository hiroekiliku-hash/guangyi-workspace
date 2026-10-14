import XCTest
import Foundation

final class ArchiveAndPersistenceTests: XCTestCase {
    func testEncryptedBackupAuthenticatesAndRejectsWrongPassword() throws {
        let state = WorkspaceState(records: [WorkspaceRecord(kind: .knowledge, title: "私有笔记")])
        let bytes = try ArchiveService.encode(state, password: "测试归档密码123")
        XCTAssertTrue(bytes.starts(with: Data("GWNA1".utf8)))
        let restored = try ArchiveService.decode(bytes, password: "测试归档密码123")
        XCTAssertTrue(WorkspaceCoding.equivalent(restored.records[0], state.records[0]))
        XCTAssertEqual(restored.profile, state.profile)
        XCTAssertThrowsError(try ArchiveService.decode(bytes, password: "wrong password"))
        var damaged = bytes; damaged[damaged.count - 1] ^= 1
        XCTAssertThrowsError(try ArchiveService.decode(damaged, password: "测试归档密码123"))
        XCTAssertThrowsError(try ArchiveService.decode(bytes.dropLast(8), password: "测试归档密码123"))
    }
    @MainActor func testSwiftDataRoundTripWithoutProductionStorage() throws {
        let repository = try SwiftDataRepository(inMemory: true)
        let state = WorkspaceState(records: [WorkspaceRecord(kind: .project, title: "本机项目")])
        try repository.save(state)
        XCTAssertEqual(try repository.load(), state)
    }
}
