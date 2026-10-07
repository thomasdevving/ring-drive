#if FULL_CARPLAY
import CarPlay
import Combine
import RingDriveCore

/// Compile with FULL_CARPLAY only after Apple approves a suitable category and provisioning.
/// No category entitlement is claimed by this source or the default project.
@MainActor final class CarPlaySceneDelegate: UIResponder, @preconcurrency CPTemplateApplicationSceneDelegate {
    private var controller: CPInterfaceController?
    private var observation: AnyCancellable?
    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        controller = interfaceController
        observation = AppModel.shared.$current.sink { [weak self] _ in Task { @MainActor in self?.refresh() } }
        refresh()
    }
    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        observation = nil; controller = nil
    }
    private func refresh() {
        let model = AppModel.shared
        let listen = CPListItem(text: "Hear why you were notified", detailText: "Spoken explanation · no video")
        listen.handler = { _, completion in model.explain(); completion() }
        let stop = CPListItem(text: "Find a safe place to stop", detailText: "Parking & service stations")
        stop.handler = { [weak self] _, completion in
            Task { @MainActor in
                await model.findStop()
                let items = model.stops.map { candidate in
                    let item = CPListItem(text: candidate.name, detailText: "\(Int(candidate.distance)) m · Apple Maps")
                    item.handler = { _, done in Task { @MainActor in await model.navigate(candidate); done() } }
                    return item
                }
                let template = CPListTemplate(title: "Places to stop", sections: [CPListSection(items: items)])
                self?.controller?.pushTemplate(template, animated: true, completion: nil); completion()
            }
        }
        stop.isEnabled = model.current?.requiresExplanation == false && [.explained, .stopRequested, .navigating].contains(model.current?.state ?? .detected)
        let heading = model.current?.status == .resolved ? "Observed activity ended" : (model.current?.decision.priority == .urgent ? "Rear door activity" : "Ring Drive")
        let template = CPListTemplate(title: heading, sections: [CPListSection(items: [listen, stop], header: "Video review on iPhone after parking", sectionIndexTitle: nil)])
        controller?.setRootTemplate(template, animated: false, completion: nil)
    }
}
#endif
