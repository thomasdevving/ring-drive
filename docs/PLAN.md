# Implementation plan

1. Verify the official Ring API, Playground, hackathon rules and Apple's iOS 26 CarPlay surfaces. Done; sources in README.
2. Build a portable Swift core: explicit evidence provenance, deterministic triage, deduplication, audited transitions and a fail-closed video guard.
3. Build native SwiftUI client: audio explanation, MapKit stop search, Apple Maps handoff, CoreLocation/CoreMotion stationary evidence, guarded AVPlayer review.
4. Ship synthetic scenarios and fault injection, clearly separated from official Ring history/webhook inputs.
5. Connect official Ring runtime through a server-to-server backend for user identity, device discovery, event-history polling and recorded MP4 download. Keep OAuth credentials on the backend, add optional refresh and signed webhooks without cloud dependencies.
6. Ship a real ActivityKit extension and a compile-gated full CarPlay scene. The interactive fallback is labeled as an in-app simulation.
7. Run core and relay tests, build app/extension with Xcode, run native UI end-to-end tests and inspect simulator screenshots.
8. Deliver setup, a demo script under three minutes, verification evidence and remaining account/entitlement blockers.

Scope decision: deterministic rules first. Ring metadata cannot prove identity across cameras or that a person is a courier. Synthetic scenario annotations are labeled; runtime correlation is an inference. No cloud AI or AWS service is necessary for this cut.

Backend update: native requests now use a separately authenticated backend with verified account identity and consented device checks. Simulator access tokens stay in private local configuration. Registered-app refresh is optional and saves rotated credentials encrypted; a production account-link portal remains outside the demo. Remote input uses a workspace-specific public-key envelope, with private keys excluded from delivery.

Delivery verification: 22 Swift core/transport tests, 10 Node backend/crypto tests and 5 native UI tests pass (37 distinct tests). The final changed native connection path passed again. The app/extension builds and FULL_CARPLAY SDK typecheck are checked independently of entitlement approval. Original accessibility review and native system documentation are retained; a narrow finish review checks the new connection/input surfaces.

External validation remains: a successful authenticated Ring simulator/device event and recording call after account access, actual CarPlay Live Activity presentation, Apple entitlement/provisioning for interactive full CarPlay, and real-iPhone stationary sensor validation. These are documented blockers, not completed checks.

## Requested timeline and incident lifecycle extension — 6 October 2026

1. Add chronological observations, immutable assessment snapshots and audited actions; migrate legacy saved records without inventing history.
2. Replace evidence detail with a live incident-ID view, gate detailed evidence with fresh confirmed parking and allow deliberate current-camera moment review.
3. Add continued/escalated/resolved/reopened updates within one incident. Preserve navigation, maintain urgency until explicit departure evidence and deduplicate alert requests.
4. Add synthetic continuing/duplicate/departure/reappearance controls with a real ten-second departure interval. Do not infer departure from official Ring motion events.
5. Verify core transitions, safety, grouping, resolution, explanation revisions, cooldowns and persistence; run native end-to-end, regression, accessibility and appearance checks.
6. Complete the native finish review/documentation handoffs, refresh the simulator build and exclude private configuration from the delivery ZIP.

Scope: preserve the existing native design. No AI snapshot analysis, new cloud infrastructure, full CarPlay approval or automatic route cancellation is included.
