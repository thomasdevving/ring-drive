import Foundation

/// What kind of incident this is. Camera incidents come from on-device triage; absence incidents come
/// from backend rules that fire when expected activity was not observed.
public enum IncidentKind: String, Codable, Sendable { case camera = "INTRUSION", absence = "ABSENCE" }

/// Explicit choices offered to the driver after hearing the explanation.
public enum DriverChoice: String, Codable, CaseIterable, Sendable {
    case notifyHousehold = "NOTIFY_HOUSEHOLD", callContact = "CALL_CONTACT", findStop = "FIND_STOP", dismiss = "DISMISS"
    public var targetState: IncidentState {
        switch self {
        case .notifyHousehold: .householdNotified
        case .callContact: .contactCalled
        case .findStop: .stopRequested
        case .dismiss: .dismissed
        }
    }
    public var title: String {
        switch self {
        case .notifyHousehold: "Notify household"
        case .callContact: "Call a contact"
        case .findStop: "Find a safe place to stop"
        case .dismiss: "Dismiss"
        }
    }
    public var symbol: String {
        switch self {
        case .notifyHousehold: "person.2.wave.2.fill"
        case .callContact: "phone.fill"
        case .findStop: "mappin.and.ellipse"
        case .dismiss: "xmark.circle"
        }
    }
}

/// Which choices each incident type offers. Video review is never a choice: it follows FIND_STOP and parking.
public enum ChoicePolicy {
    public static func offered(kind: IncidentKind, priority: Priority, status: IncidentStatus) -> [DriverChoice] {
        switch kind {
        case .absence: return [.notifyHousehold, .callContact, .dismiss]
        case .camera:
            if status == .resolved { return [.findStop, .dismiss] }
            switch priority {
            case .urgent: return [.findStop, .notifyHousehold, .callContact, .dismiss]
            // Passive and review incidents keep the existing path to parked video review.
            case .review, .passive: return [.findStop, .dismiss]
            }
        }
    }
    /// States in which the driver has already made a choice and may still make another.
    public static let choiceStates: Set<IncidentState> = [.explained, .householdNotified, .contactCalled]
}

public extension Incident {
    var offeredChoices: [DriverChoice] { ChoicePolicy.offered(kind: kind, priority: decision.priority, status: status) }
    /// Choices the driver can take right now: offered for this incident and allowed from the current state.
    var availableChoices: [DriverChoice] {
        guard !requiresExplanation else { return [] }
        return offeredChoices.filter { Incident.allowedTransitions[state, default: []].contains($0.targetState) }
    }
    /// A backend absence incident as the driver app sees it. It has no camera observations and never unlocks video.
    static func absence(id: UUID, summary: String, ruleName: String, simulated: Bool, now: Date) -> Incident {
        let decision = TriageDecision(priority: .urgent, confidence: 1, explanation: summary,
                                      reasons: ["Absence rule \"\(ruleName)\" ended without a qualifying observation at any exit camera",
                                                "Cameras do not identify people or the direction of movement"] + (simulated ? ["Simulated evidence"] : []),
                                      evidenceIDs: [], ruleVersion: "absence-1.0")
        return Incident(id: id, kind: .absence, events: [], decision: decision, now: now, simulated: simulated)
    }
}
