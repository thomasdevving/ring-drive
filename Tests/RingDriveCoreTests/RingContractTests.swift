import Foundation
import XCTest
@testable import RingDriveCore

// Transport contract fixtures. These do NOT establish authenticated Ring runtime usage.
final class ContractProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var responder: ((URLRequest) throws -> (Int, String, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (code, mime, data) = try Self.responder!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class RingContractTests: XCTestCase {
    func api() throws -> RingAPI {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ContractProtocol.self]
        return try RingAPI(token: "contract-token", session: URLSession(configuration: config))
    }
    func testOfficialDeviceEndpointAndBearerContract() async throws {
        ContractProtocol.responder = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.amazonvision.com/v1/devices")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer contract-token")
            return (200, "application/vnd.api+json", Data(#"{"data":[{"id":"device-1","attributes":{"name":"Rear camera"}}]}"#.utf8))
        }
        let devices = try await api().devices()
        XCTAssertEqual(devices.first?.displayName, "Rear camera")
    }
    func testRecordedMP4ContractAndMissingRecording() async throws {
        let now = Date(); let earlier = now.addingTimeInterval(-22)
        var safety = ParkingSafety()
        for i in 0...22 { safety.ingest(.init(at: earlier.addingTimeInterval(Double(i)), speed: 0, horizontalAccuracy: 4, motionStationary: true, motionConfidence: 0.95, source: .sensors)) }
        XCTAssertTrue(safety.confirmParked(now: now)); let verdict = safety.verdict(now: now)
        let event = CameraEvent(id: "real-event", deviceID: "camera", componentID: "1", zone: .rear, kind: .person, occurredAt: now.addingTimeInterval(-90), confidence: 0.8, source: .ringHistory)
        var incident = Incident(events: [event], decision: TriageEngine().evaluate([event], now: now), now: now)
        for state in [IncidentState.triaged, .notified, .explained, .stopRequested, .parkedConfirmed, .videoUnlocked] { try incident.transition(to: state, now: now, safety: verdict) }
        ContractProtocol.responder = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/devices/camera/media/video/download")
            let bytes: Data
            if let body = request.httpBody { bytes = body }
            else {
                let stream = request.httpBodyStream!; stream.open(); defer { stream.close() }; var result = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; result.append(contentsOf: buffer.prefix(count)) }; bytes = result
            }
            let body = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            XCTAssertEqual(body["duration"] as? Int, 5000)
            XCTAssertEqual((body["components"] as? [[String: String]])?.first?["component_id"], "1")
            return (206, "video/mp4", Data([0, 1, 2, 3]))
        }
        let bytes = try await api().clip(event: event, incident: incident, safety: verdict)
        XCTAssertEqual(bytes.count, 4)
        ContractProtocol.responder = { _ in (416, "application/json", Data()) }
        do { _ = try await api().clip(event: event, incident: incident, safety: verdict); XCTFail("Expected missing recording") }
        catch RingAPIError.noRecording {} catch { XCTFail("Unexpected error: \(error)") }
    }
}
