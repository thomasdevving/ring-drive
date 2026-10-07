import AppIntents
import Foundation
import RingDriveCore

/// Spoken by Siri when an intent cannot or should not continue.
struct SiriMessage: Error, CustomLocalizedStringResourceConvertible {
    let text: String
    init(_ text: String) { self.text = text }
    var localizedStringResource: LocalizedStringResource { "\(text)" }
}

// Driver choices as App Intents. They run in the app process without opening the app, so Siri can use them in
// CarPlay without a CarPlay entitlement. None of them shows video.

struct ExplainLatestIncidentIntent: AppIntent {
    static let title: LocalizedStringResource = "Explain latest home alert"
    static let description = IntentDescription("Reads the stored summary of the latest Ring Drive alert. No video is shown.")
    static let openAppWhenRun = false
    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = await AppModel.shared.siriExplain()
        return .result(dialog: "\(text)")
    }
}

struct NotifyHouseholdIntent: AppIntent {
    static let title: LocalizedStringResource = "Notify my household"
    static let description = IntentDescription("Messages household members who are not driving about the latest alert.")
    static let openAppWhenRun = false
    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = try await AppModel.shared.siriNotifyHousehold()
        return .result(dialog: "\(text)")
    }
}

struct ContactEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Household contact"
    static let defaultQuery = ContactQuery()
    let id: String
    let name: String
    let role: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", subtitle: "\(role)") }
}

struct ContactQuery: EntityQuery {
    @MainActor func entities(for identifiers: [String]) async throws -> [ContactEntity] {
        await AppModel.shared.callableContactsForSiri().filter { identifiers.contains($0.id) }.map(Self.entity)
    }
    @MainActor func suggestedEntities() async throws -> [ContactEntity] {
        await AppModel.shared.callableContactsForSiri().map(Self.entity)
    }
    static func entity(_ contact: HouseholdContact) -> ContactEntity { .init(id: contact.id, name: contact.name, role: contact.role.rawValue) }
}

/// iOS asks the user to confirm every call started from a tel: link; no workaround is used.
struct CallContactIntent: AppIntent {
    static let title: LocalizedStringResource = "Call a household contact"
    static let description = IntentDescription("Starts the standard phone call flow to a household or emergency contact.")
    static let openAppWhenRun = false
    @Parameter(title: "Contact") var contact: ContactEntity
    static var parameterSummary: some ParameterSummary { Summary("Call \(\.$contact)") }
    @MainActor func perform() async throws -> some IntentResult & OpensIntent {
        let url = try await AppModel.shared.siriCall(contactID: contact.id)
        return .result(opensIntent: OpenURLIntent(url))
    }
}

/// Hands a parking search to Apple Maps. Video stays locked until parking is confirmed on the iPhone.
struct FindSafeStopIntent: AppIntent {
    static let title: LocalizedStringResource = "Find a safe place to stop"
    static let description = IntentDescription("Opens Apple Maps with nearby parking for the latest camera alert.")
    static let openAppWhenRun = false
    @MainActor func perform() async throws -> some IntentResult & OpensIntent {
        let url = try await AppModel.shared.siriFindStop()
        return .result(opensIntent: OpenURLIntent(url))
    }
}

struct RingDriveShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ExplainLatestIncidentIntent(),
                    phrases: ["Explain my \(.applicationName) alert", "What happened at home in \(.applicationName)", "\(.applicationName) explain"],
                    shortTitle: "Explain alert", systemImageName: "speaker.wave.2.fill")
        AppShortcut(intent: NotifyHouseholdIntent(),
                    phrases: ["Notify my household with \(.applicationName)", "\(.applicationName) notify my household"],
                    shortTitle: "Notify household", systemImageName: "person.2.wave.2.fill")
        AppShortcut(intent: CallContactIntent(),
                    phrases: ["Call a contact with \(.applicationName)", "\(.applicationName) call a contact"],
                    shortTitle: "Call contact", systemImageName: "phone.fill")
        AppShortcut(intent: FindSafeStopIntent(),
                    phrases: ["Find a safe stop with \(.applicationName)", "\(.applicationName) find a safe stop"],
                    shortTitle: "Find safe stop", systemImageName: "mappin.and.ellipse")
    }
}
