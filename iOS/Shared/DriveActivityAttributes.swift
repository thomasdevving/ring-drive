import ActivityKit
import Foundation

struct DriveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var headline: String
        var detail: String
        var urgent: Bool
        var videoLocked: Bool
        var synthetic: Bool
        /// Current step of the driver flow, e.g. "Household notified". Optional for older payloads.
        var stage: String?
        /// Escalation outcome, e.g. "Sanne has seen this".
        var outcome: String?
    }
    var incidentID: String
}
