import ActivityKit
import Foundation

struct DriveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var headline: String
        var detail: String
        var urgent: Bool
        var videoLocked: Bool
        var synthetic: Bool
    }
    var incidentID: String
}
