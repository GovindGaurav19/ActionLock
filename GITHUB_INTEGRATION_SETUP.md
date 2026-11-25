# ACTIONLOCK — GitHub App Custom Deployment Protection Rule Setup

This guide explains how to configure a GitHub App as an **ACTIONLOCK Custom Deployment Protection Rule** so GitHub Actions environments hold deployments until voice + passkey + independent peer Separation-of-Duties authorization completes.

---

## 1. GitHub Plan & Public-Preview Constraints

GitHub Actions **Custom Deployment Protection Rules** have strict repository visibility requirements:
- **Public repositories:** Supported on GitHub Free, Team, and Enterprise plans.
- **Private and internal repositories:** Requires **GitHub Enterprise Cloud** (or GitHub Enterprise Server with Custom Deployment Protection Rules enabled). Standard Free/Team private repositories cannot invoke third-party deployment protection webhooks.

If testing without a GitHub Enterprise organisation, use a dedicated **public sandbox repository** (never store secrets or proprietary production credentials in a public repo).

---

## 2. Create the GitHub App

1. In GitHub (`Settings` → `Developer settings` → `GitHub Apps` → `New GitHub App`):
   - **GitHub App name:** `ACTIONLOCK Deployment Gate (<your-org>)`
   - **Homepage URL:** `https://<your-actionlock-domain>` (or ngrok/tunnel URL for local hackathon demos)
   - **Webhook Active:** Checked
   - **Webhook URL:** `https://<your-public-callback-domain>/api/webhooks/github`
   - **Webhook Secret:** Generate a strong random secret and set it as `GITHUB_WEBHOOK_SECRET` on the backend server (`.env`).
2. **Repository Permissions:**
   - **Deployments:** `Read and write`
   - **Actions:** `Read-only` (optional for workflow run metadata inspection)
   - **Metadata:** `Read-only`
3. **Subscribe to Events:**
   - Check **`Deployment protection rule`** (`deployment_protection_rule`).
4. **Custom Deployment Protection Rule URL:**
   - Configure the App's **Deployment protection rule** endpoint if prompted, pointing to `https://<your-public-callback-domain>/api/webhooks/github`.
5. **Generate Private Key:**
   - Click **Generate a private key** and download the `.pem` file.
   - Store the App ID and PEM private key in server-side `.env`:
     ```env
     GITHUB_APP_ID=123456
     GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
     GITHUB_WEBHOOK_SECRET=your_random_webhook_secret
     ```
   - Never expose any `GITHUB_*` variables with a `VITE_` prefix.

---

## 3. Install the App & Enable on an Environment

1. Install the GitHub App onto your target organisation / repository.
2. Open the repository → **Settings** → **Environments** → select e.g. **`production`**.
3. Under **Deployment protection rules**, enable your installed **ACTIONLOCK Deployment Gate** custom rule and click **Save protection rules**.

---

## 4. End-to-End Runtime Flow in ACTIONLOCK

1. **Webhook Ingestion (`POST /api/webhooks/github`):**
   - When a workflow job targets the protected environment, GitHub sends a `deployment_protection_rule` webhook signed with `X-Hub-Signature-256: sha256=<hmac>`.
   - ACTIONLOCK verifies the HMAC-SHA256 signature over raw body bytes, deduplicates by `X-GitHub-Delivery`, and correlates or creates a `PENDING` `GITHUB_DEPLOYMENT` Action Envelope binding `repositoryOwner`, `repositoryName`, `commitSha`, `workflowRunId`, `targetEnvironment`, `installationId`, and `deployment_callback_url`.
   - ACTIONLOCK **never** auto-approves from inbound webhook events.
2. **Voice + Passkey + Peer SoD + Permit Minting:**
   - The requester cannot verify or approve their own deployment.
   - Designated approver completes dynamic challenge phrase (`STT` + DetectifAI Eidos & Aletheia) and WebAuthn FIDO2 assertion.
   - An independent peer co-approves (`POST /api/actions/:actionId/peer-approve`), and ACTIONLOCK mints a single-use scoped JWT permit (`POST /api/actions/:actionId/approve`).
3. **Callback Execution (`POST /api/actions/:actionId/github-callback`):**
   - `approved`: Atomically consumes the scoped one-time permit (checking signature, expiry, `GITHUB_DEPLOYMENT:<actionId>` scope, target environment, and latest SHA-256 envelope hash), mints a short-lived RS256 GitHub App JWT (`iss = GITHUB_APP_ID`), exchanges it at `POST /app/installations/{installation_id}/access_tokens`, and posts `{ environment_name, state: "approved", comment }` to `POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule`.
   - `rejected`: Transitions the action to `REJECTED` and posts `state: "rejected"` to the GitHub callback URL.
