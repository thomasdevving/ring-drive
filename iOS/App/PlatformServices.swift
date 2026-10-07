import SwiftUI
import MapKit
import CoreLocation
import CoreMotion
import AVFoundation
import ActivityKit
import UserNotifications
import Security
import RingDriveCore

@MainActor final class MotionMonitor: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionActivityManager()
    private var motionAt: Date?
    private var stationary = false
    private var confidence = 0.0
    var latestLocation: CLLocation?
    var onSample: ((MotionSample) -> Void)?
    var onFailure: ((String) -> Void)?
    override init() { super.init(); locationManager.delegate = self; locationManager.desiredAccuracy = kCLLocationAccuracyBest; locationManager.activityType = .automotiveNavigation }
    func start() {
        locationManager.requestWhenInUseAuthorization()
        guard CMMotionActivityManager.isActivityAvailable() else { onFailure?("Motion sensing is unavailable. Video stays locked; use the labeled simulator path for the demo."); return }
        motionManager.startActivityUpdates(to: .main) { [weak self] activity in
            Task { @MainActor in
                guard let self, let activity else { return }
                self.motionAt = Date(); self.stationary = activity.stationary && !activity.automotive && !activity.walking && !activity.running
                self.confidence = activity.confidence == .high ? 0.95 : (activity.confidence == .medium ? 0.6 : 0.3)
            }
        }
        locationManager.startUpdatingLocation()
    }
    func stop() { motionManager.stopActivityUpdates(); locationManager.stopUpdatingLocation(); latestLocation = nil; motionAt = nil }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            onFailure?("Location permission denied. Enable it in Settings to search nearby stops and verify standstill.")
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }; latestLocation = location
        let freshMotion = motionAt.map { Date().timeIntervalSince($0) <= 3 } ?? false
        onSample?(.init(at: location.timestamp, speed: location.speed, speedAccuracy: location.speedAccuracy,
                        horizontalAccuracy: location.horizontalAccuracy, motionStationary: stationary && freshMotion,
                        motionConfidence: freshMotion ? confidence : 0, source: .sensors))
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { onFailure?("Location unavailable. Video remains locked. Try again outdoors.") }
}

@MainActor final class SpokenExplanation: NSObject, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private var completion: ((Bool) -> Void)?
    private var activeUtterance: AVSpeechUtterance?
    override init() { super.init(); synth.delegate = self }
    func speak(_ text: String, completion: @escaping (Bool) -> Void) throws {
        cancel()
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        self.completion = completion
        let utterance = AVSpeechUtterance(string: text); utterance.voice = AVSpeechSynthesisVoice(language: "en-GB"); utterance.rate = 0.52
        activeUtterance = utterance
        synth.speak(utterance)
    }
    func cancel() { let previous = completion; completion = nil; activeUtterance = nil; synth.stopSpeaking(at: .immediate); previous?(false) }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in guard self.activeUtterance === utterance else { return }; let callback = self.completion; self.completion = nil; self.activeUtterance = nil; callback?(true); try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in guard self.activeUtterance === utterance else { return }; let callback = self.completion; self.completion = nil; self.activeUtterance = nil; callback?(false) }
    }
}

@MainActor final class LiveActivityPresenter {
    private var activity: Activity<DriveActivityAttributes>?
    var status = "Not started"
    func update(_ incident: Incident, safety: SafetyVerdict) async {
        let state = DriveActivityAttributes.ContentState(
            headline: incident.status == .resolved ? "Observed activity ended" : (incident.decision.priority == .urgent ? "Activity at the rear door" : "Home update"),
            detail: incident.status == .resolved ? "Departure evidence · route unchanged" : (incident.decision.priority == .passive ? "Delivered · no action needed" : (VideoGuard.permits(incident: incident, safety: safety) ? "Parked · review on iPhone" : "Video locked · stop safely")),
            urgent: incident.status == .active && incident.decision.priority == .urgent,
            videoLocked: !VideoGuard.permits(incident: incident, safety: safety),
            synthetic: incident.events.first?.source == .synthetic)
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(180))
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { status = "Live Activities disabled in Settings"; return }
        if activity?.attributes.incidentID != incident.id.uuidString {
            if let old = activity { await old.end(nil, dismissalPolicy: .immediate) }
            do {
                activity = try Activity.request(attributes: .init(incidentID: incident.id.uuidString), content: content, pushType: nil)
                status = "Live Activity active"
            } catch { status = "Live Activity unavailable: \(error.localizedDescription)" }
        } else if let activity {
            // Urgent notification requests are centrally deduplicated by the incident policy.
            // Live Activity state and parking updates must never repeat their sound.
            await activity.update(content, alertConfiguration: nil)
        }
    }
    func clear() async { for a in Activity<DriveActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }; activity = nil; status = "Not started" }
}

enum TokenVault {
    static func save(_ token: String, key: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "RingDrive", kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
        guard !token.isEmpty else { return }
        var item = query; item[kSecValueData as String] = Data(token.utf8); item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
    static func read(key: String) -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "RingDrive", kSecAttrAccount as String: key, kSecReturnData as String: true]
        var result: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
}

struct StopCandidate: Identifiable {
    let id = UUID()
    let item: MKMapItem
    let distance: CLLocationDistance
    let simulated: Bool
    var name: String { item.name ?? "Parking location" }
}

@MainActor enum SafeStopSearch {
    static let demoOrigin = CLLocation(latitude: 52.358, longitude: 4.881)
    static func search(near location: CLLocation) async throws -> [StopCandidate] {
        let request = MKLocalPointsOfInterestRequest(center: location.coordinate, radius: 5000)
        request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.parking, .gasStation])
        let result = try await MKLocalSearch(request: request).start()
        return result.mapItems.map { StopCandidate(item: $0, distance: location.distance(from: $0.placemark.location ?? location), simulated: false) }
            .sorted { $0.distance < $1.distance }.prefix(5).map { $0 }
    }
    static func demoStops() -> [StopCandidate] {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: .init(latitude: 52.3578, longitude: 4.8797)))
        item.name = "Demo parking · Museumplein"
        return [.init(item: item, distance: 90, simulated: true)]
    }
    static func handoff(_ stop: StopCandidate, origin: CLLocation? = nil) async -> Bool {
        await withCheckedContinuation { continuation in
            let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive }
            let options = [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving]
            if let origin {
                let start = MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate))
                start.name = "Demo start · Museumplein"
                MKMapItem.openMaps(with: [start, stop.item], launchOptions: options, from: scene) { continuation.resume(returning: $0) }
            } else {
                stop.item.openInMaps(launchOptions: options, from: scene) { continuation.resume(returning: $0) }
            }
        }
    }
}
