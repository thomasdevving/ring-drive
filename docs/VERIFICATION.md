# Verification record

Environment: Apple Silicon Mac, Xcode 26.1 (17B55), Swift 6.2.1, iOS 26.1 Simulator (23B80), iPhone 17 Pro. Date: 5 October 2026.

| Check | Result |
|---|---|
| Portable Swift core | 19 XCTest cases passed, 0 failures |
| Local Node signed-webhook relay | 2 tests passed, including HTTP integration, 0 failures |
| Native app + Live Activity/widget extension | Built, installed and launched on the iPhone simulator |
| Native audio → stop → parked → AVPlayer → relock | Passed; actual speech completion and a real 20-second interval |
| Native no-stop-result safety path | Passed; fault enabled through the native switch, no video access |
| Native passive scenario + duplicate suppression | Passed; three duplicate deliveries suppressed |
| Online MapKit search + Apple Maps handoff | Passed; real search results, explicit Amsterdam demo origin, Apple Maps foreground launch, and audited NAVIGATING state |
| Full CarPlay source with feature flag | SDK typecheck passed with FULL_CARPLAY; no entitlement or runtime support inferred |
| Official authenticated Ring runtime | Not run: no Ring account access/token available |
| Live Activity on actual CarPlay Simulator | Not run: separate Apple CarPlay Simulator unavailable locally |
| Full CarPlay scene on CarPlay Simulator | Not run: entitlement and provisioning pending |
| Actual parked detection on physical iPhone | Not run: requires hardware |

The core tests cover passive/urgent decisions, low confidence and stale evidence, account isolation, duplicate/out-of-order events, permitted/denied transitions, skipped steps, failed navigation retry, standstill without user confirmation, motion revocation, stale/future samples, invalid numbers, accuracy, confidence, sample gaps, source changes, expired cached parking verdicts and rejection of simulated parking under production policy. Media requests fail before the network while locked. Two URLProtocol tests verify official request/response contracts; their canned responses are not authenticated Ring runtime evidence.

The native tests use real AVSpeechSynthesizer completion and a real 20-second wait. They do not force or bypass parking. Online Maps checks need network access; if MapKit returns no accessible result, that test is explicitly skipped and the lock is still checked.

The first native test pass exposed test-driver issues: tapping a Form row did not enable its switch, and SwiftUI combines LabeledContent accessibility text. The tests now tap the switch control, assert its value and verify the actual combined accessibility label. The Maps test checks persisted navigation state because iOS may dismiss an alert when changing foreground applications.

Visual evidence comes from the real iPhone simulator: dark driving, light system settings, accessibility-large text, parked review and real MapKit results. A fresh Impeccable finish review found button contrast and a fixed camera-symbol width at large text sizes; these were corrected. The final reviewer verdict is recorded in docs/DESIGN_REVIEW.md.

## Environment blockers and workarounds

Xcode initially did not recognize the installed SDK/runtime pair (23B77/23B80). Explicit runtime matching fixed it without downloading a new runtime; the exact command and reset are in README. Low disk space caused compilation and simulator installation failures. Only temporary project-generated compiler data was removed. The user subsequently freed storage, allowing native verification to continue. No personal documents, installed runtimes or other projects were deleted.

Codex offers Sol 6.1 High as a model configuration; it was selected for the fresh design review. These tools do not expose a setter or reliable confirmation for the running root chat's model configuration, so no claim is made that the current chat was switched.

## Final delivery run

The final full native run passed all **4 UI tests, 0 failures, 0 skips**, in 177.985 seconds. Result bundle: `Test-RingDrive-2026.10.05_16-24-30-+0200.xcresult`. Together with the 19 core/contract tests and 2 relay tests, **25 tests passed**. An additional final simulator build includes sensor startup on physical-device mode; hardware sensing itself remains unverified. CarPlay feature-flag SDK typechecking also passed with no diagnostics. Build caches and raw result bundles are intermediate workspace artifacts, not part of the submission package.
