import Foundation

enum RecurrenceEngine {
    static func dates(anchor: Date, rule: RecurrenceRule, from: Date, through: Date, timezone: String) -> [Date] {
        let calendar = WorkspaceDates.calendar(timezone)
        let anchorDay = calendar.startOfDay(for: anchor)
        var day = max(anchorDay, calendar.startOfDay(for: from))
        let last = min(calendar.startOfDay(for: through), rule.until.map { calendar.startOfDay(for: $0) } ?? through)
        guard day <= last, (1...365).contains(rule.interval) else { return [] }
        let isoWeekday = (calendar.component(.weekday, from: anchorDay) + 5) % 7 + 1
        let monday = calendar.date(byAdding: .day, value: -(isoWeekday - 1), to: anchorDay) ?? anchorDay
        let anchorDayNumber = calendar.component(.day, from: anchorDay)
        let anchorMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: anchorDay)) ?? anchorDay
        var result: [Date] = []
        // Bounded to the documented rolling three-year window.
        for _ in 0..<1200 {
            guard day <= last else { break }
            var matches = day == anchorDay
            switch rule.frequency {
            case .daily:
                let days = calendar.dateComponents([.day], from: anchorDay, to: day).day ?? 0
                matches = matches || days % rule.interval == 0
            case .weekly:
                let days = calendar.dateComponents([.day], from: monday, to: day).day ?? 0
                let weekday = (calendar.component(.weekday, from: day) + 5) % 7 + 1
                matches = matches || ((days / 7) % rule.interval == 0 && (rule.weekdays.isEmpty ? [isoWeekday] : rule.weekdays).contains(weekday))
            case .monthly:
                let month = calendar.date(from: calendar.dateComponents([.year, .month], from: day)) ?? day
                let months = calendar.dateComponents([.month], from: anchorMonth, to: month).month ?? 0
                let lastDay = calendar.range(of: .day, in: .month, for: day)?.count ?? 28
                matches = matches || (months % rule.interval == 0 && calendar.component(.day, from: day) == min(anchorDayNumber, lastDay))
            }
            if matches { result.append(day) }
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return result
    }
    static func materialize(_ state: inout WorkspaceState, now: Date = Date()) {
        for index in state.series.indices {
            let series = state.series[index]
            guard series.stoppedAt == nil, let seedDue = series.template.dueDate else { continue }
            if let parent = series.template.projectID,
               !state.records.contains(where: { $0.id == parent && $0.isLive }) { continue }
            let calendar = series.template.calendar
            let today = calendar.startOfDay(for: now)
            guard let horizon = calendar.date(byAdding: .year, value: 3, to: today) else { continue }
            let existing = Set(state.records.filter { $0.recurrenceSeriesID == series.id }.compactMap(\.occurrenceDate))
            let after = series.generatedThrough.flatMap { calendar.date(byAdding: .day, value: 1, to: $0) } ?? seedDue
            let times = calendar.dateComponents([.hour, .minute, .second], from: seedDue)
            for day in dates(anchor: seedDue, rule: series.rule, from: max(today, after), through: horizon, timezone: series.template.timezone) {
                let key = WorkspaceDates.dayKey(day, timezone: series.template.timezone)
                guard !existing.contains(key) else { continue }
                var occurrence = series.template
                occurrence.id = UUID(); occurrence.version = 1
                occurrence.createdAt = now; occurrence.updatedAt = now
                occurrence.status = "OPEN"; occurrence.completedAt = nil; occurrence.cancelledAt = nil
                occurrence.archivedAt = nil; occurrence.deletedAt = nil; occurrence.trashBatchID = nil
                occurrence.recurrenceSeriesID = series.id; occurrence.occurrenceDate = key; occurrence.isException = false
                occurrence.calendarEventID = nil
                occurrence.snoozedUntil = nil
                occurrence.dueDate = occurrence.dateOnly ? day : calendar.date(bySettingHour: times.hour ?? 0,
                    minute: times.minute ?? 0, second: times.second ?? 0, of: day,
                    matchingPolicy: .nextTime, repeatedTimePolicy: .first, direction: .forward)
                state.records.append(occurrence)
            }
            state.series[index].generatedThrough = horizon
        }
    }
}
