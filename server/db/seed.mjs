import crypto from 'node:crypto';
import { canonicalizeJson, computeEnvelopeHash } from '../crypto.mjs';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexDigest, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export const DEMO_PASSWORD_DEFAULT = 'ActionLockDemo!2026';

export const ROLE_DEFINITIONS = [
  {
    id: 'role_requester',
    name: 'REQUESTER',
    description: 'Can submit protected action requests and view own requests.',
    permissions: ['action:create', 'action:read', 'audit:read'],
  },
  {
    id: 'role_approver',
    name: 'APPROVER',
    description: 'Can perform voice challenge, WebAuthn step-up, and approve/reject non-self requests.',
    permissions: [
      'action:read',
      'action:challenge',
      'action:verify_voice',
      'action:approve',
      'action:reject',
      'speaker:enroll',
      'passkey:register',
      'audit:read',
    ],
  },
  {
    id: 'role_secops_admin',
    name: 'SECOPS_ADMIN',
    description: 'Security operations administrator for policies, incidents, integrations, and speakers.',
    permissions: [
      'action:create',
      'action:read',
      'action:challenge',
      'action:verify_voice',
      'action:approve',
      'action:reject',
      'speaker:enroll',
      'speaker:delete',
      'policy:manage',
      'incident:manage',
      'integration:manage',
      'passkey:register',
      'audit:read',
      'org:read',
    ],
  },
  {
    id: 'role_auditor',
    name: 'AUDITOR',
    description: 'Read-only compliance and forensic auditor.',
    permissions: ['action:read', 'audit:read', 'incident:read', 'org:read'],
  },
];

export const DEMO_USERS = [
  {
    id: 'usr_alex_chen',
    email: 'alex.chen@acme.corp',
    displayName: 'Alex Chen',
    title: 'DevOps Engineer',
    department: 'DevOps/SRE',
    roles: ['role_requester'],
  },
  {
    id: 'usr_sarah_jenkins',
    email: 'sarah.jenkins@acme.corp',
    displayName: 'Sarah Jenkins',
    title: 'SecOps Director',
    department: 'SecOps',
    roles: ['role_approver'],
  },
  {
    id: 'usr_marcus_vance',
    email: 'marcus.vance@acme.corp',
    displayName: 'Marcus Vance',
    title: 'Principal SecOps',
    department: 'SecOps',
    roles: ['role_secops_admin', 'role_approver'],
  },
  {
    id: 'usr_elena_rostova',
    email: 'elena.rostova@acme.corp',
    displayName: 'Elena Rostova',
    title: 'Treasury Controller',
    department: 'Treasury',
    roles: ['role_approver'],
  },
  {
    id: 'usr_dan_sullivan',
    email: 'dan.sullivan@acme.corp',
    displayName: 'Dan Sullivan',
    title: 'Finance Ops',
    department: 'Treasury',
    roles: ['role_requester'],
  },
  {
    id: 'usr_anya_kapoor',
    email: 'anya.kapoor@acme.corp',
    displayName: 'Anya Kapoor',
    title: 'Principal Architect',
    department: 'DevOps/SRE',
    roles: ['role_auditor'],
  },
];

export function seedDatabase(db) {
  const now = new Date().toISOString();
  const orgId = 'org_acme_enterprise';

  db.prepare(
    `INSERT OR IGNORE INTO organisations (id, slug, name, region, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(orgId, 'acme-global', 'Acme Global Infrastructure', 'US-East', now);

  const insertRole = db.prepare(`INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)`);
  const insertPerm = db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)`);

  for (const role of ROLE_DEFINITIONS) {
    insertRole.run(role.id, role.name, role.description);
    for (const perm of role.permissions) {
      insertPerm.run(role.id, perm);
    }
  }

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users
      (id, organisation_id, email, display_name, title, department, password_hash, is_demo, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
  `);
  const insertAssign = db.prepare(`
    INSERT OR IGNORE INTO role_assignments (user_id, organisation_id, role_id, assigned_at) VALUES (?, ?, ?, ?)
  `);

  const sharedDemoHash = hashPassword(DEMO_PASSWORD_DEFAULT);
  for (const u of DEMO_USERS) {
    insertUser.run(u.id, orgId, u.email, u.displayName, u.title, u.department, sharedDemoHash, now);
    for (const roleId of u.roles) {
      insertAssign.run(u.id, orgId, roleId, now);
    }
  }

  const defaultPolicies = [
    {
      id: 'SEC-POL-01',
      name: 'KMS Root Key Rotation',
      category: 'GITHUB_DEPLOYMENT',
      target: 'AWS KMS',
      riskTier: 'CRITICAL',
      requireVoice: 1,
      requirePasskey: 1,
      requirePeer: 1,
      nonceTtl: 120,
      permitTtl: 240,
      rules: {
        sodRule: 'Requester != Approver != Peer Signer',
        voiceRequirements: 'Eidos speaker match + Aletheia anti-spoof, corroborative evidence only.',
        fallbackPath: 'Out-of-band SecOps callback + ticket',
      },
    },
    {
      id: 'SEC-POL-04',
      name: 'Production Release Quorum',
      category: 'GITHUB_DEPLOYMENT',
      target: 'GitHub Actions',
      riskTier: 'CRITICAL',
      requireVoice: 1,
      requirePasskey: 1,
      requirePeer: 1,
      nonceTtl: 180,
      permitTtl: 300,
      rules: {
        sodRule: 'Requester != Approver != Peer Signer',
        voiceRequirements: 'Eidos speaker match + Aletheia anti-spoof, corroborative evidence only.',
        fallbackPath: 'Out-of-band SecOps callback + ticket',
      },
    },
    {
      id: 'FIN-POL-02',
      name: 'Treasury Wire / Beneficiary Change',
      category: 'FINANCE_APPROVAL',
      target: 'Finance Sandbox',
      riskTier: 'CRITICAL',
      requireVoice: 1,
      requirePasskey: 1,
      requirePeer: 1,
      nonceTtl: 180,
      permitTtl: 300,
      rules: {
        sodRule: 'Requester != Primary Approver != Peer Signer',
        voiceRequirements: 'Strict dynamic beneficiary nonce + Eidos + Aletheia verification.',
        fallbackPath: 'Dual executive in-person callback + hold',
      },
    },
    {
      id: 'SEC-POL-09',
      name: 'Standard Step-Up Override',
      category: 'IAM',
      target: 'Identity Provider',
      riskTier: 'HIGH',
      requireVoice: 0,
      requirePasskey: 1,
      requirePeer: 0,
      nonceTtl: 300,
      permitTtl: 600,
      rules: {
        sodRule: 'Requester != Approver',
        voiceRequirements: 'Optional corroborative voice check.',
        fallbackPath: 'IT Helpdesk known-number callback',
      },
    },
  ];

  const insertPolicy = db.prepare(`
    INSERT OR IGNORE INTO approval_policies
      (id, organisation_id, name, category, target, risk_tier, require_voice, require_passkey, require_peer_approval, nonce_ttl_sec, permit_ttl_sec, rules_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `);

  for (const p of defaultPolicies) {
    insertPolicy.run(
      p.id,
      orgId,
      p.name,
      p.category,
      p.target,
      p.riskTier,
      p.requireVoice,
      p.requirePasskey,
      p.requirePeer,
      p.nonceTtl,
      p.permitTtl,
      JSON.stringify(p.rules),
      now,
      now,
    );
  }

  // Idempotently seed two initial persisted sample envelopes (1 GitHub Deployment + 1 Simulated Treasury Wire)
  const existingActionCount = db.prepare('SELECT COUNT(*) AS cnt FROM action_requests').get()?.cnt || 0;
  if (existingActionCount === 0) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ghPayload = {
      action_id: 'env_gh_prod_4829',
      organisation_id: orgId,
      requester: { id: 'usr_alex_chen', email: 'alex.chen@acme.corp', roles: ['REQUESTER'] },
      claimed_approver: { id: 'usr_sarah_jenkins', email: 'sarah.jenkins@acme.corp' },
      action_category: 'GITHUB_DEPLOYMENT',
      source_integration: 'github_actions',
      target_system: 'github_environment',
      environment: 'production-us-east-1',
      parameters: {
        repositoryOwner: 'acme-corp',
        repositoryName: 'core-auth-gateway',
        commitSha: '9a2b4c8d1e7f',
        workflowRunId: '4829',
        targetEnvironment: 'production-us-east-1',
        deploymentParams: {
          branch: 'main',
          workflowFile: 'deploy-prod.yml',
        },
      },
      expires_at: expiresAt,
      version: 1,
    };

    db.prepare(
      `INSERT INTO action_requests
        (id, organisation_id, requester_user_id, claimed_approver_user_id, category, source_integration, target_system, environment, risk_tier, current_state, current_version, expires_at, created_at, updated_at)
       VALUES (?, ?, 'usr_alex_chen', 'usr_sarah_jenkins', 'GITHUB_DEPLOYMENT', 'github_actions', 'github_environment', 'production-us-east-1', 'CRITICAL', 'PENDING', 1, ?, ?, ?)`,
    ).run('env_gh_prod_4829', orgId, expiresAt, now, now);
    db.prepare(
      `INSERT INTO action_envelopes (id, action_request_id, version, canonical_json, action_hash, created_at)
       VALUES (?, 'env_gh_prod_4829', 1, ?, ?, ?)`,
    ).run('aev_seed_gh_1', canonicalizeJson(ghPayload), computeEnvelopeHash(ghPayload), now);

    const finPayload = {
      action_id: 'env_fin_sim_9824',
      organisation_id: orgId,
      requester: { id: 'usr_dan_sullivan', email: 'dan.sullivan@acme.corp', roles: ['REQUESTER'] },
      claimed_approver: { id: 'usr_elena_rostova', email: 'elena.rostova@acme.corp' },
      action_category: 'FINANCE_APPROVAL',
      source_integration: 'finance_sandbox',
      target_system: 'erp_treasury_sandbox',
      environment: 'simulation',
      parameters: {
        vendorReference: 'CloudScale Corp US',
        beneficiaryReference: 'ABA 021000021 · ****8841',
        amount: '420000.00',
        currency: 'USD',
        purpose: 'SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED. Q2 Cloud Compute Infrastructure Batch',
      },
      expires_at: expiresAt,
      version: 1,
    };

    db.prepare(
      `INSERT INTO action_requests
        (id, organisation_id, requester_user_id, claimed_approver_user_id, category, source_integration, target_system, environment, risk_tier, current_state, current_version, expires_at, created_at, updated_at)
       VALUES (?, ?, 'usr_dan_sullivan', 'usr_elena_rostova', 'FINANCE_APPROVAL', 'finance_sandbox', 'erp_treasury_sandbox', 'simulation', 'CRITICAL', 'PENDING', 1, ?, ?, ?)`,
    ).run('env_fin_sim_9824', orgId, expiresAt, now, now);
    db.prepare(
      `INSERT INTO action_envelopes (id, action_request_id, version, canonical_json, action_hash, created_at)
       VALUES (?, 'env_fin_sim_9824', 1, ?, ?, ?)`,
    ).run('aev_seed_fin_1', canonicalizeJson(finPayload), computeEnvelopeHash(finPayload), now);
  }
}
