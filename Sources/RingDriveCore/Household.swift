import Foundation

public struct HouseholdContact: Codable, Equatable, Identifiable, Sendable {
    public enum Role: String, Codable, Sendable { case household, monitored, emergency, neighbour }
    public let id: String
    public let name: String
    public let role: Role
    public let priority: Int
    public let channel: String
    public let phone: String?
    /// "driving", "not-driving" or "unknown", reported by that member's own app.
    public let drivingState: String?
    public init(id: String, name: String, role: Role, priority: Int, channel: String, phone: String?, drivingState: String?) {
        self.id = id; self.name = name; self.role = role; self.priority = priority; self.channel = channel; self.phone = phone; self.drivingState = drivingState
    }
}

/// A message for one household member: an escalation step or a driver's "notify household" request.
public struct HouseholdNotification: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let incidentId: String
    public let contactId: String
    public let contactName: String
    public let role: String
    public let message: String
    public let status: String
    public let channel: String
    public let createdAt: String
    public let ackAt: String?
    public let target: String?
    public let simulated: Bool?
    public var isAcknowledged: Bool { ackAt != nil }
    /// The monitored person answers "I'm on my way"; others confirm they have seen it.
    public var acknowledgeTitle: String { role == "monitored" ? "I'm on my way" : "I've seen this" }
}

/// Decides whether this iPhone's owner is driving. CarPlay audio is the strongest signal; CoreMotion's
/// automotive activity counts only at medium or high confidence. The simulated vehicle is used only in demo mode.
public enum DrivingSignal {
    public struct Reading: Equatable, Sendable {
        public let driving: Bool; public let source: String
        public init(driving: Bool, source: String) { self.driving = driving; self.source = source }
    }
    public static func evaluate(carPlayAudio: Bool, automotive: Bool, automotiveConfidence: Double, simulatedDriving: Bool?) -> Reading {
        if let simulatedDriving { return .init(driving: simulatedDriving, source: "simulated") }
        if carPlayAudio { return .init(driving: true, source: "carplay") }
        if automotive && automotiveConfidence >= 0.5 { return .init(driving: true, source: "motion") }
        return .init(driving: false, source: automotiveConfidence > 0 ? "motion" : "none")
    }
}

/// Calls always go through the system phone flow, where iOS asks the user to confirm. No workaround is used.
public enum CallLink {
    public static func url(for phone: String?) -> URL? {
        guard let phone, phone.range(of: #"^\+[1-9]\d{6,14}$"#, options: .regularExpression) != nil else { return nil }
        return URL(string: "tel:\(phone)")
    }
    /// Who the driver can call, emergency contacts and neighbours first, then by priority.
    public static func callable(_ contacts: [HouseholdContact]) -> [HouseholdContact] {
        let rank: [HouseholdContact.Role: Int] = [.emergency: 0, .neighbour: 1, .household: 2, .monitored: 3]
        return contacts.filter { url(for: $0.phone) != nil }
            .sorted { (rank[$0.role] ?? 9, $0.priority, $0.name) < (rank[$1.role] ?? 9, $1.priority, $1.name) }
    }
}
