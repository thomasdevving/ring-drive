import XCTest
@testable import RingDriveCore

final class ActivityTextTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_791_000_000)
    private func notification(_ name: String, role: String = "household", acknowledged: Bool = false, target: String = "household") throws -> HouseholdNotification {
        var object: [String: Any] = ["id": UUID().uuidString, "incidentId": "i", "contactId": "c", "contactName": name, "role": role, "message": "m",
                                     "status": "delivered", "channel": "app", "createdAt": "x", "target": target]
        if acknowledged { object["ackAt"] = "y" }
        return try JSONDecoder().decode(HouseholdNotification.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testAbsenceStagesFollowTheDriverFlow() throws {
        var incident = Incident.absence(id: UUID(), summary: "s", ruleName: "School run", simulated: true, now: now)
        XCTAssertEqual(ActivityText.headline(incident), "Expected activity not seen")
        try incident.transition(to: .triaged, now: now); try incident.transition(to: .notified, now: now)
        XCTAssertEqual(ActivityText.stage(incident, videoUnlocked: false), "Ask Siri: “Ring Drive explain”")
        _ = incident.acknowledgeExplanation(revision: incident.explanationRevisionID, now: now)
        XCTAssertEqual(ActivityText.stage(incident, videoUnlocked: false), "Next: notify household · call a contact")
        try incident.choose(.notifyHousehold, now: now)
        XCTAssertEqual(ActivityText.stage(incident, videoUnlocked: false), "Household notified")
    }

    func testOutcomePrefersAcknowledgementsAndOmitsTheDriver() throws {
        XCTAssertNil(ActivityText.outcome([]))
        XCTAssertEqual(ActivityText.outcome([try notification("Thomas"), try notification("Lisa", target: "driver")]), "Notified Thomas")
        XCTAssertEqual(ActivityText.outcome([try notification("Thomas"), try notification("Sanne", role: "monitored", acknowledged: true)]), "Sanne is on the way")
        XCTAssertEqual(ActivityText.outcome([try notification("Thomas", acknowledged: true)]), "Thomas has seen this")
    }
}
