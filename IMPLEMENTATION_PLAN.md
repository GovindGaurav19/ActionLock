# ACTIONLOCK — Staged Backend & Integration Implementation Plan

This plan strictly preserves the existing Stitch-derived React/Tailwind frontend design and connects it incrementally across Phases 1–10. One phase is executed per explicit continuation command (`CONTINUE PHASE <N>`).

---

## Phase Sequence

### Phase 1 — Backend Foundation, Database & Authentication
- **Objective:** Establish modular backend architecture, persistent relational storage, server config, error handling, logging, multi-user demo authentication, HTTP-only sessions, and RBAC.
- **Database Decision:** Use Node's built-in `node:sqlite` (`SQLite`) locally (since PostgreSQL is not installed in this environment) with a schema aligned 1:1 to the C4 PostgreSQL model (`organisations`, `users`, `role_assignments`, `speaker_profiles`, `voice_consents`, `action_requests`, `action_envelopes`, `action_versions`, `voice_challenges`, `voice_verifications`, `model_operations`, `webhook_events`, `approval_policies`, `approvals`, `passkey_credentials`, `authorization_tokens`, `integrations`, `audit_events`, `security_incidents`, `break_glass_events`). Document PostgreSQL target migration path.
- **Auth & RBAC:** Implement `scrypt` password hashing, HTTP-only session cookies, and distinct seeded demo identities (`alex.chen`, `sarah.jenkins`, `marcus.vance`, `elena.rostova`, `dan.sullivan`) with explicit `DEMO ACCOUNT` labels and role permissions (`REQUESTER`, `APPROVER`, `SECOPS_ADMIN`, `AUDITOR`).

### Phase 2 — Action Envelope, Hashing & Authorization Core
- **Objective:** Implement canonical JCS-style Action Envelope serialization, SHA-256 hashing, versioning, and the centralized state-transition engine.
- **Scope:** GitHub deployment & simulated financial approval payloads; recompute hash before every critical transition; invalidate prior verifications/approvals and create a new version when material fields change; enforce single authoritative state machine.

### Phase 3 — Voice Registry, DetectifAI Enrollment & Consent
- **Objective:** Wire real `POST /v1/speakers/enroll`, speaker listing, and profile deletion with explicit informed consent capture.
- **Scope:** Multipart audio upload validation (duration/MIME/size), stable `speaker_id` mapping to authenticated user, consent version + timestamp persistence, and remediating `VoiceRegistryPage.tsx` privacy copy to accurately distinguish local temp cleanup from DetectifAI's 30-day retention policy.

### Phase 4 — Voice Challenge, Speech-to-Text & Dual AI Verification
- **Objective:** Implement single-recording challenge verification: cryptographic nonce + Google Cloud Speech-to-Text V2 phrase validation + combined DetectifAI `POST /v1/speakers/verify` (`detect_deepfake=true`) + `GET /v1/operations/{operation_id}` recovery.
- **Scope:** Parse separate Eidos (`match`/`no_match`, `-1..1` similarity) and Aletheia (`real`/`fake`, score, segments) results; handle partial results (`deepfake.error`), insufficient audio, rate limits (`Retry-After`), and idempotent retries.

### Phase 5 — DetectifAI Webhooks & Operation Recovery
- **Objective:** Harden `POST /api/webhooks/detectifai` with durable DB persistence, `webhook-id` deduplication, async background job reconciliation by `operation_id`, out-of-order monotonic state handling, and `<10s` fast 2xx acknowledgment.
- **Scope:** Support `speaker.enrolled`, `speaker.verified`, `deepfake.completed`, and `webhook.test`.

### Phase 6 — Policy Engine, Passkey, Peer Approval & Scoped Token
- **Objective:** Implement deterministic TypeScript policy engine, structured policy CRUD, `@simplewebauthn/server` + `@simplewebauthn/browser` registration/authentication, independent peer approval with SoD enforcement, and atomic single-use scoped authorization tokens.
- **Scope:** Remove unverified YubiKey FIPS claims from UI unless verified; never trust client-side `verified: true`; recompute action hash before token issuance and consumption.

### Phase 7 — GitHub App Deployment Protection
- **Objective:** Implement GitHub App webhook (`POST /api/webhooks/github` with `X-Hub-Signature-256` raw-body verification), GitHub App JWT + installation access token exchange, Action Envelope correlation, and `POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule` (`approved` / `rejected`).
- **Scope:** Author `GITHUB_INTEGRATION_SETUP.md` documenting public-preview constraints (public repos vs GitHub Enterprise for private/internal repos).

### Phase 8 — Financial Simulation & Full Frontend Connectivity
- **Objective:** Connect all remaining dashboard KPIs, inbox, finance simulation, integrations, and policies to persisted backend data; enforce `"SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED."`; isolate QA test simulator controls into an explicitly labelled test harness that never injects fake results into the live DetectifAI pipeline.

### Phase 9 — Audit, Security Incidents & Break-Glass Interfaces
- **Objective:** Persist append-only hash-chained audit events across all lifecycle transitions, wire real HOLD/spoof/drift security incidents, and convert Break-Glass Recovery into an honest manual runbook + logged justification/custodian/expiry workflow (removing fabricated WORM, fake Merkle proof, and fake smartcard/Iridium hardware claims).

### Phase 10 — Full Adversarial Testing & Final Documentation
- **Objective:** Execute all 24 adversarial acceptance scenarios (tests 1–24 from Section 17), live verification where credentials exist, plus final `README.md`, API documentation, environment setup guide, and final testing report.
