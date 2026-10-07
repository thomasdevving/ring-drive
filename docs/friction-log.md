# Friction log

Running record of friction with Ring, AWS, Apple and other SDKs/APIs encountered while extending Ring Drive. Newest entries at the bottom.

Severity: **blocker** (cannot proceed without a workaround), **high** (feature degraded or materially riskier), **medium** (extra work, no feature loss), **low** (annoyance).

---

## 2026-10-07 · Ring · Event history has no camera-module IDs

- **Task attempted:** Build a per-camera, per-module timeline for multi-camera incidents and absence rules from Ring event history.
- **Steps taken:** Read the Event History section of the official Ring Partner API documentation.
- **Expected:** History events carry the same `component_ids` as `motion_detected` webhooks.
- **Actual:** History events expose `event_type`, `start`, `end` (epoch ms), `is_third_party_reviewed`, `id` and `relationships.source` (device) only. Module granularity exists only in webhooks.
- **Severity:** medium
- **Workaround:** Treat a device as the unit of "camera" for history-based rules. Use module IDs only when the event arrived by webhook.
- **Suggestion:** Add `component_ids` to history event attributes for parity with webhooks.

## 2026-10-07 · Ring · No direction or identity semantics

- **Task attempted:** Absence rule "child not seen leaving between 07:30 and 08:15".
- **Steps taken:** Checked the history, webhook and device sections for identity, direction or named zones.
- **Expected:** Some signal for entering vs leaving, or a semantic "exit" zone.
- **Actual:** Not documented. Motion/privacy zones are anonymous polygons (UUID and normalized vertices). `sub_type: human` is only present when Smart Alerts is enabled, and Smart Alerts status is not exposed by the API.
- **Severity:** high (affects wording and correctness of absence rules)
- **Workaround:** The user designates exit cameras. Any qualifying person (or, when configured, any motion) event at an exit camera inside the window satisfies the rule. The person label is used only for wording and routing, never for matching. Spoken wording reports what cameras did not record and never claims where a person is.
- **Suggestion:** Expose Smart Alerts status per device and a line-crossing/direction attribute where the hardware supports it.

## 2026-10-07 · Ring · Playground token lifetime vs. time-window rules

- **Task attempted:** Evaluate a 45-minute absence window server-side.
- **Steps taken:** Read the official starter (`AmazonAppDev/ring-api-helloworld`).
- **Expected:** A development credential that lasts a working session.
- **Actual:** Playground access tokens last about 30 minutes, and webhooks are only available in refresh-token (registered app) mode.
- **Severity:** high
- **Workaround:** Absence evaluation fails closed: if history cannot be read at window end, record "could not check" instead of raising an ABSENCE incident. Demos use a freshly generated token or a registered app with refresh.
- **Suggestion:** Offer longer-lived sandbox tokens, or webhook delivery for Playground tokens.

## 2026-10-07 · Ring · Simulator capabilities undocumented

- **Task attempted:** Confirm which events the Ring simulator/Playground can generate (person vs motion, several cameras, multi-module, long events).
- **Steps taken:** Read the API documentation, the official starter README and searched the developer site.
- **Expected:** A documented list of simulated devices and triggerable events, ideally triggerable by API for reproducible demos.
- **Actual:** No public description found. The console requires sign-in.
- **Severity:** medium
- **Workaround:** Pending the owner's check of the console. Reproducible demo scenarios inject clearly labeled synthetic events through the backend's existing ingest path.
- **Suggestion:** Document simulator devices and add an API to trigger simulated events.

## 2026-10-07 · Ring · Documentation inconsistency for webhook `data.id`

- **Task attempted:** Deduplicate webhook deliveries.
- **Actual:** The general payload section gives `<device_id>_<event_type>_<timestamp>`; the motion section gives `<device_id>_<sub_type>_<timestamp>`.
- **Severity:** low
- **Workaround:** Treat `data.id` as opaque and deduplicate on `meta.request_id` plus `data.id`.
- **Suggestion:** Align both sections.

## 2026-10-07 · Apple · Swift tests cannot run with Command Line Tools only

- **Task attempted:** Run the existing `swift test` baseline on this Mac.
- **Steps taken:** `swift test` in the repo; a minimal Swift Testing (`import Testing`) probe package.
- **Expected:** Unit tests for a platform-independent Swift package run with the Swift toolchain alone.
- **Actual:** `no such module 'XCTest'` and `no such module 'Testing'`; `xcodebuild` requires a full Xcode install.
- **Severity:** blocker for Swift verification on this machine
- **Workaround:** Install Xcode 26.x. Until then, new rule/escalation logic that lives in the Node backend is tested with `node --test`.
- **Suggestion:** Ship XCTest/Swift Testing with the Command Line Tools so SwiftPM packages can be tested without Xcode.

## 2026-10-07 · Ring · History subtype format in responses is undocumented

- **Task attempted:** Match history events against a rule that expects `motion.human`.
- **Steps taken:** Read the Event History section; compared it with the existing test fixture.
- **Expected:** The response documents whether `event_type` is returned as `motion.human` or as `motion` with a separate subtype.
- **Actual:** Only `event_type: string` is documented; the filter syntax (`event_types=motion.human`) is documented, the response shape for subtypes is not.
- **Severity:** medium
- **Workaround:** Query history with the rule's expected type as a server-side filter and treat every returned non-doorbell event as matching. Signed webhooks map `sub_type` explicitly.
- **Suggestion:** Document the returned `event_type` values, ideally identical to the filter values.

## 2026-10-07 · Apple · Native rules screen deferred until Xcode is available

- **Task attempted:** Add an absence-rules configuration screen to the iOS app in Phase 1.
- **Expected:** Build and run the SwiftUI change in the simulator before handing it over.
- **Actual:** No Xcode on this Mac (see the earlier entry), so no Swift change can be compiled or tested.
- **Severity:** high
- **Workaround:** Rules are configured through the authenticated backend API and `scripts/rules.mjs`. The native screen follows once Xcode 26.x is installed.
- **Suggestion:** n/a (environment).
