import SwiftUI
import UserNotifications
import AVKit
import RingDriveCore

@MainActor final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories([UNNotificationCategory(identifier: "RING_DRIVE", actions: [], intentIdentifiers: [])])
        return true
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let incidentID = response.notification.request.content.userInfo["incidentID"] as? String
        let householdMessage = response.notification.request.content.userInfo["notificationID"] != nil
        await MainActor.run {
            let model = AppModel.shared
            if householdMessage { model.selectedTab = 3; return }
            model.selectedTab = 0
            if model.current?.id.uuidString == incidentID { model.explain() }
            else { model.message = "This alert is no longer current. Open Incidents to inspect its history after parking." }
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
    #if FULL_CARPLAY
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        guard session.role.rawValue == "CPTemplateApplicationSceneSessionRoleApplication" else { return session.configuration }
        let config = UISceneConfiguration(name: "CarPlay", sessionRole: session.role)
        config.delegateClass = CarPlaySceneDelegate.self
        return config
    }
    #endif
}

@main struct RingDriveApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var model = AppModel.shared
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
                .onChange(of: phase) { _, phase in model.setActive(phase == .active) }
                .onOpenURL { url in
                    guard url.scheme == "ringdrive" else { return }; model.selectedTab = 0
                    if url.host == "explain" { model.explain() }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        TabView(selection: $model.selectedTab) {
            NavigationStack { DriveView() }.tabItem { Label("Drive", systemImage: "car.side") }.tag(0)
            NavigationStack { IncidentListView() }.tabItem { Label("Incidents", systemImage: "clock.arrow.circlepath") }.tag(1)
            NavigationStack { DemoView() }.tabItem { Label("Demo & Ring", systemImage: "slider.horizontal.3") }.tag(2)
            NavigationStack { HouseholdView() }.tabItem { Label("Household", systemImage: "person.2.fill") }.tag(3)
        }
        .sheet(isPresented: $model.showingCallPicker) { CallPickerView().environmentObject(model) }
        .tint(.blue)
        .preferredColorScheme(model.selectedTab == 0 ? .dark : nil)
        .alert("Ring Drive", isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) {
            Button("OK") { model.message = nil }
        } message: { Text(model.message ?? "") }
        .fullScreenCover(isPresented: $model.showingVideo, onDismiss: { model.closeVideo() }) {
            NavigationStack {
                VStack(spacing: 16) {
                    if model.canReview, let player = model.player {
                        GuardedPlayer(player: player).accessibilityIdentifier("incidentVideo")
                        Label("Parked confirmed", systemImage: "checkmark.shield.fill").foregroundStyle(.green)
                        if let event = model.reviewedEvent {
                            Text("\(event.zone.locationLabel) · \(event.occurredAt.formatted(date: .omitted, time: .standard))")
                                .font(.subheadline).accessibilityIdentifier("reviewedMoment")
                        }
                        Text(model.current?.events.first?.source == .synthetic ? "Synthetic incident footage · demonstration only" : "Recording retrieved from the official Ring API")
                            .font(.caption).foregroundStyle(.secondary)
                    } else { ContentUnavailableView("Video locked", systemImage: "lock.fill", description: Text(model.verdict.reason)) }
                }
                .padding().navigationTitle("Incident review").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { model.closeVideo() } } }
            }
        }
    }
}

struct GuardedPlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController(); vc.player = player; vc.allowsPictureInPicturePlayback = false; return vc
    }
    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) { vc.player = player }
    static func dismantleUIViewController(_ vc: AVPlayerViewController, coordinator: ()) { vc.player?.pause(); vc.player = nil }
}
