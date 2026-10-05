import XCTest
@testable import RingDriveCore

final class CoreTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func testCourierIsPassive() {
        let d = TriageEngine().evaluate(DemoScenario.package.events(now: now), now: now)
        XCTAssertEqual(d.priority, .passive); XCTAssertEqual(d.reasons.count, 3)
    }
    func testCrossCameraPersistenceUrgent() {
        let d = TriageEngine().evaluate(DemoScenario.rearDoor.events(now: now), now: now)
        XCTAssertEqual(d.priority, .urgent); XCTAssertTrue(d.explanation.contains("78 seconds"))
        XCTAssertTrue(d.reasons.contains { $0.contains("identity is not verified") })
    }
    func testLowConfidenceAndStaleNeverUrgent() {
        for s in [DemoScenario.lowConfidence, .stale] {
            XCTAssertEqual(TriageEngine().evaluate(s.events(now: now), now: now).priority, .review)
        }
    }
    func testDuplicatesAndOutOfOrder() {
        var ledger = EventLedger()
        for e in DemoScenario.duplicates.events(now: now).reversed() { ledger.ingest(e, now: now) }
        XCTAssertEqual(ledger.events.count, 3); XCTAssertEqual(ledger.duplicateCount, 3)
        XCTAssertEqual(TriageEngine().evaluate(ledger.events, now: now).priority, .urgent)
    }
    func testAccountIsolation() {
        let events = DemoScenario.rearDoor.events(now: now)
        let altered = CameraEvent(id: "other", accountID: "other-house", deviceID: "rear", zone: .rear, kind: .person,
                                  occurredAt: now, confidence: 0.95, source: .ringHistory)
        XCTAssertEqual(TriageEngine().evaluate(events + [altered], now: now).priority, .review)
    }
    func sample(_ offset: Double, speed: Double = 0, accuracy: Double = 4, confidence: Double = 0.95,
                source: MotionEvidenceSource = .sensors) -> MotionSample {
        .init(at: now.addingTimeInterval(offset), speed: speed, horizontalAccuracy: accuracy,
              motionStationary: speed == 0, motionConfidence: confidence, source: source)
    }
    func parked() -> ParkingSafety {
        var safety = ParkingSafety()
        for i in 0...20 { safety.ingest(sample(Double(i))) }
        XCTAssertTrue(safety.confirmParked(now: now.addingTimeInterval(20)))
        return safety
    }
    func incident() -> Incident {
        let events = DemoScenario.rearDoor.events(now: now)
        return .init(events: events, decision: TriageEngine().evaluate(events, now: now), now: now)
    }
    func testAllTransitionsAndUnlockOnlyParked() throws {
        var i = incident(); let v = parked().verdict(now: now.addingTimeInterval(20))
        for state in [IncidentState.triaged, .notified, .explained, .stopRequested, .navigating, .parkedConfirmed, .videoUnlocked] {
            try i.transition(to: state, now: now.addingTimeInterval(20), safety: v)
        }
        XCTAssertEqual(i.audit.map(\.state), IncidentState.allCases)
        XCTAssertTrue(VideoGuard.permits(incident: i, safety: v, now: now.addingTimeInterval(20)))
        XCTAssertFalse(VideoGuard.permits(incident: i, safety: v, now: now.addingTimeInterval(24)))
        i.revokeVideo(now: now, reason: "motion resumed")
        XCTAssertFalse(VideoGuard.permits(incident: i, safety: v))
    }
    func testSkippedAndUnsafeTransitionsRejected() throws {
        var i = incident()
        XCTAssertThrowsError(try i.transition(to: .videoUnlocked, now: now))
        for s in [IncidentState.triaged, .notified, .explained, .stopRequested] { try i.transition(to: s, now: now) }
        XCTAssertThrowsError(try i.transition(to: .parkedConfirmed, now: now))
        XCTAssertEqual(i.state, .stopRequested)
    }
    func testNavigationHandoffRetry() throws {
        var i = incident()
        for s in [IncidentState.triaged, .notified, .explained, .stopRequested, .navigating, .stopRequested, .navigating] {
            try i.transition(to: s, now: now)
        }
        XCTAssertEqual(i.state, .navigating)
    }
    func testStoplightDoesNotUnlock() {
        var p = ParkingSafety()
        for i in 0...20 { p.ingest(sample(Double(i))) }
        XCTAssertEqual(p.verdict(now: now.addingTimeInterval(20)).state, .stationary)
        XCTAssertFalse(p.verdict(now: now.addingTimeInterval(20)).allowsVideo)
    }
    func testMovementRevokesImmediately() {
        var p = parked(); p.ingest(sample(21, speed: 9))
        XCTAssertEqual(p.verdict(now: now.addingTimeInterval(21)).state, .driving)
        XCTAssertFalse(p.verdict(now: now.addingTimeInterval(21)).allowsVideo)
    }
    func testStaleUncertainFutureInvalidNumbersFailClosed() {
        let p = parked()
        XCTAssertFalse(p.verdict(now: now.addingTimeInterval(24)).allowsVideo)
        XCTAssertFalse(p.verdict(now: now.addingTimeInterval(19)).allowsVideo)
        for s in [sample(0, speed: -1), sample(0, speed: .nan), sample(0, accuracy: 99), sample(0, confidence: 0.2)] {
            var q = ParkingSafety(); q.ingest(s); XCTAssertFalse(q.confirmParked(now: now))
        }
    }
    func testGapAndSourceChangeResetStandstill() {
        var p = parked(); p.ingest(sample(30))
        XCTAssertFalse(p.confirmParked(now: now.addingTimeInterval(30)))
        p.ingest(sample(31, source: .simulator))
        XCTAssertFalse(p.verdict(now: now.addingTimeInterval(31)).allowsVideo)
    }
    func testSimulatorNeverUnlocksProductionPolicy() {
        var p = ParkingSafety()
        for i in 0...30 { p.ingest(sample(Double(i), source: .simulator)) }
        XCTAssertFalse(p.confirmParked(now: now.addingTimeInterval(30)))
    }
    func testAllStatesBlockedWhileDrivingEvenAfterUnlock() throws {
        var i = incident(); let v = parked().verdict(now: now.addingTimeInterval(20))
        var p = ParkingSafety(); p.ingest(sample(0, speed: 20))
        let driving = p.verdict(now: now)
        XCTAssertFalse(VideoGuard.permits(incident: i, safety: driving))
        for s in [IncidentState.triaged, .notified, .explained, .stopRequested, .navigating, .parkedConfirmed, .videoUnlocked] {
            try i.transition(to: s, now: now.addingTimeInterval(20), safety: v)
            XCTAssertFalse(VideoGuard.permits(incident: i, safety: driving))
        }
    }
    func testHistoryStringTimestampsAndWebhookComponents() throws {
        let json = #"{"data":[{"id":"e1","attributes":{"event_type":"motion","start":"1800000000000","end":1800000002000}}]}"#
        let page = try JSONDecoder().decode(RingHistoryPage.self, from: Data(json.utf8))
        XCTAssertEqual(page.data.first?.attributes.start, 1_800_000_000_000)
        let webhook = #"{"meta":{"request_id":"req","account_id":"home"},"data":{"id":"event","type":"motion_detected","attributes":{"source":"camera","timestamp":1800000000000,"sub_type":"human","component_ids":["0","1"]}}}"#
        let value = try JSONDecoder().decode(RingWebhook.self, from: Data(webhook.utf8))
        let observations = value.observations(zone: .rear)
        XCTAssertEqual(observations.count, 2); XCTAssertNotEqual(observations[0].id, observations[1].id)
        XCTAssertEqual(observations[0].source, .ringWebhook)
    }
    func testUnsafeMediaFailsBeforeNetwork() async throws {
        let api = try RingAPI(token: "unused")
        do { _ = try await api.clip(event: DemoScenario.rearDoor.events(now: now)[0], incident: incident(), safety: ParkingSafety().verdict(now: now)); XCTFail("Unexpected media access") }
        catch RingAPIError.unsafe {} catch { XCTFail("Wrong error: \(error)") }
    }
    func testHeldParkingVerdictExpiresBeforeTransition() throws {
        var i = incident(); let v = parked().verdict(now: now.addingTimeInterval(20))
        for state in [IncidentState.triaged, .notified, .explained, .stopRequested] { try i.transition(to: state, now: now) }
        XCTAssertThrowsError(try i.transition(to: .parkedConfirmed, now: now.addingTimeInterval(24), safety: v))
    }
}
