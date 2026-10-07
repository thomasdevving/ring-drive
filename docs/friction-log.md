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

## 2026-10-08 · AWS · New account blocks Bedrock until verification completes

- **Task attempted:** First Bedrock call (Claude via `InvokeModel`, eu-central-1) with a fresh IAM user scoped to `bedrock:InvokeModel`.
- **Steps taken:** Called `anthropic.claude-opus-5-5`, `global.anthropic.claude-opus-5-5`, `eu.anthropic.claude-opus-5-5`, `anthropic.claude-haiku-5-5` through `@anthropic-ai/bedrock-sdk`, and the Mantle endpoint.
- **Expected:** A response, or a clear model-access error.
- **Actual:** HTTP 403 "Your account is currently being verified. Verification normally takes less than 2 hours." The `eu.` prefix returned 400 "The provided model identifier is invalid", so these models are invoked with the bare or `global.` ID. The Mantle endpoint returned 403 "not available for this account" for Opus 5.5 and 404 for Haiku 5.5 in this region.
- **Severity:** high (blocks live verification of Phase 2 for a few hours)
- **Workaround:** Summaries fall back to the deterministic template; Bedrock is tested with an injected client and verified live with `node scripts/verify_bedrock.mjs` once the account is verified.
- **Suggestion:** Show the verification state on the Bedrock console landing page and in the error code (not only in the message), so tooling can distinguish it from IAM denials.

## 2026-10-08 · Apple · Remote push to household members needs APNs (paid program)

- **Task attempted:** Push escalation messages to other household members' Ring Drive apps via Amazon SNS mobile push.
- **Steps taken:** Checked SNS platform applications for iOS and Apple's requirements.
- **Expected:** A development push path usable with a free Apple account.
- **Actual:** SNS mobile push (and ActivityKit push updates) require an APNs key or certificate, which needs Apple Developer Program membership. The owner has a free Personal Team only.
- **Severity:** high
- **Workaround:** The backend stores messages in a per-member inbox (`GET /members/{id}/inbox`); the app polls while open and raises a local notification. Acknowledgements ("Sanne has seen this") work end to end. SMS through Amazon SNS is available as a separate channel (dry-run by default).
- **Suggestion:** A sandbox APNs entitlement for free Personal Team builds, limited to the developer's own devices.

## 2026-10-08 · Apple · Driving detection cannot be verified without hardware

- **Task attempted:** Detect whether a household member is driving (CarPlay audio route via `AVAudioSession`, CoreMotion automotive activity).
- **Steps taken:** Implemented `DrivingMonitor` (route-change observer for `.carAudio` outputs, `CMMotionActivityManager` automotive at medium/high confidence).
- **Expected:** A way to exercise both signals in the iOS Simulator.
- **Actual:** The iOS Simulator provides no motion activity, and the CarPlay audio route only exists with a CarPlay head unit or Apple's CarPlay Simulator, which pairs with a physical iPhone. Neither could be exercised here (no Xcode, no device).
- **Severity:** medium
- **Workaround:** Pure decision logic (`DrivingSignal`) is tested; demo mode uses the labeled simulated vehicle; presence can be set with `scripts/household.mjs driving`.
- **Suggestion:** Let the iOS Simulator inject CoreMotion activity and a CarPlay audio route.

## 2026-10-08 · AWS · SMS through SNS needs extra account setup

- **Task attempted:** Send household SMS through Amazon SNS `Publish`.
- **Expected:** SMS to verified numbers with the existing IAM user.
- **Actual:** New accounts are in the SMS sandbox (verified destination numbers only), the Netherlands requires a registered origination identity/sender ID for reliable delivery, and the IAM user needs `sns:Publish` in addition to Bedrock.
- **Severity:** medium
- **Workaround:** SMS is dry-run unless `DRY_RUN` excludes `sms`; the in-app inbox is the primary household channel.
- **Suggestion:** Show sandbox status and country requirements next to the SMS `Publish` error.

## 2026-10-08 · Apple · Siri and App Intents in CarPlay cannot be verified here

- **Task attempted:** Verify `ExplainLatestIncidentIntent`, `NotifyHouseholdIntent`, `CallContactIntent` and `FindSafeStopIntent` through Siri on the CarPlay Simulator.
- **Steps taken:** Type-checked `iOS/App/Intents.swift` unchanged against the AppIntents framework in the macOS SDK (with a stub app model); unit-checked the shared logic.
- **Expected:** Run the app on an iOS Simulator with its CarPlay window, or Apple's CarPlay Simulator, and invoke the App Shortcuts by voice.
- **Actual:** No Xcode on this Mac, so no iOS build, simulator or Siri run. Apple's standalone CarPlay Simulator connects to a physical iPhone over USB, not to the iOS Simulator.
- **Severity:** high (Phase 5 runtime behaviour unverified)
- **Workaround:** Intents never open the app (`openAppWhenRun = false`), answer with spoken dialogs, and hand calls and Maps to the system with `OpenURLIntent`. A manual verification checklist is in the README.
- **Suggestion:** Allow the iOS Simulator's CarPlay window to run Siri App Shortcuts, and document which `OpenURLIntent` targets CarPlay Siri accepts.

## 2026-10-08 · Amazon · Alexa+ MCP add-ons need OAuth, not a static token

- **Task attempted:** Connect a self-hosted Ring Drive MCP server (Streamable HTTP, protocol 2025-11-25) to Alexa+.
- **Steps taken:** Built the server with `@modelcontextprotocol/sdk` 1.32.1 and a static bearer token; read the Alexa+ MCP toolkit authentication documentation.
- **Expected:** Register a remote MCP URL with a bearer token, as most MCP clients allow.
- **Actual:** Alexa+ requires an OAuth authorization server: `client_credentials` with scope `mcp:service` for initialize and tools/list (Tier 1), and `authorization_code` with PKCE S256 and scope `mcp:tools` for user data (Tier 2), tokens ≤ 3600 s, no refresh tokens for client credentials, `resource` validation, and responses under 500 ms. The documentation also conflicts with itself and with the MCP specification about `WWW-Authenticate` on 401 responses.
- **Severity:** high
- **Workaround:** Implemented a minimal single-household authorization server in `mcp/oauth.mjs` (RFC 8414 and RFC 9728 metadata, Tier 1 and Tier 2, owner consent page, rotating refresh tokens). The MCP endpoint keeps `WWW-Authenticate` with `resource_metadata` per the MCP specification; the token endpoint omits it. Publishing the add-on (Alexa AI CLI, privacy policy and terms URLs, public HTTPS) was not done here, so the Alexa+ connection itself is untested.
- **Suggestion:** Offer a static-token or API-key option for private, single-household add-ons, and align the 401 guidance with the MCP specification.
