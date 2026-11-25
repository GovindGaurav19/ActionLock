---
name: Zero-Trust Infrastructure Console
colors:
  surface: '#FFFFFF'
  surface-dim: '#cfdaf1'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e7eeff'
  surface-container-high: '#dee9ff'
  surface-container-highest: '#d8e3fa'
  on-surface: '#111c2c'
  on-surface-variant: '#44474d'
  inverse-surface: '#263142'
  inverse-on-surface: '#ebf1ff'
  outline: '#74777e'
  outline-variant: '#c4c6ce'
  surface-tint: '#4c5f7c'
  primary: '#01162f'
  on-primary: '#ffffff'
  primary-container: '#172b45'
  on-primary-container: '#7f93b2'
  inverse-primary: '#b4c8e9'
  secondary: '#00696d'
  on-secondary: '#ffffff'
  secondary-container: '#9af1f5'
  on-secondary-container: '#007074'
  tertiary: '#001826'
  on-tertiary: '#ffffff'
  tertiary-container: '#002d45'
  on-tertiary-container: '#6f96b4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d4e3ff'
  primary-fixed-dim: '#b4c8e9'
  on-primary-fixed: '#061c35'
  on-primary-fixed-variant: '#354863'
  secondary-fixed: '#9af1f5'
  secondary-fixed-dim: '#7ed4d8'
  on-secondary-fixed: '#002021'
  on-secondary-fixed-variant: '#004f52'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#a4cbeb'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#214a65'
  background: '#f9f9ff'
  on-background: '#111c2c'
  surface-variant: '#d8e3fa'
  sidebar-bg: '#14243A'
  canvas-bg: '#F5F7FA'
  text-secondary: '#64748B'
  border-subtle: '#E2E8F0'
  status-success: '#237A57'
  status-warning: '#A56B18'
  status-error: '#B54747'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  mono-badge:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system establishes a high-assurance, precision-engineered interface tailored for mission-critical authorization gateways and enterprise security operations. The visual atmosphere is disciplined, calm, and unapologetically utilitarian—prioritizing situational awareness, low cognitive fatigue, and rapid scannability over decorative flourish.

Drawing from modern high-density technical interfaces (Linear, HashiCorp Nomad/Vault, Cloudflare Zero Trust), the style adheres to a **Structured Corporate Minimalist** aesthetic:
- **Strict Hierarchy:** Data integrity and security state dominate canvas real estate. High-contrast typography paired with muted container tiers ensures immediate anomaly recognition.
- **Controlled Density:** Compact vertical cadences, tabular alignments, and low-contrast perimeter dividers maximize information throughput for engineers auditing high-velocity policy evaluations and cryptographic proofs.
- **Architectural Permanence:** Monolithic dark navy left navigation (`#14243A`) grounds the application space, transitioning into a clean, surgical `#F5F7FA` light-theme operational canvas that keeps ambient ocular strain low during extended monitoring sessions.

## Colors

The color palette avoids decorative gradients and saturated primaries, relying on architectural deep navy neutrals alongside an assertive, clinical teal accent.

### Functional Roles
- **Primary Navy (`#172B45`):** Structural anchor used for primary brand identifiers, high-priority table headers, active navigation pills, and critical state emphasis.
- **Navigation Chrome (`#14243A`):** Dedicated sidebar background establishing an immovable operational boundary on the left axis.
- **Canvas Base (`#F5F7FA`):** Low-glare cool neutral serving as the workspace background, ensuring high contrast against pure white data modules without sterile harshness.
- **Primary Action Teal (`#167C80`):** Reserved exclusively for constructive interactive triggers: authorizing transactions, publishing policy revisions, confirming cryptographic bypasses, and primary filter toggles.
- **Secondary Slate (`#3D6480`):** Secondary controls, metadata tags, and tertiary operational switches.
- **Status Semantics:** Strictly desaturated enterprise tones calibrated to pass WCAG AA against white and tinted container fills:
  - **Success / Passed (`#237A57`):** Authorized payloads, active proxy listeners, valid TLS handshakes.
  - **Warning / Pending (`#A56B18`):** Step-up pending, voice stage hold, non-blocking policy advisories.
  - **Error / Blocked (`#B54747`):** Execution rejections, perimeter locks, signature mismatches.

## Typography

Typography prioritizes high-speed information parsing and numerical legibility.

- **Proportional Type (`Inter`):** Drives interface structure, table headers, labels, and analytical metrics. Tabular figures (`tnum`) must be forced on all numerical counts, latencies, and transaction values to avoid horizontal layout jitter during streaming data updates.
- **Monospaced Engine (`JetBrains Mono`):** Dedicated to technical artifacts: SHA-256 digests, payload envelopes, policy JSON keys, session nonces, IP addresses, and high-visibility status tokens.
- **Line Heights:** Tightly constrained between 1.25x and 1.45x to maintain compact table cell density without text clipping.

## Layout & Spacing

The operational interface uses an asymmetric dual-pane layout: a persistent left vertical navigation bar fixed at 240px width (collapsible to 64px on smaller viewports) alongside an adaptable main data viewport.

### Grid Rhythm & Adapters
- **Desktop (>= 1280px):** 12-column dynamic grid within the canvas zone. Standard 16px (`1rem`) gutters and 24px (`1.5rem`) canvas inset padding. Multi-pane inspectors use a split 7:5 ratio for live log lists versus JSON envelope details.
- **Tablet (768px - 1279px):** Collapsed iconography sidebar (64px). Grid shifts to 8 columns with 16px margins. Complex policy trees fold into vertically stacked panels.
- **Mobile (< 768px):** Sidebar converts to an off-canvas drawer. 4-column layout with 12px horizontal margins. Non-essential table attributes collapse into expandable accordion rows.
- **Vertical Spacing:** Micro increments (4px, 8px, 12px) govern internal component relationships. Larger tokens (16px, 24px) are strictly boundary and layout delimiters.

## Elevation & Depth

This system intentionally eliminates atmospheric blur, multi-layered ambient spread, and saturated drop shadows in favor of structural planar definition.

- **Planar Tiering:** Hierarchy is communicated by physical surface stacking:
  - **Tier 0 (Root Base):** `#14243A` (Left navigation rail).
  - **Tier 1 (Canvas Workstation):** `#F5F7FA` (Main scrolling environment).
  - **Tier 2 (Surface Elements):** `#FFFFFF` (Data tables, configuration cards, form panels).
- **Outlines over Shadows:** All containers, cards, and modal components rely on a razor-sharp 1px border (`#E2E8F0`).
- **Interactive Elevations:** Shadows are applied conservatively:
  - **Static Cards & Tables:** No shadow; defined solely by the 1px perimeter line.
  - **Dropdown Menus & Popovers:** `0 4px 12px rgba(20, 36, 58, 0.08)`, bounded by a 1px `#E2E8F0` stroke.
  - **Modal Dialogs & Command Bars:** `0 12px 32px rgba(20, 36, 58, 0.16)`, backed by a 40% `#14243A` backdrop wash.

## Shapes

The geometry reflects tight mechanical restraint:
- **Baseline Components (Buttons, Inputs, Badges):** 6px border radius (`0.375rem`), standardizing an architectural, non-circular perimeter.
- **Structural Modules (Cards, Modals, Logs Windows):** 8px border radius (`0.5rem`) paired with 1px structural framing.
- **Status Pills & Inline Identifiers:** Subtle 4px radius (`0.25rem`) rather than pill curves (`9999px`) to maintain alignment with monospaced data grids and tabular structures.

## Components

### Buttons
- **Primary:** Solid `#167C80` teal fill, `#FFFFFF` Inter 13px medium text, 6px radius. Focus: 2px offset ring in `#167C80`. Hover: `#126467`.
- **Secondary:** Solid `#FFFFFF` fill, 1px `#E2E8F0` border, `#202B3C` text. Hover: `#F5F7FA` fill, `#CBD5E1` border.
- **Destructive:** Solid `#FFFFFF` fill, 1px `#B54747` border, `#B54747` text. Hover: `#B54747` fill with white text.
- **Icon Actions:** 28x28px or 32x32px square buttons, borderless, `#64748B` icon fill transitioning to `#202B3C` on hover with a subtle `#F1F5F9` background block.

### Badges & Security Status Indicators
Constructed strictly using `JetBrains Mono` 11px uppercase with 0.04em tracking, 4px radius, 2px vertical / 6px horizontal padding:
- **AUTHORIZED:** Background `#ECFDF5`, text `#237A57`, border `1px solid rgba(35, 122, 87, 0.25)`.
- **HOLD / STEP_UP_PENDING:** Background `#FFFBEB`, text `#A56B18`, border `1px solid rgba(165, 107, 24, 0.25)`.
- **REJECTED / BLOCKED:** Background `#FEF2F2`, text `#B54747`, border `1px solid rgba(181, 71, 71, 0.25)`.
- **VOICE_STAGE_PASSED:** Background `#F0FDFA`, text `#167C80`, border `1px solid rgba(22, 124, 128, 0.25)`.

### Form Fields & Inputs
- **Text Inputs:** Height 36px, background `#FFFFFF`, border 1px `#E2E8F0`, 6px radius. Typography: Inter 13px regular. Focus state: border color switches to `#167C80` with a 1px solid ring.
- **Monospace Code Inputs:** Dedicated for signature inputs and security keys. Background `#F8FAFC`, font family `JetBrains Mono` 12px.

### Data Tables & Log Inspectors
- **Header:** Height 32px, background `#F8FAFC`, 1px solid `#E2E8F0` bottom border, Inter 11px uppercase semi-bold text (`#64748B`).
- **Rows:** Height 40px (compact) or 48px (standard), background `#FFFFFF`, alternating hover state to `#F8FAFC`. All borders 1px `#E2E8F0`. SHA hashes, IP addresses, and timestamps render in `JetBrains Mono` 12px.

### Cards & Panels
- Pure white `#FFFFFF` surface enclosed by a continuous 1px `#E2E8F0` boundary, zero ambient shadow. Card headers feature an explicit 1px divider separating title metadata from body metrics.