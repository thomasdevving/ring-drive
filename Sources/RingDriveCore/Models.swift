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
    case householdNotified = "HOUSEHOLD_NOTIFIED", contactCalled = "CONTACT_CALLED", dismissed = "DISMISSED"
}
public struct AuditEntry: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let at: Date
    public let state: IncidentState
    public let note: String
    /// Set when this entry records an explicit driver choice.
    public let choice: DriverChoice?
    public init(at: Date, state: IncidentState, note: String, choice: DriverChoice? = nil) {
        id = UUID(); self.at = at; self.state = state; self.note = note; self.choice = choice
    }
}
public struct Incident: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let kind: IncidentKind
    /// Absence incidents carry no camera events, so their simulation label is stored explicitly.
    public let markedSimulated: Bool
    public private(set) var events: [CameraEvent]
    public private(set) var decision: TriageDecision
    public private(set) var state: IncidentState
    public private(set) var audit: [AuditEntry]
    public private(set) var assessments: [IncidentAssessment]
    public private(set) var status: IncidentStatus
    public private(set) var resolvedAt: Date?
    public private(set) var explanationRevisionID: UUID?
    public private(set) var lastAlertAt: Date?
    public private(set) var alertRequestCount: Int
    public var requiresExplanation: Bool { explanationRevisionID != nil }
    public var isSimulated: Bool { markedSimulated || events.first?.source == .synthetic }
    public init(id: UUID = UUID(), kind: IncidentKind = .camera, events: [CameraEvent], decision: TriageDecision, now: Date, simulated: Bool = false) {
        self.id = id; self.kind = kind; markedSimulated = simulated; self.events = events; self.decision = decision; state = .detected
        audit = [AuditEntry(at: now, state: .detected, note: kind == .absence ? "Absence rule fired: no qualifying observation at any exit camera" : "Camera evidence received")]
        assessments = [.init(at: now, decision: decision, evidenceKeys: events.map(\.deduplicationKey))]
        status = .active; resolvedAt = nil; explanationRevisionID = assessments[0].id
        lastAlertAt = nil; alertRequestCount = 0
    }
    /// After EXPLAINED the driver makes explicit choices; FIND_STOP enters the existing stop → parked → video path.
    public static let allowedTransitions: [IncidentState: Set<IncidentState>] = [
        .detected: [.triaged], .triaged: [.notified], .notified: [.explained],
        .explained: [.stopRequested, .householdNotified, .contactCalled, .dismissed],
        .householdNotified: [.contactCalled, .stopRequested, .dismissed],
        .contactCalled: [.householdNotified, .stopRequested, .dismissed],
        .stopRequested: [.navigating, .parkedConfirmed, .dismissed],
        .navigating: [.stopRequested, .parkedConfirmed, .dismissed], .parkedConfirmed: [.videoUnlocked], .videoUnlocked: [], .dismissed: []
    ]
    public mutating func transition(to next: IncidentState, now: Date, safety: SafetyVerdict? = nil) throws {
        guard Self.allowedTransitions[state, default: []].contains(next) else { throw TransitionError.invalid(state, next) }
        if next == .parkedConfirmed || next == .videoUnlocked {
            guard kind == .camera, !requiresExplanation, safety?.allowsVideo == true, safety?.isFresh(at: now) == true else { throw TransitionError.unsafe }
        }
        state = next
        if next == .explained { explanationRevisionID = nil }
        audit.append(AuditEntry(at: now, state: next, note: next == .parkedConfirmed ? (safety?.reason ?? "") : "Transition accepted"))
    }
    /// Records an explicit driver choice with its timestamp. Only choices offered for this incident type are accepted.
    public mutating func choose(_ choice: DriverChoice, now: Date, detail: String? = nil) throws {
        guard !requiresExplanation else { throw TransitionError.explanationRequired }
        guard offeredChoices.contains(choice) else { throw TransitionError.notOffered(choice) }
        let next = choice.targetState
        if state == next && next == .stopRequested { return }
        guard Self.allowedTransitions[state, default: []].contains(next) else { throw TransitionError.invalid(state, next) }
        state = next
        audit.append(AuditEntry(at: now, state: next, note: "Driver chose \(choice.title.lowercased())" + (detail.map { ": \($0)" } ?? ""), choice: choice))
    }
    public mutating func revokeVideo(now: Date, reason: String) {
        guard state == .parkedConfirmed || state == .videoUnlocked else { return }
        state = .stopRequested
        audit.append(AuditEntry(at: now, state: state, note: "Video revoked: \(reason)"))
    }
    /// One household episode, with synthetic and real evidence kept separate.
    public func canJoin(_ incoming: [CameraEvent], now: Date) -> Bool {
        guard let first = events.first, let latest = events.map(\.occurredAt).max(),
              let newest = incoming.map(\.occurredAt).max(), !incoming.isEmpty else { return false }
        return incoming.allSatisfy { $0.accountID == first.accountID && ($0.source == .synthetic) == (first.source == .synthetic) }
            && ((status == .active && decision.priority == .urgent) || abs(newest.timeIntervalSince(latest)) <= IncidentUpdatePolicy.episodeGap)
            && now.timeIntervalSince(newest) <= TriageEngine().maxEvidenceAge
    }

    @discardableResult public mutating func appendEvidence(_ incoming: [CameraEvent], now: Date) -> IncidentChange {
        guard canJoin(incoming, now: now) else { return .ignored }
        var seen = Set(events.map(\.deduplicationKey))
        let fresh = incoming.filter {
            let age = now.timeIntervalSince($0.occurredAt)
            return age >= 0 && age <= TriageEngine().maxEvidenceAge && $0.confidence.isFinite
                && (0...1).contains($0.confidence) && seen.insert($0.deduplicationKey).inserted
        }
        guard !fresh.isEmpty else { return .ignored }
        let merged = (events + fresh).sorted { $0.occurredAt < $1.occurredAt }
        let plan = IncidentUpdatePolicy.plan(incident: self, events: merged, incoming: fresh, now: now)
        events = merged; decision = plan.decision; status = plan.status; resolvedAt = plan.resolvedAt
        let assessment = IncidentAssessment(at: now, decision: decision,
                                           evidenceKeys: merged.filter { now.timeIntervalSince($0.occurredAt) <= TriageEngine().maxEvidenceAge }.map(\.deduplicationKey),
                                           change: plan.change)
        assessments.append(assessment)
        if plan.change.requiresNewExplanation {
            explanationRevisionID = assessment.id
            revokeVideo(now: now, reason: "Urgency changed; hear the updated explanation")
            // Earlier choices covered the earlier evidence; the driver hears the update and chooses again.
            if ChoicePolicy.choiceStates.contains(state) || state == .dismissed { state = .notified }
        } else if plan.change == .resolved { explanationRevisionID = nil }
        audit.append(.init(at: now, state: state, note: plan.change.auditNote))
        return plan.change
    }

    /// A speech completion may acknowledge only the revision it actually read.
    @discardableResult public mutating func acknowledgeExplanation(revision: UUID?, now: Date) -> Bool {
        guard revision == explanationRevisionID else { return false }
        if state == .notified {
            do { try transition(to: .explained, now: now) } catch { return false }
        } else {
            explanationRevisionID = nil
            audit.append(.init(at: now, state: state, note: "Updated spoken explanation completed; navigation preserved"))
        }
        return true
    }

    @discardableResult public mutating func requestUrgentAlert(now: Date, reopened: Bool = false) -> Bool {
        guard status == .active, decision.priority == .urgent else { return false }
        if let lastAlertAt {
            guard reopened, now.timeIntervalSince(lastAlertAt) >= IncidentUpdatePolicy.alertCooldown else { return false }
        }
        lastAlertAt = now; alertRequestCount += 1
        audit.append(.init(at: now, state: state, note: "Urgent alert requested; continued activity will update this incident silently"))
        return true
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, markedSimulated, events, decision, state, audit, assessments, status, resolvedAt, explanationRevisionID, lastAlertAt, alertRequestCount
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        kind = try c.decodeIfPresent(IncidentKind.self, forKey: .kind) ?? .camera
        markedSimulated = try c.decodeIfPresent(Bool.self, forKey: .markedSimulated) ?? false
        events = try c.decode([CameraEvent].self, forKey: .events)
        decision = try c.decode(TriageDecision.self, forKey: .decision)
        state = try c.decode(IncidentState.self, forKey: .state)
        audit = try c.decode([AuditEntry].self, forKey: .audit)
        assessments = try c.decodeIfPresent([IncidentAssessment].self, forKey: .assessments)
            ?? [.init(at: audit.first?.at ?? events.first?.occurredAt ?? .distantPast,
                      decision: decision, evidenceKeys: events.map(\.deduplicationKey), isRecovered: true)]
        status = try c.decodeIfPresent(IncidentStatus.self, forKey: .status) ?? .active
        resolvedAt = try c.decodeIfPresent(Date.self, forKey: .resolvedAt)
        if c.contains(.explanationRevisionID) { explanationRevisionID = try c.decodeIfPresent(UUID.self, forKey: .explanationRevisionID) }
        else { explanationRevisionID = status == .active && [.detected, .triaged, .notified].contains(state) ? assessments.last?.id : nil }
        lastAlertAt = try c.decodeIfPresent(Date.self, forKey: .lastAlertAt)
        alertRequestCount = try c.decodeIfPresent(Int.self, forKey: .alertRequestCount) ?? 0
    }
}
public enum TransitionError: Error, Equatable { case invalid(IncidentState, IncidentState), unsafe, notOffered(DriverChoice), explanationRequired }
