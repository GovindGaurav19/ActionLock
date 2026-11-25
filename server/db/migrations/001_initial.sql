-- ACTIONLOCK Relational Schema (SQLite MVP; 1:1 aligned to C4 PostgreSQL Target Model)

CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'US-East',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS role_assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, organisation_id, role_id)
);

CREATE TABLE IF NOT EXISTS speaker_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  detectifai_speaker_id TEXT NOT NULL UNIQUE,
  enrollment_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_operation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS voice_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  speaker_profile_id TEXT REFERENCES speaker_profiles(id) ON DELETE SET NULL,
  consent_version TEXT NOT NULL,
  retention_acknowledged INTEGER NOT NULL,
  consented_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS action_requests (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  requester_user_id TEXT REFERENCES users(id),
  claimed_approver_user_id TEXT REFERENCES users(id),
  category TEXT NOT NULL,
  source_integration TEXT NOT NULL,
  target_system TEXT NOT NULL,
  environment TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  current_state TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_envelopes (
  id TEXT PRIMARY KEY,
  action_request_id TEXT NOT NULL REFERENCES action_requests(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  canonical_json TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (action_request_id, version)
);

CREATE TABLE IF NOT EXISTS voice_challenges (
  id TEXT PRIMARY KEY,
  action_request_id TEXT NOT NULL REFERENCES action_requests(id) ON DELETE CASCADE,
  action_hash TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  phrase TEXT NOT NULL,
  designated_approver_id TEXT REFERENCES users(id),
  stt_status TEXT NOT NULL DEFAULT 'PENDING',
  stt_transcript TEXT,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_operations (
  id TEXT PRIMARY KEY,
  action_request_id TEXT REFERENCES action_requests(id) ON DELETE SET NULL,
  challenge_id TEXT REFERENCES voice_challenges(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_response_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_verifications (
  id TEXT PRIMARY KEY,
  action_request_id TEXT NOT NULL REFERENCES action_requests(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES voice_challenges(id) ON DELETE CASCADE,
  eidos_operation_id TEXT,
  eidos_decision TEXT,
  eidos_similarity REAL,
  aletheia_operation_id TEXT,
  aletheia_verdict TEXT,
  aletheia_score REAL,
  evidence_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  operation_id TEXT,
  signature_valid INTEGER NOT NULL,
  processing_status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE (provider, webhook_id)
);

CREATE TABLE IF NOT EXISTS approval_policies (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  target TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  require_voice INTEGER NOT NULL DEFAULT 1,
  require_passkey INTEGER NOT NULL DEFAULT 1,
  require_peer_approval INTEGER NOT NULL DEFAULT 1,
  nonce_ttl_sec INTEGER NOT NULL DEFAULT 180,
  permit_ttl_sec INTEGER NOT NULL DEFAULT 300,
  rules_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  action_request_id TEXT NOT NULL REFERENCES action_requests(id) ON DELETE CASCADE,
  approver_user_id TEXT NOT NULL REFERENCES users(id),
  approval_kind TEXT NOT NULL,
  decision TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key_b64 TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS authorization_tokens (
  id TEXT PRIMARY KEY,
  jti TEXT NOT NULL UNIQUE,
  action_request_id TEXT NOT NULL REFERENCES action_requests(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  action_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_integration TEXT NOT NULL,
  environment TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  action_request_id TEXT,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_incidents (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  action_request_id TEXT,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS break_glass_events (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  initiated_by_user_id TEXT REFERENCES users(id),
  custodian_ids_json TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  justification TEXT NOT NULL,
  target_scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
