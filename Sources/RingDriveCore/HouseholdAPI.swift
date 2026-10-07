import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Stored spoken summary for an incident. Generated on the backend (Amazon Bedrock or template) when the
/// incident is created or changes, so reading it at tap time never waits for a model.
public struct StoredSummary: Codable, Equatable, Sendable {
    public let text: String
    public let source: String
    public let basedOn: Int
    public let status: String?
    public init(text: String, source: String, basedOn: Int, status: String? = nil) {
        self.text = text; self.source = source; self.basedOn = basedOn; self.status = status
    }
    /// Usable only when it describes the same observation set the driver is about to hear about.
    public func matches(_ incident: Incident) -> Bool { basedOn == incident.events.count && !text.isEmpty }
}

/// Payload for POST /incidents. Camera names come from the Ring device list; no person identity is sent.
public struct IncidentSyncPayload: Encodable, Equatable, Sendable {
    public struct Observation: Encodable, Equatable, Sendable {
        public let id: String, deviceId: String, zone: String, kind: String, atMs: Int64, confidence: Double
        public let cameraName: String?, componentId: String?
    }
    public let id: String, priority: String, simulated: Bool, timeZone: String
    public let observations: [Observation]
    public init(incident: Incident, cameraNames: [String: String], timeZone: TimeZone = .current) {
        id = incident.id.uuidString.lowercased(); priority = incident.decision.priority.rawValue
        simulated = incident.events.first?.source == .synthetic; self.timeZone = timeZone.identifier
        observations = incident.events.map {
            .init(id: $0.deduplicationKey, deviceId: $0.deviceID, zone: $0.zone.rawValue, kind: $0.kind.rawValue,
                  atMs: Int64(($0.occurredAt.timeIntervalSince1970 * 1000).rounded()), confidence: $0.confidence,
                  cameraName: cameraNames[$0.deviceID], componentId: $0.componentID)
        }
    }
}

/// An incident as stored on the backend (absence incidents originate there).
public struct BackendIncident: Decodable, Equatable, Sendable {
    public let id: String
    public let type: String
    public let state: String
    public let status: String
    public let simulated: Bool?
    public let ruleName: String?
    public let summary: StoredSummary?
    public var uuid: UUID? { UUID(uuidString: id) }
}

/// One audit entry mirrored to the backend timeline. The entry id makes retries idempotent.
public struct AuditPayload: Encodable, Equatable, Sendable {
    public let id: String, at: String, state: String, note: String, choice: String?, source: String
    public init(_ entry: AuditEntry, source: String = "driver-app") {
        id = entry.id.uuidString.lowercased(); state = entry.state.rawValue; note = entry.note; choice = entry.choice?.rawValue; self.source = source
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        at = formatter.string(from: entry.at)
    }
    /// Driver-side states are mirrored; detection and notification are recorded by the backend itself.
    public static func mirrors(_ entry: AuditEntry) -> Bool { ![.detected, .triaged, .notified].contains(entry.state) }
}

public enum HouseholdAPIError: LocalizedError, Equatable {
    case invalidOrigin, missingToken, http(Int), invalidPayload
    public var errorDescription: String? {
        switch self {
        case .invalidOrigin: "Use your HTTPS backend, or http://127.0.0.1 for the simulator."
        case .missingToken: "Enter the backend client key in Demo & Ring."
        case .http(401): "Backend access denied. Check the backend client key."
        case .http(let code): "The Ring Drive backend returned HTTP \(code)."
        case .invalidPayload: "The Ring Drive backend returned an unexpected response."
        }
    }
}

/// Client for the household endpoints of our own backend (incidents, summaries, and later contacts).
public struct HouseholdAPI: Sendable {
    private let base: URL
    private let token: String
    private let session: URLSession
    public init(backend: URL, clientToken: String, session: URLSession? = nil) throws {
        guard BackendOrigin.isAllowed(backend) else { throw HouseholdAPIError.invalidOrigin }
        guard !clientToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw HouseholdAPIError.missingToken }
        base = backend; token = clientToken
        self.session = session ?? URLSession(configuration: .ephemeral, delegate: RejectRingRedirects(), delegateQueue: nil)
    }
    public func sync(_ incident: Incident, cameraNames: [String: String], timeZone: TimeZone = .current) async throws {
        let body = try JSONEncoder().encode(IncidentSyncPayload(incident: incident, cameraNames: cameraNames, timeZone: timeZone))
        _ = try await request("incidents", method: "POST", body: body)
    }
    public func summary(incidentID: UUID) async throws -> StoredSummary {
        struct Envelope: Decodable { let data: StoredSummary }
        let data = try await request("incidents/\(incidentID.uuidString.lowercased())/summary", timeout: 3)
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { throw HouseholdAPIError.invalidPayload }
        return envelope.data
    }
    /// Active incidents of one type that the driver app should know about (for example ABSENCE).
    public func activeIncidents(type: String) async throws -> [BackendIncident] {
        struct Envelope: Decodable { let data: [BackendIncident] }
        let data = try await request("incidents", query: [URLQueryItem(name: "type", value: type), URLQueryItem(name: "active", value: "1")])
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { throw HouseholdAPIError.invalidPayload }
        return envelope.data
    }
    public func recordAudit(incidentID: UUID, entries: [AuditEntry], source: String = "driver-app") async throws {
        struct Body: Encodable { let entries: [AuditPayload] }
        let body = try JSONEncoder().encode(Body(entries: entries.map { AuditPayload($0, source: source) }))
        _ = try await request("incidents/\(incidentID.uuidString.lowercased())/audit", method: "POST", body: body)
    }
    func request(_ path: String, query: [URLQueryItem] = [], method: String = "GET", body: Data? = nil, timeout: TimeInterval = 10) async throws -> Data {
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!); request.httpMethod = method; request.httpBody = body
        request.timeoutInterval = timeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw HouseholdAPIError.invalidPayload }
        guard (200...299).contains(http.statusCode) else { throw HouseholdAPIError.http(http.statusCode) }
        return data
    }
}
