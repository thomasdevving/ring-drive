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
    public private(set) var assessments: [IncidentAssessment]
    public private(set) var status: IncidentStatus
    public private(set) var resolvedAt: Date?
    public private(set) var explanationRevisionID: UUID?
    public private(set) var lastAlertAt: Date?
    public private(set) var alertRequestCount: Int
    public var requiresExplanation: Bool { explanationRevisionID != nil }
    public init(events: [CameraEvent], decision: TriageDecision, now: Date) {
        self.id = UUID(); self.events = events; self.decision = decision; state = .detected
        audit = [AuditEntry(at: now, state: .detected, note: "Camera evidence received")]
        assessments = [.init(at: now, decision: decision, evidenceKeys: events.map(\.deduplicationKey))]
        status = .active; resolvedAt = nil; explanationRevisionID = assessments[0].id
        lastAlertAt = nil; alertRequestCount = 0
    }
    public mutating func transition(to next: IncidentState, now: Date, safety: SafetyVerdict? = nil) throws {
        let allowed: [IncidentState: Set<IncidentState>] = [
            .detected: [.triaged], .triaged: [.notified], .notified: [.explained],
            .explained: [.stopRequested], .stopRequested: [.navigating, .parkedConfirmed],
            .navigating: [.stopRequested, .parkedConfirmed], .parkedConfirmed: [.videoUnlocked], .videoUnlocked: []
        ]
        guard allowed[state, default: []].contains(next) else { throw TransitionError.invalid(state, next) }
        if next == .parkedConfirmed || next == .videoUnlocked {
            guard !requiresExplanation, safety?.allowsVideo == true, safety?.isFresh(at: now) == true else { throw TransitionError.unsafe }
        }
        state = next
        if next == .explained { explanationRevisionID = nil }
        audit.append(AuditEntry(at: now, state: next, note: next == .parkedConfirmed ? (safety?.reason ?? "") : "Transition accepted"))
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
            if state == .explained { state = .notified }
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
        case id, events, decision, state, audit, assessments, status, resolvedAt, explanationRevisionID, lastAlertAt, alertRequestCount
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
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
public enum TransitionError: Error, Equatable { case invalid(IncidentState, IncidentState), unsafe }
