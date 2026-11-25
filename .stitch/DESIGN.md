# ACTIONLOCK Design System (`Zero-Trust Infrastructure Console`)

Extracted directly from Stitch Project `2116532167851802089` (`ActionLock Enterprise Authorization Platform`) — `metadata.json`, `design-system-raw.json`, and all 11 Stitch HTML screen sources.

---

## 1. Color System

### Core Surfaces & Chrome
| Token | Hex / Value | Role |
|---|---|---|
| `--color-sidebar-bg` | `#14243A` | Left navigation rail background (Tier 0) |
| `--color-sidebar-border` | `#1E385B` | Sidebar dividers and internal chrome borders |
| `--color-sidebar-well` | `#0D1826` | Demo badge well & user footer well inside sidebar |
| `--color-sidebar-hover` | `#1B2F4A` | Sidebar link hover surface |
| `--color-canvas-bg` | `#F5F7FA` | Main operational workstation canvas (Tier 1) |
| `--color-surface` | `#FFFFFF` | Cards, tables, header, and panels (Tier 2) |
| `--color-surface-bright` | `#F9F9FF` | Bright subtle surface |
| `--color-surface-container-lowest` | `#FFFFFF` | Elevated white container |
| `--color-surface-container-low` | `#F0F3FF` | Subtle tinted banner / header control fill |
| `--color-surface-container` | `#E7EEFF` | Container tint |
| `--color-surface-container-high` | `#DEE9FF` | Higher emphasis tint |
| `--color-surface-container-highest` | `#D8E3FA` | Surface variant |
| `--color-surface-dim` | `#CFDAF1` | Dim surface |
| `--color-surface-tint` | `#4C5F7C` | Surface tint |

### Brand & Interactive Accents
| Token | Hex / Value | Role |
|---|---|---|
| `--color-primary` | `#01162F` | Deepest structural ink |
| `--color-on-primary` | `#FFFFFF` | Text on primary |
| `--color-primary-container` | `#172B45` | Active nav pill, primary dark headers, inspector headers |
| `--color-on-primary-container` | `#7F93B2` | Muted text on primary container |
| `--color-primary-fixed` | `#D4E3FF` | Light blue pill text on dark containers |
| `--color-primary-fixed-dim` | `#B4C8E9` | Secondary dark-surface highlight |
| `--color-secondary` | `#00696D` / `#167C80` | Primary Action Teal (`#00696D` in Tailwind config, `#167C80` override) |
| `--color-secondary-hover` | `#005A5E` / `#126467` | Primary button hover |
| `--color-secondary-container` | `#9AF1F5` | Bright teal badge background (e.g. Owner tag) |
| `--color-on-secondary-container` | `#007074` | Text inside secondary container |
| `--color-tertiary` | `#001826` | Tertiary ink |
| `--color-tertiary-container` | `#002D45` | Deep slate-teal container |
| `--color-on-tertiary-container` | `#6F96B4` | Muted slate text |
| `--color-on-tertiary-fixed-variant` | `#214A65` | Badge/pill ink |

### Text & Borders
| Token | Hex / Value | Role |
|---|---|---|
| `--color-on-surface` | `#111C2C` | Primary body & heading text |
| `--color-on-surface-variant` | `#44474D` | Secondary dark text |
| `--color-text-secondary` | `#64748B` | Muted labels, timestamps, subtitles |
| `--color-neutral` | `#202B3C` | Secondary button ink |
| `--color-border-subtle` | `#E2E8F0` | 1px card, table, input, and divider borders |
| `--color-outline` | `#74777E` | Strong outline |
| `--color-outline-variant` | `#C4C6CE` | Sidebar inactive link text & muted dividers |
| `--color-inverse-surface` | `#263142` | Dark surface |
| `--color-inverse-on-surface` | `#EBF1FF` | Text on dark surface |

### Semantic Status Tokens
| State | Text / Accent | Background | Border |
|---|---|---|---|
| **Success / AUTHORIZED** | `#237A57` | `#ECFDF5` | `1px solid rgba(35, 122, 87, 0.25)` |
| **Warning / HOLD / STEP_UP_PENDING** | `#A56B18` | `#FFFBEB` | `1px solid rgba(165, 107, 24, 0.25)` |
| **Error / REJECTED / BLOCKED** | `#B54747` / `#BA1A1A` | `#FEF2F2` / `#FFDAD6` | `1px solid rgba(181, 71, 71, 0.25)` |
| **Teal / VOICE_STAGE_PASSED** | `#167C80` / `#00696D` | `#F0FDFA` | `1px solid rgba(22, 124, 128, 0.25)` |

---

## 2. Typography

- **Proportional UI Font:** `Inter` (`400`, `500`, `600`, `700`) with `font-variant-numeric: tabular-nums` on metrics and tables.
- **Monospace Technical Font:** `JetBrains Mono` (`400`, `500`, `600`) for SHA-256 digests, envelope IDs, JTI tokens, policy IDs, JSON payloads, and status badges.
- **Icon Font:** `Material Symbols Outlined` (`opsz 20..48`, `wght 100..700`, `FILL 0..1`).

| Scale Token | Family | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|---|
| `headline-xl` | Inter | `30px` | `600` | `38px` | `-0.02em` |
| `headline-lg` | Inter | `24px` | `600` | `32px` | `-0.015em` |
| `headline-md` | Inter | `20px` | `600` | `28px` | `-0.01em` |
| `headline-sm` | Inter | `16px` | `600` | `24px` | `0em` |
| `body-lg` | Inter | `15px` | `400` | `22px` | `-0.005em` |
| `body-md` | Inter | `14px` | `400` | `20px` | `0em` |
| `body-sm` | Inter | `12px` | `400` | `16px` | `0em` |
| `label-md` | Inter | `13px` | `500` | `18px` | `0.01em` |
| `label-sm` | Inter | `11px` | `500` | `14px` | `0.02em` |
| `mono-data` | JetBrains Mono | `12px` | `400` | `16px` | `0em` |
| `mono-badge` | JetBrains Mono | `11px` | `600` | `14px` | `0.04em` |

---

## 3. Layout, Spacing & Shapes

- **Shell:** Fixed left sidebar (`w-64` / `256px` in HTML, collapsible to `64px` on tablet, off-canvas drawer on mobile `< 768px`) + fixed top header (`h-16` / `64px`) + full-width `bg-canvas-bg` main area with `pt-16`.
- **Top Demo Banner:** Full-bleed strip `bg-surface-container-low` (`#F0F3FF`) with `C4 COMPLIANT` badge, `DEMO ENVIRONMENT · Realistic security fixtures active`, `SESSION NONCE`, and `View C4 Spec` link.
- **Spacing Tokens:**
  - `space-xs`: `0.25rem` (`4px`)
  - `space-sm`: `0.5rem` (`8px`)
  - `space-md`: `0.75rem` (`12px`)
  - `space-lg`: `1rem` (`16px`)
  - `space-xl`: `1.5rem` (`24px`)
  - `gutter`: `1rem` (`16px`)
  - `margin`: `1.5rem` (`24px`)
- **Border Radii:**
  - `DEFAULT`: `0.25rem` (`4px` — badges, pills, buttons in Stitch Tailwind config)
  - `lg`: `0.5rem` (`8px` — cards, modals, panels)
  - `xl`: `0.75rem` (`12px`)
  - `full`: `9999px` (status dots, avatars)

---

## 4. Component Patterns

- **Sidebar Navigation:** Dark `#14243A` rail with brand header (`ACTIONLOCK` + `ENTERPRISE` badge), `DEMO ENV · FIXTURES` indicator pill, nav links (`px-3 py-2 rounded`), active item uses `bg-primary-container text-white border-l-2 border-secondary font-medium`, and bottom user profile card (`Marcus Vance` / `OWNER` / `Principal SecOps`).
- **Top Bar:** Breadcrumb (`Gateway / Acme Global Infrastructure (US-East)`), global search (`⌘K`), status pills (`API GATEWAY: OPERATIONAL`, `DETECTIFAI: HEALTHY`), documentation & alert icon buttons, `BREAK-GLASS` quick button, and user avatar.
- **Cards & Tables:** Pure `#FFFFFF` surface with `1px solid #E2E8F0` border (`border border-border-subtle` or `shadow-sm`). Table headers use `#F8FAFC` / `bg-surface-container-low` with `label-sm` uppercase `#64748B` labels.
- **Buttons:**
  - Primary: `bg-secondary hover:bg-[#005A5E] text-white` (`#00696D` / `#167C80`).
  - Secondary: `bg-surface border border-border-subtle text-on-surface hover:bg-surface-container-low`.
  - Destructive: `bg-[#FEF2F2] border border-[rgba(181,71,71,0.25)] text-status-error hover:bg-error hover:text-white`.
- **Evidence vs Authority Banner:** Every AI verification panel explicitly states: `"AI verification provides additional security evidence. It does not independently prove identity, authority or intent."` and displays Aletheia and Eidos metrics separately without averaging them or showing Eidos similarity as a percentage.
