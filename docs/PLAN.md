# Implementation plan

1. Verify the official Ring API, Playground, hackathon rules and Apple's iOS 26 CarPlay surfaces. Done; sources in README.
2. Build a portable Swift core: explicit evidence provenance, deterministic triage, deduplication, audited transitions and a fail-closed video guard.
3. Build native SwiftUI client: audio explanation, MapKit stop search, Apple Maps handoff, CoreLocation/CoreMotion stationary evidence, guarded AVPlayer review.
4. Ship synthetic scenarios and fault injection, clearly separated from official Ring history/webhook inputs.
5. Connect official Ring runtime through device discovery, event-history polling and recorded MP4 download. Add a small signed-webhook relay, without cloud dependencies.
6. Ship a real ActivityKit extension and a compile-gated full CarPlay scene. The interactive fallback is labeled as an in-app simulation.
7. Run core and relay tests, build app/extension with Xcode, run native UI end-to-end tests and inspect simulator screenshots.
8. Deliver setup, a demo script under three minutes, verification evidence and remaining account/entitlement blockers.

Scope decision: deterministic rules first. Ring metadata cannot prove identity across cameras or that a person is a courier. Synthetic scenario annotations are labeled; runtime correlation is an inference. No cloud AI or AWS service is necessary for this cut.

Delivery status: all implementation steps are complete. Local verification passed 19 Swift core/contract tests, 2 relay tests and 4 native UI tests. The final app/extension build and FULL_CARPLAY SDK typecheck passed. The fresh finish review scored both accessibility fixes resolved with disposition ship; native design documentation is included.

External validation remains: a successful authenticated Ring simulator/device event and recording call after account access, actual CarPlay Live Activity presentation, Apple entitlement/provisioning for interactive full CarPlay, and real-iPhone stationary sensor validation. These are documented blockers, not completed checks.
