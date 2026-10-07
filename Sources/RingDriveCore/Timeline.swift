import Foundation

public struct IncidentAssessment: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let at: Date
    public let decision: TriageDecision
    public let evidenceKeys: [String]
    public let isRecovered: Bool
    public let change: IncidentChange?
    public init(at: Date, decision: TriageDecision, evidenceKeys: [String], isRecovered: Bool = false, change: IncidentChange? = nil) {
        id = UUID(); self.at = at; self.decision = decision; self.evidenceKeys = evidenceKeys; self.isRecovered = isRecovered; self.change = change
    }
}

public enum IncidentTimelineItem: Equatable, Identifiable, Sendable {
    case observation(CameraEvent), assessment(IncidentAssessment), transition(AuditEntry)
    public var id: String {
        switch self {
        case .observation(let e): "event:\(e.deduplicationKey)"
        case .assessment(let a): "assessment:\(a.id)"
        case .transition(let a): "transition:\(a.id)"
        }
    }
    public var at: Date {
        switch self {
        case .observation(let e): e.occurredAt
        case .assessment(let a): a.at
        case .transition(let a): a.at
        }
    }
    private var tieOrder: Int {
        switch self { case .observation: 0; case .assessment: 1; case .transition: 2 }
    }
    static func precedes(_ lhs: Self, _ rhs: Self) -> Bool {
        if lhs.at != rhs.at { return lhs.at < rhs.at }
        if lhs.tieOrder != rhs.tieOrder { return lhs.tieOrder < rhs.tieOrder }
        // Stable input order preserves transitions that share a timestamp.
        return false
    }
}

public extension Incident {
    var timeline: [IncidentTimelineItem] {
        let items = events.map(IncidentTimelineItem.observation)
            + assessments.map(IncidentTimelineItem.assessment) + audit.map(IncidentTimelineItem.transition)
        return items.enumerated().sorted {
            if IncidentTimelineItem.precedes($0.element, $1.element) { return true }
            if IncidentTimelineItem.precedes($1.element, $0.element) { return false }
            return $0.offset < $1.offset
        }.map(\.element)
    }
}

public extension Zone {
    var locationLabel: String {
        switch self { case .front: "Front entrance"; case .side: "Side entrance"; case .rear: "Rear door"; case .unknown: "Unmapped camera" }
    }
}
public extension EventKind {
    var observationLabel: String {
        switch self {
        case .person: "Person activity"; case .package: "Package observed"; case .departed: "Departure observed"
        case .motion: "Motion observed"; case .doorbell: "Doorbell pressed"
        }
    }
}

/// Shared fresh parking gate for detailed evidence and video surfaces.
public enum ParkedReviewGuard {
    public static func permits(safety: SafetyVerdict, now: Date = Date()) -> Bool {
        safety.allowsVideo && safety.state == .parked && safety.isFresh(at: now)
    }
}
