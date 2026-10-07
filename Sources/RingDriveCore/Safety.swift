import Foundation

public enum VehicleState: String, Sendable { case driving, uncertain, stationary, parked }
public enum MotionEvidenceSource: String, Sendable { case sensors, simulator }
public struct MotionSample: Sendable {
    public let at: Date
    public let speed: Double
    public let speedAccuracy: Double
    public let horizontalAccuracy: Double
    public let motionStationary: Bool
    public let motionConfidence: Double
    public let source: MotionEvidenceSource
    public init(at: Date, speed: Double, speedAccuracy: Double = 0.1, horizontalAccuracy: Double,
                motionStationary: Bool, motionConfidence: Double, source: MotionEvidenceSource) {
        self.at = at; self.speed = speed; self.speedAccuracy = speedAccuracy; self.horizontalAccuracy = horizontalAccuracy
        self.motionStationary = motionStationary; self.motionConfidence = motionConfidence; self.source = source
    }
}
public struct SafetyVerdict: Equatable, Sendable {
    public let state: VehicleState
    public let stationarySeconds: TimeInterval
    public let allowsVideo: Bool
    public let reason: String
    public let isSimulated: Bool
    public let evidenceAt: Date?
    // Only the policy engine creates this, not presentation code.
    internal init(state: VehicleState, stationarySeconds: TimeInterval, allowsVideo: Bool, reason: String, isSimulated: Bool, evidenceAt: Date?) {
        self.state = state; self.stationarySeconds = stationarySeconds; self.allowsVideo = allowsVideo
        self.reason = reason; self.isSimulated = isSimulated; self.evidenceAt = evidenceAt
    }
    public func isFresh(at now: Date) -> Bool { evidenceAt.map { now.timeIntervalSince($0) >= 0 && now.timeIntervalSince($0) <= 3 } ?? false }
}

public struct ParkingSafety: Sendable {
    public let minimumStationarySeconds: TimeInterval = 20
    public let freshnessLimit: TimeInterval = 3
    public private(set) var latest: MotionSample?
    private var stationarySince: Date?
    private var confirmedAt: Date?
    private let allowsSimulation: Bool
    public init(allowsSimulation: Bool = false) { self.allowsSimulation = allowsSimulation }
    public mutating func ingest(_ sample: MotionSample) {
        guard latest == nil || sample.at > latest!.at else { invalidate(); return }
        let contiguous = latest.map { sample.at.timeIntervalSince($0.at) <= freshnessLimit && sample.source == $0.source } ?? false
        latest = sample
        guard qualifies(sample), sample.source == .sensors || allowsSimulation else {
            stationarySince = nil; confirmedAt = nil; return
        }
        if !contiguous || stationarySince == nil { stationarySince = sample.at; confirmedAt = nil }
    }
    public mutating func invalidate() { latest = nil; stationarySince = nil; confirmedAt = nil }
    @discardableResult public mutating func confirmParked(now: Date) -> Bool {
        let v = verdict(now: now)
        guard v.state == .stationary || v.state == .parked else { return false }
        confirmedAt = now; return true
    }
    public func verdict(now: Date) -> SafetyVerdict {
        func v(_ s: VehicleState, _ seconds: TimeInterval = 0, _ allow: Bool = false, _ reason: String) -> SafetyVerdict {
            .init(state: s, stationarySeconds: seconds, allowsVideo: allow, reason: reason, isSimulated: latest?.source == .simulator, evidenceAt: latest?.at)
        }
        guard let sample = latest else { return v(.uncertain, 0, false, "Waiting for reliable motion and location evidence.") }
        let age = now.timeIntervalSince(sample.at)
        guard age >= 0 && age <= freshnessLimit else { return v(.uncertain, 0, false, "Motion evidence is stale. Video remains locked.") }
        if sample.speed.isFinite && sample.speed > 0.5 { return v(.driving, 0, false, "The vehicle is moving. Video is locked.") }
        guard qualifies(sample), sample.source == .sensors || allowsSimulation, let since = stationarySince else {
            return v(.uncertain, 0, false, "Stationary state is uncertain. Video remains locked.")
        }
        let elapsed = sample.at.timeIntervalSince(since)
        guard elapsed >= minimumStationarySeconds else { return v(.uncertain, elapsed, false, "Confirming continuous standstill: \(Int(elapsed))/20 seconds.") }
        guard confirmedAt != nil else { return v(.stationary, elapsed, false, "Standstill confirmed. Confirm that you are safely parked.") }
        return v(.parked, elapsed, true, sample.source == .simulator ? "Parked confirmed with simulated sensor evidence." : "Parked confirmed: fresh location, stationary motion and your confirmation.")
    }
    private func qualifies(_ s: MotionSample) -> Bool {
        s.speed.isFinite && s.speed >= 0 && s.speed + s.speedAccuracy <= 0.3 &&
        s.speedAccuracy.isFinite && s.speedAccuracy >= 0 && s.speedAccuracy <= 0.2 &&
        s.horizontalAccuracy.isFinite && s.horizontalAccuracy > 0 && s.horizontalAccuracy <= 15 &&
        s.motionStationary && s.motionConfidence.isFinite && s.motionConfidence >= 0.85 && s.motionConfidence <= 1
    }
}

public enum VideoGuard {
    public static func permits(incident: Incident?, safety: SafetyVerdict, now: Date = Date()) -> Bool {
        incident?.state == .videoUnlocked && incident?.requiresExplanation == false && ParkedReviewGuard.permits(safety: safety, now: now)
    }
}
