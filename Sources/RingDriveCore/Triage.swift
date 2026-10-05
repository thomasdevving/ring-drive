import Foundation

public struct TriageEngine: Sendable {
    public let maxEvidenceAge: TimeInterval = 180
    public let correlationWindow: TimeInterval = 150
    public let dwellThreshold: TimeInterval = 60
    public init() {}
    public func evaluate(_ input: [CameraEvent], now: Date) -> TriageDecision {
        let events = input.filter {
            let age = now.timeIntervalSince($0.occurredAt)
            return age >= -5 && age <= maxEvidenceAge && $0.confidence.isFinite && (0...1).contains($0.confidence)
        }.sorted { $0.occurredAt < $1.occurredAt }
        let ids = events.map(\.id)
        func decision(_ p: Priority, _ c: Double, _ text: String, _ reasons: [String]) -> TriageDecision {
            .init(priority: p, confidence: c, explanation: text, reasons: reasons, evidenceIDs: ids, ruleVersion: "triage-1.0")
        }
        guard Set(events.map(\.accountID)).count <= 1 else {
            return decision(.review, 0, "Events from different households cannot be correlated.", ["Account isolation guard"])
        }
        guard !events.isEmpty else {
            return decision(.review, 0, "The camera evidence is too old to assess. No urgent interruption was sent.", ["No fresh, valid evidence"])
        }
        let packages = events.filter { $0.zone == .front && $0.kind == .package && $0.confidence >= 0.8 }
        let departures = events.filter { $0.zone == .front && $0.kind == .departed && $0.confidence >= 0.8 }
        if let package = packages.last, departures.contains(where: { $0.occurredAt >= package.occurredAt }),
           !events.contains(where: { $0.zone == .rear || $0.zone == .side }) {
            return decision(.passive, 0.92, "A package was delivered at the front door and the visitor left. There is nothing you need to do now.", ["Package at front door", "Departure after delivery", "No side or rear activity"])
        }
        let side = events.filter { $0.zone == .side && ($0.kind == .person || $0.kind == .motion) && $0.confidence >= 0.7 }
        let rear = events.filter { $0.zone == .rear && ($0.kind == .person || $0.kind == .motion) && $0.confidence >= 0.7 }
        if let firstRear = rear.first, let lastRear = rear.last,
           side.contains(where: { firstRear.occurredAt >= $0.occurredAt && firstRear.occurredAt.timeIntervalSince($0.occurredAt) <= correlationWindow }),
           firstRear.deviceID != side.last?.deviceID || firstRear.componentID != side.last?.componentID {
            let dwell = lastRear.occurredAt.timeIntervalSince(firstRear.occurredAt)
            if dwell >= dwellThreshold && dwell <= correlationWindow {
                let human = rear.allSatisfy { $0.kind == .person } && side.allSatisfy { $0.kind == .person }
                return decision(.urgent, human ? 0.88 : 0.73,
                    "\(human ? "Person activity" : "Repeated motion") at the side entrance was followed by activity at the rear door for at least \(Int(dwell)) seconds. This may need your attention. Stop somewhere safe before reviewing the video.",
                    ["Side → rear sequence within 150 seconds", "Rear observations span \(Int(dwell)) seconds", "At least two cameras or modules", "Correlation is inferred; identity is not verified"])
            }
        }
        let confidence = events.map(\.confidence).min() ?? 0
        return decision(.review, confidence, "Activity was detected at home, but there is not enough reliable evidence for an urgent interruption. You can review it after parking.", [confidence < 0.7 ? "Low confidence; urgent alert suppressed" : "No qualifying side → rear persistence", "More evidence needed"])
    }
}

public struct EventLedger: Sendable {
    public private(set) var events: [CameraEvent] = []
    public private(set) var duplicateCount = 0
    public private(set) var rejectedCount = 0
    private var seen: Set<String> = []
    public init() {}
    @discardableResult public mutating func ingest(_ event: CameraEvent, now: Date) -> Bool {
        guard event.occurredAt.timeIntervalSince(now) <= 5, event.confidence.isFinite,
              (0...1).contains(event.confidence) else { rejectedCount += 1; return false }
        guard seen.insert(event.deduplicationKey).inserted else { duplicateCount += 1; return false }
        events.append(event)
        // Bounded memory for a local demo; persisted multi-user storage is a production follow-up.
        if events.count > 2000 { let removed = events.removeFirst(); seen.remove(removed.deduplicationKey) }
        return true
    }
}
