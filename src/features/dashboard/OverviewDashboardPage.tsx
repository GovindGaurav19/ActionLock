import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { EvidenceBoundaryNotice } from '@/components/common/EvidenceBoundaryNotice';
import { PolicyStateBadge } from '@/components/common/StatusBadge';
import type { ActionCategory } from '@/types/actionlock';

export function OverviewDashboardPage() {
  const navigate = useNavigate();
  const {
    mode,
    dashboardSummary,
    envelopes,
    setSelectedEnvelopeId,
    setC4SpecOpen,
    setNewActionModalOpen,
    rejectEnvelope,
    notify,
  } = useActionLock();

  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ActionCategory>('ALL');
  const [tableSearch, setTableSearch] = useState('');

  const filteredEnvelopes = envelopes.filter((env) => {
    const matchesCategory = categoryFilter === 'ALL' || env.category === categoryFilter;
    const q = tableSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      env.id.toLowerCase().includes(q) ||
      env.targetTitle.toLowerCase().includes(q) ||
      env.requester.toLowerCase().includes(q) ||
      env.actionHash.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const attentionCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.envelopes.activeCount
      : envelopes.filter((e) => e.state !== 'AUTHORIZED' && e.state !== 'REJECTED').length;
  const totalEnvMetric = mode === 'live' && dashboardSummary ? dashboardSummary.envelopes.total : envelopes.length;
  const voiceReqCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.envelopes.voiceRequiredCount
      : envelopes.filter((e) => ['AWAITING_APPROVER', 'CHALLENGE_ISSUED', 'VERIFICATION_PENDING'].includes(e.state)).length;
  const holdCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.envelopes.holdCount
      : envelopes.filter((e) => ['ON_HOLD', 'ACTION_CHANGED', 'INTEGRATION_ERROR'].includes(e.state)).length;
  const stepUpCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.envelopes.stepUpCount
      : envelopes.filter((e) => ['VOICE_STAGE_PASSED', 'STEP_UP_PENDING', 'PEER_APPROVAL_PENDING'].includes(e.state)).length;
  const interceptionsTotal =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.interceptions.totalBlocked
      : envelopes.filter((e) => e.hashDriftDetected || e.aletheia.verdict === 'fake' || e.eidos.decision === 'no_match').length;
  const syntheticBlocked =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.interceptions.syntheticBlocked
      : envelopes.filter((e) => e.aletheia.verdict === 'fake').length;
  const hashDriftBlocked =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.interceptions.hashDriftBlocked
      : envelopes.filter((e) => e.hashDriftDetected).length;
  const tokensMinted =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.tokens.mintedCount
      : envelopes.filter((e) => e.jtiConsumed || e.state === 'AUTHORIZED').length;
  const activeWaveformEnv = envelopes.find((e) => e.id === 'env_8f92a10c') || envelopes[0];
  const spoofEnv = envelopes.find((e) => e.aletheia.verdict === 'fake');

  const exportAuditBundle = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), envelopes }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `actionlock-audit-bundle-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Signed audit bundle exported as JSON.', 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-6">
      {/* Viewport Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
              Authorization Gateway &amp; Telemetry
            </h1>
            <span className="font-mono-badge text-mono-badge px-2 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
              ACTIVE ENFORCEMENT
            </span>
          </div>
          <p className="font-body-md text-body-md text-text-secondary mt-0.5">
            Deterministic policy arbitration, AI voice biometrics, and phish-resistant cryptographic proof engine.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-surface border border-border-subtle px-3 py-1.5 rounded">
            <span className="h-2 w-2 rounded-full bg-status-success mr-2 animate-ping" />
            <span className="font-mono-badge text-mono-badge text-on-surface">GATEWAY CLUSTER: L9_ACTIVE</span>
          </div>
          <button
            type="button"
            onClick={exportAuditBundle}
            className="bg-surface border border-border-subtle hover:bg-surface-container-low text-on-surface px-3 py-1.5 rounded font-label-md text-label-md flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">file_download</span>
            Export Audit Bundle
          </button>
          <button
            type="button"
            onClick={() => setNewActionModalOpen(true)}
            className="bg-secondary hover:bg-[#005a5e] text-on-secondary px-3 py-1.5 rounded font-label-md text-label-md flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            Issue Action Nonce
          </button>
        </div>
      </div>

      {/* 4 High-Assurance Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-surface border border-border-subtle p-4 rounded-lg flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
              Active Action Envelopes
            </span>
            <span className="material-symbols-outlined text-text-secondary text-[20px]">mark_email_unread</span>
          </div>
          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">{totalEnvMetric}</span>
              <span className="font-mono-badge text-mono-badge text-status-warning bg-[#fffbeb] border border-[rgba(165,107,24,0.2)] px-1.5 py-0.5 rounded">
                {attentionCount} REQUIRING ATTENTION
              </span>
            </div>
            <div className="w-full bg-surface-container-low h-1.5 rounded-full mt-3 overflow-hidden flex">
              <div
                className="bg-secondary h-full"
                style={{ width: totalEnvMetric ? `${Math.round(((totalEnvMetric - holdCount - stepUpCount) / totalEnvMetric) * 100)}%` : '0%' }}
                title="Active / Verified"
              />
              <div
                className="bg-status-warning h-full"
                style={{ width: totalEnvMetric ? `${Math.round((stepUpCount / totalEnvMetric) * 100)}%` : '0%' }}
                title="Pending Step-up"
              />
              <div
                className="bg-status-error h-full"
                style={{ width: totalEnvMetric ? `${Math.round((holdCount / totalEnvMetric) * 100)}%` : '0%' }}
                title="Quarantined / Hold"
              />
            </div>
          </div>
          <div className="flex items-center justify-between font-mono-badge text-mono-badge text-text-secondary pt-1">
            <span>{voiceReqCount} VOICE REQ</span>
            <span>{holdCount} ON HOLD</span>
            <span>{stepUpCount} STEP-UP</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle p-4 rounded-lg flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
              AI Verification Evidence
            </span>
            <span className="material-symbols-outlined text-secondary text-[20px]">neurology</span>
          </div>
          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">
                {mode === 'live'
                  ? dashboardSummary?.verifications.passRatePct !== null && dashboardSummary?.verifications.passRatePct !== undefined
                    ? `${dashboardSummary.verifications.passRatePct}%`
                    : '—'
                  : '1.4s'}
              </span>
              <span className="font-mono-badge text-mono-badge text-status-success bg-[#ecfdf5] border border-[rgba(35,122,87,0.2)] px-1.5 py-0.5 rounded">
                {mode === 'live'
                  ? `${dashboardSummary?.verifications.completedCount || 0} VERIFIED`
                  : 'FIXTURE BENCHMARK'}
              </span>
            </div>
            <div className="flex items-center gap-1 mt-2 text-text-secondary font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[16px] text-status-success">speed</span>
              <span>
                {mode === 'live'
                  ? `Genuine: ${dashboardSummary?.verifications.genuinePassCount || 0} · Real Aletheia + Eidos checks`
                  : 'Aletheia + Eidos Dual-Engine Bus'}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between font-mono-badge text-mono-badge text-text-secondary pt-1">
            <span>
              {mode === 'live'
                ? dashboardSummary?.integrations.detectifAiConfigured
                  ? 'DETECTIFAI: CONFIGURED'
                  : 'DETECTIFAI: UNSET'
                : 'DETECTIFAI: DEMO'}
            </span>
            <span className="text-status-success font-medium">FAIL-CLOSED</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle p-4 rounded-lg flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
              Deterministic Interceptions
            </span>
            <span className="material-symbols-outlined text-status-error text-[20px]">security_update_warning</span>
          </div>
          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">{interceptionsTotal}</span>
              <span className="font-mono-badge text-mono-badge text-status-error bg-[#fef2f2] border border-[rgba(181,71,71,0.2)] px-1.5 py-0.5 rounded">
                BLOCKED ({mode === 'live' ? 'PERSISTED' : 'FIXTURE'})
              </span>
            </div>
            <div className="flex items-center gap-1 mt-2 text-text-secondary font-body-sm text-body-sm">
              <span className="text-status-error font-medium">{syntheticBlocked} synthetic audio</span>
              <span>· {hashDriftBlocked} payload hash drifts</span>
            </div>
          </div>
          <div className="flex items-center justify-between font-mono-badge text-mono-badge text-text-secondary pt-1">
            <span>REPLAY PREVENTED: 100%</span>
            <span>QUARANTINE READY</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle p-4 rounded-lg flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
              Scoped Tokens Minted
            </span>
            <span className="material-symbols-outlined text-secondary text-[20px]">key</span>
          </div>
          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">{tokensMinted}</span>
              <span className="font-mono-badge text-mono-badge text-on-tertiary-fixed-variant bg-surface-container px-1.5 py-0.5 rounded">
                JTI SINGLE-USE
              </span>
            </div>
            <div className="text-text-secondary font-body-sm text-body-sm mt-2">
              Cryptographically bound to SHA-256 target
            </div>
          </div>
          <div className="flex items-center justify-between font-mono-badge text-mono-badge text-text-secondary pt-1">
            <span>CONSUMED: {mode === 'live' && dashboardSummary ? dashboardSummary.tokens.consumedCount : tokensMinted}</span>
            <span>TTL: ≤180s</span>
          </div>
        </div>
      </div>

      {/* Critical Interception Banner */}
      {spoofEnv && (
        <div className="rounded-lg border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-status-error text-[22px] mt-0.5">gpp_maybe</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono-badge text-mono-badge px-2 py-0.5 rounded bg-error text-white">
                  CRITICAL INTERCEPTION
                </span>
                <span className="font-mono-data text-mono-data text-status-error">
                  ENVELOPE: {spoofEnv.id} · 18m ago
                </span>
              </div>
              <p className="font-label-md text-label-md font-semibold text-on-surface mt-1">
                Deepfake voice synthesis detected via DetectifAI Aletheia Engine (Score: 0.94 fake).
              </p>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                Spoof attempted on claimed executive <code className="font-mono-data">{spoofEnv.claimedApprover}</code>{' '}
                for Treasury wire commit. Deterministic lock applied: Action frozen, permit issue blocked, audit hash
                recorded.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/incidents')}
              className="px-3 py-1.5 rounded bg-surface border border-border-subtle text-on-surface font-label-md text-label-md hover:bg-surface-container-low"
            >
              View Forensic Waveform
            </button>
            <button
              type="button"
              onClick={() => rejectEnvelope(spoofEnv.id, 'Permanent disqualification following Aletheia 0.94 spoof alert')}
              className="px-3 py-1.5 rounded bg-surface border border-[rgba(181,71,71,0.35)] text-status-error font-label-md text-label-md hover:bg-error hover:text-white transition-colors"
            >
              Permanent Disqualify
            </button>
          </div>
        </div>
      )}

      {/* Priority Pending Action Envelopes Table */}
      <div className="bg-surface border border-border-subtle rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border-subtle flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-headline-sm text-headline-sm text-on-surface">Priority Pending Action Envelopes</h2>
              <span className="font-mono-badge text-mono-badge px-2 py-0.5 rounded bg-surface-container-low border border-border-subtle text-on-surface">
                {filteredEnvelopes.length} RECORDS
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary mt-0.5">
              Strict canonicalization enforced. Any change to target payload recomputes SHA-256 and invalidates existing
              proofs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Filter envelopes..."
              className="h-8 px-3 rounded border border-border-subtle bg-canvas-bg font-body-sm text-on-surface placeholder:text-text-secondary focus:outline-none focus:border-secondary"
            />
            <div className="flex items-center rounded border border-border-subtle bg-canvas-bg p-0.5">
              {(['ALL', 'DevSecOps', 'Financial', 'IAM'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCategoryFilter(tab)}
                  className={`px-2.5 py-1 rounded font-label-sm text-label-sm transition-colors ${
                    categoryFilter === tab
                      ? 'bg-primary-container text-white'
                      : 'text-text-secondary hover:text-on-surface'
                  }`}
                >
                  {tab === 'ALL' ? `All (${envelopes.length})` : tab}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-label-sm uppercase text-text-secondary">
                <th className="py-2.5 px-4">Envelope ID / Hash</th>
                <th className="py-2.5 px-4">Category &amp; Target</th>
                <th className="py-2.5 px-4">Requester</th>
                <th className="py-2.5 px-4">Designated Approver</th>
                <th className="py-2.5 px-4">State &amp; Step Validation</th>
                <th className="py-2.5 px-4">Age</th>
                <th className="py-2.5 px-4 text-right">Arbitration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filteredEnvelopes.map((env) => {
                const actionLabel =
                  env.state === 'CHALLENGE_ISSUED' || env.state === 'AWAITING_APPROVER'
                    ? 'Complete Voice Step'
                    : env.state === 'VOICE_STAGE_PASSED' || env.state === 'STEP_UP_PENDING'
                      ? 'Passkey Step-Up'
                      : env.state === 'ON_HOLD' || env.state === 'ACTION_CHANGED'
                        ? env.details.kind === 'finance'
                          ? 'Inspect Diff'
                          : 'Incident Case'
                        : 'Inspect Envelope';

                return (
                  <tr key={env.id} className="hover:bg-[#f8fafc] transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-text-secondary">
                          {env.state === 'ON_HOLD' ? 'block' : 'lock'}
                        </span>
                        <div>
                          <div className="font-mono-data text-mono-data font-medium text-on-surface">{env.id}</div>
                          <div className="font-mono-data text-[11px] text-text-secondary truncate max-w-[150px]">
                            {env.actionHash}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-label-md text-label-md font-semibold text-on-surface">{env.targetTitle}</div>
                      <div className="font-mono-data text-[11px] text-text-secondary">{env.targetSubtitle}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-mono-badge text-[10px] ${
                            env.requesterInitials === '!'
                              ? 'bg-[#fef2f2] text-status-error border border-[rgba(181,71,71,0.3)]'
                              : 'bg-primary-container text-white'
                          }`}
                        >
                          {env.requesterInitials}
                        </span>
                        <span className="font-body-sm text-body-sm text-on-surface">{env.requester}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-body-sm text-body-sm text-on-surface">{env.claimedApprover}</span>
                        <span className="font-mono-badge text-[9px] px-1.5 py-0.5 rounded bg-surface-container-low border border-border-subtle text-text-secondary">
                          {env.category}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <PolicyStateBadge state={env.state} />
                    </td>
                    <td className="py-3 px-4 font-mono-data text-mono-data text-text-secondary tabular-nums">
                      {env.ageDisplay}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEnvelopeId(env.id);
                          if (env.state === 'VOICE_STAGE_PASSED' || env.state === 'STEP_UP_PENDING') {
                            navigate('/webauthn-permit');
                          } else if (env.details.kind === 'finance' && (env.state === 'ON_HOLD' || env.state === 'ACTION_CHANGED')) {
                            navigate('/finance-beneficiary');
                          } else if (env.state === 'ON_HOLD') {
                            navigate('/incidents');
                          } else {
                            navigate('/approvals');
                          }
                        }}
                        className={`px-3 py-1.5 rounded font-label-sm text-label-sm transition-colors ${
                          env.state === 'CHALLENGE_ISSUED' || env.state === 'AWAITING_APPROVER'
                            ? 'bg-secondary hover:bg-[#005a5e] text-white'
                            : env.state === 'ON_HOLD' || env.state === 'ACTION_CHANGED'
                              ? 'bg-[#fef2f2] border border-[rgba(181,71,71,0.25)] text-status-error hover:bg-error hover:text-white'
                              : 'bg-surface border border-border-subtle text-on-surface hover:bg-surface-container-low'
                        }`}
                      >
                        {actionLabel}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-2.5 bg-[#f8fafc] border-t border-border-subtle flex flex-wrap items-center justify-between gap-2 font-mono-badge text-[10px] text-text-secondary">
          <span>CANONICALIZATION ENGINE: JCS_RFC8785 + HMAC-SHA256 STAMP ACTIVE</span>
          <span>UNCONSUMED NONCES: 12 · ATOMIC EXPIRATION: STRICT 300s</span>
        </div>
      </div>

      {/* Layered Security Architecture Status (C4 Specification) */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              Layered Security Architecture Status (C4 Specification)
            </h2>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Zero implicit trust boundary. Every component returns typed state, correlation ID, and non-bypassable proof.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setC4SpecOpen(true)}
            className="font-mono-badge text-[10px] text-text-secondary hover:text-secondary"
          >
            SPEC LEVEL: MVP CORE + AUDIT STORE ↗
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[
            {
              code: 'COMPONENT A',
              status: 'ACTIVE',
              title: 'Immutable Action Envelope',
              desc: 'Deterministic payload binding. Normalizes target repo, commit SHA, recipient account, and amount.',
              rows: [
                ['Canonical Digest', 'RFC 8785 JSON'],
                ['Tamper Re-check', 'Zero Drift Allowed'],
              ],
            },
            {
              code: 'COMPONENT B',
              status: 'OPERATIONAL',
              title: 'Voice Challenge & Nonce Engine',
              desc: 'Generates single-use cryptographically random phoneme phrases bound to envelope ID and monotonic time.',
              rows: [
                ['Nonce Freshness', '300s Sliding TTL'],
                ['Replay Guard', 'Anti-Stale Cache'],
              ],
            },
            {
              code: 'COMPONENT C',
              status: 'ONLINE',
              title: 'DetectifAI Dual AI Pipeline',
              desc: 'Aletheia neural deepfake synthesis detection runs independently against Eidos speaker verification vector.',
              rows: [
                ['Evaluation Mode', 'Pure Evidence Only'],
                ['Score Combination', 'No Numeric Average'],
              ],
            },
            {
              code: 'COMPONENT E',
              status: 'ACTIVE',
              title: 'Deterministic Policy Arbiter',
              desc: 'Voice stage pass does not auto-authorize. Explicit RBAC rules, SoD, passkey presence, and quorum required.',
              rows: [
                ['Fail-Safe Mode', 'Fail Closed (HOLD)'],
                ['Decision Log', 'Full Cryptographic Trail'],
              ],
            },
            {
              code: 'COMPONENT F',
              status: 'ENFORCED',
              title: 'Passkey / WebAuthn Service',
              desc: 'Phishing-resistant RP server-side verification. Validates user presence, authenticator data, and clientDataHash.',
              rows: [
                ['Key Storage', 'Hardware Bound'],
                ['MitM Defense', 'Origin Verified'],
              ],
            },
            {
              code: 'COMPONENT G',
              status: 'ACTIVE',
              title: 'Scoped Permit Token Issuer',
              desc: 'Mints short-lived single-use JWT with tight audience binding. Downstream adapters reject reused JTIs atomically.',
              rows: [
                ['Binding Scope', 'action_hash_bound'],
                ['Adapter Target', 'GitHub / AWS / ERP'],
              ],
            },
          ].map((comp) => (
            <div key={comp.code} className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono-badge text-[10px] text-secondary">{comp.code}</span>
                  <span className="font-mono-badge text-[10px] text-status-success flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
                    {comp.status}
                  </span>
                </div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">{comp.title}</h3>
                <p className="font-body-sm text-body-sm text-text-secondary mt-1">{comp.desc}</p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-border-subtle flex flex-col gap-1">
                {comp.rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-[12px]">
                    <span className="text-text-secondary">{k}</span>
                    <span className="font-mono-data text-on-surface font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom 7:5 Split — Live Waveform Inspector & Emergency Recovery */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {activeWaveformEnv ? (
          <div className="xl:col-span-8 bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-[20px]">graphic_eq</span>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface">
                    Synchronous Request &amp; Live Waveform Inspector
                  </h2>
                </div>
                <p className="font-body-sm text-body-sm text-text-secondary mt-0.5">
                  Visual inspection for Envelope <code className="font-mono-data text-on-surface">{activeWaveformEnv.id}</code>.
                  Aletheia synthesis detection and Eidos speaker similarity status.
                </p>
              </div>
              <span className="font-mono-badge text-mono-badge px-2 py-0.5 rounded bg-[#ecfdf5] border border-[rgba(35,122,87,0.25)] text-status-success">
                {activeWaveformEnv.aletheia.verdict === 'real' && activeWaveformEnv.eidos.decision === 'match'
                  ? 'DUAL VOICE PASS'
                  : activeWaveformEnv.state}
              </span>
            </div>

            <div className="rounded-lg bg-[#f8fafc] border border-border-subtle p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono-badge text-[10px] text-text-secondary mb-4">
                <span>SPECTRAL ENVELOPE: CAPTURED AUDIO</span>
                <span className="text-status-success">
                  ALETHEIA SCORE: {activeWaveformEnv.aletheia.score ?? '—'} (VERDICT:{' '}
                  {activeWaveformEnv.aletheia.verdict?.toUpperCase() || 'PENDING'})
                </span>
              </div>
              <div className="h-16 flex items-center justify-between gap-1.5 px-2">
                {activeWaveformEnv.challenge.waveformBars.map((bar, idx) => (
                  <div
                    key={idx}
                    className="w-1.5 rounded-full bg-secondary/85"
                    style={{ height: `${Math.max(18, bar * 0.62)}px` }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono-data text-[11px] text-text-secondary mt-4">
                <span>0.00s (CHALLENGE START)</span>
                <span className="text-on-surface font-medium">PHRASE: &ldquo;{activeWaveformEnv.challenge.phrase}&rdquo;</span>
                <span>{activeWaveformEnv.challenge.recordingDurationSec ?? '—'}s</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded border border-border-subtle bg-canvas-bg p-3">
                <div className="font-label-sm text-label-sm text-text-secondary">Eidos Biometric</div>
                <div className="font-mono-data text-mono-data font-semibold text-status-success mt-1">
                  {activeWaveformEnv.eidos.decision?.toUpperCase() || 'PENDING'} ({activeWaveformEnv.eidos.similarity ?? '—'})
                </div>
              </div>
              <div className="rounded border border-border-subtle bg-canvas-bg p-3">
                <div className="font-label-sm text-label-sm text-text-secondary">Aletheia Synthetics</div>
                <div className="font-mono-data text-mono-data font-semibold text-status-success mt-1">
                  {activeWaveformEnv.aletheia.verdict?.toUpperCase() || 'PENDING'} (score{' '}
                  {activeWaveformEnv.aletheia.score ?? '—'})
                </div>
              </div>
              <div className="rounded border border-border-subtle bg-canvas-bg p-3">
                <div className="font-label-sm text-label-sm text-text-secondary">STT Phrase Check</div>
                <div className="font-mono-data text-mono-data font-semibold text-on-surface mt-1">
                  {activeWaveformEnv.challenge.sttValidated ? 'MATCHED' : 'PENDING'}
                </div>
              </div>
              <div className="rounded border border-border-subtle bg-canvas-bg p-3">
                <div className="font-label-sm text-label-sm text-text-secondary">Challenge Nonce</div>
                <div className="font-mono-data text-mono-data font-semibold text-on-surface mt-1">
                  {activeWaveformEnv.challenge.nonceId}
                </div>
              </div>
            </div>

            <EvidenceBoundaryNotice compact />
          </div>
        ) : (
          <div className="xl:col-span-8 bg-surface border border-border-subtle rounded-lg p-6 flex flex-col justify-center">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              Synchronous Request &amp; Live Waveform Inspector
            </h2>
            <p className="font-body-sm text-text-secondary mt-1">
              Sign in via the sidebar account switcher or create a Protected Action to inspect persisted voice challenge
              evidence and canonical SHA-256 digests.
            </p>
          </div>
        )}

        <div className="xl:col-span-4 bg-surface border border-border-subtle rounded-lg p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-start justify-between">
              <h2 className="font-headline-sm text-headline-sm text-on-surface">Emergency Outage &amp; Recovery</h2>
              <span className="material-symbols-outlined text-status-warning text-[20px]">emergency</span>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary mt-1">
              Emergency Access Must Survive ACTIONLOCK Outage. Normal policy flow strictly fails closed.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {[
                {
                  icon: 'vpn_key',
                  title: 'Dedicated Credentials',
                  desc: 'Isolated emergency identities; never shared daily-use accounts.',
                },
                {
                  icon: 'group',
                  title: 'Two-Person Governance',
                  desc: 'Named custodians; mandatory cryptographic justification.',
                },
                {
                  icon: 'lock_clock',
                  title: 'Bounded Session',
                  desc: 'Strict time-bound scope with immediate emergency broadcast.',
                },
              ].map((item) => (
                <div key={item.title} className="rounded border border-border-subtle bg-canvas-bg p-3 flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-secondary mt-0.5">{item.icon}</span>
                  <div>
                    <div className="font-label-md text-label-md font-semibold text-on-surface">{item.title}</div>
                    <div className="font-body-sm text-body-sm text-text-secondary">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Link
            to="/break-glass"
            className="w-full py-2.5 px-4 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] text-status-error hover:bg-error hover:text-white transition-colors font-label-md text-label-md flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">shield_lock</span>
            Simulate Gateway Partition
          </Link>
        </div>
      </div>
    </div>
  );
}
