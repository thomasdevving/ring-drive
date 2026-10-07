import XCTest
@testable import RingDriveCore

final class DriverChoiceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_791_000_000)
    private func explained(_ scenario: DemoScenario) throws -> Incident {
        let events = scenario.events(now: now)
        var incident = Incident(events: events, decision: TriageEngine().evaluate(events, now: now), now: now)
        try incident.transition(to: .triaged, now: now); try incident.transition(to: .notified, now: now)
        XCTAssertTrue(incident.availableChoices.isEmpty, "No choices before the explanation")
        XCTAssertThrowsError(try incident.choose(.dismiss, now: now)) { XCTAssertEqual($0 as? TransitionError, .explanationRequired) }
        XCTAssertTrue(incident.acknowledgeExplanation(revision: incident.explanationRevisionID, now: now))
        return incident
    }

    func testUrgentCameraIncidentOffersAllChoicesAndPersistsThem() throws {
        var incident = try explained(.rearDoor)
        XCTAssertEqual(incident.offeredChoices, [.findStop, .notifyHousehold, .callContact, .dismiss])
        try incident.choose(.notifyHousehold, now: now.addingTimeInterval(5))
        try incident.choose(.callContact, now: now.addingTimeInterval(6), detail: "Sanne")
        try incident.choose(.findStop, now: now.addingTimeInterval(7))
        XCTAssertEqual(incident.state, .stopRequested)
        XCTAssertEqual(incident.audit.compactMap(\.choice), [.notifyHousehold, .callContact, .findStop])
        XCTAssertEqual(incident.audit.first { $0.choice == .notifyHousehold }?.at, now.addingTimeInterval(5))
        XCTAssertEqual(incident.audit.first { $0.choice == .callContact }?.note, "Driver chose call a contact: Sanne")
        XCTAssertThrowsError(try incident.transition(to: .parkedConfirmed, now: now), "Video still requires fresh parking evidence")
    }

    func testOfferedChoicesDependOnIncidentType() throws {
        XCTAssertEqual(try explained(.package).availableChoices, [.findStop, .dismiss])
        XCTAssertEqual(try explained(.lowConfidence).availableChoices, [.findStop, .dismiss])
        var absence = Incident.absence(id: UUID(), summary: "School run: No person was detected.", ruleName: "School run", simulated: true, now: now)
        try absence.transition(to: .triaged, now: now); try absence.transition(to: .notified, now: now)
        XCTAssertTrue(absence.acknowledgeExplanation(revision: absence.explanationRevisionID, now: now))
        XCTAssertEqual(absence.availableChoices, [.notifyHousehold, .callContact, .dismiss])
        XCTAssertThrowsError(try absence.choose(.findStop, now: now)) { XCTAssertEqual($0 as? TransitionError, .notOffered(.findStop)) }
        XCTAssertThrowsError(try absence.transition(to: .parkedConfirmed, now: now))
        try absence.choose(.dismiss, now: now)
        XCTAssertTrue(absence.availableChoices.isEmpty)
    }

    func testEscalationAfterAChoiceRequiresANewExplanation() throws {
        var incident = try explained(.package)
        try incident.choose(.dismiss, now: now)
        XCTAssertEqual(incident.appendEvidence(DemoScenario.rearDoor.events(now: now), now: now), .escalated)
        XCTAssertEqual(incident.state, .notified)
        XCTAssertTrue(incident.requiresExplanation)
    }

    func testKindAndChoicesPersistAndLegacyRecordsDecode() throws {
        var absence = Incident.absence(id: UUID(), summary: "x", ruleName: "r", simulated: true, now: now)
        try absence.transition(to: .triaged, now: now); try absence.transition(to: .notified, now: now)
        _ = absence.acknowledgeExplanation(revision: absence.explanationRevisionID, now: now)
        try absence.choose(.notifyHousehold, now: now)
        let decoded = try JSONDecoder().decode(Incident.self, from: JSONEncoder().encode(absence))
        XCTAssertEqual(decoded.kind, .absence); XCTAssertTrue(decoded.isSimulated); XCTAssertEqual(decoded.audit.last?.choice, .notifyHousehold)
        let events = DemoScenario.rearDoor.events(now: now)
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(Incident(events: events, decision: TriageEngine().evaluate(events, now: now), now: now))) as? [String: Any])
        legacy["kind"] = nil; legacy["markedSimulated"] = nil
        XCTAssertEqual(try JSONDecoder().decode(Incident.self, from: JSONSerialization.data(withJSONObject: legacy)).kind, .camera)
    }
}
