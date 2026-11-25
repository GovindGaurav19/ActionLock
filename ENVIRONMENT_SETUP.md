# ACTIONLOCK — Environment Setup Guide

ACTIONLOCK strictly isolates all secrets to the Node.js backend (`server/`). **Never** expose API keys, private keys, or webhook secrets with a `VITE_` prefix.

---

## 1. Prerequisites

- **Node.js:** `v22+` or `v26+` (verified on `v26.9.0`, uses built-in `node:sqlite`, `node:crypto`, and `node:test`)
- **npm:** `v10+` (verified on `11.19.1`)
- **Browser (for live WebAuthn passkeys):** Chromium / Chrome / Safari / Firefox on `http://localhost:5173` (matches default `WEBAUTHN_ORIGIN` and `WEBAUTHN_RP_ID=localhost`)

---

## 2. Backend Environment Variables (`.env`)

Create `.env` from `.env.example`:
```bash
cp .env.example .env
```

### Server & Database
- `PORT=8787` — Backend HTTP listen port
- `NODE_ENV=development` — Set to `production` when deploying (requires explicit `SESSION_SECRET` & `ACTION_TOKEN_SECRET`)
- `SQLITE_DB_PATH=./data/actionlock.db` — Local persistent SQLite file (automatically initialized with `001_initial.sql` and seeded demo accounts/policies/sample actions)
- `DATABASE_URL=` — Target PostgreSQL connection string when deploying to PostgreSQL (schema in `server/db/migrations/001_initial.sql` mirrors the C4 relational model)
- `SESSION_SECRET=` — Cryptographic HMAC key for session cookies (ephemeral in `development` if unset; required in `production`)
- `ACTION_TOKEN_SECRET=` — HMAC-SHA256 signing key for single-use scoped permit JWTs (required in `production`)

### DetectifAI Platform (Voice Enrollment, Speaker Verification & Anti-Spoofing)
- `DETECTIF_API_KEY=` — Server API key for `https://platform.detectif.ai` (`X-API-Key` / Bearer auth)
- `DETECTIF_API_BASE_URL=https://platform.detectif.ai`
- `DETECTIF_WEBHOOK_SECRET=whsec_...` — Standard Webhooks Base64 secret for verifying `POST /api/webhooks/detectifai`

> Note: Uploaded voice samples are temporarily buffered in memory/temp scope on ACTIONLOCK and sent to DetectifAI, which retains uploaded audio for 30 days and keeps enrolled embeddings encrypted until profile deletion (`DELETE /api/speakers/:speakerId`).

### Google Cloud Speech-to-Text V2 (Dynamic Phrase Verification)
- `GOOGLE_CLOUD_PROJECT_ID=` — GCP project ID for Speech-to-Text V2 API
- `GOOGLE_APPLICATION_CREDENTIALS=` — Path to service account JSON credentials file with Speech-to-Text permissions
- `STT_LANGUAGE_CODE=en-US`

### GitHub App Custom Deployment Protection Rule
- `GITHUB_APP_ID=` — Numeric GitHub App ID
- `GITHUB_APP_PRIVATE_KEY=` — RSA PEM private key (use `\n` escapes if single-line in `.env`)
- `GITHUB_WEBHOOK_SECRET=` — Random webhook secret matching the GitHub App `X-Hub-Signature-256` configuration

See [GITHUB_INTEGRATION_SETUP.md](./GITHUB_INTEGRATION_SETUP.md) for repository visibility rules (public repos vs GitHub Enterprise).

### WebAuthn / FIDO2 Relying Party
- `WEBAUTHN_RP_ID=localhost`
- `WEBAUTHN_RP_NAME=ACTIONLOCK Enterprise`
- `WEBAUTHN_ORIGIN=http://localhost:5173`
