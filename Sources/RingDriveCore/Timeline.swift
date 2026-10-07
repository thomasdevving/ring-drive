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

/// Consecutive observations from the same camera (and module) of the same kind, for the per-camera timeline.
public struct CameraSegment: Equatable, Identifiable, Sendable {
    public let events: [CameraEvent]
    public var id: String { events[0].deduplicationKey }
    public var deviceID: String { events[0].deviceID }
    public var componentID: String? { events[0].componentID }
    public var zone: Zone { events[0].zone }
    public var kind: EventKind { events[0].kind }
    public var first: Date { events[0].occurredAt }
    public var last: Date { events[events.count - 1].occurredAt }
    /// Span between the first and last observation in this segment, in whole seconds.
    public var seconds: Int { Int(last.timeIntervalSince(first).rounded()) }
}

public extension Incident {
    var cameraSegments: [CameraSegment] {
        var segments: [[CameraEvent]] = []
        for event in events.sorted(by: { $0.occurredAt < $1.occurredAt }) {
            if let last = segments.last?.last, last.deviceID == event.deviceID, last.componentID == event.componentID, last.kind == event.kind {
                segments[segments.count - 1].append(event)
            } else { segments.append([event]) }
        }
        return segments.map(CameraSegment.init(events:))
    }
}
