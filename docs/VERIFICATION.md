# Verification record

Environment: Apple Silicon Mac, Xcode 26.1 (17B55), Swift 6.2.1, iOS 26.1 Simulator (23B80), iPhone 17 Pro. Latest verification: 7 October 2026. Earlier runs are retained below.

| Check | Result |
|---|---|
| Portable Swift core, incident timeline/lifecycle and native backend transport | 41 XCTest cases passed, 0 failures |
| Local Node backend, OAuth refresh, signed webhooks and encrypted token handoff | 10 tests passed, including HTTP integration, 0 failures |
| Native app + Live Activity/widget extension | Built, installed and launched on the iPhone simulator |
| Physical arm64 iPhone Release compilation | Passed: app and widget built for iPhoneOS, minimum iOS 26.0; unsigned, not installed |
| Native audio → stop → parked → AVPlayer → relock | Passed; actual speech completion and a real 20-second interval |
| Native no-stop-result safety path | Passed; fault enabled through the native switch, no video access |
| Native passive scenario + duplicate suppression | Passed; three duplicate deliveries suppressed |
| Online MapKit search + Apple Maps handoff | Passed; real search results, explicit Amsterdam demo origin, Apple Maps foreground launch, and audited NAVIGATING state |
| Full CarPlay source with feature flag | SDK typecheck passed with FULL_CARPLAY; no entitlement or runtime support inferred |
| Native backend connection form | Passed: rejects direct Ring API origin before network; captured actual native form |
| Native continued incident → resolution → reopening | Passed: same incident reference, navigation preserved, duplicate suppressed, one urgent alert request |
| Parked camera timeline → selected camera review → relock | Not passing: timeline/disclosure reached, nested-action lookup unresolved in targeted reruns; latest rerun failed earlier to reach the synthetic navigation button |
| Remote token-input page | Chrome desktop/390px responsive browser check passed: WebCrypto envelope decrypted locally, original input cleared, no network requests or script errors |
| Official authenticated Ring runtime | Pending: owner reports official simulator access; access token not yet received locally or as an encrypted envelope |
| Live Activity on actual CarPlay Simulator | Not run: separate Apple CarPlay Simulator unavailable locally |
| Full CarPlay scene on CarPlay Simulator | Not run: entitlement and provisioning pending |
| Actual parked detection on physical iPhone | Not run: requires hardware |

The core tests cover passive/urgent decisions, low confidence and stale evidence, account isolation, duplicate/out-of-order events, permitted/denied transitions, skipped steps, failed navigation retry, standstill without user confirmation, motion revocation, stale/future samples, invalid numbers, accuracy, confidence, sample gaps, source changes, expired cached parking verdicts and rejection of simulated parking under production policy. Media requests fail before the network while locked. Five URLProtocol/transport tests verify backend routing, account identity, official `button_press` decoding, rejected unsafe/direct Ring origins and recorded MP4 contracts. Their canned responses are not authenticated Ring runtime evidence.

The backend tests verify separate native-client authentication, user-profile PII filtering, consented device checks, fixed human/ding history filtering, parking markers before media access, partial MP4 and missing recording responses, missing/expired tokens, one refresh under concurrent failures, account binding after refresh, encrypted private token storage, HMAC raw-byte checks, deduplication/staleness and the official doorbell event name. A WebCrypto-to-Node test checks encrypted remote handoff and rejects tampered ciphertext or the wrong local key. Refresh has been tested with fixtures, not a live Ring refresh credential. Native parking markers are not independent hardware attestation.

The native tests use real AVSpeechSynthesizer completion and a real 20-second wait. They do not force or bypass parking. Online Maps checks need network access; if MapKit returns no accessible result, that test is explicitly skipped and the lock is still checked.

The first native test pass exposed test-driver issues: tapping a Form row did not enable its switch, and SwiftUI combines LabeledContent accessibility text. The tests now tap the switch control, assert its value and verify the actual combined accessibility label. The Maps test checks persisted navigation state because iOS may dismiss an alert when changing foreground applications.

Visual evidence comes from the real iPhone simulator: dark driving, light system settings, accessibility-large text, parked review and real MapKit results. A fresh Impeccable finish review found button contrast and a fixed camera-symbol width at large text sizes; these were corrected. The final reviewer verdict is recorded in docs/DESIGN_REVIEW.md.

## Environment blockers and workarounds

Xcode initially did not recognize the installed SDK/runtime pair (23B77/23B80). Explicit runtime matching fixed it without downloading a new runtime; the exact command and reset are in README. Low disk space caused compilation and simulator installation failures. Only temporary project-generated compiler data was removed. The user subsequently freed storage, allowing native verification to continue. No personal documents, installed runtimes or other projects were deleted.

Codex offers Sol 6.1 High as a model configuration; it was selected for the fresh design review. These tools do not expose a setter or reliable confirmation for the running root chat's model configuration, so no claim is made that the current chat was switched.

## Earlier delivery run

The final full native run passed all **4 UI tests, 0 failures, 0 skips**, in 177.985 seconds. Result bundle: `Test-RingDrive-2026.10.05_16-24-30-+0200.xcresult`. Together with the 19 core/contract tests and 2 relay tests, **25 tests passed**. An additional final simulator build includes sensor startup on physical-device mode; hardware sensing itself remains unverified. CarPlay feature-flag SDK typechecking also passed with no diagnostics. Build caches and raw result bundles are intermediate workspace artifacts, not part of the submission package.

## Backend integration update

After the owner supplied current Ring documentation, direct native Ring requests were replaced by a server-to-server backend, as required by that documentation. The app keeps a verified connection snapshot until explicit reconnection; reconnecting revokes video and motion evidence before any network call. A failed or edited connection cannot silently mix account sessions.

The updated full native run passed **5 UI tests, 0 failures, 0 skips**, in 174.781 seconds, result bundle `Test-RingDrive-2026.10.05_18-30-39-+0200.xcresult`. After connection latching was finalized, the changed connection path passed again with its exact XCTest identifier, **1 test, 0 failures**, in 27.267 seconds. The final readable-label build passed that connection test again in **29.116 seconds**, result bundle `Test-RingDrive-2026.10.05_18-46-19-+0200.xcresult`. The test driver now uses a fixed launch-domain URL and taps the field's trailing edge before clearing; it checks exact text entry and restoration rather than assuming cursor position. Together with **22 core/transport tests and 10 Node tests, 37 distinct automated tests pass**. The optional full CarPlay SDK typecheck passed again on final app sources; entitlement/runtime support remains pending.

The remote input utility was additionally exercised in installed Chrome with a fake token, at desktop width 960 and responsive width 390. Its actual browser encryption was decrypted using the matching local private key. There were no outgoing network requests or script errors. A physical phone/Safari file viewer has not been validated; file-preview apps can disable JavaScript. The page's public key can be shared; `.env.local`, private keys, encrypted token storage and local runtime receipts are ignored and excluded by the packaging script. No real Ring credentials were used in tests.

The documented backend startup command also passed a local smoke check with separate client authentication. A fresh narrow Impeccable review found faint field identification; persistent readable labels resolved its one finding. Its final ship verdict applies to that scored fix. The browser detector returned no findings; native review used platform conventions. Reports are in `REMOTE_CONNECTION_REVIEW.md` and `REMOTE_CONNECTION_DESIGN_CHECK.md`.

## Physical build readiness

The remote-testing follow-up passed a Release build for `generic/platform=iOS`, SDK `iphoneos`, architecture `arm64`, with signing disabled. The generated app reports platform `iPhoneOS` and minimum iOS `26.0`; no signing resources are present. Both the app and widget compiled. This confirms device compilation, not installation, physical sensor validation or App Store distribution. There are no signing identities or configured development team on this Mac. The owner reports no paid Apple Developer account, so TestFlight distribution is currently unavailable. Free Personal Team testing through Xcode remains a local-Mac route. A reachable HTTPS backend is also required for real Ring calls from a remote phone.

## Incident timeline and lifecycle extension

The final core suite on 7 October passed **41 tests, 0 failures**; the backend suite passed **10 tests, 0 failures**. Nineteen added core tests cover chronological/stable timeline identities, original assessment snapshots, legacy decoding, fresh parked evidence, episode/account/source isolation, continued navigation, escalation acknowledgments, stale speech completion, explicit departure resolution, intervening activity, reopening and alert cooldowns. Silence, low confidence and an unrelated front-door departure cannot clear an urgent rear-door incident.

The six-test native run `Test-RingDrive-2026.10.06_00-24-51-+0200.xcresult` passed five cases, including real MapKit/Maps, connection validation, passive/duplicate handling, no-stop safety and continued/resolved/reopened activity. Its remaining camera-review test reached the parked timeline and expanded the actual review control, then failed to locate the nested accessibility identifier. The disclosure identifier now attaches only to its label, and the nested action uses the native borderless button style. The test selects the review action by an exact spoken-label predicate and checks the selected camera in the player. The test runner was explicitly reinstalled during diagnosis; subsequent installed app/test binaries were checked against the build.

**This native test is still open.** The 7 October targeted runs did not pass: one still could not locate the review control; the latest `Test-RingDrive-2026.10.07_22-27-47-+0200.xcresult` failed to reach the synthetic navigation button before parking (81.934 seconds). The latest selector and failure-hierarchy attachment changes therefore remain unverified end to end. Current automated evidence is 51 passing Swift/backend tests plus five passing native cases from the earlier extension run; there is one failing native case. These failures are retained rather than counted as passes or skips. Native tests do not skip or shorten the twenty-second parking interval.

The extension's physical arm64 app/widget Release build passed again on the final UI sources, unsigned. The full CarPlay source passed SDK typechecking with `FULL_CARPLAY`, with existing MapKit deprecation warnings; this remains compilation evidence only. A fresh native finish reviewer returned **ship** at the extension's supplied evidence scope, then cleared the two accessibility/action semantics changes: `INCIDENT_EVIDENCE_REVIEW.md`. The documenter comparison and recheck are in `INCIDENT_EVIDENCE_DESIGN_CHECK.md`; incumbent design files were preserved. New timeline Dynamic Type and physical sensors remain unverified; the existing large-text capture checks the established Drive layout only. Changing Simulator text preferences during a targeted run also disrupted its control selection; accessibility settings should be fixed before launching a run.

Official Ring departure detection is not implemented: resolution/reappearance are demonstrated with explicitly synthetic semantic observations. Current incidents support selected-camera media review; archived incidents expose parked metadata. Authenticated Ring runtime, real CarPlay presentation and Apple approval remain external validation steps.

## Household, Bedrock, Siri and Alexa+ extension — 8 October 2026

Environment: Apple Silicon Mac with Command Line Tools only (Swift 6.3.3, no Xcode), Node 22.23.1.

| Check | Result |
|---|---|
| Backend (`Relay`, `node --test`) | 55 tests pass: absence rules and time zones, fail-closed history reading, scheduler retries, Bedrock summaries and output checks, mirrored state machine, contacts, escalation ladders, routing, dry run, HTTP API, Ring proxy, webhooks |
| MCP server (`mcp`, `node --test`) | 9 tests pass with the official MCP client SDK: protocol 2025-11-25, tools, DNS-rebinding protection, OAuth Tier 1/Tier 2, PKCE, refresh rotation |
| Swift core | `swift build` passes. A scratch harness importing `RingDriveCore` passes all checks for sync payloads, driver choices, absence incidents, persistence, driving decision, call links, Live Activity texts and the multi-camera scenario |
| Swift client ↔ backend contract | The harness ran `HouseholdAPI` against a real local backend: contacts, presence, absence incidents, summary, audit mirroring, notify household, inbox, acknowledgement |
| App Intents | `iOS/App/Intents.swift` type-checks unchanged against the AppIntents SDK (macOS) with a stub model |
| Demo scenarios | `demo.mjs 0815 --auto` and `demo.mjs multicam --backend-only` run end to end against a real backend |
| XCTest | New test files added (`HouseholdAPITests`, `DriverChoiceTests`, `HouseholdTests`, `ActivityTextTests`, `DemoScenarioTests`); not run: XCTest needs Xcode |
| iOS app and widget build | Not run since 7 October: no Xcode |
| Live Bedrock output | Not obtained: AWS returned 403 "account is being verified"; template fallback verified |
| Siri, CarPlay, driving sensors, Alexa+ registration | Not run; see `docs/friction-log.md` |
