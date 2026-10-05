---
name: Ring Drive
description: Hear home-camera evidence, stop safely, then review.
colors:
  filled-button-foreground: "#000000"
typography:
  incident-headline:
    fontFamily: "System"
  section-title:
    fontFamily: "System"
  headline:
    fontFamily: "System"
  body:
    fontFamily: "System"
  supporting-label:
    fontFamily: "System"
  footnote:
    fontFamily: "System"
  caption:
    fontFamily: "System"
  compact-caption:
    fontFamily: "System"
spacing:
  tight: "4pt"
  status-detail: "6pt"
  row-detail: "8pt"
  evidence-row: "12pt"
  camera-chain: "14pt"
  action-stack: "16pt"
  incident-stack: "20pt"
  screen-inset: "24pt"
  drive-stack: "28pt"
components:
  button-primary:
    textColor: "{colors.filled-button-foreground}"
  button-review:
    textColor: "{colors.filled-button-foreground}"
  drive-surface:
    padding: "{spacing.screen-inset}"
---

# Design System: Ring Drive

## Overview

**Creative North Star: "Hear first. Stop safely."**

Ring Drive is a native Operate interface for turning home-camera evidence into an audible decision and a safe stop. Its design language is quiet, direct and familiar: system navigation, system text styles, SF Symbols and platform controls carry the experience. The driving presentation uses a dark appearance; Incidents and Demo & Ring follow the system appearance.

A large incident headline leads to the camera observation chain, an explanation action and an explicit video-lock status. Orange calls attention to urgency or simulation, blue identifies actions and camera evidence, and green identifies passive resolution or parked readiness. These roles always accompany words or symbols. This is a demonstration concept, without official Ring affiliation; synthetic evidence and the CarPlay simulation remain visibly identified.

**Key Characteristics:**

- Native SwiftUI controls and system navigation.
- Dynamic Type throughout, with a scaled camera-symbol column.
- Quiet dark driving presentation; adaptive supporting screens.
- Brief evidence, audible explanation and visible video-lock state.
- Explicit simulation labels and system-surface limits.

## Colors

The palette uses native semantic colors rather than a custom brand ramp. The frontmatter records the literal black foreground; native semantic sources are recorded in the sidecar because substituting CSS names or hex samples would misrepresent SwiftUI’s resolved colors. The sidecar provides native SwiftUI excerpts rather than HTML/CSS component previews; browser-based preview tooling cannot render them.

### Primary

- **Action Blue** (`SwiftUI.Color.blue`): the root tint, camera-chain symbols and home-awareness imagery. Prominent actions inherit this tint unless explicitly overridden.

### Secondary

- **Urgency Orange** (`SwiftUI.Color.orange`): urgent incident labels and explicit simulation labels.

### Tertiary

- **Readiness Green** (`SwiftUI.Color.green`): passive resolution, unlocked status, parked confirmation and the enabled review action.

### Neutral

- **System Foreground**: implicit native primary text and symbols.
- **Secondary Foreground** (`.foregroundStyle(.secondary)`): explanations, timestamps, source labels and supporting copy; this is a semantic hierarchical style, not a single fixed color.
- **System Background** (`.background`): platform surfaces, with a dark appearance on Drive and the interactive CarPlay preview.
- **Filled Button Foreground**: explicit black text and symbols on the current blue and green prominent buttons. Keep this contrast choice when retaining these fills.

**The State Has Words Rule.** Urgency, simulation and parked readiness are expressed with text or symbols as well as color.

## Typography

The system font carries every screen and widget. The frontmatter deliberately omits fixed font sizes: the native text style is the source of sizing, line metrics and Dynamic Type behavior. There is no custom typeface or fixed scale ratio.

- **Incident headline**: `.largeTitle.bold()`; urgent and passive incident summaries, empty-state headline and interactive preview headline.
- **Section title**: `.title3.bold()`; nearby stops and the small widget’s instruction. Preview supporting instruction uses plain `.title3`.
- **Headline**: `.headline`; safety status, stop names, incident rows and Live Activity headline.
- **Body**: `.body`; explanation and introductory copy. Unmodified list text inherits the platform default.
- **Supporting label**: `.subheadline`; metadata, safety reasoning and camera-zone text. Semibold marks motion and priority, medium marks camera zones.
- **Footnote**: `.footnote`; qualifications, connection guidance and fault descriptions.
- **Caption**: `.caption`; timestamps, source attribution and supporting system-surface copy. The simulation badge adds bold weight; event IDs use `.monospaced()` and camera timestamps use `.monospacedDigit()`.
- **Compact caption**: `.caption2`; synthetic-event attribution in the Live Activity.

The camera symbol column is `@ScaledMetric(relativeTo: .subheadline)` with a starting width of 24 points. This is a scalable alignment dimension, not a fixed icon size. Standalone lock and Live Activity symbols use `.title2`; decorative home imagery uses `.largeTitle`.

**The Type Follows the Reader Rule.** Use native text styles and scaled dimensions for text-adjacent symbols; do not replace them with fixed type sizes.

## Layout

Drive and the interactive preview use a vertically scrolling, leading-aligned stack with the observed `screen-inset`. Drive separates major blocks with `drive-stack`; the preview uses `screen-inset` between blocks. Incident focus uses `incident-stack`, actions and stop results use `action-stack`, and camera observations use `camera-chain` vertically with `evidence-row` horizontally. The camera trace has vertical padding from `action-stack` and dividers at its top and bottom.

Rows rely on intrinsic text sizing, spacers and native layout rather than fixed screen widths or breakpoints. The large incident headline permits vertical growth. Incidents use a native `List`; Demo & Ring uses a native `Form` with sections. The root contains three tabs, each with its own `NavigationStack`. Top-level navigation titles use the platform default large-title behavior; evidence detail and focused modal surfaces use inline titles.

Plain action and navigation rows explicitly set a minimum height of 44 points. Large styled buttons use `.controlSize(.large)`; the full-width listen, stop-search and review labels set a 34-point content minimum before the system button style supplies its own padding. Do not treat that content minimum as the complete tap target. The Live Activity chooses 8-point padding for the small activity family and 16-point padding otherwise; the small widget is owned by WidgetKit. No app-defined responsive breakpoints exist.

## Elevation & Depth

The app defines no custom shadows, blur recipes or elevation scale. Native grouped surfaces, dividers, navigation chrome and modality supply separation. SwiftUI owns the border, fill, corner treatment and disabled appearance of the bordered and prominent buttons. The interactive preview is a sheet; guarded video review is a full-screen cover with native navigation and a Done action. There are no custom animation tokens; push, sheet and dismissal motion stay with the platform.

**The Platform Owns the Controls Rule.** Keep platform navigation, forms, sheets and button styles responsible for their standard appearance and interaction.

## Shapes

No custom radius, card silhouette or border-width tokens are defined. Keep the platform’s shapes for buttons, grouped rows, form fields, alerts and widget containers. The camera trace is a flat evidence chain bounded by native dividers. SF Symbols provide all interface iconography, using native text styles, baseline alignment and accessibility labels where meaningful.

## Components

### Buttons

Primary explanation and demo-entry actions use `.borderedProminent` with `.controlSize(.large)` and black foregrounds. Listen switches its label and symbol while speaking and is disabled during speech. The safe-stop search uses `.bordered`, large control size and a full-width label; its searching state changes its label and disables it. Parking confirmation is prominent and disabled until the model reports stationary or parked. Review is prominent, explicitly tinted green, and appears only when `canReview` is true. Plain form and handoff actions retain native tint and interaction. No hover or custom focus treatment is defined.

### Camera evidence chain

Camera observations pair a blue SF Symbol, a medium-weight zone label and a secondary monospaced-digit time. The first-baseline row alignment and scaled symbol column keep the chain legible across text sizes. Decorative symbols are hidden from VoiceOver, and the trace combines its child accessibility content. Source attribution appears directly beneath the incident explanation.

### Safety status

A title-sized lock symbol accompanies a headline and subheadline reason. The locked and ready variants use explicit text; readiness turns the symbol green. Simulated vehicle evidence adds an orange caption. This is an informational group, not a tappable card.

### Navigation and grouped surfaces

Drive, Incidents and Demo & Ring are top-level sections in the native tab bar. Incident history uses navigation links and sectioned list rows. Evidence detail keeps explanations, transitions and camera sources in native sections. Alerts use the system alert. The preview sheet and review cover include a native Done action; they retain the platform dismissal model.

### Inputs and demonstration controls

The native form contains switches, secure fields, a URL field and device-zone pickers. Credentials use `SecureField`, and URL/token fields disable unwanted capitalization or correction where the source specifies it. Loading connections disable their action. Keep fault controls in Demo & Ring and the simulation identifiers visible on the driving surface.

### Live Activity and widget

The Live Activity uses a symbol, headline, detail and optional synthetic-event caption; text line limits adapt to the activity family. The larger family includes a lock/readiness indicator, and Dynamic Island regions use compact system symbols. Its URL opens the explanation route; it is not an interactive CarPlay control. The small widget uses a native background and a short hear-first instruction, linking home. Full CarPlay interaction requires Apple approval; the native in-app preview remains explicitly simulated.

### Guarded video review

The full-screen review uses `AVPlayerViewController`, with picture-in-picture disabled. Footage appears only while the parked-review gate permits it, accompanied by parked confirmation and synthetic or official-runtime attribution. A locked unavailable view covers the disallowed state.

## Do's and Don'ts

### Do:

- **Do** use the blue action tint, orange urgency and simulation cues, and green parked readiness with explicit labels.
- **Do** keep black foregrounds on the implemented blue and green prominent buttons.
- **Do** use system text styles and preserve the camera column’s subheadline-relative scaling.
- **Do** retain native tabs, navigation stacks, grouped lists, forms and dismiss controls.
- **Do** keep the video-lock state visible and expose review only after the model permits it.
- **Do** label synthetic events, simulated vehicle evidence and the interactive CarPlay preview.

### Don't:

- **Don’t** invent custom fonts, fixed text sizes, color hex values or corner radii for platform-owned styling.
- **Don’t** replace the native interface with web-shaped controls or hover-dependent interactions.
- **Don’t** turn supporting screens dark globally; their appearance follows the system.
- **Don’t** show incident footage before the parked-review gate is satisfied.
- **Don’t** present simulated CarPlay interaction as an entitled full CarPlay app or a camera correlation as verified identity.
