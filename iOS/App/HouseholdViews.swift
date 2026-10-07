import SwiftUI
import RingDriveCore

/// For every household member's iPhone: who this phone belongs to, whether they are driving, and their messages.
struct HouseholdView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Form {
            Section {
                Picker("This iPhone belongs to", selection: Binding(get: { model.memberContactID ?? "" }, set: { model.memberContactID = $0.isEmpty ? nil : $0 })) {
                    Text("Not set").tag("")
                    ForEach(model.contacts.filter { $0.role == .household || $0.role == .monitored }) { Text($0.name).tag($0.id) }
                }.accessibilityIdentifier("memberPicker")
                LabeledContent("Driving", value: model.drivingReading.driving ? "Yes" : "No")
                LabeledContent("Detected from", value: sourceLabel(model.drivingReading.source))
                Toggle("Dry-run calls", isOn: $model.dryRunCalls).accessibilityIdentifier("dryRunCalls")
            } header: { Text("This iPhone") } footer: {
                Text("Driving is detected from a CarPlay audio route or CoreMotion's automotive activity, and reported to your backend so household messages reach someone who is not driving. In demo mode the labeled simulated vehicle is used.")
            }
            Section {
                if model.inbox.isEmpty { Text("No messages in the last 24 hours.").foregroundStyle(.secondary) }
                ForEach(model.inbox) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.message)
                        if item.simulated == true { Label("Simulated", systemImage: "testtube.2").font(.caption).foregroundStyle(.orange) }
                        if item.isAcknowledged { Label("Confirmed", systemImage: "checkmark.circle.fill").font(.subheadline).foregroundStyle(.green) }
                        else {
                            Button(item.acknowledgeTitle) { Task { await model.acknowledge(item) } }
                                .buttonStyle(.borderedProminent).accessibilityIdentifier("ack-\(item.id)")
                        }
                    }.padding(.vertical, 6)
                }
            } header: { Text("Messages for you") } footer: {
                Text("Delivered through your Ring Drive backend while this app is open. Remote push needs Apple Push Notification service, which is not configured for this demo.")
            }
            Section("Household contacts") {
                if model.contacts.isEmpty { Text("Add contacts on the backend: node scripts/household.mjs add-contact …").font(.footnote).foregroundStyle(.secondary) }
                ForEach(model.contacts) { contact in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(contact.name).font(.headline)
                        Text(([contact.role.rawValue.capitalized, contact.channel, stateLabel(contact.drivingState)] + (contact.simulated == true ? ["Simulated"] : [])).joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Household")
        .refreshable { await model.pollHousehold() }
    }
    private func sourceLabel(_ source: String) -> String {
        ["carplay": "CarPlay audio", "motion": "Motion (automotive)", "simulated": "Simulated vehicle", "none": "No signal"][source] ?? source
    }
    private func stateLabel(_ state: String?) -> String {
        ["driving": "Driving", "not-driving": "Not driving"][state ?? ""] ?? "Driving unknown"
    }
}

/// CALL_CONTACT: the driver picks a contact; iOS then asks for confirmation before any call is placed.
struct CallPickerView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                let callable = CallLink.callable(model.contacts)
                if callable.isEmpty { Text("No contacts with a phone number. Add them on the backend.").foregroundStyle(.secondary) }
                ForEach(callable) { contact in
                    Button { model.call(contact) } label: {
                        Label("\(contact.name) · \(contact.role.rawValue)", systemImage: "phone.fill").frame(minHeight: 44)
                    }.accessibilityIdentifier("call-\(contact.name)")
                }
                if model.dryRunCalls { Text("Dry run is on: no call will be placed.").font(.footnote).foregroundStyle(.orange) }
            }
            .navigationTitle("Call a contact").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }.preferredColorScheme(.dark)
    }
}

/// Outcome of household messages for the current incident, e.g. "Sanne has seen this".
struct HouseholdOutcome: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        if !model.incidentNotifications.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(model.incidentNotifications) { n in
                    Label(n.isAcknowledged ? (n.role == "monitored" ? "\(n.contactName) is on the way" : "\(n.contactName) has seen this")
                                           : "\(n.contactName) · \(n.status == "dry_run" ? "dry run" : "notified")",
                          systemImage: n.isAcknowledged ? "checkmark.circle.fill" : "paperplane")
                        .foregroundStyle(n.isAcknowledged ? .green : .secondary)
                }
            }.font(.subheadline).accessibilityIdentifier("householdOutcome")
        }
    }
}
