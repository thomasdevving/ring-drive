import SwiftUI
import RingDriveCore
import AVFoundation
import MapKit
import UserNotifications

@MainActor final class AppModel: ObservableObject {
    static let shared = AppModel()
    @Published var current: Incident?
    @Published var history: [Incident] = []
    @Published var verdict = ParkingSafety().verdict(now: Date())
    @Published var demoMode = true
    @Published var demoStationary = false
    @Published var speaking = false
    @Published var searching = false
    @Published var loadingRing = false
    @Published var stops: [StopCandidate] = []
    @Published var message: String?
    @Published var player: AVPlayer?
    @Published var showingVideo = false
    @Published var reviewedEvent: CameraEvent?
    @Published var selectedTab = 0
    @Published var devices: [RingDevice] = []
    @Published var zones: [String: Zone] = [:]
    @Published var runtimeStatus = "Ring not connected · synthetic demo available"
    @Published var activityStatus = "Not started"
    @Published var noStops = false
    @Published var deniedLocation = false
    @Published var handoffFailure = false
    @Published var uncertainParking = false
    @Published var offlineStops = true
    @Published var relayURL = "http://127.0.0.1:8787" {
        didSet { UserDefaults.standard.set(relayURL, forKey: "ring-backend-url") }
    }
    @Published var duplicateCount = 0
    @Published var departureChecksRemaining = 0
    /// Backend-generated spoken summaries (Bedrock or template), fetched ahead of time.
    @Published var summaries: [UUID: StoredSummary] = [:]
    private var safety = ParkingSafety(allowsSimulation: true)
    private var ledger = EventLedger()
    private let speech = SpokenExplanation()
    private let live = LiveActivityPresenter()
    private let motion = MotionMonitor()
    private var timer: Timer?
    private var pollTask: Task<Void, Never>?
    private var departureTask: Task<Void, Never>?
    private var departureStartedAt: Date?
    private var lifecycleActive = true
    private var clipGeneration = 0
    private var speechGeneration = 0
    private var lastActivityState = ""
    private var syncTask: Task<Void, Never>?
    /// Household backend client; nil until a backend URL and client key are configured.
    var household: HouseholdAPI? {
        guard let url = URL(string: relayURL) else { return nil }
        return try? HouseholdAPI(backend: url, clientToken: backendToken)
    }
    var canReview: Bool { VideoGuard.permits(incident: current, safety: safety.verdict(now: Date())) }
    var canInspectTimeline: Bool { ParkedReviewGuard.permits(safety: safety.verdict(now: Date())) }
    func incident(id: UUID) -> Incident? { current?.id == id ? current : history.first { $0.id == id } }
    func cameraName(for event: CameraEvent) -> String {
        devices.first { $0.id == event.deviceID }?.displayName
            ?? (event.source == .synthetic ? "Demo \(event.zone.rawValue) camera" : "Camera \(event.deviceID)")
    }
    var backendToken: String { TokenVault.read(key: "relay-token") }
    private var ringAccountID: String?
    private var connectedAPI: RingAPI?
    private var connectedBackend: URL?
    private func ringAPI() throws -> RingAPI {
        guard let connectedAPI else { throw RingAPIError.missingToken }
        return connectedAPI
    }
    private var storage: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("incidents.json") }
    init() {
        relayURL = UserDefaults.standard.string(forKey: "ring-backend-url") ?? relayURL
        // Remove the obsolete direct-API credential saved by earlier demo builds.
        TokenVault.save("", key: "ring-token")
        #if !targetEnvironment(simulator)
        demoMode = false; safety = ParkingSafety()
        #endif
        if let data = try? Data(contentsOf: storage), let saved = try? JSONDecoder().decode([Incident].self, from: data) { history = saved }
        zones = (UserDefaults.standard.dictionary(forKey: "zones") as? [String: String] ?? [:]).compactMapValues(Zone.init(rawValue:))
        motion.onSample = { [weak self] sample in guard let self, !self.demoMode else { return }; self.safety.ingest(sample); self.tick() }
        motion.onFailure = { [weak self] text in self?.message = text; self?.safety.invalidate(); self?.tick() }
        if !demoMode { motion.start() }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
        if ProcessInfo.processInfo.arguments.contains("--demo-urgent") { run(.rearDoor) }
    }
    func setDemoMode(_ enabled: Bool) {
        cancelExplanation(); cancelDepartureVerification(); stopPolling(); closeVideo(); motion.stop()
        demoMode = enabled; demoStationary = false; safety = ParkingSafety(allowsSimulation: enabled)
        current?.revokeVideo(now: Date(), reason: "Evidence source changed")
        if !enabled { motion.start() }
        tick()
    }
    func setActive(_ active: Bool) {
        lifecycleActive = active
        if !active { safety.invalidate(); closeVideo(); cancelExplanation(); cancelDepartureVerification() }
        tick()
    }
    func tick() {
        let now = Date()
        if let departureStartedAt { departureChecksRemaining = max(0, Int(ceil(IncidentUpdatePolicy.departureInterval - now.timeIntervalSince(departureStartedAt)))) }
        if demoMode && lifecycleActive {
            safety.ingest(.init(at: now, speed: demoStationary ? 0 : 14, horizontalAccuracy: uncertainParking ? 90 : 4,
                                motionStationary: demoStationary && !uncertainParking, motionConfidence: uncertainParking ? 0.3 : 0.95, source: .simulator))
        }
        verdict = safety.verdict(now: now)
        if !verdict.allowsVideo {
            current?.revokeVideo(now: now, reason: verdict.reason)
            if showingVideo || player != nil { closeVideo() }
        }
        if let current {
            let key = "\(current.id)\(current.state)\(current.assessments.last?.id.uuidString ?? "")\(current.status)\(verdict.allowsVideo)"
            if key != lastActivityState { lastActivityState = key; Task { await live.update(current, safety: verdict); activityStatus = live.status } }
        }
        persist()
    }
    func run(_ scenario: DemoScenario) {
        if !demoMode { setDemoMode(true) }
        cancelExplanation(); cancelDepartureVerification(); closeVideo(); stops = []; message = nil; demoStationary = false; safety.invalidate(); tick()
        receive(scenario.events(now: Date()), replace: true)
        runtimeStatus = "Synthetic scenario · no Ring runtime proof"
        selectedTab = 0
    }
    func receive(_ incoming: [CameraEvent], replace: Bool = false) {
        guard Set(incoming.map(\.accountID)).count <= 1,
              Set(incoming.map { $0.source == .synthetic }).count <= 1 else {
            message = "Evidence from different households or simulation sources cannot be combined."; return
        }
        let accepted = incoming.filter { ledger.ingest($0, now: Date()) }; duplicateCount = ledger.duplicateCount
        guard !accepted.isEmpty else { return }
        let now = Date()
        var change = IncidentChange.continued
        if replace || current == nil || current?.canJoin(accepted, now: now) != true {
            cancelExplanation(); closeVideo(); stops = []
            if let current { history.insert(current, at: 0) }
            let d = TriageEngine().evaluate(accepted, now: now); current = Incident(events: accepted, decision: d, now: now)
            transition(.triaged)
            transition(.notified)
        } else if var incident = current {
            change = incident.appendEvidence(accepted, now: now)
            guard change != .ignored else { return }
            current = incident
            if change.requiresNewExplanation { cancelExplanation(); closeVideo() }
            else if change == .resolved { cancelExplanation() }
        }
        if var incident = current {
            if incident.requestUrgentAlert(now: now, reopened: change == .reopened) { current = incident; notify(incident) }
            if incident.status == .resolved {
                UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [incident.id.uuidString])
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [incident.id.uuidString])
            }
        }
        tick()
        syncCurrent()
    }
    /// Sends the incident to the backend, which stores a spoken summary; the summary is fetched in the
    /// background so Listen never waits for Bedrock. Failures are silent: the local explanation remains.
    func syncCurrent() {
        guard let incident = current, let api = household else { return }
        let names = Dictionary(devices.map { ($0.id, $0.displayName) }, uniquingKeysWith: { first, _ in first })
        syncTask?.cancel()
        syncTask = Task { [weak self] in
            do {
                try await api.sync(incident, cameraNames: names)
                for delay in [1.5, 4.0, 10.0, 20.0] {
                    try await Task.sleep(for: .seconds(delay))
                    let summary = try await api.summary(incidentID: incident.id)
                    self?.summaries[incident.id] = summary
                    if summary.status == "ready" { break }
                }
            } catch {}
        }
    }
    /// The text the driver hears: the stored backend summary when it covers the current evidence.
    func spokenText(for incident: Incident) -> String {
        if let summary = summaries[incident.id], summary.matches(incident) { return summary.text }
        return incident.decision.explanation
    }
    func transition(_ next: IncidentState) {
        do { try current?.transition(to: next, now: Date(), safety: verdict); persist() }
        catch { message = "Action could not complete: \(error). Video remains protected." }
    }
    func explain() {
        guard let incident = current, !speaking else { return }
        speaking = true; let id = incident.id; let revision = incident.explanationRevisionID
        speechGeneration += 1; let generation = speechGeneration
        do {
            try speech.speak(spokenText(for: incident)) { [weak self] finished in
                guard let self, generation == self.speechGeneration else { return }; self.speaking = false
                guard self.current?.id == id else { return }
                if finished {
                    if self.current?.acknowledgeExplanation(revision: revision, now: Date()) != true {
                        self.message = "The incident changed during playback. Listen to the updated explanation before continuing."
                    }
                    self.persist()
                }
                if !finished { self.message = "Explanation interrupted. Tap Listen again before requesting a stop." }
            }
        } catch { speaking = false; message = "Audio is unavailable. Check the output volume and try Listen again." }
    }
    private func cancelExplanation() { speechGeneration += 1; speech.cancel(); speaking = false }
    func addDemoActivity(uncertain: Bool = false) {
        guard let incident = current, incident.events.first?.source == .synthetic,
              let anchor = incident.events.last(where: { $0.kind == .person || $0.kind == .motion || $0.kind == .doorbell }) else { return }
        receive([demoObservation(anchor: anchor, kind: .person, confidence: uncertain ? 0.3 : 0.94)])
    }
    func repeatDemoDelivery() {
        guard let event = current?.events.last, event.source == .synthetic else { return }
        receive([event])
    }
    func beginDepartureVerification() {
        guard departureTask == nil, let incident = current, incident.status == .active,
              incident.events.first?.source == .synthetic,
              let anchor = incident.events.last(where: { $0.kind == .person || $0.kind == .motion || $0.kind == .doorbell }) else { return }
        let id = incident.id; departureStartedAt = Date(); departureChecksRemaining = 10
        receive([demoObservation(anchor: anchor, kind: .departed)])
        departureTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10.1))
            guard !Task.isCancelled, let self, self.current?.id == id, self.lifecycleActive else { return }
            self.receive([self.demoObservation(anchor: anchor, kind: .departed)])
            self.departureTask = nil; self.departureStartedAt = nil; self.departureChecksRemaining = 0
        }
    }
    private func demoObservation(anchor: CameraEvent, kind: EventKind, confidence: Double = 0.94) -> CameraEvent {
        .init(id: UUID().uuidString, accountID: anchor.accountID, deviceID: anchor.deviceID, componentID: anchor.componentID,
              zone: anchor.zone, kind: kind, occurredAt: Date(), confidence: confidence, source: .synthetic)
    }
    private func cancelDepartureVerification() {
        departureTask?.cancel(); departureTask = nil; departureStartedAt = nil; departureChecksRemaining = 0
    }
    func findStop() async {
        guard current?.requiresExplanation == false else { return }
        guard current?.state == .explained || current?.state == .stopRequested || current?.state == .navigating else { return }
        if current?.state == .explained { transition(.stopRequested) }
        else if current?.state == .navigating { transition(.stopRequested) }
        searching = true; stops = []; defer { searching = false }
        if deniedLocation { message = "Location permission denied. Enable location in Settings or park at a place you can verify yourself."; return }
        if noStops { message = "No nearby parking or service station found. Continue safely and retry; video stays locked."; return }
        if demoMode && offlineStops { stops = SafeStopSearch.demoStops(); return }
        guard let location = demoMode ? SafeStopSearch.demoOrigin : motion.latestLocation,
              demoMode || (Date().timeIntervalSince(location.timestamp) <= 10 && location.horizontalAccuracy > 0 && location.horizontalAccuracy <= 50) else {
            message = "A fresh location is unavailable. Enable location and wait for a reliable fix."; return
        }
        do {
            stops = try await SafeStopSearch.search(near: location)
            if stops.isEmpty { message = "No nearby stop found. Continue safely and try again." }
        } catch { message = "Nearby search failed. Check connectivity and retry. Video stays locked." }
    }
    func navigate(_ stop: StopCandidate) async {
        guard current?.state == .stopRequested else { return }
        let incidentID = current?.id
        if handoffFailure { message = "Apple Maps could not open. Retry the handoff or choose another stop."; return }
        // The local rehearsal can simulate the handoff; real search always opens Apple Maps.
        let ok = stop.simulated ? true : await SafeStopSearch.handoff(stop, origin: demoMode ? SafeStopSearch.demoOrigin : nil)
        guard current?.id == incidentID, current?.state == .stopRequested else { return }
        if ok { transition(.navigating); message = stop.simulated ? "Simulated Maps handoff. Use Live MapKit search in Demo for real Apple Maps directions." : "Directions handed to Apple Maps. Arrival does not unlock video." }
        else { message = "Apple Maps did not accept the route. Retry; video stays locked." }
    }
    func simulateStandstill() { demoStationary = true; safety.invalidate(); tick() }
    func resumeDriving() { demoStationary = false; safety.invalidate(); tick() }
    func confirmParking() {
        guard current?.requiresExplanation == false else { message = "Listen to the updated explanation before confirming parking."; return }
        guard current?.state == .stopRequested || current?.state == .navigating else { return }
        guard safety.confirmParked(now: Date()) else { message = "Parking is not yet verified. Wait for 20 seconds of reliable, continuous standstill."; return }
        verdict = safety.verdict(now: Date()); transition(.parkedConfirmed); transition(.videoUnlocked); tick()
    }
    func review(event selectedEvent: CameraEvent? = nil) async {
        guard canReview, let incident = current else { message = verdict.reason; return }
        let selectedKey = selectedEvent?.deduplicationKey
        guard let event = selectedKey == nil ? incident.events.last(where: { $0.kind != .departed }) : incident.events.first(where: { $0.deduplicationKey == selectedKey }) else { return }
        let generation = clipGeneration
        if incident.events.first?.source == .synthetic {
            guard let url = Bundle.main.url(forResource: "demo-incident", withExtension: "mp4") else { message = "Synthetic demo clip is missing from the bundle."; return }
            reviewedEvent = event; player = AVPlayer(url: url); showingVideo = true; player?.play(); return
        }
        do {
            let api = try ringAPI()
            let bytes = try await api.clip(event: event, incident: incident, safety: safety.verdict(now: Date()))
            guard generation == clipGeneration, current?.id == incident.id, canReview else { return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("ring-review.mp4")
            try bytes.write(to: url, options: .atomic)
            guard canReview else { try? FileManager.default.removeItem(at: url); return }
            reviewedEvent = event; player = AVPlayer(url: url); showingVideo = true; player?.play()
            runtimeStatus = "Official Ring API · MP4 retrieved at runtime"
        } catch { message = error.localizedDescription }
    }
    func closeVideo() {
        clipGeneration += 1; player?.pause(); player?.replaceCurrentItem(with: nil); player = nil; showingVideo = false
        reviewedEvent = nil
        try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("ring-review.mp4"))
    }
    func connectRing(clientToken: String) async {
        let trimmed = clientToken.trimmingCharacters(in: .whitespacesAndNewlines)
        TokenVault.save(trimmed, key: "relay-token"); loadingRing = true; defer { loadingRing = false }
        stopPolling(); devices = []; ringAccountID = nil; connectedAPI = nil; connectedBackend = nil
        closeVideo(); cancelExplanation(); cancelDepartureVerification(); safety.invalidate(); tick()
        do {
            guard let backend = URL(string: relayURL) else { throw RingAPIError.invalidOrigin }
            let api = try RingAPI(backend: backend, clientToken: trimmed)
            let account = try await api.accountID(); let found = try await api.devices()
            let proof = try await api.runtimeProof()
            // Re-linking can mean a different household. Never correlate across token sessions.
            if let current { history.insert(current, at: 0) }
            current = nil; ledger = EventLedger(); duplicateCount = 0; closeVideo(); cancelExplanation(); safety.invalidate()
            ringAccountID = account; devices = found; connectedAPI = api; connectedBackend = backend
            runtimeStatus = "Official Ring via backend · \(devices.count) devices discovered"
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("runtime-proof.local.json")
            try proof.write(to: url)
        } catch { runtimeStatus = "Ring not verified"; message = error.localizedDescription }
    }
    func setZone(_ device: String, _ zone: Zone) { zones[device] = zone; UserDefaults.standard.set(zones.mapValues(\.rawValue), forKey: "zones") }
    func pollRing() async {
        guard !devices.isEmpty, let account = ringAccountID else { message = "Connect the Ring backend and map its cameras first."; return }
        loadingRing = true; defer { loadingRing = false }
        do {
            let api = try ringAPI()
            var events: [CameraEvent] = []
            for device in devices where zones[device.id] != nil && zones[device.id] != .unknown {
                let page = try await api.history(deviceID: device.id)
                events += page.data.filter { Date().timeIntervalSince1970 - $0.attributes.start / 1000 <= 180 }
                    .map { $0.observation(deviceID: device.id, accountID: account, zone: zones[device.id] ?? .unknown, personFiltered: $0.attributes.eventType != "ding") }
            }
            receive(events)
            runtimeStatus = "Official Ring runtime · event history received · \(events.count) fresh observations"
            if events.isEmpty { message = "Ring returned no fresh events. Trigger activity in the official simulator, then poll again. Map camera zones first." }
        } catch { message = error.localizedDescription; runtimeStatus = "Ring event polling failed" }
    }
    func startPolling() {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollRing()
                try? await Task.sleep(for: .seconds(8))
            }
        }
    }
    func stopPolling() { pollTask?.cancel(); pollTask = nil }
    func pollRelay() async {
        guard let backend = connectedBackend,
              let account = ringAccountID else { message = "Connect and verify the backend account first."; return }
        let url = backend.appendingPathComponent("events")
        var request = URLRequest(url: url); request.setValue("Bearer \(TokenVault.read(key: "relay-token"))", forHTTPHeaderField: "Authorization"); request.timeoutInterval = 10
        do {
            let (bytes, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { message = "Relay access failed. Check its client token and address."; return }
            struct Envelope: Decodable { let events: [RingWebhook] }
            let batch = try JSONDecoder().decode(Envelope.self, from: bytes)
            receive(batch.events.filter { $0.meta.accountID == account }.flatMap { $0.observations(zone: zones[$0.data.attributes.source] ?? .unknown) })
            runtimeStatus = "Signed Ring webhooks received from configured relay"
        } catch { message = "Relay unreachable. Start the local relay and check its URL." }
    }
    private func notify(_ incident: Incident) {
        guard incident.decision.priority == .urgent else { return } // Passive means no audible interruption.
        let content = UNMutableNotificationContent(); content.title = "Ring Drive · rear door activity"; content.body = "Listen to the explanation. Video stays locked while driving."
        content.sound = .default; content.categoryIdentifier = "RING_DRIVE"; content.userInfo = ["incidentID": incident.id.uuidString]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: incident.id.uuidString, content: content, trigger: nil))
    }
    func enableNotifications() async {
        do { _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) }
        catch { message = "Notification permission unavailable. The in-app demo remains usable." }
    }
    private func persist() {
        var records = history; if let current { records.insert(current, at: 0) }
        if let data = try? JSONEncoder().encode(Array(records.prefix(50))) { try? data.write(to: storage, options: .atomic) }
    }
}
