# Incident evidence design check

Date: 2026-10-07. Scope: ordinary extension of the established native iPhone Operate interface. Result: the finished timeline and ongoing incident controls match the incumbent visual system. The finish review in `docs/INCIDENT_EVIDENCE_REVIEW.md` records **ship**, with no material fixes within its supplied visual and interaction scope.

This document records comparison evidence; it does not refresh the design system or certify authenticated runtime behavior.

## Authority and inspected evidence

Compared the implementation with `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, and the direction contract in `.impeccable/surfaces/incident-evidence.md`. Read the document reference and the ordinary-extension finishing requirements in Impeccable new-work section 7.

Inspected `iOS/App/Views.swift`, `iOS/App/AppModel.swift`, `iOS/App/RingDriveApp.swift`, `Sources/RingDriveCore/Timeline.swift`, `Sources/RingDriveCore/IncidentUpdates.swift`, and the relevant incident behavior in `Sources/RingDriveCore/Models.swift`.

Visually inspected these existing actual native iPhone captures, each 1206 × 2622 pixels:

- `.impeccable/review/timeline-phone-dark.png`: explanation, active/urgent metadata, qualified rule score, and the beginning of chronological camera observations in a native grouped list.
- `.impeccable/review/timeline-camera-phone-dark.png`: scrolled timeline with expanded camera disclosure, synthetic source, score qualification, evidence ID, and deliberate illustrative-clip review action. The capture is a scrolled recording frame, not a full-page image.
- `.impeccable/review/incident-resolved-phone-light.png`: adaptive light Demo & Ring form with resolved status, six observations, one urgent alert request, and explicit synthetic departure/cooldown explanation.
- `.impeccable/review/incident-navigation-phone-dark.png`: scrolled Drive view retaining Apple Maps navigation, video lock and simulation attribution. The resolved headline is above this viewport.

The earlier `phone-dynamic-type.png` establishes only the existing Drive layout. It predates this extension and supplies no evidence of the timeline at enlarged Dynamic Type.

## Comparison with the incumbent system

| System element | Finding and evidence |
| --- | --- |
| Typography | Match. Timeline labels use `.subheadline`, `.footnote`, and `.caption`; status content inherits native list typography. Dates use monospaced digits and IDs use monospaced captions as data treatments. No custom face or fixed text size was introduced. |
| SF Symbols and scaling | Match. Camera, assessment, transition and lock symbols use SF Symbols with native text styles. `IncidentTimelineRow` uses `@ScaledMetric(relativeTo: .subheadline)` with a 24-point starting column, matching `CameraTrace`. Decorative row symbols are hidden from accessibility. |
| Color and appearance | Match. Blue identifies camera evidence/actions, orange identifies urgency/simulation, green identifies resolution/readiness, and `.secondary` carries supporting content. State remains worded. Drive forces dark appearance; supporting tabs follow the system. No custom palette was added. |
| Navigation and grouped controls | Match. Three native tabs retain their navigation stacks; timeline detail uses an inline title and native `List`, `Section`, `LabeledContent`, and `DisclosureGroup`. Demonstration controls stay in a native `Form`. Video retains the full-screen review cover and Done action. |
| Geometry and motion | Match. The timeline reuses observed 4/6/8/12-point spacing and a scaled symbol column; review actions have a 44-point minimum height. Native grouped surfaces and separators provide depth. No custom shadows, radii, transitions or web-style controls were introduced. |
| Evidence hierarchy | Match. Explanation and current status lead into chronological observations, assessments and action transitions. Disclosure reveals source/camera identity and qualifies scores; no correlation is described as verified identity. |
| Parked review | Match in source. Fresh parked safety gates detailed evidence; the locked branch replaces the timeline with parking guidance. Only the current incident exposes media review when the additional video/explanation gate permits it. Synthetic footage is explicitly illustrative. Lifecycle invalidation and motion close media and remove detailed evidence through the guard. |
| Ongoing incident continuity | Match in source and supplied captures. Detail resolves the incident by ID from the latest model revision. Appending evidence preserves navigation; continued activity updates quietly. Explicit qualifying departures resolve, and reappearance reopens with an updated explanation. Event deduplication and urgent-alert policy prevent repeated interruption; reopening observes a 120-second alert cooldown. |

## Preserved files and existing drift

`DESIGN.md` and `.impeccable/design.json` were preserved without edits. Their SHA-256 values at this check are:

- `DESIGN.md`: `9659bdf90ac1aeff51a3e42068887aa1a5c3b82a861c90c95073937b68f6e0b6`
- `.impeccable/design.json`: `388f7378a748a2433765d7633878a13236b50217e2a0bcd7949ce5e2e5b91b37`

The existing context loader reports `design-sidecar-stale`: DESIGN.md was modified after the sidecar was generated. The recorded modification times are October 5, 2026, 16:37:11 and 16:36:44 respectively. This is pre-existing documentation drift, not a visual defect introduced by the extension. Refresh remains a separately requested document pass; this check does not repair it.

## Verification limits

No HTML/CSS detector ran because this is native iOS. No generated or approved composition image was used; this was a code-led local extension. No new raster was created by this documentation check.

The supplied evidence is Simulator evidence for iPhone. Timeline Dynamic Type, hardware posture, gesture behavior, and hardware performance remain unverified. This check makes no claim that the pending native test rerun passed. Core and backend test results belong to the implementation validation record, not this visual comparison.

Authenticated Ring runtime requires the owner's credentials. Departure markers in this extension are explicit synthetic observations; real motion/history adapters do not infer departure. CarPlay approval and certified vehicle gear evidence remain pending.
