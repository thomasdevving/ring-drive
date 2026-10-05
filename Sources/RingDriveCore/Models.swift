import Foundation

public enum Zone: String, Codable, CaseIterable, Sendable { case front, side, rear, unknown }
public enum EventKind: String, Codable, Sendable { case person, package, departed, motion, doorbell }
public enum EvidenceSource: String, Codable, Sendable {
    case synthetic, ringHistory, ringWebhook
    public var label: String {
        switch self {
        case .synthetic: "Synthetic scenario"
        case .ringHistory: "Official Ring API"
        case .ringWebhook: "Signed Ring webhook"
        }
    }
}

public struct CameraEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let accountID: String
    public let deviceID: String
    public let componentID: String?
    public let zone: Zone
    public let kind: EventKind
    public let occurredAt: Date
    public let confidence: Double
    public let source: EvidenceSource
    public init(id: String, accountID: String = "demo-home", deviceID: String, componentID: String? = nil,
                zone: Zone, kind: EventKind, occurredAt: Date, confidence: Double, source: EvidenceSource) {
        self.id = id; self.accountID = accountID; self.deviceID = deviceID; self.componentID = componentID
        self.zone = zone; self.kind = kind; self.occurredAt = occurredAt; self.confidence = confidence; self.source = source
    }
    public var deduplicationKey: String { "\(accountID)|\(deviceID)|\(id)" }
}

public enum Priority: String, Codable, Sendable { case passive, review, urgent }
public struct TriageDecision: Codable, Equatable, Sendable {
    public let priority: Priority
    public let confidence: Double
    public let explanation: String
    public let reasons: [String]
    public let evidenceIDs: [String]
    public let ruleVersion: String
}

public enum IncidentState: String, Codable, CaseIterable, Sendable {
    case detected = "DETECTED", triaged = "TRIAGED", notified = "NOTIFIED", explained = "EXPLAINED"
    case stopRequested = "STOP_REQUESTED", navigating = "NAVIGATING"
    case parkedConfirmed = "PARKED_CONFIRMED", videoUnlocked = "VIDEO_UNLOCKED"
}
public struct AuditEntry: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let at: Date
    public let state: IncidentState
    public let note: String
    public init(at: Date, state: IncidentState, note: String) { id = UUID(); self.at = at; self.state = state; self.note = note }
}
public struct Incident: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public private(set) var events: [CameraEvent]
    public private(set) var decision: TriageDecision
    public private(set) var state: IncidentState
    public private(set) var audit: [AuditEntry]
    public init(events: [CameraEvent], decision: TriageDecision, now: Date) {
        self.id = UUID(); self.events = events; self.decision = decision; state = .detected
        audit = [AuditEntry(at: now, state: .detected, note: "Camera evidence received")]
    }
    public mutating func transition(to next: IncidentState, now: Date, safety: SafetyVerdict? = nil) throws {
        let allowed: [IncidentState: Set<IncidentState>] = [
            .detected: [.triaged], .triaged: [.notified], .notified: [.explained],
            .explained: [.stopRequested], .stopRequested: [.navigating, .parkedConfirmed],
            .navigating: [.stopRequested, .parkedConfirmed], .parkedConfirmed: [.videoUnlocked], .videoUnlocked: []
        ]
        guard allowed[state, default: []].contains(next) else { throw TransitionError.invalid(state, next) }
        if next == .parkedConfirmed || next == .videoUnlocked {
            guard safety?.allowsVideo == true, safety?.isFresh(at: now) == true else { throw TransitionError.unsafe }
        }
        state = next
        audit.append(AuditEntry(at: now, state: next, note: next == .parkedConfirmed ? (safety?.reason ?? "") : "Transition accepted"))
    }
    public mutating func revokeVideo(now: Date, reason: String) {
        guard state == .parkedConfirmed || state == .videoUnlocked else { return }
        state = .stopRequested
        audit.append(AuditEntry(at: now, state: state, note: "Video revoked: \(reason)"))
    }
    public mutating func revise(events: [CameraEvent], decision: TriageDecision, now: Date) {
        self.events = events; self.decision = decision
        if state != .triaged && state != .detected { state = .triaged }
        audit.append(AuditEntry(at: now, state: state, note: "New evidence; explanation and acknowledgement required again"))
    }
}
public enum TransitionError: Error, Equatable { case invalid(IncidentState, IncidentState), unsafe }
