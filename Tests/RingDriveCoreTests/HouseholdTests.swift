import XCTest
@testable import RingDriveCore

final class HouseholdTests: XCTestCase {
    func testDrivingSignalPrefersCarPlayThenConfidentMotion() {
        XCTAssertEqual(DrivingSignal.evaluate(carPlayAudio: true, automotive: false, automotiveConfidence: 0, simulatedDriving: nil), .init(driving: true, source: "carplay"))
        XCTAssertEqual(DrivingSignal.evaluate(carPlayAudio: false, automotive: true, automotiveConfidence: 0.95, simulatedDriving: nil), .init(driving: true, source: "motion"))
        XCTAssertFalse(DrivingSignal.evaluate(carPlayAudio: false, automotive: true, automotiveConfidence: 0.3, simulatedDriving: nil).driving)
        XCTAssertEqual(DrivingSignal.evaluate(carPlayAudio: true, automotive: true, automotiveConfidence: 1, simulatedDriving: false), .init(driving: false, source: "simulated"))
    }

    func testCallsUseValidatedTelLinksAndEmergencyContactsFirst() {
        XCTAssertEqual(CallLink.url(for: "+31612345678")?.absoluteString, "tel:+31612345678")
        XCTAssertNil(CallLink.url(for: "0612345678;evil"))
        XCTAssertNil(CallLink.url(for: nil))
        let contacts = [HouseholdContact(id: "1", name: "Thomas", role: .household, priority: 1, channel: "app", phone: "+31611111111", drivingState: nil),
                        HouseholdContact(id: "2", name: "Oma", role: .emergency, priority: 5, channel: "call", phone: "+31622222222", drivingState: nil),
                        HouseholdContact(id: "3", name: "Sanne", role: .monitored, priority: 1, channel: "app", phone: nil, drivingState: nil)]
        XCTAssertEqual(CallLink.callable(contacts).map(\.name), ["Oma", "Thomas"])
    }

    func testNotificationAcknowledgementWording() throws {
        let json = #"{"id":"n","incidentId":"i","contactId":"c","contactName":"Sanne","role":"monitored","message":"m","status":"delivered","channel":"app","createdAt":"2026-10-07T06:17:00.000Z"}"#
        let item = try JSONDecoder().decode(HouseholdNotification.self, from: Data(json.utf8))
        XCTAssertEqual(item.acknowledgeTitle, "I'm on my way")
        XCTAssertFalse(item.isAcknowledged)
    }
}
