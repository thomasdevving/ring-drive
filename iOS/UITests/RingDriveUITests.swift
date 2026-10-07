import XCTest

final class RingDriveUITests: XCTestCase {
    var app: XCUIApplication!
    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication(); app.launchArguments = ["--demo-urgent", "-ring-backend-url", "http://127.0.0.1:8787"]; app.launch()
        XCTAssertTrue(app.buttons["listen"].waitForExistence(timeout: 10))
    }
    func visible(_ id: String) -> XCUIElement {
        let element = app.buttons[id]
        for _ in 0..<12 where !element.isHittable { app.swipeUp() }
        if !element.isHittable {
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "Synthetic demo accessibility: \(id)"; tree.lifetime = .keepAlways; add(tree)
        }
        XCTAssertTrue(element.isHittable, "Button not reachable: \(id)")
        return element
    }
    func explainAndFind() {
        app.buttons["listen"].tap()
        XCTAssertTrue(app.buttons["findStop"].waitForExistence(timeout: 40), "Only completed speech should allow the next step")
        visible("findStop").tap()
    }
    func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testEndToEndAudioStopParkReviewAndRelock() {
        screenshot("urgent-driving")
        XCTAssertFalse(app.buttons["reviewVideo"].exists)
        visible("openTimeline").tap()
        XCTAssertTrue(app.descendants(matching: .any)["timelineLocked"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["incidentTimeline"].exists)
        screenshot("timeline-locked-driving")
        app.navigationBars.buttons["Ring Drive"].tap()
        for _ in 0..<5 where !app.buttons["listen"].isHittable { app.swipeDown() }
        explainAndFind()
        visible("navigate").tap()
        if app.alerts.firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["OK"].tap() }
        visible("simulateArrival").tap()
        let confirm = visible("confirmParked")
        XCTAssertFalse(confirm.isEnabled, "Standstill must be sustained before confirmation")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: confirm)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 28), .completed)
        confirm.tap()
        let review = visible("reviewVideo"); XCTAssertTrue(review.isEnabled)
        screenshot("parked-unlocked")
        visible("openTimeline").tap()
        XCTAssertTrue(app.descendants(matching: .any)["incidentTimeline"].waitForExistence(timeout: 5))
        screenshot("parked-timeline-dark")
        let side = app.descendants(matching: .any).matching(identifier: "observation-side").firstMatch
        for _ in 0..<5 where !side.isHittable { app.swipeUp() }
        XCTAssertTrue(side.isHittable); side.tap()
        XCTAssertTrue(app.staticTexts["Demo side camera"].waitForExistence(timeout: 5))
        let moment = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Review illustrative demo clip")).firstMatch
        for _ in 0..<12 where !moment.isHittable { app.swipeUp() }
        if !moment.isHittable {
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "Synthetic camera review accessibility"; tree.lifetime = .keepAlways; add(tree)
        }
        XCTAssertTrue(moment.isHittable)
        screenshot("parked-camera-moment")
        moment.tap()
        XCTAssertTrue(app.navigationBars["Incident review"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["reviewedMoment"].label.contains("Side entrance"))
        screenshot("synthetic-video-review")
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertTrue(app.descendants(matching: .any)["timelineLocked"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["incidentTimeline"].exists)
        screenshot("timeline-relocked")
        app.navigationBars.buttons["Ring Drive"].tap()
        XCTAssertFalse(app.buttons["reviewVideo"].exists, "Backgrounding invalidates motion evidence and closes video")
    }
    func testIncidentUpdatesResolveAndReopenWithoutRepeatedAlertsOrNavigationReset() {
        explainAndFind()
        visible("navigate").tap()
        if app.alerts.firstMatch.waitForExistence(timeout: 3) { app.alerts.buttons["OK"].tap() }
        XCTAssertTrue(app.staticTexts["driverProgress"].exists)
        app.tabBars.buttons["Demo & Ring"].tap()
        visible("appendActivity").tap()
        let reference = app.staticTexts["incidentReference"].label
        XCTAssertEqual(app.staticTexts["observationCount"].label, "Observations, 4")
        XCTAssertEqual(app.staticTexts["alertRequestCount"].label, "Urgent alert requests, 1")
        visible("repeatDelivery").tap()
        XCTAssertEqual(app.staticTexts["observationCount"].label, "Observations, 4")
        XCTAssertEqual(app.staticTexts["alertRequestCount"].label, "Urgent alert requests, 1")
        screenshot("incident-updates-light")
        visible("departureEvidence").tap()
        let status = app.staticTexts["incidentStatus"]
        let resolved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == 'Status, Resolved'"), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [resolved], timeout: 16), .completed)
        XCTAssertEqual(app.staticTexts["incidentReference"].label, reference)
        screenshot("incident-resolved-light")
        app.tabBars.buttons["Drive"].tap()
        XCTAssertTrue(app.staticTexts["Observed activity ended"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["driverProgress"].exists)
        XCTAssertFalse(app.buttons["reviewVideo"].exists)
        screenshot("resolved-driving")
        app.tabBars.buttons["Demo & Ring"].tap()
        visible("appendActivity").tap()
        XCTAssertEqual(app.staticTexts["incidentStatus"].label, "Status, Active")
        XCTAssertEqual(app.staticTexts["incidentReference"].label, reference)
        XCTAssertEqual(app.staticTexts["alertRequestCount"].label, "Urgent alert requests, 1")
        app.tabBars.buttons["Drive"].tap()
        XCTAssertTrue(app.staticTexts["driverProgress"].exists)
        XCTAssertFalse(app.buttons["findStop"].exists, "Reopened activity needs updated speech before new actions")
        XCTAssertFalse(app.buttons["reviewVideo"].exists)
    }
    func testNoStopResultKeepsVideoLocked() {
        app.tabBars.buttons["Demo & Ring"].tap()
        let fault = app.switches["noStops"]
        for _ in 0..<4 where !fault.isHittable { app.swipeUp() }
        XCTAssertTrue(fault.isHittable)
        fault.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertEqual(fault.value as? String, "1", "The fault must be enabled before exercising search")
        app.tabBars.buttons["Drive"].tap()
        explainAndFind()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.alerts.staticTexts.containing(NSPredicate(format: "label CONTAINS 'No nearby'")).firstMatch.exists)
        app.alerts.buttons["OK"].tap()
        XCTAssertFalse(app.buttons["reviewVideo"].exists)
    }
    func testConnectionFormRejectsDirectRingOrigin() {
        app.tabBars.buttons["Demo & Ring"].tap()
        let connect = visible("connectBackend")
        let backend = app.textFields["backendURL"]
        for _ in 0..<3 where !backend.isHittable { app.swipeDown() }
        XCTAssertTrue(backend.isHittable)
        XCTAssertTrue(app.staticTexts["Backend URL"].exists)
        XCTAssertTrue(app.staticTexts["Backend client key"].exists)
        XCTAssertTrue(app.secureTextFields["backendKey"].exists)
        screenshot("backend-connection-settings")
        let original = backend.value as? String ?? "http://127.0.0.1:8787"
        backend.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.75)).tap()
        backend.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue,count:original.count))
        XCTAssertEqual(backend.value as? String, "", "Clear the field before typing the forbidden origin")
        backend.typeText("https://api.amazonvision.com")
        XCTAssertEqual(backend.value as? String, "https://api.amazonvision.com")
        for _ in 0..<3 where !connect.isHittable { app.swipeUp() }
        connect.tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout:5))
        XCTAssertTrue(app.alerts.staticTexts.containing(NSPredicate(format:"label CONTAINS 'must run on the backend'")).firstMatch.exists)
        app.alerts.buttons["OK"].tap()
        for _ in 0..<3 where !backend.isHittable { app.swipeDown() }
        backend.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.75)).tap()
        backend.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue,count:"https://api.amazonvision.com".count))
        XCTAssertEqual(backend.value as? String, "")
        backend.typeText(original)
        XCTAssertEqual(backend.value as? String, original)
        app.tabBars.buttons["Drive"].tap()
        XCTAssertFalse(app.buttons["reviewVideo"].exists)
    }
    func testPassiveScenarioAndDuplicateSuppression() {
        app.tabBars.buttons["Demo & Ring"].tap()
        visible("scenario-package").tap()
        XCTAssertTrue(app.staticTexts["No action needed"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["reviewVideo"].exists)
        app.tabBars.buttons["Demo & Ring"].tap()
        visible("scenario-duplicates").tap()
        XCTAssertTrue(app.staticTexts["Needs your attention"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Demo & Ring"].tap()
        let count = app.staticTexts["duplicateCount"]
        for _ in 0..<4 where !count.isHittable { app.swipeUp() }
        XCTAssertTrue(count.isHittable)
        XCTAssertEqual(count.label, "Duplicate deliveries ignored, 3")
    }
    func testOnlineMapKitSearchAndMapsHandoff() throws {
        app.tabBars.buttons["Demo & Ring"].tap()
        screenshot("phone-light-settings")
        let offline = app.switches["Offline stop-search rehearsal"]
        for _ in 0..<4 where !offline.isHittable { app.swipeUp() }
        XCTAssertTrue(offline.isHittable)
        offline.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertEqual(offline.value as? String, "0")
        app.tabBars.buttons["Drive"].tap()
        explainAndFind()
        let navigate = app.buttons.matching(identifier: "navigate").firstMatch
        if !navigate.waitForExistence(timeout: 30) {
            XCTAssertFalse(app.buttons["reviewVideo"].exists)
            screenshot("online-search-unavailable")
            throw XCTSkip("MapKit returned no accessible stop; inspect connectivity or service coverage. Video remained locked.")
        }
        for _ in 0..<6 where !navigate.isHittable { app.swipeUp() }
        XCTAssertTrue(navigate.isHittable)
        XCTAssertEqual(navigate.label, "Navigate with Apple Maps")
        screenshot("real-mapkit-results")
        navigate.tap()
        let maps = XCUIApplication(bundleIdentifier: "com.apple.Maps")
        XCTAssertTrue(maps.wait(for: .runningForeground, timeout: 15), "Apple Maps must actually open")
        let handoffCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        handoffCapture.name = "apple-maps-handoff"; handoffCapture.lifetime = .keepAlways; add(handoffCapture)
        app.activate()
        // iOS can dismiss an alert while moving the app to the background.
        // Validate the persisted navigation transition rather than alert lifetime.
        if app.alerts.firstMatch.exists { app.alerts.buttons["OK"].tap() }
        XCTAssertFalse(app.buttons["reviewVideo"].exists)
        let state = app.staticTexts["driverProgress"]
        for _ in 0..<6 where !state.isHittable { app.swipeUp() }
        XCTAssertTrue(state.isHittable, "Successful Maps handoff must preserve navigation without opening the parked timeline")
    }
}
