import Foundation

enum ItemKind: String, Codable, CaseIterable, Identifiable {
    case area = "AREA", project = "PROJECT", milestone = "MILESTONE"
    case task = "TASK", deadline = "DEADLINE", reminder = "REMINDER", knowledge = "KNOWLEDGE"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .area, .project: "项目组"
        case .milestone, .task, .reminder: "事项"
        case .deadline: "截止事项"
        case .knowledge: "知识笔记"
        }
    }
    // Preserve wire values for existing archives and clients; expose one category in the UI.
    var isProjectGroup: Bool { self == .area || self == .project }
    var isItem: Bool { [.task, .reminder, .milestone].contains(self) }
    var creationKind: ItemKind { isProjectGroup ? .project : isItem ? .task : self }
    var symbol: String {
        switch self {
        case .area, .project: "folder"
        case .milestone, .task, .reminder: "checkmark.circle"
        case .deadline: "hourglass"
        case .knowledge: "book.closed"
        }
    }
    var states: [String] {
        switch self {
        case .project: ["PLANNED", "ACTIVE", "WAITING", "PAUSED", "COMPLETED"]
        case .task: ["TODO", "IN_PROGRESS", "WAITING", "DONE", "CANCELLED"]
        case .milestone: ["PLANNED", "ACTIVE", "DONE", "CANCELLED"]
        case .deadline: ["OPEN", "DONE", "CANCELLED"]
        case .reminder: ["OPEN", "DONE"]
        default: ["OPEN"]
        }
    }
}

enum StateLabels {
    static func title(_ status: String) -> String {
        ["PLANNED": "计划中", "ACTIVE": "进行中", "WAITING": "等待中", "PAUSED": "已暂停",
         "COMPLETED": "已完成", "TODO": "待处理", "IN_PROGRESS": "进行中", "DONE": "已完成",
         "CANCELLED": "已取消", "OPEN": "待处理"][status] ?? status
    }
}

struct WorkspaceRecord: Identifiable, Codable, Hashable {
    var id: UUID
    var kind: ItemKind
    var title: String
    var version = 1
    var createdAt = Date()
    var updatedAt = Date()
    var archivedAt: Date?
    var deletedAt: Date?
    var completedAt: Date?
    var cancelledAt: Date?
    var projectID: UUID?
    var milestoneID: UUID?
    var areaID: UUID?
    var status: String
    var summary = ""
    var body = ""
    var category = "笔记"
    var tags: [String] = []
    var pinned = false
    var projectKind = "RESEARCH"
    var startDate: Date?
    var targetDate: Date?
    var dueDate: Date?
    var dateOnly = true
    var scheduledAt: Date?
    var remindAt: Date?
    var timezone = "Asia/Shanghai"
    var notificationsEnabled = false
    var notificationLeadMinutes = 0
    var snoozedUntil: Date?
    var recurrenceSeriesID: UUID?
    var occurrenceDate: String?
    var isException = false
    var trashBatchID: UUID?
    var calendarEventID: String?

    init(kind: ItemKind, title: String = "", id: UUID = UUID()) {
        self.id = id; self.kind = kind; self.title = title
        status = kind.states.first ?? "OPEN"
        notificationsEnabled = kind == .reminder || kind == .deadline
    }
    var isFinished: Bool { ["DONE", "COMPLETED", "CANCELLED"].contains(status) }
    var isKeyItem: Bool { kind.isItem && pinned }
    var isLive: Bool { deletedAt == nil && archivedAt == nil }
    var isOverdue: Bool { !isFinished && dueDate.map { effectiveDueDate($0) < Date() } == true }
    var calendar: Calendar { WorkspaceDates.calendar(timezone) }
    func effectiveDueDate(_ value: Date) -> Date {
        guard dateOnly else { return value }
        return calendar.date(byAdding: .second, value: -1,
            to: calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: value)) ?? value) ?? value
    }
    var recurrenceAnchor: Date? {
        kind.isItem ? scheduledAt ?? dueDate ?? remindAt : kind == .deadline ? dueDate : nil
    }
    var recurrenceEffectiveDate: Date? {
        if kind.isItem, let scheduledAt { return scheduledAt }
        if let dueDate { return effectiveDueDate(dueDate) }
        return kind.isItem ? remindAt : nil
    }
    var notificationDate: Date? {
        guard notificationsEnabled, isLive, !isFinished else { return nil }
        if let snoozedUntil { return snoozedUntil }
        // An explicit reminder is already the exact notification time.
        if kind.isItem, let remindAt { return remindAt }
        let date: Date?
        if let dueDate {
            date = dateOnly ? calendar.date(bySettingHour: 9, minute: 0, second: 0, of: dueDate) : dueDate
        } else { date = scheduledAt }
        return date?.addingTimeInterval(-Double(notificationLeadMinutes) * 60)
    }
}

enum WorkspaceNotificationPolicy {
    /// Notification actions must belong to the record's current reminder
    /// occurrence. This prevents an old delivered banner from completing or
    /// snoozing a record after its reminder was disabled, moved, or replaced.
    static func isCurrentAction(for record: WorkspaceRecord, scheduledAtMilliseconds: Double?) -> Bool {
        guard let supplied = scheduledAtMilliseconds, supplied.isFinite,
              let current = record.notificationDate else { return false }
        let expected = current.timeIntervalSince1970 * 1000
        return abs(expected - supplied) < 1000
    }
}

struct RecurrenceRule: Codable, Hashable {
    enum Frequency: String, Codable, CaseIterable, Identifiable {
        case daily = "DAILY", weekly = "WEEKLY", monthly = "MONTHLY"
        case oddWeeks = "ODD_WEEKS", evenWeeks = "EVEN_WEEKS"
        case weekdays = "WEEKDAYS", workdays = "CHINA_WORKDAYS"
        static let allCases: [Frequency] = [.daily, .weekly, .oddWeeks, .evenWeeks, .weekdays, .workdays, .monthly]
        var id: String { rawValue }
        var title: String {
            switch self {
            case .daily: "每天"; case .weekly: "每周"; case .monthly: "每月"
            case .oddWeeks: "单周"; case .evenWeeks: "双周"
            case .weekdays: "周一至周五"; case .workdays: "工作日（含调休）"
            }
        }
        var intervalUnit: String { self == .daily ? "天" : self == .monthly ? "月" : "周" }
        var supportsInterval: Bool { [.daily, .weekly, .monthly].contains(self) }
        var usesWeekParity: Bool { self == .oddWeeks || self == .evenWeeks }
        var usesWeekdays: Bool { self == .weekly || usesWeekParity }
    }
    var frequency: Frequency = .weekly
    var interval = 1
    var weekdays: [Int] = [] // ISO: Monday = 1, Sunday = 7.
    var until: Date?
    var weekOneStart: Date?
    var label: String {
        let base = frequency.supportsInterval && interval > 1 ? "每\(interval)\(frequency.intervalUnit)" : frequency.title
        return base + (frequency.usesWeekdays && !weekdays.isEmpty ? " · " + weekdays.sorted().map { WorkspaceDates.weekdayName($0) }.joined(separator: "、") : "")
    }
}

struct DeadlineSeries: Identifiable, Codable, Hashable {
    var id = UUID()
    var template: WorkspaceRecord
    var rule: RecurrenceRule
    var stoppedAt: Date?
    var generatedThrough: Date?
}
struct ActivityEntry: Identifiable, Codable, Hashable {
    var id = UUID()
    var entityID: UUID
    var projectID: UUID?
    var title: String
    var message: String
    var date = Date()
}
struct KnowledgeRevision: Identifiable, Codable, Hashable {
    var id = UUID()
    var record: WorkspaceRecord
    var action: String
    var date = Date()
}
struct WorkspaceAsset: Identifiable, Codable, Hashable {
    var id = UUID()
    var ownerID: UUID
    var name: String
    var data: Data
    var createdAt = Date()
}
struct TrashBatch: Identifiable, Codable, Hashable {
    var id = UUID()
    var rootID: UUID
    var title: String
    var itemIDs: [UUID]
    var deletedAt = Date()
    var expiresAt: Date?
}
struct WorkspaceProfile: Codable, Hashable {
    var name = "广益"
    var timezone = "Asia/Shanghai"
    var avatar: Data?
}
struct WorkspaceState: Codable, Equatable {
    var format = "guangyi-native"
    var schemaVersion = 1
    var records: [WorkspaceRecord] = []
    var series: [DeadlineSeries] = []
    var activities: [ActivityEntry] = []
    var revisions: [KnowledgeRevision] = []
    var assets: [WorkspaceAsset] = []
    var trash: [TrashBatch] = []
    var profile = WorkspaceProfile()
}
struct DeletionPreview: Identifiable {
    var id = UUID()
    var root: WorkspaceRecord
    var records: [WorkspaceRecord]
    var createdAt = Date()
}
enum WorkspaceFailure: LocalizedError {
    case invalid(String), conflict, missingParent, stalePreview, expiredTrash, remainingTasks(Int), tooLarge
    var errorDescription: String? {
        switch self {
        case .invalid(let message): message
        case .conflict: "内容已在其他窗口修改。请关闭编辑器，重新打开后比较。"
        case .missingParent: "关联项目组或事项不可用，请先恢复或重新选择。"
        case .stalePreview: "关联内容已变化，请重新确认删除范围。"
        case .expiredTrash: "此删除批次已超过 30 天恢复期限。"
        case .remainingTasks(let count): "项目组还有 \(count) 项未完成事项，请先确认。"
        case .tooLarge: "文件过大，或内容超过支持的上限。"
        }
    }
}

enum WorkspaceDates {
    static func calendar(_ timezone: String = "Asia/Shanghai") -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone) ?? .current
        calendar.locale = Locale(identifier: "zh_CN")
        calendar.firstWeekday = 2
        return calendar
    }
    static func dayKey(_ date: Date, timezone: String) -> String {
        let parts = calendar(timezone).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 2000, parts.month ?? 1, parts.day ?? 1)
    }
    static func weekdayName(_ day: Int) -> String {
        [1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日"][day] ?? ""
    }
    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: value) { return date }
        let onlyDate = DateFormatter()
        onlyDate.calendar = calendar(); onlyDate.timeZone = calendar().timeZone
        onlyDate.locale = Locale(identifier: "en_US_POSIX"); onlyDate.dateFormat = "yyyy-MM-dd"
        onlyDate.isLenient = false
        return onlyDate.date(from: value)
    }
}
