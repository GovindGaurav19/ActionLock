# ACTIONLOCK — Backend API Reference

All routes are served by `server/app.mjs` (default port `8787`, proxied by Vite under `/api`). Authenticated endpoints require an HTTP-only signed session cookie (`actionlock_sid`).

---

## 1. Health & Integrations

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health, SQLite connectivity, DetectifAI/GitHub config flags, WebAuthn RP ID |
| `GET` | `/api/integrations` | Public | Configured adapter status (`detectifai`, `github`, `webauthn`) & GitHub webhook count |
| `GET` | `/api/dashboard/summary` | `action:read` | Aggregated SQLite counts for envelopes, verifications, interceptions, tokens, policies, webhooks |

## 2. Authentication & Organisation

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/auth/demo-accounts` | Public | Lists seeded `DEMO ACCOUNT` personas |
| `POST` | `/api/auth/login` | Public (rate limited) | Authenticates with `{ email, password }`; issues HTTP-only `actionlock_sid` cookie |
| `POST` | `/api/auth/logout` | Session | Revokes server session and clears cookie |
| `GET` | `/api/auth/me` | Authenticated | Returns current user, roles, permissions, organisation, and session ID |
| `GET` | `/api/org` | `org:read` | Organisation metadata & roster |
| `GET` | `/api/rbac/check` | Authenticated | Evaluates `?permission=...` for the signed-in identity |

## 3. Action Envelopes & Authorization Lifecycle

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/actions` | `action:read` | Lists organisation actions with `latestChallenge`, `latestVerification`, `approvals`, `issuedPermit`, `ingressHash`, `hasVersionDrift` |
| `POST` | `/api/actions` | `action:create` | Creates version 1 canonical Action Envelope (`GITHUB_DEPLOYMENT` or `FINANCE_APPROVAL`) under SoD check |
| `GET` | `/api/actions/:id` | `action:read` | Full Action Envelope detail, version history, and hash integrity validation |
| `GET` | `/api/actions/:id/versions` | `action:read` | Lists canonical JSON & SHA-256 hashes per version |
| `POST` | `/api/actions/:id/mutate` | `action:create` | Updates parameters, creates `version + 1`, invalidates prior challenges/approvals, transitions to `INVALIDATED`, opens `SEV-1 CRITICAL` incident if post-challenge/approval |
| `POST` | `/api/actions/:id/verify-hash` | `action:read` | Recomputes canonical JCS SHA-256 hash (`409` on mismatch/drift) |
| `POST` | `/api/actions/:id/reject` | `action:reject` | Explicitly rejects action (blocked if actor is requester) |

## 4. Voice Registry, Challenge, STT & DetectifAI Pipeline

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/speakers` | `action:read` | Lists enrolled speakers and consent/retention metadata |
| `POST` | `/api/speakers/enroll` | `speaker:enroll` | Validates audio upload + explicit consent + DetectifAI 30-day retention acknowledgment, enrolls via `/v1/speakers/enroll` |
| `DELETE` | `/api/speakers/:speakerId` | `speaker:delete` | Deletes remote DetectifAI speaker profile & marks consent revoked |
| `POST` | `/api/actions/:id/challenge` | `action:challenge` | Issues one-time cryptographic nonce phrase bound to action hash |
| `POST` | `/api/actions/:id/recording` | `action:verify_voice` | Validates Google STT V2 transcript + invokes DetectifAI `/v1/speakers/verify` (`detect_deepfake=true`, `Idempotency-Key`); fails closed on errors/spoof/mismatch |
| `GET` | `/api/actions/:id/verification` | `action:read` | Returns latest separate Eidos & Aletheia verification evidence |
| `POST` | `/api/operations/:opId/recover` | `action:verify_voice` | Recovers pending/timed-out DetectifAI operation via `GET /v1/operations/{operation_id}` |

## 5. Policy Engine, WebAuthn Passkeys, Peer SoD & Scoped Tokens

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/policies` | `action:read` | Lists organisation `approval_policies` |
| `POST` | `/api/policies` | `policy:manage` | Creates deterministic policy rule |
| `PATCH` | `/api/policies/:id` | `policy:manage` | Updates policy attributes |
| `GET` | `/api/actions/:id/policy-eval` | `action:read` | Evaluates matching policy against action state, voice/passkey/peer evidence, and acting user SoD |
| `POST` | `/api/webauthn/register/options` | `passkey:register` | Generates `@simplewebauthn/server` registration options |
| `POST` | `/api/webauthn/register/verify` | `passkey:register` | Verifies & stores WebAuthn credential public key & counter |
| `POST` | `/api/actions/:id/passkey/options` | `action:approve` | Generates WebAuthn authentication challenge |
| `POST` | `/api/actions/:id/passkey/verify` | `action:approve` | Verifies WebAuthn assertion server-side; invalid assertions move action to `HOLD` |
| `POST` | `/api/actions/:id/peer-approve` | `action:approve` | Independent peer co-approval enforcing `actor != requester && actor != primary_passkey_signer` |
| `POST` | `/api/actions/:id/approve` | `action:approve` | Evaluates full 7-condition gate and mints single-use HS256 scoped JWT permit (`TOKEN_ISSUED`) |
| `POST` | `/api/tokens/consume` | Token Bearer | Verifies signature, expiry, scope, environment, and action hash, then atomically marks token `CONSUMED` (`409` on replay) |

## 6. Webhooks & GitHub Deployment Protection

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/webhooks/detectifai` | Standard Webhooks HMAC | Verifies `webhook-id` / `webhook-timestamp` / `webhook-signature` over raw bytes, deduplicates, queues async reconciliation |
| `POST` | `/api/webhooks/github` | `X-Hub-Signature-256` | Verifies HMAC-SHA256 raw body signature, validates SSRF-safe `deployment_callback_url`, correlates/creates `PENDING` deployment envelope |
| `POST` | `/api/actions/:id/github-callback` | `action:approve` / `action:reject` | Consumes permit (`approved`) or marks rejected, exchanges RS256 App JWT -> installation token, posts `/deployment_protection_rule` |
| `GET` | `/api/webhooks/events` | `audit:read` | Lists persisted webhook deliveries |

## 7. Audit Chain, Security Incidents & Break-Glass Registry

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/audit-events` | `audit:read` | Lists append-only hash-chained audit events |
| `GET` | `/api/audit-events/verify-chain` | `audit:read` | Recomputes chronological SHA-256 audit chain integrity |
| `GET` | `/api/incidents` | `action:read` | Lists persisted security incidents (Aletheia spoofs & payload hash drift) |
| `PATCH` | `/api/incidents/:id` | `incident:manage` | Updates incident status (`OPEN`, `INVESTIGATING`, `BLOCKED`, `RESOLVED`) with audit event |
| `GET` | `/api/break-glass` | `audit:read` | Lists manual out-of-band Break-Glass records |
| `POST` | `/api/break-glass` | `incident:manage` | Logs audited Break-Glass invocation requiring ticket ID, justification (`>=15` chars), `>=2` distinct custodians, runbook ack, and `15–120`m TTL |
