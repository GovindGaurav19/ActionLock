import { useState } from 'react';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { RiskTierBadge } from '@/components/common/StatusBadge';
import type { SecurityPolicyRule } from '@/types/actionlock';

export function SecurityPoliciesPage() {
  const { mode, dashboardSummary, refreshLiveData, policies, createPolicyRule, notify } = useActionLock();
  const [categoryTab, setCategoryTab] = useState<'ALL' | SecurityPolicyRule['category']>('ALL');
  const [selectedPolicyId, setSelectedPolicyId] = useState(policies[1]?.id || policies[0]?.id);
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    id: 'SEC-POL-12',
    name: 'Database Snapshot Export',
    category: 'DevSecOps' as SecurityPolicyRule['category'],
    target: 'AWS RDS',
    riskTier: 'CRITICAL' as SecurityPolicyRule['riskTier'],
    voiceCheck: 'Aletheia + Eidos',
    fido2: 'Mandatory' as SecurityPolicyRule['fido2'],
    quorum: '2-of-2 Tier-1',
    nonceTtlSec: 180,
    permitTtlSec: 300,
    sodRule: 'Requester != Approver != Peer Signer',
    voiceRequirements: 'Eidos speaker match + Aletheia anti-spoof, corroborative evidence only.',
    fallbackPath: 'Out-of-band SecOps callback + ticket',
  });

  const filtered = policies.filter((p) => categoryTab === 'ALL' || p.category === categoryTab);
  const activePolicy = filtered.find((p) => p.id === selectedPolicyId) || filtered[0] || policies[0];
  const activePoliciesCount =
    mode === 'live' && dashboardSummary ? dashboardSummary.policies.activeCount : policies.filter((p) => p.status === 'ACTIVE').length;
  const totalPoliciesCount =
    mode === 'live' && dashboardSummary ? dashboardSummary.policies.totalCount : policies.length;

  const exportPolicyBundle = () => {
    const blob = new Blob([JSON.stringify(activePolicy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activePolicy.id.toLowerCase()}-policy.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${activePolicy.id} policy bundle.`, 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
              POLICY ENGINE V4.2
            </span>
            <span className="font-mono-data text-[12px] text-text-secondary">AST_HASH: 9f84a2c1e0b7</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Security Policies</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-0.5">
            Deterministic policy arbitration rules, separation-of-duties (SoD) enforcement, and step-up verification
            thresholds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (mode === 'live') {
                void refreshLiveData().then(() => notify('Synced deterministic policies from backend.', 'success'));
              } else {
                notify('Policy AST verified and synchronized across enclave nodes.', 'success');
              }
            }}
            className="px-3.5 py-2 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">sync</span>
            Sync Policy AST
          </button>
          <button
            type="button"
            onClick={() => setNewRuleOpen(true)}
            className="px-3.5 py-2 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">add_moderator</span>
            New Policy Rule
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm uppercase text-text-secondary">Active Policies</div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">{activePoliciesCount}</span>
            <span className="text-[12px] text-status-success">{totalPoliciesCount} total rules</span>
          </div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm uppercase text-text-secondary">Enforced SoD Rules</div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">100%</span>
            <span className="text-[12px] text-text-secondary">
              {totalPoliciesCount}/{totalPoliciesCount} strict
            </span>
          </div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm uppercase text-text-secondary">Strict Fail-Closed Mode</div>
          <div className="flex items-center gap-2 mt-2.5">
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#f0fdfa] text-secondary">ACTIVE</span>
            <span className="text-[12px] text-text-secondary">Zero-trust default</span>
          </div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm uppercase text-text-secondary">Policy Store Source</div>
          <div className="font-headline-md text-headline-md mt-2">
            {mode === 'live' ? 'Backend SQLite' : 'Demo Fixtures'}
          </div>
        </div>
      </div>

      {/* Split Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Policy Matrix */}
        <div className="xl:col-span-7 bg-surface border border-border-subtle rounded-lg overflow-hidden">
          <div className="px-4 py-3.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-headline-sm text-headline-sm">Policy Matrix</h2>
              <p className="font-body-sm text-text-secondary">
                Select a policy rule to inspect AST constraints and step-up thresholds
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {(['ALL', 'DevSecOps', 'Financial', 'IT Identity', 'Break-Glass'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryTab(cat)}
                  className={`px-2.5 py-1 rounded font-label-sm text-[11px] ${
                    categoryTab === cat
                      ? 'bg-primary-container text-white'
                      : 'bg-canvas-bg text-text-secondary hover:text-on-surface'
                  }`}
                >
                  {cat === 'ALL' ? 'All' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-[11px] uppercase text-text-secondary">
                  <th className="py-2.5 px-3.5">Policy ID</th>
                  <th className="py-2.5 px-3.5">Action Category &amp; Target</th>
                  <th className="py-2.5 px-3.5">Risk Tier</th>
                  <th className="py-2.5 px-3.5">Voice Check</th>
                  <th className="py-2.5 px-3.5">FIDO2</th>
                  <th className="py-2.5 px-3.5">Quorum</th>
                  <th className="py-2.5 px-3.5">TTL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-[13px]">
                {filtered.map((pol) => (
                  <tr
                    key={pol.id}
                    onClick={() => setSelectedPolicyId(pol.id)}
                    className={`cursor-pointer ${
                      activePolicy?.id === pol.id ? 'bg-surface-container-low/80' : 'hover:bg-[#f8fafc]'
                    }`}
                  >
                    <td className="py-3 px-3.5 font-mono-data font-semibold text-secondary">{pol.id}</td>
                    <td className="py-3 px-3.5">
                      <div className="font-medium text-on-surface">{pol.name}</div>
                      <div className="text-[11px] text-text-secondary">
                        {pol.category} · {pol.target}
                      </div>
                    </td>
                    <td className="py-3 px-3.5">
                      <RiskTierBadge tier={pol.riskTier} />
                    </td>
                    <td className="py-3 px-3.5 text-[12px]">{pol.voiceCheck}</td>
                    <td className="py-3 px-3.5 text-[12px] font-medium">{pol.fido2}</td>
                    <td className="py-3 px-3.5 text-[12px]">{pol.quorum}</td>
                    <td className="py-3 px-3.5 font-mono-data text-[11px] text-text-secondary">
                      {pol.nonceTtlSec}s / {pol.permitTtlSec}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Policy Inspector */}
        {activePolicy && (
          <div className="xl:col-span-5 bg-surface border border-border-subtle rounded-lg overflow-hidden">
          <div className="bg-primary-container text-white p-5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono-badge text-[11px] text-primary-fixed">{activePolicy.id}</span>
                <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-secondary text-white">
                  {activePolicy.status}
                </span>
              </div>
              <span className="material-symbols-outlined text-primary-fixed text-[20px]">verified_user</span>
            </div>
            <h2 className="font-headline-md text-headline-md text-white">{activePolicy.name}</h2>
            <p className="font-body-sm text-primary-fixed-dim mt-0.5">
              {activePolicy.target} ({activePolicy.category})
            </p>
          </div>

          <div className="p-5 flex flex-col gap-3.5">
            <div className="rounded border border-border-subtle bg-[#f8fafc] p-3.5">
              <div className="font-label-sm uppercase text-text-secondary mb-1">Separation of Duties (SoD)</div>
              <div className="font-mono-data text-[12px] text-on-surface font-medium">{activePolicy.sodRule}</div>
            </div>

            <div className="rounded border border-border-subtle bg-[#f8fafc] p-3.5">
              <div className="flex items-center justify-between mb-1">
                <span className="font-label-sm uppercase text-text-secondary">Voice Challenge Requirements</span>
                <span className="font-mono-badge text-[10px] text-secondary">CORROBORATIVE</span>
              </div>
              <p className="font-body-sm text-on-surface-variant">{activePolicy.voiceRequirements}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border border-border-subtle bg-[#f8fafc] p-3">
                <div className="font-label-sm uppercase text-text-secondary mb-1">Hardware Step-Up</div>
                <div className="text-[12px] font-medium text-on-surface">
                  Strict FIDO2/WebAuthn resident key ({activePolicy.fido2})
                </div>
              </div>
              <div className="rounded border border-border-subtle bg-[#f8fafc] p-3">
                <div className="font-label-sm uppercase text-text-secondary mb-1">Time Limits</div>
                <div className="font-mono-data text-[12px] text-on-surface">
                  Nonce TTL: {activePolicy.nonceTtlSec}s
                  <br />
                  Permit TTL: {activePolicy.permitTtlSec}s
                </div>
              </div>
            </div>

            <div className="rounded border border-border-subtle bg-[#f8fafc] p-3.5">
              <div className="font-label-sm uppercase text-text-secondary mb-1">Manual Verification Fallback Path</div>
              <div className="text-[12px] text-on-surface">{activePolicy.fallbackPath}</div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => notify(`Opened AST simulation for ${activePolicy.id}: 0 conflicts, strict fail-closed.`, 'success')}
                className="py-2 px-3 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-[12px]"
              >
                Simulate Policy AST
              </button>
              <button
                type="button"
                onClick={exportPolicyBundle}
                className="py-2 px-3 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-[12px]"
              >
                Export Policy Bundle
              </button>
            </div>
          </div>
        </div>
        )}
      </div>

      {newRuleOpen && (
        <div className="fixed inset-0 z-50 bg-[#14243A]/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface rounded-lg border border-border-subtle shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-primary-container text-white flex items-center justify-between">
              <span className="font-headline-sm">Create Deterministic Policy Rule</span>
              <button type="button" onClick={() => setNewRuleOpen(false)}>
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <form
              className="p-5 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                createPolicyRule(ruleForm);
                setSelectedPolicyId(ruleForm.id);
                setNewRuleOpen(false);
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-label-sm text-text-secondary mb-1">Policy ID</label>
                  <input
                    required
                    value={ruleForm.id}
                    onChange={(e) => setRuleForm((f) => ({ ...f, id: e.target.value }))}
                    className="w-full h-9 px-3 rounded border border-border-subtle font-mono-data"
                  />
                </div>
                <div>
                  <label className="block font-label-sm text-text-secondary mb-1">Target</label>
                  <input
                    required
                    value={ruleForm.target}
                    onChange={(e) => setRuleForm((f) => ({ ...f, target: e.target.value }))}
                    className="w-full h-9 px-3 rounded border border-border-subtle"
                  />
                </div>
              </div>
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">Rule Name</label>
                <input
                  required
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full h-9 px-3 rounded border border-border-subtle"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setNewRuleOpen(false)} className="px-3.5 py-2 rounded border border-border-subtle">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded bg-secondary text-white">
                  Activate Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
