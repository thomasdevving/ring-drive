import XCTest
@testable import RingDriveCore

final class HouseholdAPITests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_791_000_000)
    private func incident() -> Incident {
        let events = DemoScenario.rearDoor.events(now: now)
        return Incident(events: events, decision: TriageEngine().evaluate(events, now: now), now: now)
    }

    func testSyncPayloadCarriesObservationsWithoutIdentity() throws {
        let incident = incident()
        let payload = IncidentSyncPayload(incident: incident, cameraNames: ["demo-side": "Side gate"], timeZone: TimeZone(identifier: "Europe/Amsterdam")!)
        XCTAssertEqual(payload.id, incident.id.uuidString.lowercased())
        XCTAssertEqual(payload.priority, "urgent")
        XCTAssertTrue(payload.simulated)
        XCTAssertEqual(payload.timeZone, "Europe/Amsterdam")
        XCTAssertEqual(payload.observations.map(\.cameraName), ["Side gate", nil, nil])
        XCTAssertEqual(payload.observations.first?.atMs, Int64((incident.events[0].occurredAt.timeIntervalSince1970 * 1000).rounded()))
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(payload), encoding: .utf8))
        XCTAssertFalse(json.contains("null"), "Optional fields are omitted so the backend validator accepts them")
    }

    func testStoredSummaryIsUsedOnlyForTheSameEvidence() {
        let incident = incident()
        XCTAssertTrue(StoredSummary(text: "Summary", source: "bedrock", basedOn: 3).matches(incident))
        XCTAssertFalse(StoredSummary(text: "Summary", source: "bedrock", basedOn: 2).matches(incident))
        XCTAssertFalse(StoredSummary(text: "", source: "template", basedOn: 3).matches(incident))
    }

    func testHouseholdClientOnlyTalksToOurBackend() {
        XCTAssertThrowsError(try HouseholdAPI(backend: URL(string: "https://api.amazonvision.com")!, clientToken: "k"))
        XCTAssertThrowsError(try HouseholdAPI(backend: URL(string: "http://example.com")!, clientToken: "k"))
        XCTAssertThrowsError(try HouseholdAPI(backend: URL(string: "http://127.0.0.1:8787")!, clientToken: " "))
        XCTAssertNoThrow(try HouseholdAPI(backend: URL(string: "http://127.0.0.1:8787")!, clientToken: "k"))
    }
}
