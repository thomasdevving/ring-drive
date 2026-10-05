import WidgetKit
import SwiftUI
import ActivityKit

struct IncidentActivityView: View {
    let context: ActivityViewContext<DriveActivityAttributes>
    @Environment(\.activityFamily) var family
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: context.state.urgent ? "exclamationmark.shield.fill" : "house.fill")
                .font(.title2).foregroundStyle(context.state.urgent ? .orange : .blue)
            VStack(alignment: .leading, spacing: 4) {
                Text(context.state.headline).font(.headline).lineLimit(family == .small ? 2 : 1)
                Text(context.state.detail).font(.caption).lineLimit(2)
                if context.state.synthetic { Text("Simulated Ring event").font(.caption2).foregroundStyle(.secondary) }
            }
            if family != .small { Spacer(); Image(systemName: context.state.videoLocked ? "lock.fill" : "checkmark.shield") }
        }.padding(family == .small ? 8 : 16)
    }
}
struct RingDriveLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DriveActivityAttributes.self) { context in
            IncidentActivityView(context: context)
                .widgetURL(URL(string: "ringdrive://explain"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "house.fill").foregroundStyle(.blue) }
                DynamicIslandExpandedRegion(.trailing) { Image(systemName: "lock.fill") }
                DynamicIslandExpandedRegion(.bottom) { Text(context.state.headline).font(.headline); Text(context.state.detail).font(.caption) }
            } compactLeading: { Image(systemName: context.state.urgent ? "exclamationmark.shield" : "house") }
            compactTrailing: { Image(systemName: "lock.fill") }
            minimal: { Image(systemName: "house.fill") }
            .widgetURL(URL(string: "ringdrive://explain"))
        }.supplementalActivityFamilies([.small])
    }
}
struct DriveEntry: TimelineEntry { let date: Date }
struct DriveProvider: TimelineProvider {
    func placeholder(in context: Context) -> DriveEntry { .init(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (DriveEntry) -> Void) { completion(.init(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DriveEntry>) -> Void) { completion(Timeline(entries: [.init(date: Date())], policy: .never)) }
}
struct RingDriveWidget: Widget {
    let kind = "RingDriveStatus"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DriveProvider()) { _ in
            VStack(alignment: .leading, spacing: 8) {
                Label("Ring Drive", systemImage: "house.fill").font(.headline)
                Text("Hear first.\nStop safely.").font(.title3.bold())
                Text("See current alerts in the Live Activity.").font(.caption).foregroundStyle(.secondary)
            }.containerBackground(.background, for: .widget).widgetURL(URL(string: "ringdrive://home"))
        }.configurationDisplayName("Ring Drive").description("A reminder to review home activity only after parking.").supportedFamilies([.systemSmall])
    }
}
@main struct DriveWidgets: WidgetBundle { var body: some Widget { RingDriveLiveActivity(); RingDriveWidget() } }
