import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { EvidenceBoundaryNotice } from '@/components/common/EvidenceBoundaryNotice';
import { PolicyStateBadge, RiskTierBadge } from '@/components/common/StatusBadge';
import type { ActionCategory, RiskTier } from '@/types/actionlock';

type QueueTab = 'all' | 'awaiting' | 'voice' | 'hold' | 'step_up' | 'authorized';

export function ActionInboxPage() {
  const navigate = useNavigate();
  const {
    mode,
    dashboardSummary,
    refreshLiveData,
    envelopes,
    selectedEnvelopeId,
    setSelectedEnvelopeId,
    authorizeEnvelope,
    rejectEnvelope,
    notify,
  } = useActionLock();

  const [tab, setTab] = useState<QueueTab>('all');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ActionCategory>('ALL');
  const [riskFilter, setRiskFilter] = useState<'ALL' | RiskTier>('ALL');
  const [showRawJson, setShowRawJson] = useState(false);

  const filtered = useMemo(() => {
    return envelopes.filter((e) => {
      if (tab === 'awaiting' && !['AWAITING_APPROVER', 'CHALLENGE_ISSUED', 'STEP_UP_PENDING', 'VOICE_STAGE_PASSED'].includes(e.state)) return false;
      if (tab === 'voice' && !['CHALLENGE_ISSUED', 'RECORDING', 'VERIFICATION_PENDING'].includes(e.state)) return false;
      if (tab === 'hold' && !['ON_HOLD', 'ACTION_CHANGED', 'INTEGRATION_ERROR'].includes(e.state)) return false;
      if (tab === 'step_up' && !['VOICE_STAGE_PASSED', 'STEP_UP_PENDING', 'PEER_APPROVAL_PENDING'].includes(e.state)) return false;
      if (tab === 'authorized' && e.state !== 'AUTHORIZED') return false;

      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
      if (riskFilter !== 'ALL' && e.riskTier !== riskFilter) return false;
      const q = search.trim().toLowerCase();
      if (
        q &&
        !e.id.toLowerCase().includes(q) &&
        !e.targetTitle.toLowerCase().includes(q) &&
        !e.requester.toLowerCase().includes(q) &&
        !e.actionHash.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [envelopes, tab, categoryFilter, riskFilter, search]);

  const activeEnv = filtered.find((e) => e.id === selectedEnvelopeId) || filtered[0] || envelopes[0];
  const awaitingCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.envelopes.activeCount
      : envelopes.filter((e) => e.state !== 'AUTHORIZED' && e.state !== 'REJECTED').length;
  const passRateDisplay =
    mode === 'live'
      ? dashboardSummary?.verifications.passRatePct !== null && dashboardSummary?.verifications.passRatePct !== undefined
        ? `${dashboardSummary.verifications.passRatePct}%`
        : '—'
      : '99.1%';
  const fakeFlaggedCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.verifications.syntheticFlaggedCount
      : envelopes.filter((e) => e.aletheia.verdict === 'fake').length;
  const driftBlockedCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.interceptions.hashDriftBlocked
      : envelopes.filter((e) => e.hashDriftDetected).length;
  const permitsMintedCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.tokens.mintedCount
      : envelopes.filter((e) => e.jtiConsumed || e.state === 'AUTHORIZED').length;

  const exportSignedLedger = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `action-inbox-ledger-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Signed Action Inbox ledger exported.', 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-headline-lg text-headline-lg text-on-surface">Action Inbox</h1>
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-primary-container text-white">
              GATEWAY · V2.1-PROD
            </span>
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#f0fdfa] border border-[rgba(22,124,128,0.25)] text-secondary">
              ● EIDOS ENGINE ONLINE
            </span>
          </div>
          <p className="font-body-md text-body-md text-text-secondary mt-0.5">
            Review, filter, and audit real-time cryptographic Action Envelopes across DevSecOps, Financial Operations, and
            Privileged IT Recovery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (mode === 'live') {
                void refreshLiveData().then(() => notify('Action Inbox synced with backend SQLite store.', 'info'));
              } else {
                notify('Action Inbox queue synchronized with canonical envelope store.', 'info');
              }
            }}
            className="px-3 py-1.5 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh Queue
          </button>
          <button
            type="button"
            onClick={exportSignedLedger}
            className="px-3 py-1.5 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Export Signed Ledger
          </button>
          <button
            type="button"
            onClick={() => navigate('/approvals')}
            className="px-3.5 py-1.5 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">verified_user</span>
            Step-Up Queue ({envelopes.filter((e) => e.state !== 'AUTHORIZED' && e.state !== 'REJECTED').length})
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>Awaiting Action</span>
            <span className="material-symbols-outlined text-[18px] text-status-warning">pending_actions</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">{awaitingCount}</span>
            <span className="font-body-sm text-status-warning font-medium">Critical Path</span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-text-secondary">
            <span>Selected Envelope:</span>
            <span className="font-mono-data text-status-error">{activeEnv ? activeEnv.id : 'None'}</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>Voice Biometric Pass Rate</span>
            <span className="material-symbols-outlined text-[18px] text-secondary">record_voice_over</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">{passRateDisplay}</span>
            <span className="font-body-sm text-status-success font-medium">{fakeFlaggedCount} Fake Flagged</span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-text-secondary">
            <span>Evidence Boundary:</span>
            <span className="font-mono-data text-status-success">Corroborative AI</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>Policy Hash Drift Blocked</span>
            <span className="material-symbols-outlined text-[18px] text-status-error">gpp_bad</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">{driftBlockedCount}</span>
            <span className="font-body-sm text-status-error font-medium">Payload Tamper</span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-text-secondary">
            <span>Lockdown Mode:</span>
            <span className="font-mono-data text-status-error">Fail-Closed HOLD</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>Scoped Permits Minted</span>
            <span className="material-symbols-outlined text-[18px] text-status-success">token</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl text-on-surface tabular-nums">{permitsMintedCount}</span>
            <span className="font-body-sm text-secondary font-medium">Single-Use JTI</span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-text-secondary">
            <span>Permit Binding:</span>
            <span className="font-mono-data text-on-surface">SHA-256 + 180s TTL</span>
          </div>
        </div>
      </div>

      {/* Queue Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle pb-2.5">
        {(
          [
            ['all', `All Requests (${envelopes.length})`],
            ['awaiting', 'Awaiting My Approval'],
            ['voice', 'Voice Verification Pending'],
            ['hold', 'On HOLD'],
            ['step_up', 'Step-Up / WebAuthn Pending'],
            ['authorized', 'Authorized'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded font-label-md text-label-md transition-colors ${
              tab === key
                ? 'bg-primary-container text-white'
                : 'bg-surface border border-border-subtle text-text-secondary hover:text-on-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-surface border border-border-subtle rounded-lg p-2.5 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[220px]">
          <span className="material-symbols-outlined text-[18px] text-text-secondary absolute left-2.5 top-2">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
            placeholder="Filter by Envelope ID, commit SHA, requester..."
            className="w-full h-9 pl-8 pr-20 rounded border border-border-subtle bg-canvas-bg font-body-sm text-on-surface focus:outline-none focus:border-secondary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1.5 font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-text-secondary"
            >
              ESC clear
            </button>
          )}
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | ActionCategory)}
          className="h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm text-on-surface"
        >
          <option value="ALL">All Categories</option>
          <option value="DevSecOps">DevSecOps</option>
          <option value="Financial">Financial</option>
          <option value="IAM">IAM</option>
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value as 'ALL' | RiskTier)}
          className="h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm text-on-surface"
        >
          <option value="ALL">All Risk Tiers</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="ELEVATED">ELEVATED</option>
        </select>
      </div>

      {/* 7:5 Split Inbox Table + Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 bg-surface border border-border-subtle rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-[#f8fafc] border-b border-border-subtle flex items-center justify-between font-mono-badge text-[11px] text-text-secondary">
            <span>ACTIVE ENVELOPES · {filtered.length} RECORDS SHOWN</span>
            <span className="text-status-success flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
              STREAM: WS-TLS-AUTH
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-label-sm uppercase text-text-secondary">
                  <th className="py-2.5 px-3.5">Envelope ID / Hash</th>
                  <th className="py-2.5 px-3.5">Target &amp; Operation</th>
                  <th className="py-2.5 px-3.5">Requester &amp; Quorum</th>
                  <th className="py-2.5 px-3.5">Risk Tier</th>
                  <th className="py-2.5 px-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filtered.map((env) => {
                  const selected = env.id === activeEnv.id;
                  return (
                    <tr
                      key={env.id}
                      onClick={() => setSelectedEnvelopeId(env.id)}
                      className={`cursor-pointer transition-colors ${
                        selected ? 'bg-surface-container-low/80' : 'hover:bg-[#f8fafc]'
                      }`}
                    >
                      <td className="py-3 px-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono-data text-mono-data font-semibold text-secondary">{env.id}</span>
                          <span className="font-mono-badge text-[9px] px-1.5 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                            {env.hashDriftDetected ? 'DRIFT' : env.version}
                          </span>
                        </div>
                        <div
                          className={`font-mono-data text-[11px] text-text-secondary truncate max-w-[140px] ${
                            env.hashDriftDetected ? 'line-through text-status-error' : ''
                          }`}
                        >
                          {env.actionHash}
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-label-md text-label-md font-medium text-on-surface">{env.targetTitle}</div>
                        <div className="font-mono-data text-[11px] text-text-secondary">{env.targetSubtitle}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-primary-container text-white flex items-center justify-center font-mono-badge text-[10px]">
                            {env.requesterInitials}
                          </span>
                          <div>
                            <div className="font-body-sm text-body-sm font-medium text-on-surface">{env.requester}</div>
                            <div className="font-body-sm text-[11px] text-text-secondary">{env.requesterRole}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <RiskTierBadge tier={env.riskTier} />
                      </td>
                      <td className="py-3 px-3.5">
                        <PolicyStateBadge state={env.state} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 bg-[#f8fafc] border-t border-border-subtle flex items-center justify-between font-body-sm text-[12px] text-text-secondary">
            <span>Showing 1-{filtered.length} of {envelopes.length} Envelopes · REALTIME IDLE</span>
            <button
              type="button"
              onClick={() => navigate('/approvals')}
              className="font-label-sm text-secondary hover:underline"
            >
              Open Full Step-Up Workspace →
            </button>
          </div>
        </div>

        {/* Right Cryptographic Envelope Inspector */}
        {activeEnv ? (
          <div className="xl:col-span-5 bg-surface border border-border-subtle rounded-lg p-4 flex flex-col gap-3.5">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-border-subtle">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-headline-sm text-headline-sm text-on-surface">Cryptographic Envelope Inspector</h2>
                <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                  {activeEnv.id}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-text-secondary mt-0.5">
                Immutable canonical field order &amp; SHA-256 verification hash
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRawJson((v) => !v)}
              className="px-2.5 py-1 rounded border border-border-subtle bg-canvas-bg font-mono-badge text-[10px] text-on-surface hover:border-secondary"
            >
              {showRawJson ? 'FIELDS' : '<> RAW JSON'}
            </button>
          </div>

          <div className="rounded border border-border-subtle bg-canvas-bg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-label-sm text-label-sm uppercase text-text-secondary">Digest Signature Status</span>
              <span
                className={`font-mono-badge text-[10px] ${
                  activeEnv.hashDriftDetected ? 'text-status-error' : 'text-status-success'
                }`}
              >
                {activeEnv.hashDriftDetected ? '✕ HASH DRIFT DETECTED' : '✓ HASH MATCH (0 DRIFT)'}
              </span>
            </div>
            <div className="font-mono-data text-[11px] bg-surface border border-border-subtle rounded p-2 break-all text-on-surface">
              sha256(canonical) = {activeEnv.actionHash.replace('sha256:', '')}
            </div>
          </div>

          {/* DetectifAI Dual Engine Evidence (Strictly Separate) */}
          <div className="rounded border border-border-subtle bg-surface p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="font-label-md text-label-md font-semibold text-on-surface">DetectifAI Voice Analysis</span>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                SYNCHRONOUS
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded border border-border-subtle bg-[#f8fafc] p-2.5">
                <div className="font-mono-badge text-[10px] text-text-secondary">EIDOS SPEAKER MATCH</div>
                <div className="font-label-md text-label-md font-semibold text-on-surface mt-1">
                  {activeEnv.eidos.decision === 'match'
                    ? 'MATCH CONFIRMED'
                    : activeEnv.eidos.decision === 'no_match'
                      ? 'NO MATCH'
                      : 'PENDING'}
                </div>
                <div className="font-mono-data text-[11px] text-text-secondary mt-0.5">
                  Ref {activeEnv.eidos.speakerId} · sim {activeEnv.eidos.similarity ?? '—'}
                </div>
              </div>
              <div className="rounded border border-border-subtle bg-[#f8fafc] p-2.5">
                <div className="font-mono-badge text-[10px] text-text-secondary">ALETHEIA DEEPFAKE SCORE</div>
                <div
                  className={`font-label-md text-label-md font-semibold mt-1 ${
                    activeEnv.aletheia.verdict === 'fake' ? 'text-status-error' : 'text-status-success'
                  }`}
                >
                  {activeEnv.aletheia.verdict ? `${activeEnv.aletheia.verdict.toUpperCase()} (${activeEnv.aletheia.score})` : 'PENDING'}
                </div>
                <div className="font-mono-data text-[11px] text-text-secondary mt-0.5">
                  Threshold &lt; {activeEnv.aletheia.threshold ?? 0.2} required
                </div>
              </div>
            </div>
            <div className="rounded border border-border-subtle bg-canvas-bg p-2.5 font-body-sm text-[12px] italic text-on-surface">
              &ldquo;{activeEnv.challenge.phrase}&rdquo;
            </div>
            <EvidenceBoundaryNotice compact />
          </div>

          {showRawJson ? (
            <pre className="rounded bg-[#0d1826] text-[#d4e3ff] p-3 font-mono-data text-[11px] overflow-x-auto max-h-60">
              {JSON.stringify(
                {
                  action_id: activeEnv.actionId,
                  org_id: activeEnv.orgId,
                  requester_sub: activeEnv.requester,
                  claimed_approver: activeEnv.claimedApprover,
                  single_use_jti: activeEnv.singleUseJti,
                  state: activeEnv.state,
                  details: activeEnv.details,
                },
                null,
                2,
              )}
            </pre>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="font-label-sm text-label-sm uppercase text-text-secondary">Immutable Canonical Fields</div>
              {[
                ['action_id', activeEnv.actionId],
                ['org_id / tenant', activeEnv.orgId],
                ['requester_sub', activeEnv.requester],
                ['claimed_approver', activeEnv.claimedApprover],
                ['policy_id', activeEnv.policyId],
                ['single_use_jti', activeEnv.singleUseJti],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[12px] py-1 border-b border-border-subtle/70">
                  <span className="font-mono-data text-text-secondary">{k}</span>
                  <span className="font-mono-data text-on-surface font-medium truncate max-w-[230px]">{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Quorum Enforcement Footer */}
          <div className="rounded-lg bg-primary-container text-white p-3.5">
            <div className="flex items-center gap-1.5 font-label-md text-label-md font-semibold">
              <span className="material-symbols-outlined text-secondary-fixed text-[16px]">shield_lock</span>
              Quorum Policy Enforcement
            </div>
            <p className="font-body-sm text-[12px] text-primary-fixed-dim mt-1">{activeEnv.policySummary}</p>
            <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[#263f61] font-mono-data text-[11px]">
              <span>Passkey Quorum:</span>
              <span className="text-secondary-fixed">
                {activeEnv.passkey.status === 'verified' ? '1/1 Signed' : '0/1 Signed'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (activeEnv.passkey.status !== 'verified') {
                  navigate('/webauthn-permit');
                } else {
                  void authorizeEnvelope(activeEnv.id);
                }
              }}
              className="flex-1 py-2 px-3 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md transition-colors"
            >
              {activeEnv.passkey.status === 'verified'
                ? 'Authorize & Mint Scoped Permit'
                : 'Proceed to WebAuthn Step-Up'}
            </button>
            <button
              type="button"
              onClick={() => void rejectEnvelope(activeEnv.id)}
              className="py-2 px-4 rounded border border-border-subtle bg-surface hover:bg-[#fef2f2] hover:text-status-error font-label-md text-label-md transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
        ) : (
          <div className="xl:col-span-5 bg-surface border border-border-subtle rounded-lg p-6 text-text-secondary text-[13px]">
            No Action Envelopes available in the current view. Sign in or create a new Protected Action to inspect its canonical SHA-256 digest.
          </div>
        )}
      </div>
    </div>
  );
}
