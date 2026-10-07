import XCTest
@testable import RingDriveCore

final class DemoScenarioTests: XCTestCase {
    func testMultiCameraScenarioIsUrgentWithAnEightyFiveSecondBackDoorSpan() {
        let now = Date(timeIntervalSince1970: 1_791_000_000)
        let events = DemoScenario.multiCamera.events(now: now)
        let decision = TriageEngine().evaluate(events, now: now)
        XCTAssertEqual(decision.priority, .urgent)
        XCTAssertTrue(decision.explanation.contains("85 seconds"))
        XCTAssertTrue(events.allSatisfy { $0.source == .synthetic })
        let incident = Incident(events: events, decision: decision, now: now)
        XCTAssertEqual(incident.cameraSegments.map(\.zone), [.side, .rear])
        XCTAssertEqual(incident.cameraSegments.map(\.seconds), [0, 85])
        XCTAssertEqual(incident.cameraSegments.map { $0.events.count }, [1, 3])
    }
}
