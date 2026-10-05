import SwiftUI
import MapKit
import RingDriveCore

struct DriveView: View {
    @EnvironmentObject var model: AppModel
    @State private var showDisplay = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Label(model.verdict.state == .parked ? "Parked" : (model.verdict.state == .driving ? "Driving" : "Verifying stop"), systemImage: model.verdict.state == .parked ? "parkingsign.circle.fill" : "car.side.fill")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    if model.demoMode { Text("SIMULATION").font(.caption.weight(.bold)).foregroundStyle(.orange).accessibilityIdentifier("simulationLabel") }
                }
                if let incident = model.current {
                    IncidentFocus(incident: incident)
                    DriverActions()
                    if !model.stops.isEmpty { StopResults() }
                    SafetyStatus()
                    NavigationLink { IncidentDetailView(incident: incident) } label: { Label("Why this alert?", systemImage: "list.bullet.rectangle") }
                        .frame(minHeight: 44)
                } else {
                    Image(systemName: "house.and.flag.fill").font(.largeTitle).foregroundStyle(.blue).accessibilityHidden(true)
                    Text("Home awareness.\nEyes on the road.").font(.largeTitle.bold())
                    Text("Only meaningful activity gets your attention. Hear what happened, find a place to stop, then review.")
                        .font(.body).foregroundStyle(.secondary)
                    Label("Video stays locked while driving", systemImage: "lock.shield.fill").foregroundStyle(.secondary)
                    Button("Run rear-door demo") { model.run(.rearDoor) }.buttonStyle(.borderedProminent).controlSize(.large).foregroundStyle(.black)
                        .accessibilityIdentifier("runUrgent")
                    Text("Local synthetic scenario. Connect the official Ring Playground in Demo & Ring to demonstrate real runtime events.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button { showDisplay = true } label: { Label("Preview CarPlay flow", systemImage: "rectangle.inset.filled.and.person.filled") }
                    .frame(minHeight: 44)
                Text("The interactive preview is simulated. The real Live Activity is separate; full CarPlay interaction requires Apple approval.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(24)
        }
        .navigationTitle("Ring Drive")
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Image(systemName: "shield.lefthalf.filled").foregroundStyle(.blue).accessibilityLabel("Driver-safe video protection")
        } }
        .sheet(isPresented: $showDisplay) { CarPlayPreview().environmentObject(model) }
    }
}

struct IncidentFocus: View {
    let incident: Incident
    var isUrgent: Bool { incident.decision.priority == .urgent }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(isUrgent ? "Needs your attention" : (incident.decision.priority == .passive ? "No action needed" : "Awaiting better evidence"),
                  systemImage: isUrgent ? "exclamationmark.triangle.fill" : "checkmark.shield.fill")
                .foregroundStyle(isUrgent ? .orange : (incident.decision.priority == .passive ? .green : .secondary))
                .font(.subheadline.weight(.semibold))
            Text(isUrgent ? "Activity at your\nrear door" : (incident.decision.priority == .passive ? "Package delivered.\nVisitor has left." : "Activity detected.\nConfidence is limited."))
                .font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("incidentHeadline")
            CameraTrace(events: incident.events)
            Text(isUrgent ? "Side entrance activity was followed by repeated rear-door observations. Listen for the evidence." : incident.decision.explanation)
                .font(.body).foregroundStyle(.secondary)
            Label(incident.events.first?.source.label ?? "No evidence", systemImage: incident.events.first?.source == .synthetic ? "testtube.2" : "network")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct CameraTrace: View {
    let events: [CameraEvent]
    @ScaledMetric(relativeTo: .subheadline) private var iconWidth: CGFloat = 24
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(events) { event in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Image(systemName: event.kind == .package ? "shippingbox" : "video.fill")
                        .font(.subheadline).foregroundStyle(.blue).frame(width: iconWidth).accessibilityHidden(true)
                    Text(event.zone.rawValue.capitalized + (event.zone == .rear ? " door" : " entrance")).font(.subheadline.weight(.medium))
                    Spacer()
                    Text(event.occurredAt, style: .time).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 16)
        .overlay(alignment: .top) { Divider() }
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .combine)
    }
}

struct DriverActions: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button { model.explain() } label: {
                Label(model.speaking ? "Explaining…" : "Listen to explanation", systemImage: model.speaking ? "waveform" : "speaker.wave.2.fill")
                    .frame(maxWidth: .infinity, minHeight: 34)
            }.buttonStyle(.borderedProminent).controlSize(.large).foregroundStyle(.black).disabled(model.speaking).accessibilityIdentifier("listen")
            if let state = model.current?.state, state != .notified && state != .triaged && state != .detected {
                if state == .explained || state == .stopRequested || state == .navigating {
                    Button { Task { await model.findStop() } } label: {
                        Label(model.searching ? "Finding nearby stops…" : "Find a safe place to stop", systemImage: "mappin.and.ellipse")
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }.buttonStyle(.bordered).controlSize(.large).disabled(model.searching).accessibilityIdentifier("findStop")
                }
                if state == .stopRequested || state == .navigating {
                    Button("I'm safely parked") { model.confirmParking() }
                        .buttonStyle(.borderedProminent).controlSize(.large).foregroundStyle(.black)
                        .disabled(model.verdict.state != .stationary && model.verdict.state != .parked)
                        .accessibilityIdentifier("confirmParked")
                    if model.demoMode && !model.demoStationary {
                        Button("Simulate arrival & standstill") { model.simulateStandstill() }
                            .frame(minHeight: 44).accessibilityIdentifier("simulateArrival")
                    }
                }
            }
            if model.canReview {
                Button { Task { await model.review() } } label: { Label("Review incident video", systemImage: "play.rectangle.fill").frame(maxWidth: .infinity, minHeight: 34) }
                    .buttonStyle(.borderedProminent).controlSize(.large).tint(.green).foregroundStyle(.black).accessibilityIdentifier("reviewVideo")
            }
        }
    }
}

struct SafetyStatus: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: model.canReview ? "lock.open.fill" : "lock.fill").font(.title2).foregroundStyle(model.canReview ? .green : .secondary)
            VStack(alignment: .leading, spacing: 6) {
                Text(model.canReview ? "Video ready for review" : "Video locked").font(.headline).accessibilityIdentifier("videoLock")
                Text(model.verdict.reason).font(.subheadline).foregroundStyle(.secondary)
                if model.verdict.isSimulated { Text("Simulated vehicle evidence").font(.caption).foregroundStyle(.orange) }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StopResults: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Nearby places to stop").font(.title3.bold())
            Text("Parking and service stations, closest first. Check signs and road conditions before stopping.").font(.footnote).foregroundStyle(.secondary)
            ForEach(model.stops) { stop in
                VStack(alignment: .leading, spacing: 8) {
                    Text(stop.name).font(.headline)
                    Text("\(Int(stop.distance)) m away\(stop.simulated ? " · synthetic search result" : " · Apple MapKit")").font(.subheadline).foregroundStyle(.secondary)
                    if model.current?.state == .stopRequested {
                        Button(stop.simulated ? "Simulate Maps handoff" : "Navigate with Apple Maps") { Task { await model.navigate(stop) } }
                            .frame(minHeight: 44).accessibilityIdentifier("navigate")
                    }
                }
                Divider()
            }
        }
    }
}

struct CarPlayPreview: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Label("Interactive CarPlay simulation", systemImage: "testtube.2").font(.subheadline).foregroundStyle(.orange)
                    if let incident = model.current {
                        Text(incident.decision.priority == .urgent ? "Rear door activity" : "Home update").font(.largeTitle.bold())
                        Text("Listen first. Stop safely to review video.").font(.title3).foregroundStyle(.secondary)
                        DriverActions()
                        if !model.stops.isEmpty { StopResults() }
                        SafetyStatus()
                    } else { ContentUnavailableView("No current incident", systemImage: "house", description: Text("Run a demo scenario or connect Ring.")) }
                }.padding(24)
            }.navigationTitle("Ring Drive").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }.preferredColorScheme(.dark)
    }
}

struct IncidentListView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        List {
            if let current = model.current { Section("Current incident") { incidentRow(current) } }
            Section("Previous incidents") {
                ForEach(model.history) { incidentRow($0) }
                if model.history.isEmpty { Text("Run a second scenario to compare passive and urgent triage.").foregroundStyle(.secondary) }
            }
        }.navigationTitle("Incidents")
    }
    private func incidentRow(_ incident: Incident) -> some View {
        NavigationLink { IncidentDetailView(incident: incident) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text(incident.decision.priority == .urgent ? "Rear-door activity" : (incident.decision.priority == .passive ? "Package delivered" : "Evidence needs review")).font(.headline)
                Text(incident.decision.priority.rawValue.capitalized + " · " + (incident.events.first?.source.label ?? "Unknown")).font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 8)
        }
    }
}

struct IncidentDetailView: View {
    let incident: Incident
    var body: some View {
        List {
            Section("Why this alert?") {
                Text(incident.decision.explanation)
                LabeledContent("Priority", value: incident.decision.priority.rawValue.capitalized)
                LabeledContent("Rule confidence", value: "\(Int(incident.decision.confidence * 100))%")
                Text("A rule score, not a calibrated probability. Camera correlation does not verify a person's identity.").font(.footnote).foregroundStyle(.secondary)
                ForEach(incident.decision.reasons, id: \.self) { Text($0) }
            }
            Section("State transitions") {
                ForEach(incident.audit) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.state.rawValue).font(.subheadline.weight(.semibold))
                        Text(entry.note).font(.footnote).foregroundStyle(.secondary)
                        Text(entry.at, style: .time).font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 4)
                }
            }
            Section("Camera evidence · \(incident.decision.ruleVersion)") {
                ForEach(incident.events) { event in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(event.zone.rawValue.capitalized) · \(event.kind.rawValue)")
                        Text(event.source.label).font(.caption).foregroundStyle(.secondary)
                        Text(event.id).font(.caption.monospaced()).textSelection(.enabled)
                    }
                }
            }
        }.navigationTitle("Incident evidence").navigationBarTitleDisplayMode(.inline)
    }
}

struct DemoView: View {
    @EnvironmentObject var model: AppModel
    @State private var relayToken = ""
    var body: some View {
        Form {
            Section {
                Toggle("Simulate vehicle sensors", isOn: Binding(get: { model.demoMode }, set: { model.setDemoMode($0) }))
                Text("Simulation is explicit. Turn this off on an iPhone for CoreLocation + CoreMotion. Sensor uncertainty always keeps video locked.")
                    .font(.footnote).foregroundStyle(.secondary)
            } header: { Text("Demonstration") }
            Section("Synthetic Ring scenarios") {
                ForEach(DemoScenario.allCases) { scenario in
                    Button(scenario.title) { model.run(scenario) }.accessibilityIdentifier("scenario-\(scenario.rawValue)").frame(minHeight: 44)
                }
                LabeledContent("Duplicate deliveries ignored") {
                    Text(String(model.duplicateCount)).accessibilityIdentifier("duplicateCount")
                }
            }
            Section("Vehicle & Maps faults") {
                Toggle("Offline stop-search rehearsal", isOn: $model.offlineStops)
                Text("Turn off for real Apple MapKit search and Apple Maps directions from the demo location in Amsterdam.")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("No nearby stops", isOn: $model.noStops).accessibilityIdentifier("noStops")
                Toggle("Location permission denied", isOn: $model.deniedLocation)
                Toggle("Maps handoff fails", isOn: $model.handoffFailure)
                Toggle("Parked-state uncertainty", isOn: $model.uncertainParking)
                Button("Resume driving · revoke video") { model.resumeDriving() }.accessibilityIdentifier("resumeDriving").frame(minHeight: 44)
            }
            Section("Official Ring runtime") {
                Text(model.runtimeStatus).font(.subheadline)
                Link("Open Ring Developer Playground", destination: URL(string: "https://developer.amazon.com/ring/console/playground")!).frame(minHeight: 44)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Backend URL").font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    TextField("", text: $model.relayURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                        .accessibilityLabel("Backend URL").accessibilityIdentifier("backendURL").frame(minHeight: 28)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Backend client key").font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    SecureField("", text: $relayToken).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityLabel("Backend client key").accessibilityIdentifier("backendKey").frame(minHeight: 28)
                }
                Button(model.loadingRing ? "Connecting…" : "Connect & discover Ring devices") {
                    let value = relayToken.isEmpty ? model.backendToken : relayToken
                    Task { await model.connectRing(clientToken: value); relayToken = "" }
                }.disabled(model.loadingRing).frame(minHeight: 44).accessibilityIdentifier("connectBackend")
                Text("Use RELAY_CLIENT_TOKEN from your local setup. Ring OAuth tokens and app secrets stay on the backend. The client key is saved in iOS Keychain.")
                    .font(.footnote).foregroundStyle(.secondary)
                ForEach(model.devices) { device in
                    Picker(device.displayName, selection: Binding(get: { model.zones[device.id] ?? .unknown }, set: { model.setZone(device.id, $0) })) {
                        ForEach(Zone.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                    }
                }
                Button("Poll Ring event history") { Task { await model.pollRing() } }.disabled(model.loadingRing).frame(minHeight: 44)
                Button("Start 8-second foreground polling") { model.startPolling() }.frame(minHeight: 44)
                Button("Stop polling") { model.stopPolling() }.frame(minHeight: 44)
            }
            Section("Signed webhook relay · optional") {
                Button("Fetch signed Ring events") {
                    Task { await model.pollRelay() }
                }.frame(minHeight: 44)
                Text("Uses the same verified backend connection. Requires a registered HMAC key and an HTTPS webhook endpoint.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("System surfaces") {
                Button("Enable iPhone notifications") { Task { await model.enableNotifications() } }.frame(minHeight: 44)
                LabeledContent("ActivityKit", value: model.activityStatus)
                Text("The extension includes a small CarPlay Live Activity. Its buttons are not interactive in CarPlay. This app has no granted full CarPlay entitlement.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("Demo & Ring")
    }
}
