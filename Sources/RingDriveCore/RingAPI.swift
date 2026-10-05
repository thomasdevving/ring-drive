import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct RingDevice: Codable, Identifiable, Sendable {
    public let id: String
    public let attributes: Attributes
    public struct Attributes: Codable, Sendable { public let name: String?; public let description: String? }
    public var displayName: String { attributes.name ?? attributes.description ?? id }
}
public enum RingAPIError: LocalizedError {
    case missingToken, http(Int), invalidPayload, noRecording, unsafe, invalidOrigin
    public var errorDescription: String? {
        switch self {
        case .missingToken: "Enter the backend client key in Demo & Ring. Ring OAuth tokens belong only on the backend."
        case .http(401): "Backend access denied. Check the backend client key."
        case .http(424): "Ring token expired or was rejected. Replace RING_ACCESS_TOKEN on the backend and restart it."
        case .http(503): "Ring backend is not configured. Set its simulator token locally and start it."
        case .http(403): "Ring access denied. Check consent and device permissions."
        case .http(429): "Ring rate limit reached. Wait before retrying."
        case .http(let code): "Ring returned HTTP \(code). Retry or check your account configuration."
        case .invalidPayload: "Ring returned an unexpected response. Keep the response schema for inspection."
        case .noRecording: "Ring has no recording at this timestamp (416). A media download does not start recording."
        case .unsafe: "Video is locked until safe parking is confirmed."
        case .invalidOrigin: "Use your HTTPS backend, or http://127.0.0.1 for the simulator. Ring API calls must run on the backend."
        }
    }
}

public struct RingHistoryEvent: Decodable, Sendable {
    public let id: String
    public let attributes: Attributes
    public struct Attributes: Decodable, Sendable {
        public let eventType: String
        public let start: Double
        public let end: Double?
        enum CodingKeys: String, CodingKey { case eventType = "event_type", start, end }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            eventType = try c.decode(String.self, forKey: .eventType)
            func number(_ key: CodingKeys) throws -> Double? {
                if let d = try? c.decode(Double.self, forKey: key) { return d }
                if let s = try? c.decode(String.self, forKey: key), let d = Double(s) { return d }
                return nil
            }
            guard let d = try number(.start), d.isFinite else { throw RingAPIError.invalidPayload }
            start = d; end = try number(.end)
        }
    }
    public func observation(deviceID: String, accountID: String, zone: Zone, personFiltered: Bool) -> CameraEvent {
        .init(id: id, accountID: accountID, deviceID: deviceID, zone: zone,
              kind: attributes.eventType == "ding" ? .doorbell : (personFiltered ? .person : .motion),
              occurredAt: Date(timeIntervalSince1970: attributes.start / 1000),
              confidence: personFiltered ? 0.8 : 0.72, source: .ringHistory)
    }
}
public struct RingHistoryPage: Decodable, Sendable {
    public let data: [RingHistoryEvent]
    public let links: Links?
    public struct Links: Decodable, Sendable { public let next: String? }
}
public struct RingWebhook: Decodable, Sendable {
    public let meta: Meta
    public let data: Resource
    public struct Meta: Decodable, Sendable {
        public let requestID: String
        public let accountID: String
        enum CodingKeys: String, CodingKey { case requestID = "request_id", accountID = "account_id" }
    }
    public struct Resource: Decodable, Sendable {
        public let id: String; public let type: String; public let attributes: Attributes
    }
    public struct Attributes: Decodable, Sendable {
        public let source: String; public let timestamp: Double; public let subType: String?; public let componentIDs: [String]?
        enum CodingKeys: String, CodingKey { case source, timestamp, subType = "sub_type", componentIDs = "component_ids" }
    }
    public func observations(zone: Zone) -> [CameraEvent] {
        guard data.type == "motion_detected" || data.type == "button_press" else { return [] }
        let kind: EventKind = data.type == "button_press" ? .doorbell : (data.attributes.subType == "human" ? .person : .motion)
        return (data.attributes.componentIDs ?? [""]).map {
            .init(id: data.id + ($0.isEmpty ? "" : ":\($0)"), accountID: meta.accountID, deviceID: data.attributes.source,
                  componentID: $0.isEmpty ? nil : $0, zone: zone, kind: kind,
                  occurredAt: Date(timeIntervalSince1970: data.attributes.timestamp / 1000), confidence: kind == .person ? 0.8 : 0.72, source: .ringWebhook)
        }
    }
}

private final class RejectRingRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

// Native transport to our backend. OAuth credentials never enter this client.
public struct RingAPI: Sendable {
    public static let officialOrigin = URL(string: "https://api.amazonvision.com")!
    private let base: URL
    private let token: String
    private let session: URLSession
    public init(backend: URL, clientToken: String, session: URLSession? = nil) throws {
        guard let host = backend.host, !host.isEmpty, !["api.amazonvision.com", "oauth.ring.com"].contains(host.lowercased()),
              backend.user == nil, backend.password == nil, backend.query == nil, backend.fragment == nil,
              backend.path.isEmpty || backend.path == "/",
              backend.scheme == "https" || (["localhost", "127.0.0.1"].contains(host) && backend.scheme == "http") else { throw RingAPIError.invalidOrigin }
        self.base = backend.appendingPathComponent("ring"); self.token = clientToken
        self.session = session ?? URLSession(configuration: .ephemeral, delegate: RejectRingRedirects(), delegateQueue: nil)
    }
    public func accountID() async throws -> String {
        struct Response: Decodable { let data: User }
        struct User: Decodable { let id: String; let type: String }
        let profile = try JSONDecoder().decode(Response.self, from: await request(path: "v1/users/me"))
        guard profile.data.type == "users", !profile.data.id.isEmpty else { throw RingAPIError.invalidPayload }
        return profile.data.id
    }
    public func runtimeProof() async throws -> Data {
        let data = try await request(path: "proof")
        guard let proof = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              proof["verified"] as? Bool == true, proof["origin"] as? String == Self.officialOrigin.absoluteString else { throw RingAPIError.invalidPayload }
        return data
    }
    public func devices() async throws -> [RingDevice] {
        struct Response: Decodable { let data: [RingDevice] }
        return try JSONDecoder().decode(Response.self, from: await request(path: "v1/devices")).data
    }
    public func history(deviceID: String, cursor: String? = nil) async throws -> RingHistoryPage {
        let id = deviceID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? ""
        var parts = URLComponents(); parts.queryItems = [URLQueryItem(name: "event_types", value: "motion.human,ding")]
        if let cursor { parts.queryItems?.append(URLQueryItem(name: "page[key]", value: cursor)) }
        return try JSONDecoder().decode(RingHistoryPage.self, from: await request(path: "v1/history/devices/\(id)/events", query: parts.query))
    }
    public func clip(event: CameraEvent, incident: Incident, safety: SafetyVerdict) async throws -> Data {
        guard VideoGuard.permits(incident: incident, safety: safety), event.source != .synthetic else { throw RingAPIError.unsafe }
        let id = event.deviceID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? ""
        var body: [String: Any] = ["timestamp": Int64(event.occurredAt.timeIntervalSince1970 * 1000), "duration": 5000,
                                   "video_options": ["codec": "avc"], "audio_options": ["audio_enabled": false]]
        if let component = event.componentID { body["components"] = [["component_id": component]] }
        return try await request(path: "v1/devices/\(id)/media/video/download", method: "POST", body: JSONSerialization.data(withJSONObject: body), video: true)
    }
    private func request(path: String, query: String? = nil, method: String = "GET", body: Data? = nil, video: Bool = false) async throws -> Data {
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw RingAPIError.missingToken }
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.percentEncodedQuery = query
        var request = URLRequest(url: components.url!); request.httpMethod = method; request.httpBody = body; request.timeoutInterval = 15
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if video { request.setValue("confirmed", forHTTPHeaderField: "X-Ring-Drive-Parking") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw RingAPIError.invalidPayload }
        if http.statusCode == 416 { throw RingAPIError.noRecording }
        guard (200...299).contains(http.statusCode) else { throw RingAPIError.http(http.statusCode) }
        if video && http.mimeType != "video/mp4" { throw RingAPIError.invalidPayload }
        return data
    }
}
