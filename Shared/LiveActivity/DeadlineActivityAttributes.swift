#if os(iOS)
import ActivityKit
import Foundation

struct DeadlineActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var title: String
        var dueDate: Date
    }
    var recordID: UUID
    var startedAt: Date
}
#endif
