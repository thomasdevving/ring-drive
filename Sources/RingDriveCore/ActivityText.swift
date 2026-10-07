import Foundation

/// Short texts for the Live Activity (lock screen, Dynamic Island and the small CarPlay presentation).
public enum ActivityText {
    public static func headline(_ incident: Incident) -> String {
        if incident.kind == .absence { return "Expected activity not seen" }
        if incident.status == .resolved { return "Observed activity ended" }
        switch incident.decision.priority {
        case .urgent: return "Activity at the rear door"
        case .passive: return "Home update"
        case .review: return "Activity detected"
        }
    }
    /// Where the driver is in the flow, phrased as the next spoken action where possible.
    public static func stage(_ incident: Incident, videoUnlocked: Bool) -> String {
        if incident.requiresExplanation { return "Ask Siri: “Ring Drive explain”" }
        switch incident.state {
        case .explained:
            let options = incident.availableChoices.filter { $0 != .dismiss }.map { $0.title.lowercased() }
            return options.isEmpty ? "No action needed" : "Next: " + options.joined(separator: " · ")
        case .householdNotified: return "Household notified"
        case .contactCalled: return "Contact called"
        case .stopRequested: return "Finding a safe stop · video locked"
        case .navigating: return "Navigating to a stop · video locked"
        case .parkedConfirmed, .videoUnlocked: return videoUnlocked ? "Parked · review on iPhone" : "Parked · video locked"
        case .dismissed: return "Dismissed"
        case .detected, .triaged, .notified: return incident.decision.priority == .passive ? "Delivered · no action needed" : "Video locked · stop safely"
        }
    }
    /// Outcome of household messages, acknowledgements first ("Sanne has seen this").
    public static func outcome(_ notifications: [HouseholdNotification]) -> String? {
        if let ack = notifications.first(where: \.isAcknowledged) {
            return ack.role == "monitored" ? "\(ack.contactName) is on the way" : "\(ack.contactName) has seen this"
        }
        let names = Array(Set(notifications.filter { $0.status != "failed" && $0.status != "skipped" && $0.target != "driver" }.map(\.contactName))).sorted()
        return names.isEmpty ? nil : "Notified " + names.joined(separator: ", ")
    }
}
