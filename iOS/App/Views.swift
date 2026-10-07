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
                    HouseholdOutcome()
                    if !model.stops.isEmpty { StopResults() }
                    SafetyStatus()
                    if incident.state == .navigating {
                        Label("Navigating with Apple Maps", systemImage: "arrow.turn.up.right")
                            .font(.subheadline).accessibilityIdentifier("driverProgress")
                    }
                    NavigationLink { IncidentDetailView(incidentID: incident.id) } label: { Label("Incident timeline", systemImage: "list.bullet.rectangle") }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("openTimeline")
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
    @EnvironmentObject var model: AppModel
    let incident: Incident
    var isUrgent: Bool { incident.status == .active && incident.decision.priority == .urgent && incident.state != .dismissed }
    var isResolved: Bool { incident.status == .resolved }
    var isAbsence: Bool { incident.kind == .absence }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(incident.state == .dismissed ? "Dismissed" : (isResolved ? "Observed activity ended" : (isUrgent ? "Needs your attention" : (incident.decision.priority == .passive ? "No action needed" : "Awaiting better evidence"))),
                  systemImage: isUrgent ? "exclamationmark.triangle.fill" : "checkmark.shield.fill")
                .foregroundStyle(isUrgent ? .orange : (incident.decision.priority == .passive ? .green : .secondary))
                .font(.subheadline.weight(.semibold))
            Text(isAbsence ? "Expected activity\nnot seen" : (isResolved ? "Departure observed.\nIncident updated." : (incident.decision.priority == .urgent ? "Activity at your\nrear door" : (incident.decision.priority == .passive ? "Package delivered.\nVisitor has left." : "Activity detected.\nConfidence is limited."))))
                .font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("incidentHeadline")
            if !incident.events.isEmpty { CameraTrace(events: Array(incident.events.suffix(3))) }
            if incident.events.count > 3 { Text("\(incident.events.count) observations in this incident · full timeline after parking").font(.caption).foregroundStyle(.secondary) }
            Text(isAbsence ? model.spokenText(for: incident) : (isUrgent ? "Side entrance activity was followed by repeated rear-door observations. Listen for the evidence." : incident.decision.explanation))
                .font(.body).foregroundStyle(.secondary)
            Label(isAbsence ? (incident.isSimulated ? "Simulated absence rule" : "Absence rule · Ring event history") : (incident.events.first?.source.label ?? "No evidence"),
                  systemImage: incident.isSimulated ? "testtube.2" : "network")
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
            if let incident = model.current, !incident.requiresExplanation {
                let state = incident.state
                // Explicit driver choices after the explanation; each one is recorded with its time.
                if ChoicePolicy.choiceStates.contains(state) {
                    ForEach(incident.availableChoices, id: \.self) { choice in
                        Button { model.choose(choice) } label: {
                            Label(choice == .findStop && model.searching ? "Finding nearby stops…" : choice.title, systemImage: choice.symbol)
                                .frame(maxWidth: .infinity, minHeight: 34)
                        }.buttonStyle(.bordered).controlSize(.large).disabled(choice == .findStop && model.searching)
                            .accessibilityIdentifier(choice == .findStop ? "findStop" : "choice-\(choice.rawValue)")
                    }
                }
                if state == .stopRequested || state == .navigating {
                    Button { Task { await model.findStop() } } label: {
                        Label(model.searching ? "Finding nearby stops…" : "Find a safe place to stop", systemImage: "mappin.and.ellipse")
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }.buttonStyle(.bordered).controlSize(.large).disabled(model.searching).accessibilityIdentifier("findStop")
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
                        Text(incident.kind == .absence ? "Expected activity not seen" : (incident.status == .resolved ? "Observed activity ended" : (incident.decision.priority == .urgent ? "Rear door activity" : "Home update"))).font(.largeTitle.bold())
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
        let title: String
        if incident.kind == .absence { title = "Expected activity not seen" }
        else if incident.status == .resolved { title = "Observed activity ended" }
        else if incident.decision.priority == .urgent { title = "Rear-door activity" }
        else if incident.decision.priority == .passive { title = "Package delivered" }
        else { title = "Evidence needs review" }
        let subtitle = [incident.status.rawValue.capitalized, incident.decision.priority.rawValue.capitalized,
                        incident.kind == .absence ? (incident.isSimulated ? "Simulated absence rule" : "Absence rule") : (incident.events.first?.source.label ?? "Unknown"),
                        incident.state.rawValue.replacingOccurrences(of: "_", with: " ").capitalized].joined(separator: " · ")
        return NavigationLink { IncidentDetailView(incidentID: incident.id) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 8)
        }
    }
}

struct IncidentDetailView: View {
    @EnvironmentObject var model: AppModel
    let incidentID: UUID
    var body: some View {
        Group {
            if !model.canInspectTimeline {
                ContentUnavailableView {
                    Label("Park to inspect the timeline", systemImage: "lock.shield.fill")
                } description: {
                    Text("Hear the explanation in Drive. Detailed camera evidence becomes available after continuous standstill and your parking confirmation.")
                } actions: {
                    Button("Return to Drive") { model.selectedTab = 0 }.frame(minHeight: 44)
                }.accessibilityIdentifier("timelineLocked")
            } else if let incident = model.incident(id: incidentID) {
                IncidentTimelineView(incident: incident)
            } else {
                ContentUnavailableView("Incident unavailable", systemImage: "clock", description: Text("This incident is no longer in the saved history."))
            }
        }.navigationTitle("Incident timeline").navigationBarTitleDisplayMode(.inline)
    }
}

struct IncidentTimelineView: View {
    @EnvironmentObject var model: AppModel
    let incident: Incident
    var body: some View {
        List {
            Section("Why this alert?") {
                Text(incident.decision.explanation)
                LabeledContent("Incident status", value: incident.status.rawValue.capitalized)
                LabeledContent("Priority", value: incident.decision.priority.rawValue.capitalized)
                if incident.kind == .camera {
                    LabeledContent("Rule confidence", value: "\(Int(incident.decision.confidence * 100))%")
                    Text("A rule score, not a calibrated probability. Camera correlation does not verify a person's identity.").font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("Exit cameras recorded no qualifying observation in the rule window. Cameras do not identify people or the direction of movement.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            if !incident.events.isEmpty {
                Section("Per-camera timeline") {
                    ForEach(incident.cameraSegments) { segment in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(segment.zone.locationLabel) · \(model.cameraName(for: segment.events[0]))").font(.subheadline.weight(.semibold))
                            Text(segmentDetail(segment)).font(.footnote).foregroundStyle(.secondary)
                        }.padding(.vertical, 4).accessibilityElement(children: .combine).accessibilityIdentifier("segment-\(segment.zone.rawValue)")
                    }
                }
            }
            Section {
                ForEach(incident.timeline) { item in
                    IncidentTimelineRow(item: item, incidentID: incident.id)
                }
            } header: { Text("Camera observations & decisions") }
              footer: { Text("Observation times come from the camera evidence; decisions and actions show when Ring Drive processed them. Rules: \(incident.decision.ruleVersion).") }
            Section("Saved incident") {
                LabeledContent("Observations", value: String(incident.events.count))
                Text(incident.id.uuidString).font(.caption.monospaced()).textSelection(.enabled)
            }
        }.accessibilityIdentifier("incidentTimeline")
    }
    private func segmentDetail(_ segment: CameraSegment) -> String {
        let start = segment.first.formatted(date: .omitted, time: .standard)
        guard segment.events.count > 1 else { return "\(segment.kind.observationLabel) at \(start)" }
        return "\(segment.kind.observationLabel) from \(start) to \(segment.last.formatted(date: .omitted, time: .standard)) · \(segment.seconds) s · \(segment.events.count) observations"
    }
}

struct IncidentTimelineRow: View {
    @EnvironmentObject var model: AppModel
    let item: IncidentTimelineItem
    let incidentID: UUID
    @ScaledMetric(relativeTo: .subheadline) private var symbolWidth: CGFloat = 24
    var body: some View {
        switch item {
        case .observation(let event):
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.cameraName(for: event)).font(.subheadline)
                    if let component = event.componentID { Text("Camera module \(component)").font(.caption) }
                    Text(event.source.label).font(.caption).foregroundStyle(.secondary)
                    Text("Evidence score: \(Int(event.confidence * 100))% · not an identity match").font(.footnote).foregroundStyle(.secondary)
                    Text(event.id).font(.caption.monospaced()).textSelection(.enabled)
                    if incidentID == model.current?.id, model.canReview {
                        Button(event.source == .synthetic ? "Review illustrative demo clip" : "Review this camera moment") {
                            Task { await model.review(event: event) }
                        }.buttonStyle(.borderless).frame(minHeight: 44).accessibilityIdentifier("reviewMoment-\(event.zone.rawValue)")
                        if event.source == .synthetic { Text("The bundled clip illustrates the scenario; it is not footage of this observation.").font(.footnote).foregroundStyle(.secondary) }
                    }
                }.padding(.vertical, 8)
            } label: {
                timelineLabel(event.zone.locationLabel, detail: event.kind.observationLabel, symbol: "video.fill", color: .blue)
                    .accessibilityIdentifier("observation-\(event.zone.rawValue)")
            }
        case .assessment(let assessment):
            VStack(alignment: .leading, spacing: 8) {
                timelineLabel(assessmentTitle(assessment), detail: assessment.isRecovered ? "Recovered from saved history" : "Evidence evaluated",
                              symbol: assessment.change == .resolved ? "checkmark.circle" : "checklist",
                              color: assessment.change == .resolved ? .green : (assessment.decision.priority == .urgent ? .orange : .blue))
                Text(assessment.decision.explanation).font(.subheadline)
                ForEach(assessment.decision.reasons, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
                Text("\(assessment.evidenceKeys.count) observations · \(assessment.decision.ruleVersion)").font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 4)
        case .transition(let entry):
            timelineLabel(entry.choice.map { "Driver chose: \($0.title)" } ?? entry.state.rawValue, detail: entry.note,
                          symbol: entry.choice?.symbol ?? "arrow.right.circle", color: entry.choice == nil ? .secondary : .blue)
                .padding(.vertical, 4)
        }
    }
    private func assessmentTitle(_ assessment: IncidentAssessment) -> String {
        switch assessment.change {
        case .resolved: "Observed activity ended"
        case .reopened: "Incident reopened · new activity"
        case .continued: "Update · \(assessment.decision.priority.rawValue)"
        default: assessment.decision.priority == .urgent ? "Escalated · attention needed" : "Assessment · \(assessment.decision.priority.rawValue)"
        }
    }
    private func timelineLabel(_ title: String, detail: String, symbol: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.subheadline).foregroundStyle(color).frame(width: symbolWidth).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.footnote).foregroundStyle(.secondary)
                Text(item.at, format: .dateTime.hour().minute().second()).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
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
            if let incident = model.current, incident.events.first?.source == .synthetic {
                Section("Update this synthetic incident") {
                    LabeledContent("Incident reference") { Text(String(incident.id.uuidString.prefix(8))).accessibilityIdentifier("incidentReference") }
                    LabeledContent("Status") { Text(incident.status.rawValue.capitalized).accessibilityIdentifier("incidentStatus") }
                    LabeledContent("Observations") { Text(String(incident.events.count)).accessibilityIdentifier("observationCount") }
                    LabeledContent("Urgent alert requests") { Text(String(incident.alertRequestCount)).accessibilityIdentifier("alertRequestCount") }
                    Button(incident.status == .resolved ? "Simulate activity returning" : "Add continuing activity") { model.addDemoActivity() }
                        .frame(minHeight: 44).accessibilityIdentifier("appendActivity")
                    Button("Add uncertain activity") { model.addDemoActivity(uncertain: true) }.frame(minHeight: 44).accessibilityIdentifier("appendUncertain")
                    Button("Repeat the last delivery") { model.repeatDemoDelivery() }.frame(minHeight: 44).accessibilityIdentifier("repeatDelivery")
                    Button(model.departureChecksRemaining > 0 ? "Checking departure · \(model.departureChecksRemaining)s" : "Simulate two departure observations") {
                        model.beginDepartureVerification()
                    }.disabled(model.departureChecksRemaining > 0 || incident.status == .resolved)
                        .frame(minHeight: 44).accessibilityIdentifier("departureEvidence")
                    Text("Departure uses two explicit synthetic observations, at least 10 seconds apart. Silence alone never ends an incident. Continued activity updates quietly; a reopened urgent alert has a 120-second cooldown.")
                        .font(.footnote).foregroundStyle(.secondary)
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
                Button("Save key for household features") { model.saveBackendKey(relayToken.isEmpty ? model.backendToken : relayToken); relayToken = "" }
                    .frame(minHeight: 44).accessibilityIdentifier("saveBackendKey")
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
