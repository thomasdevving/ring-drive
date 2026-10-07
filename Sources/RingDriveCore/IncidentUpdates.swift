import Foundation

public enum IncidentStatus: String, Codable, Sendable { case active, resolved }
public enum IncidentChange: String, Codable, Sendable {
    case ignored, continued, escalated, resolved, reopened
    public var requiresNewExplanation: Bool { self == .escalated || self == .reopened }
    public var auditNote: String {
        switch self {
        case .ignored: "No fresh, distinct evidence"
        case .continued: "New observations added to the same incident; navigation preserved; no repeated interruption"
        case .escalated: "Urgency increased; updated spoken explanation required"
        case .resolved: "Observed activity ended on explicit departure evidence; this does not certify that the home is safe"
        case .reopened: "New activity after departure; incident reopened; updated spoken explanation required"
        }
    }
}

public enum IncidentUpdatePolicy {
    public static let episodeGap: TimeInterval = 180
    public static let alertCooldown: TimeInterval = 120
    public static let departureInterval: TimeInterval = 10
    struct Plan {
        let decision: TriageDecision
        let status: IncidentStatus
        let resolvedAt: Date?
        let change: IncidentChange
    }
    static func plan(incident: Incident, events: [CameraEvent], incoming: [CameraEvent], now: Date) -> Plan {
        let fresh = events.filter { (0...TriageEngine().maxEvidenceAge).contains(now.timeIntervalSince($0.occurredAt)) }
        let activity = fresh.filter { $0.kind == .person || $0.kind == .motion || $0.kind == .doorbell }
        let reopening = incident.status == .resolved && incoming.contains {
            ($0.kind == .person || $0.kind == .motion || $0.kind == .doorbell)
                && $0.occurredAt > (incident.resolvedAt ?? .distantPast)
        }
        if incident.status == .resolved && !reopening {
            return .init(decision: incident.decision, status: .resolved, resolvedAt: incident.resolvedAt, change: .continued)
        }
        let wasUrgent = incident.decision.priority == .urgent || incident.assessments.contains { $0.decision.priority == .urgent }
        if let latest = activity.last, latest.zone != .unknown, !wasUrgent || latest.zone == .rear {
            let exits = fresh.filter {
                $0.kind == .departed && $0.confidence >= 0.8 && $0.deviceID == latest.deviceID
                    && $0.componentID == latest.componentID && $0.zone == latest.zone && $0.occurredAt > latest.occurredAt
            }
            if let first = exits.first, let last = exits.last,
               last.occurredAt.timeIntervalSince(first.occurredAt) >= departureInterval {
                let decision = TriageDecision(priority: .passive, confidence: exits.map(\.confidence).min() ?? 0,
                    explanation: "Two departure observations at the \(latest.zone.locationLabel.lowercased()) indicate that the observed activity has ended. This does not confirm that your home is safe. Your route is unchanged; review the evidence after parking.",
                    reasons: ["Two distinct departure observations after the latest activity", "Same camera and module; at least 10 seconds apart",
                              "No newer person, motion or doorbell observation", "Absence of events alone never resolves an incident"],
                    evidenceIDs: [latest.id, first.id, last.id], ruleVersion: "incident-update-1.0")
                return .init(decision: decision, status: .resolved, resolvedAt: last.occurredAt, change: .resolved)
            }
        }
        let assessed = TriageEngine().evaluate(fresh, now: now)
        let decision: TriageDecision
        if wasUrgent && assessed.priority != .urgent {
            decision = .init(priority: .urgent, confidence: incident.assessments.last { $0.decision.priority == .urgent }?.decision.confidence ?? 0,
                             explanation: "The earlier rear-door incident remains unresolved. New observations do not provide enough evidence that the activity has ended. Stop somewhere safe before reviewing the evidence.",
                             reasons: ["Earlier urgent assessment retained", "No qualifying departure evidence", "Lower confidence or silence cannot prove resolution"],
                             evidenceIDs: fresh.map(\.id), ruleVersion: "incident-update-1.0")
        } else { decision = assessed }
        let change: IncidentChange = reopening ? .reopened : (incident.decision.priority != .urgent && decision.priority == .urgent ? .escalated : .continued)
        return .init(decision: decision, status: .active, resolvedAt: nil, change: change)
    }
}
