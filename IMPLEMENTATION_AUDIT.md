# ACTIONLOCK — Phase 0 Complete Repository Audit

**Audit Date:** 2026-11-25  
**Workspace:** `/Users/govindgaurav/agnitest`  
**Audit Scope:** Full read-only inspection of frontend, backend prototype, dependencies, environment config, tests, and alignment against the three project PDFs (`CMRIT_DetectifAI_Hackathon_Guide(1).pdf`, `ActionLock_Research_Based_Idea(1).pdf`, `ACTIONLOCK — Enterprise System Design & User Workflow(1).pdf`) and Stitch project `2116532167851802089`.

---

## 1. Existing Architecture & Tech Stack

- **Package Manager & Runtime:** `npm` (`11.19.1`), `node` (`v26.9.0`), `package-lock.json` present.
- **Git Status:** Not an initialized Git repository (`git status` cannot read repo state; no `.git/` directory present).
- **Frontend Stack:**
  - `react` `^19.0.0`, `react-dom` `^19.0.0`, `react-router-dom` `^7.5.0`
  - `typescript` `^5.8.2`, `vite` `^6.2.2`, `@vitejs/plugin-react` `^4.3.4`
  - `tailwindcss` `^3.4.17`, `postcss` `^8.5.3`, `autoprefixer` `^10.4.21`
  - Styling tokens extracted from Stitch in `src/styles/tokens.css`, `src/styles/globals.css`, `tailwind.config.ts`.
- **Backend Stack (Minimal Prototype Only):**
  - Raw Node.js `http` server in `server/index.mjs` (port `8787`, proxied via Vite `/api` -> `http://127.0.0.1:8787`).
  - Helper modules: `server/detectifai.mjs` (REST `fetch` wrapper for DetectifAI) and `server/crypto.mjs` (canonical JSON SHA-256 + Standard Webhooks HMAC-SHA256 verification).
  - Unit test file: `server/__tests__/security.test.mjs` (`2` passing unit tests via `node --test`).
- **Database Status:**
  - **No database or migrations exist.** `server/index.mjs` stores `actions`, `webhooks`, `auditEvents`, and `seenWebhookIds` only in ephemeral JavaScript `Map` / `Set` / arrays.
  - Local environment check: `psql` / `pg_isready` are **not installed**; `/usr/bin/sqlite3` and Node `v26.9.0` built-in `node:sqlite` **are available**.
- **Environment Files:**
  - `.env.example` exists with placeholders (`PORT`, `DETECTIF_API_KEY`, `DETECTIF_API_BASE_URL`, `DETECTIF_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`).
  - No `.env` file exists on disk. No `VITE_` secret keys exist in source code.

---

## 2. Feature Audit Classification Table

Legend:
- **A:** Genuinely implemented and working.
- **B:** Frontend implemented, using static/mock fixtures or browser-only simulated state.
- **C:** Partially implemented (e.g., partial backend prototype or client-only API without persistence/verification).
- **D:** Not implemented.
- **E:** Cannot be verified from available source code (e.g., requires external live credentials).

| Visible Feature / Capability | Class | Relevant File Paths | Audit Findings |
|---|---|---|---|
| **Navigation Shell & Routing (13 items)** | **A** | `src/components/layout/AppShell.tsx`, `src/app/router.tsx` | All 11 Stitch desktop screens + `New Protected Action` modal + `View C4 Spec` modal are wired with React Router; responsive desktop/tablet/mobile layout verified. |
| **Overview Dashboard** | **B** | `src/features/dashboard/OverviewDashboardPage.tsx`, `src/data/mock/fixtures.ts` | UI faithful to Stitch, but telemetry KPIs (`14`, `1.4s`, `48`, `99.98%`) are hardcoded and table reads in-memory `DEMO_ENVELOPES` fixtures. |
| **Action Inbox & Envelope Inspector** | **B** | `src/features/action-inbox/ActionInboxPage.tsx`, `src/app/providers/ActionLockContext.tsx` | Search, category/risk/status filters, and inspector work against React state seeded from `DEMO_ENVELOPES`; not backed by persisted DB queries. |
| **New Protected Action (Envelope Creation)** | **C** | `src/components/layout/AppShell.tsx`, `src/utils/canonicalHash.ts`, `server/index.mjs` | Computes real SHA-256 canonical hash in browser/server, and `POST /api/actions` exists in `server/index.mjs`, but server stores in memory only with no DB, auth, or strict schema validation. |
| **Approvals & Step-Up (Microphone Recording)** | **C** | `src/features/approvals/ApprovalsStepUpPage.tsx` | Uses real browser `navigator.mediaDevices.getUserMedia` + `MediaRecorder` + playback when supported, with fallback notice; however, submission in Demo Mode simulates verdicts locally and Live Mode lacks server STT and DB persistence. |
| **Dynamic Challenge & Nonce Service** | **C** | `src/app/providers/ActionLockContext.tsx`, `server/index.mjs` | Generates random nonce client-side and has basic `POST /api/actions/:id/challenge`, but challenges are not persisted, bound to DB transactions, or atomically invalidated/expired server-side. |
| **Speech-to-Text (STT) Phrase Validation** | **D** | `src/features/approvals/ApprovalsStepUpPage.tsx`, `server/index.mjs` | **Not implemented.** `sttValidated` is mocked in Demo Mode; no Google Cloud Speech-to-Text V2 integration or server-side phrase comparison exists. |
| **DetectifAI Dual Verification (`Eidos` + `Aletheia`)** | **C** | `server/detectifai.mjs`, `server/index.mjs` | Server calls `POST /v1/speakers/verify` with `detect_deepfake=true` and `Idempotency-Key` when `DETECTIF_API_KEY` is set, and fails closed without it; however, response fields (`result.decision`, `result.similarity`, `deepfake.verdict`, `operation_id`) are not parsed/normalized, persisted, or recovered via `GET /v1/operations/{id}`. |
| **Voice Registry (Enrollment, Consent, Deletion)** | **B** | `src/features/voice-registry/VoiceRegistryPage.tsx`, `server/detectifai.mjs` | Frontend displays `DEMO_SPEAKERS` fixtures and client-side enrollment/revocation; `enrollSpeakerWithDetectifAi` exists in `server/detectifai.mjs` but has **no** HTTP route, **no** consent persistence, and **no** speaker list/delete API wiring. |
| **DetectifAI Webhooks (`POST /api/webhooks/detectifai`)** | **C** | `server/index.mjs`, `server/crypto.mjs` | Raw-body HMAC-SHA256 verification and `webhook-id` in-memory deduplication exist and pass unit tests; missing durable persistence, async queue processing, `speaker.enrolled`/`speaker.verified`/`deepfake.completed` correlation by `operation_id`, and frontend live sync. |
| **Deterministic Policy Engine & SoD** | **C** | `src/app/providers/ActionLockContext.tsx`, `src/features/policies/SecurityPoliciesPage.tsx` | Client enforces 7-condition gate in `authorizeEnvelope`, but server `POST /api/actions/:id/approve` is a stub returning `403`, and `SecurityPoliciesPage` uses static `DEMO_POLICIES` without backend persistence or RBAC. |
| **Authentication, Sessions & RBAC** | **D** | — | **Not implemented.** `Marcus Vance (Owner)` is hardcoded in `AppShell.tsx`. No login, password hashing, HTTP-only session cookies, user switching, or server-side RBAC/SoD exists. |
| **WebAuthn / FIDO2 Passkeys** | **D** | `src/features/approvals/WebAuthnPermitPage.tsx`, `server/index.mjs` | `@simplewebauthn/server` and `@simplewebauthn/browser` are not installed. `server/index.mjs` has placeholder `passkey/options` and rejects `passkey/verify`; Demo Mode simulates hardware touch in React state. |
| **Scoped One-Time Permit Issuance & Consumption** | **B** | `src/features/approvals/WebAuthnPermitPage.tsx`, `src/data/mock/fixtures.ts` | Displays static/demo RFC 7519 JWT claim preview and `jtiConsumed` boolean in React state; no server-side signed token issuer or atomic consumption endpoint exists. |
| **GitHub App Custom Deployment Protection** | **D** | `src/features/integrations/IntegrationsWebhookPage.tsx`, `server/index.mjs` | **Not implemented.** No GitHub App webhook (`X-Hub-Signature-256`), App JWT/installation token exchange, or `POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule` callback exists. |
| **Finance Beneficiary Change Simulation** | **B** | `src/features/finance-sandbox/FinanceBeneficiaryPage.tsx`, `src/app/providers/ActionLockContext.tsx` | Interactive SHA-256 hash drift detection works in browser state (`mutateFinancePayload` / `revertFinanceToOriginal`), but uses client fixtures and lacks backend persistence, payment creation API, and server-side hash recheck. |
| **Integrations & Webhook Monitor** | **B** | `src/features/integrations/IntegrationsWebhookPage.tsx`, `server/index.mjs` | `GET /api/health` and `GET /api/integrations` exist on backend; webhook list & inspector show `DEMO_WEBHOOKS` fixtures rather than persisted server events. |
| **Audit Trail** | **B** | `src/features/audit/AuditTrailPage.tsx`, `src/app/providers/ActionLockContext.tsx` | Appends client-side hash-chained records in React memory (`DEMO_AUDIT_EVENTS`); server `GET /api/audit-events` returns an empty unpersisted array. |
| **Security Incidents** | **B** | `src/features/incidents/SecurityIncidentsPage.tsx`, `src/data/mock/fixtures.ts` | Renders `DEMO_INCIDENTS` fixtures; not connected to backend HOLD/spoof/drift/auth-failure events. |
| **Break-Glass Recovery Console** | **B** | `src/features/break-glass/BreakGlassPage.tsx` | Purely simulated UI (`Shard 2` PIN, Iridium LEO, WORM optical drive, local TPM bus logs); no backend break-glass event/justification persistence. |
| **Live External Provider Verification** | **E** | `.env.example`, `server/detectifai.mjs` | Cannot be verified until `DETECTIF_API_KEY`, `DETECTIF_WEBHOOK_SECRET`, `GOOGLE_APPLICATION_CREDENTIALS`, and `GITHUB_APP_*` credentials are provided. |

---

## 3. Security Gaps & Conflicts With Reference Architecture

1. **Privacy & Retention Overclaim (`VoiceRegistryPage.tsx`):**
   - Current UI displays `"STRICT ZERO RAW AUDIO POLICY"` and `"Zero Raw Audio Certified: Original acoustic recording was permanently destroyed..."`.
   - **Conflict with Phase 3 & DetectifAI Docs:** DetectifAI retains uploaded audio for 30 days and keeps enrolled speaker profiles encrypted until deletion. UI copy must distinguish temporary application-side file cleanup from DetectifAI's retention policy.
2. **Unverified Hardware & WORM/Merkle Claims (`WebAuthnPermitPage.tsx`, `AuditTrailPage.tsx`, `BreakGlassPage.tsx`):**
   - Current UI displays `"Yubico YubiKey 5C NFC · FIPS 140-2 L3"`, `"WORM LEDGER · MERKLE ROOT INTACT"`, `"Verify Merkle Proof"`, `"YubiKey 5 FIPS"`, `"Physical SmartCard"`, and `"Iridium LEO Sync"`.
   - **Conflict with Phase 6 & Phase 9:** Must not fabricate YubiKey FIPS attestation, smartcard verification, WORM storage guarantees, or fake Merkle proofs. Audit trail should present tamper-evident hash-chained records honestly without false WORM/Merkle guarantees.
3. **Hardcoded Demo Metrics (`OverviewDashboardPage.tsx`, `ActionInboxPage.tsx`):**
   - Cards show hardcoded static numbers (`14`, `1.4s`, `48`, `99.1%`, `142`). Phase 8 requires computing metrics from real persisted backend records (or showing explicit empty/unavailable states).
4. **Test Simulator vs Real DetectifAI Separation (`ApprovalsStepUpPage.tsx`):**
   - `QA SCENARIO SIMULATOR` buttons (`Genuine Pass`, `Synthetic Spoof`, etc.) currently share `evaluateVoiceRecording` in `ActionLockContext.tsx`. Phase 8 requires strict separation between an explicitly labelled **TEST SIMULATOR** mock harness and the real DetectifAI submission path.
5. **Missing Authentication & SoD Enforcement:**
   - Currently any browser user acts as `Marcus Vance (Owner)` with no backend session, making Separation of Duties (`requester !== approver !== peer`) unenforceable.
6. **Missing Server-Side Security Controls:**
   - No rate limiting on sensitive endpoints, no multipart upload size/MIME validation on backend, no DB transactions for atomic single-use token consumption, no Google Cloud STT V2 server check, no WebAuthn server verification (`@simplewebauthn/server`).

---

## 4. Missing Backend Modules & APIs

- **Missing Modules (`server/`):**
  - `config` (env loader/validation without crashing when optional external keys are absent)
  - `db` (SQLite persistence via `node:sqlite` + migrations, aligned to the C4 PostgreSQL relational model)
  - `auth` & `session` (scrypt/argon2 password hashing, HTTP-only signed session cookies, multi-user demo identities, RBAC middleware)
  - `envelopes` & `state-machine` (canonical JCS hash, versioned envelopes, centralized state transition service)
  - `challenges` & `stt` (cryptographic nonce issuance, expiry, Google Cloud STT V2 adapter + normalization)
  - `webhooks` worker & `operations` recovery (`GET /v1/operations/{operation_id}`, idempotent reconciliation)
  - `policy` engine (pure TypeScript deterministic policy evaluator)
  - `webauthn` service (`@simplewebauthn/server` registration/authentication + credential storage)
  - `tokens` service (HMAC/JWT scoped one-time permit issuance & atomic consumption)
  - `github` app service (`X-Hub-Signature-256`, App JWT, installation token, `deployment_protection_rule` callback)
  - `audit`, `incidents`, `break-glass`, `finance-sandbox` services
- **Missing APIs:**
  - Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/users`
  - Speakers: `GET /api/speakers`, `POST /api/speakers/enroll`, `DELETE /api/speakers/:speakerId`
  - Actions & Lifecycle: `POST /api/actions/:id/mutate` (or new version), `POST /api/actions/:id/peer-approve`, `POST /api/tokens/consume`, `POST /api/operations/:opId/recover`
  - WebAuthn: `POST /api/webauthn/register/options`, `POST /api/webauthn/register/verify`, `POST /api/actions/:id/passkey/options`, `POST /api/actions/:id/passkey/verify`
  - Policies, Incidents, Break-Glass: `GET/POST /api/policies`, `GET/PATCH /api/incidents`, `GET/POST /api/break-glass`
  - GitHub: `POST /api/webhooks/github`, `GET /api/github/deployments`

---

## 5. Dependencies Audit

- **Existing Dependencies to Reuse:** `react`, `react-dom`, `react-router-dom`, `vite`, `tailwindcss`, `typescript`, Node `v26.9.0` built-in `node:http`, `node:crypto`, `node:sqlite`, `node:test`.
- **Dependencies Genuinely Required in Future Phases:**
  - `@simplewebauthn/server` & `@simplewebauthn/browser` (Phase 6 — FIDO2/WebAuthn standard)
  - `google-auth-library` or `@google-cloud/speech` (Phase 4 — Google Cloud STT V2, or direct signed JWT via `google-auth-library` / `node:crypto` + REST)
  - `tsx` (optional dev dependency if backend is migrated from `.mjs` to `.ts`, or keep TypeScript compiled via `tsc` / Node strip-types)
  - `dotenv` (or Node `--env-file=.env` built into Node v26!)

---

## 6. Exact Starting Point Summary

The repository currently has **all 11 Stitch-faithful frontend React pages** running cleanly on Vite + Tailwind + TypeScript, backed by rich deterministic mock fixtures (`src/data/mock/fixtures.ts`), a client-side SHA-256 canonicalizer (`src/utils/canonicalHash.ts`), and a **minimal unpersisted 203-line Node HTTP prototype** (`server/index.mjs`, `server/detectifai.mjs`, `server/crypto.mjs`) with 2 unit tests. There is **no database, no authentication/RBAC, no server-side STT, no WebAuthn package integration, and no GitHub App integration**.
