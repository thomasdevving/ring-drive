import XCTest
@testable import RingDriveCore

final class TimelineTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func makeIncident() -> Incident {
        let events = DemoScenario.rearDoor.events(now: now)
        return Incident(events: events.reversed(), decision: TriageEngine().evaluate(events, now: now), now: now)
    }
    func testChronologicalTimelineContainsCamerasAssessmentAndTransitions() throws {
        var incident = makeIncident()
        try incident.transition(to: .triaged, now: now)
        try incident.transition(to: .notified, now: now)
        XCTAssertEqual(incident.timeline.map(\.at), incident.timeline.map(\.at).sorted())
        let zones: [Zone] = incident.timeline.prefix(3).compactMap { if case .observation(let e) = $0 { return e.zone }; return nil }
        let states: [IncidentState] = incident.timeline.compactMap { if case .transition(let a) = $0 { return a.state }; return nil }
        XCTAssertEqual(zones, [.side, .rear, .rear])
        XCTAssertEqual(states, [.detected, .triaged, .notified])
        XCTAssertEqual(Set(incident.timeline.map(\.id)).count, incident.timeline.count)
    }
    func testSameEventIdentifierOnDifferentCamerasHasDistinctTimelineIdentity() {
        let events = ["a", "b"].map { CameraEvent(id: "shared", deviceID: $0, zone: .rear, kind: .person, occurredAt: now, confidence: 0.9, source: .ringHistory) }
        let incident = Incident(events: events, decision: TriageEngine().evaluate(events, now: now), now: now)
        XCTAssertEqual(Set(incident.timeline.map(\.id)).count, incident.timeline.count)
    }
    func testOldAssessmentKeepsItsOriginalEvidenceAndReasons() {
        var incident = makeIncident()
        let original = incident.assessments[0]
        let events = [11.0, 22.0].map { CameraEvent(id: "exit-\($0)", deviceID: "demo-rear", zone: .rear, kind: .departed,
                                                occurredAt: now.addingTimeInterval($0), confidence: 0.94, source: .synthetic) }
        incident.appendEvidence(events, now: now.addingTimeInterval(22))
        XCTAssertEqual(incident.assessments.first, original)
        XCTAssertEqual(incident.assessments.last?.evidenceKeys.count, 5)
        XCTAssertEqual(incident.assessments.first?.decision.priority, .urgent)
        XCTAssertEqual(incident.assessments.last?.decision.priority, .passive)
    }
    func testPersistedTimelineRoundTripAndLegacyMigration() throws {
        let incident = makeIncident()
        let bytes = try JSONEncoder().encode(incident)
        XCTAssertEqual(try JSONDecoder().decode(Incident.self, from: bytes), incident)
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        legacy.removeValue(forKey: "assessments")
        for key in ["status", "resolvedAt", "explanationRevisionID", "lastAlertAt", "alertRequestCount"] { legacy.removeValue(forKey: key) }
        let recovered = try JSONDecoder().decode(Incident.self, from: JSONSerialization.data(withJSONObject: legacy))
        XCTAssertEqual(recovered.id, incident.id)
        XCTAssertTrue(recovered.assessments[0].isRecovered)
        XCTAssertEqual(recovered.assessments[0].at, incident.audit[0].at)
        XCTAssertEqual(recovered.assessments[0].decision, incident.decision)
    }
    func testTimelineGateRequiresFreshConfirmedParkingAndRevokesOnMotion() {
        var safety = ParkingSafety()
        for second in 0...20 {
            safety.ingest(.init(at: now.addingTimeInterval(Double(second)), speed: 0, horizontalAccuracy: 4,
                                motionStationary: true, motionConfidence: 0.95, source: .sensors))
        }
        let at = now.addingTimeInterval(20)
        XCTAssertFalse(ParkedReviewGuard.permits(safety: safety.verdict(now: at), now: at))
        XCTAssertTrue(safety.confirmParked(now: at))
        let confirmed = safety.verdict(now: at)
        XCTAssertTrue(ParkedReviewGuard.permits(safety: confirmed, now: at))
        XCTAssertFalse(ParkedReviewGuard.permits(safety: confirmed, now: at.addingTimeInterval(4)))
        safety.ingest(.init(at: at.addingTimeInterval(1), speed: 10, horizontalAccuracy: 4,
                            motionStationary: false, motionConfidence: 0.95, source: .sensors))
        XCTAssertFalse(ParkedReviewGuard.permits(safety: safety.verdict(now: at.addingTimeInterval(1)), now: at.addingTimeInterval(1)))
    }
}
