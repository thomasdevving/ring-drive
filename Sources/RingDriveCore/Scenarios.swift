import Foundation

public enum DemoScenario: String, CaseIterable, Identifiable, Sendable {
    case package, rearDoor, lowConfidence, stale, duplicates
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .package: "Package delivered"
        case .rearDoor: "Side entrance → rear door"
        case .lowConfidence: "Low-confidence evidence"
        case .stale: "Stale evidence"
        case .duplicates: "Duplicate Ring deliveries"
        }
    }
    public func events(now: Date) -> [CameraEvent] {
        let batch = UUID().uuidString
        func e(_ n: Int, _ zone: Zone, _ kind: EventKind, _ seconds: Double, _ confidence: Double = 0.94) -> CameraEvent {
            .init(id: "\(batch)-\(n)", deviceID: "demo-\(zone.rawValue)", zone: zone, kind: kind,
                  occurredAt: now.addingTimeInterval(seconds), confidence: confidence, source: .synthetic)
        }
        switch self {
        case .package: return [e(1, .front, .person, -24), e(2, .front, .package, -12), e(3, .front, .departed, -3)]
        case .rearDoor: return [e(1, .side, .person, -100), e(2, .rear, .person, -80), e(3, .rear, .person, -2)]
        case .lowConfidence: return [e(1, .side, .person, -100, 0.4), e(2, .rear, .person, -80, 0.45), e(3, .rear, .person, -2, 0.35)]
        case .stale: return [e(1, .side, .person, -600), e(2, .rear, .person, -580), e(3, .rear, .person, -480)]
        case .duplicates:
            let events = DemoScenario.rearDoor.events(now: now)
            return events + events
        }
    }
}
