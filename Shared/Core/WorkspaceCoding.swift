import Foundation

enum WorkspaceCoding {
    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let ordinary = ISO8601DateFormatter()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let date = fractional.date(from: value) ?? ordinary.date(from: value) else {
                throw WorkspaceFailure.invalid("时间格式无效。")
            }
            return date
        }
        return decoder
    }
    static func equivalent(_ lhs: WorkspaceRecord, _ rhs: WorkspaceRecord) -> Bool {
        // Wire timestamps are millisecond precision; avoid reporting export rounding as an edit.
        var normalized = rhs
        if abs(lhs.createdAt.timeIntervalSince(rhs.createdAt)) < 0.002 { normalized.createdAt = lhs.createdAt }
        if abs(lhs.updatedAt.timeIntervalSince(rhs.updatedAt)) < 0.002 { normalized.updatedAt = lhs.updatedAt }
        let optionalDates: [WritableKeyPath<WorkspaceRecord, Date?>] = [\.archivedAt, \.deletedAt, \.completedAt,
            \.cancelledAt, \.startDate, \.targetDate, \.dueDate, \.scheduledAt, \.remindAt, \.snoozedUntil]
        for path in optionalDates {
            if let left = lhs[keyPath: path], let right = rhs[keyPath: path], abs(left.timeIntervalSince(right)) < 0.002 {
                normalized[keyPath: path] = left
            }
        }
        return lhs == normalized
    }
}
