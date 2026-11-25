# ACTIONLOCK — Voice-Bound Authorization for High-Consequence Enterprise Actions

ACTIONLOCK is a full-stack security authorization gateway designed around the C4 enterprise governance architecture: **canonical SHA-256 Action Envelopes**, **ephemeral Speech-to-Text nonce verification**, **dual DetectifAI AI evidence (Eidos speaker match + Aletheia anti-spoofing)**, **WebAuthn/FIDO2 passkey step-up**, **independent Peer Separation of Duties (SoD)**, and **single-use scoped JWT permit release** for GitHub Deployment Protection Rules and simulated Treasury workflows.

> **Core Security Principle:** AI verification (`VOICE_VERIFIED`) provides corroborative evidence only and **never** authorizes high-consequence actions on its own.

---

## Architecture Summary

- **Frontend:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS 3 (`src/`) + `@simplewebauthn/browser` (`v14`).
  - Supports **DEMO ENVIRONMENT** (deterministic UI fixtures + isolated Demo Test Harness) and **LIVE BACKEND MODE** (authenticated HTTP-only sessions querying real SQLite persistence and live enclave adapters).
- **Backend (`server/`):** Node.js HTTP server (`server/index.mjs`, `server/app.mjs`) with modular domain services:
  - `node:sqlite` (`server/db/database.mjs`, `server/db/migrations/001_initial.sql`, `server/db/seed.mjs`) with an explicit schema aligned to the C4 relational model.
  - Auth & RBAC (`scrypt` salted hashes, HTTP-only session cookies, `REQUESTER`, `APPROVER`, `SECOPS_ADMIN`, `AUDITOR`).
  - JCS-style canonical Action Envelopes & state machine (`server/crypto.mjs`, `server/services/envelopeService.mjs`, `server/services/stateMachine.mjs`).
  - DetectifAI enrollment, combined verification + operation recovery (`server/detectifai.mjs`, `speakerRegistryService.mjs`, `voiceVerificationService.mjs`).
  - Google Cloud Speech-to-Text V2 challenge verification (`server/services/sttService.mjs`, `challengeService.mjs`).
  - Standard Webhooks raw-body HMAC-SHA256 ingestion (`server/services/webhookService.mjs`).
  - Deterministic policy engine, `@simplewebauthn/server` FIDO2 WebAuthn verification, peer SoD approval, and atomic single-use scoped permit tokens (`policyEngineService.mjs`, `webauthnService.mjs`, `approvalAndTokenService.mjs`).
  - GitHub App custom deployment protection rule adapter (`server/services/githubAppService.mjs`).
  - Append-only SHA-256 hash-chained audit trail (`auditService.mjs`), incident management (`incidentService.mjs`), and manual Break-Glass custodian registry (`breakGlassService.mjs`).

---

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Configure environment (optional for Demo Mode; required for live external providers):**
   Copy `.env.example` to `.env` (never commit `.env` or use `VITE_*` prefixes for secrets):
   ```bash
   cp .env.example .env
   ```
   See [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) for variable details and [GITHUB_INTEGRATION_SETUP.md](./GITHUB_INTEGRATION_SETUP.md) for GitHub App rules.
3. **Run backend + frontend locally:**
   ```bash
   # Terminal 1 — Backend API (http://127.0.0.1:8787)
   npm run dev:server

   # Terminal 2 — Vite Frontend (http://localhost:5173, proxies /api -> 8787)
   npm run dev
   ```
4. **Demo Accounts (`DEMO ACCOUNT`):**
   - `alex.chen@acme.corp` (`REQUESTER`)
   - `sarah.jenkins@acme.corp` (`APPROVER`)
   - `marcus.vance@acme.corp` (`SECOPS_ADMIN`, `APPROVER`)
   - `elena.rostova@acme.corp` (`APPROVER`)
   - `dan.sullivan@acme.corp` (`REQUESTER`)
   - `anya.kapoor@acme.corp` (`AUDITOR`)
   - Seeded dev password in `server/services/authService.mjs`: `ActionLockDemo!2026`

---

## Build & Verification Commands

```bash
# TypeScript check + production bundle
npx tsc --noEmit && npm run build

# Full automated backend & adversarial test suite
npm test
```

See [API_REFERENCE.md](./API_REFERENCE.md) for all endpoints and [TESTING_REPORT.md](./TESTING_REPORT.md) for verification scope and live credential status.
# ActionLock
