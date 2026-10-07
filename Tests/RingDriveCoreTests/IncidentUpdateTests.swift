import XCTest
@testable import RingDriveCore

final class IncidentUpdateTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func event(_ offset: Double, kind: EventKind = .person, confidence: Double = 0.94,
               camera: String = "demo-rear", zone: Zone = .rear, id: String = UUID().uuidString,
               account: String = "demo-home", source: EvidenceSource = .synthetic, component: String? = nil) -> CameraEvent {
        .init(id: id, accountID: account, deviceID: camera, componentID: component, zone: zone, kind: kind,
              occurredAt: now.addingTimeInterval(offset), confidence: confidence, source: source)
    }
    func incident(urgent: Bool = true, state: IncidentState = .notified) throws -> Incident {
        let observations = urgent ? DemoScenario.rearDoor.events(now: now) : Array(DemoScenario.rearDoor.events(now: now).prefix(2))
        var value = Incident(events: observations, decision: TriageEngine().evaluate(observations, now: now), now: now)
        for step in [IncidentState.triaged, .notified, .explained, .stopRequested, .navigating] {
            try value.transition(to: step, now: now)
            if step == state { break }
        }
        return value
    }
    func resolve(_ incident: inout Incident, first: Double = 1, second: Double = 12) {
        XCTAssertEqual(incident.appendEvidence([event(first, kind: .departed)], now: now.addingTimeInterval(first)), .continued)
        XCTAssertEqual(incident.appendEvidence([event(second, kind: .departed)], now: now.addingTimeInterval(second)), .resolved)
    }
    func testContinuedActivityPreservesNavigationIdentityAcknowledgementAndOneAlert() throws {
        var value = try incident(state: .navigating); let id = value.id
        XCTAssertTrue(value.requestUrgentAlert(now: now))
        XCTAssertEqual(value.appendEvidence([event(1)], now: now.addingTimeInterval(1)), .continued)
        XCTAssertEqual(value.id, id); XCTAssertEqual(value.state, .navigating)
        XCTAssertFalse(value.requiresExplanation); XCTAssertEqual(value.events.count, 4)
        XCTAssertFalse(value.requestUrgentAlert(now: now.addingTimeInterval(150)))
        XCTAssertEqual(value.alertRequestCount, 1)
    }
    func testEscalationRequiresNewExplanationAndRejectsOldSpeechCompletion() throws {
        var value = try incident(urgent: false); let oldRevision = value.explanationRevisionID
        XCTAssertEqual(value.decision.priority, .review)
        XCTAssertEqual(value.appendEvidence([event(0)], now: now), .escalated)
        XCTAssertTrue(value.requiresExplanation)
        XCTAssertFalse(value.acknowledgeExplanation(revision: oldRevision, now: now))
        XCTAssertTrue(value.acknowledgeExplanation(revision: value.explanationRevisionID, now: now))
        XCTAssertEqual(value.state, .explained)
        XCTAssertTrue(value.requestUrgentAlert(now: now))
    }
    func testEscalationDuringNavigationDoesNotChangeTheRouteAndBlocksParkingUntilAcknowledged() throws {
        var value = try incident(urgent: false, state: .navigating)
        XCTAssertEqual(value.appendEvidence([event(0)], now: now), .escalated)
        XCTAssertEqual(value.state, .navigating)
        var safety = ParkingSafety()
        for second in 0...20 { safety.ingest(.init(at: now.addingTimeInterval(Double(second)), speed: 0, horizontalAccuracy: 4, motionStationary: true, motionConfidence: 0.95, source: .sensors)) }
        let at = now.addingTimeInterval(20); XCTAssertTrue(safety.confirmParked(now: at))
        let verdict = safety.verdict(now: at)
        XCTAssertThrowsError(try value.transition(to: .parkedConfirmed, now: at, safety: verdict))
        XCTAssertFalse(VideoGuard.permits(incident: value, safety: verdict, now: at))
        XCTAssertTrue(value.acknowledgeExplanation(revision: value.explanationRevisionID, now: at))
        try value.transition(to: .parkedConfirmed, now: at, safety: verdict)
        try value.transition(to: .videoUnlocked, now: at, safety: verdict)
        XCTAssertTrue(VideoGuard.permits(incident: value, safety: verdict, now: at))
    }
    func testTwoExplicitDeparturesResolveWithoutResettingNavigationOrUnlockingVideo() throws {
        var value = try incident(state: .navigating); let id = value.id
        resolve(&value)
        XCTAssertEqual(value.status, .resolved); XCTAssertEqual(value.id, id)
        XCTAssertEqual(value.state, .navigating); XCTAssertEqual(value.decision.priority, .passive)
        XCTAssertFalse(VideoGuard.permits(incident: value, safety: ParkingSafety().verdict(now: now), now: now))
        XCTAssertEqual(value.assessments.last?.change, .resolved)
    }
    func testSilenceAndInsufficientEvidenceNeverResolveUrgency() throws {
        var value = try incident(state: .navigating)
        XCTAssertEqual(value.appendEvidence([], now: now.addingTimeInterval(100)), .ignored)
        XCTAssertEqual(value.appendEvidence([event(121, confidence: 0.2)], now: now.addingTimeInterval(121)), .continued)
        XCTAssertEqual(value.status, .active); XCTAssertEqual(value.decision.priority, .urgent)
        XCTAssertFalse(value.requiresExplanation)
    }
    func testDuplicateExitLowConfidenceWrongCameraAndShortIntervalDoNotResolve() throws {
        for variant in 0..<5 {
            var value = try incident()
            let first = event(1, kind: .departed, id: "exit")
            value.appendEvidence([first], now: now.addingTimeInterval(1))
            let second: CameraEvent
            switch variant {
            case 0: second = first
            case 1: second = event(12, kind: .departed, confidence: 0.4)
            case 2: second = event(12, kind: .departed, camera: "other-camera")
            case 3: second = event(5, kind: .departed)
            default: second = event(12, kind: .departed, component: "other-module")
            }
            value.appendEvidence([second], now: now.addingTimeInterval(12))
            XCTAssertEqual(value.status, .active, "Variant \(variant) must not resolve")
        }
    }
    func testNewActivityBetweenDepartureChecksPreventsResolution() throws {
        var value = try incident()
        value.appendEvidence([event(1, kind: .departed)], now: now.addingTimeInterval(1))
        value.appendEvidence([event(7, confidence: 0.2)], now: now.addingTimeInterval(7))
        value.appendEvidence([event(12, kind: .departed)], now: now.addingTimeInterval(12))
        XCTAssertEqual(value.status, .active)
    }
    func testLateOldObservationDoesNotReopenResolvedIncident() throws {
        var value = try incident(); resolve(&value)
        XCTAssertEqual(value.appendEvidence([event(-40)], now: now.addingTimeInterval(13)), .continued)
        XCTAssertEqual(value.status, .resolved)
    }
    func testReopeningKeepsIdentityRequiresExplanationAndHonorsAlertCooldown() throws {
        var value = try incident(state: .navigating); let id = value.id
        XCTAssertTrue(value.requestUrgentAlert(now: now))
        resolve(&value)
        XCTAssertEqual(value.appendEvidence([event(13)], now: now.addingTimeInterval(13)), .reopened)
        XCTAssertEqual(value.id, id); XCTAssertEqual(value.status, .active); XCTAssertTrue(value.requiresExplanation)
        XCTAssertEqual(value.state, .navigating)
        XCTAssertFalse(value.requestUrgentAlert(now: now.addingTimeInterval(13), reopened: true))
        resolve(&value, first: 14, second: 25)
        XCTAssertEqual(value.appendEvidence([event(130)], now: now.addingTimeInterval(130)), .reopened)
        XCTAssertTrue(value.requestUrgentAlert(now: now.addingTimeInterval(130), reopened: true))
        XCTAssertEqual(value.alertRequestCount, 2)
    }
    func testAccountAndSimulationIsolationButOfficialFeedsCanJoin() throws {
        var value = try incident()
        XCTAssertFalse(value.canJoin([event(1, account: "other")], now: now.addingTimeInterval(1)))
        XCTAssertEqual(value.appendEvidence([event(1, source: .ringHistory)], now: now.addingTimeInterval(1)), .ignored)
        let real = event(0, source: .ringHistory)
        var official = Incident(events: [real], decision: TriageEngine().evaluate([real], now: now), now: now)
        XCTAssertEqual(official.appendEvidence([event(1, source: .ringWebhook)], now: now.addingTimeInterval(1)), .continued)
        XCTAssertEqual(official.events.count, 2)
    }
    func testStaleFutureInvalidAndDuplicateEvidenceDoNotAddAssessments() throws {
        var value = try incident()
        for invalid in [event(-500), event(4), event(0, confidence: .nan), value.events[0]] {
            XCTAssertEqual(value.appendEvidence([invalid], now: now), .ignored)
        }
        XCTAssertEqual(value.assessments.count, 1)
    }
    func testEpisodeGapCreatesSeparateGroupingWithoutClaimingResolution() throws {
        let value = try incident(urgent: false)
        XCTAssertFalse(value.canJoin([event(200)], now: now.addingTimeInterval(200)))
        XCTAssertEqual(value.status, .active)
    }
    func testUnresolvedUrgentIncidentSurvivesLongSilenceAndUnrelatedFrontDeparture() throws {
        var value = try incident(state: .navigating); let id = value.id
        let front = event(200, camera: "demo-front", zone: .front)
        XCTAssertTrue(value.canJoin([front], now: now.addingTimeInterval(200)))
        XCTAssertEqual(value.appendEvidence([front], now: now.addingTimeInterval(200)), .continued)
        let exits = [201.0, 212.0].map { event($0, kind: .departed, camera: "demo-front", zone: .front) }
        value.appendEvidence(exits, now: now.addingTimeInterval(212))
        XCTAssertEqual(value.id, id); XCTAssertEqual(value.status, .active)
        XCTAssertEqual(value.decision.priority, .urgent); XCTAssertEqual(value.state, .navigating)
    }
    func testResolvedIncidentRoundTripRetainsCooldownAndExplanationState() throws {
        var value = try incident(); XCTAssertTrue(value.requestUrgentAlert(now: now)); resolve(&value)
        let saved = try JSONDecoder().decode(Incident.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(saved, value); XCTAssertFalse(saved.requiresExplanation)
        XCTAssertEqual(saved.alertRequestCount, 1)
        XCTAssertEqual(saved.lastAlertAt, now)
    }
}
