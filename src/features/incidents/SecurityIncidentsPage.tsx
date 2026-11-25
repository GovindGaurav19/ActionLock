import { useState } from 'react';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { EvidenceBoundaryNotice } from '@/components/common/EvidenceBoundaryNotice';

export function SecurityIncidentsPage() {
  const { mode, dashboardSummary, refreshLiveData, incidents, updateIncidentStatus, notify } = useActionLock();
  const [filterTab, setFilterTab] = useState<'ALL' | 'SEV1' | 'QUARANTINED'>('ALL');
  const [selectedId, setSelectedId] = useState(incidents[0]?.id || '');

  const filtered = incidents.filter((inc) => {
    if (filterTab === 'SEV1') return inc.severity === 'SEV-1 CRITICAL';
    if (filterTab === 'QUARANTINED') return inc.status.includes('QUARANTINED');
    return true;
  });

  const active = filtered.find((i) => i.id === selectedId) || filtered[0] || incidents[0];
  const openCount = incidents.filter((i) => i.status !== 'RESOLVED').length;
  const criticalCount = incidents.filter((i) => i.severity === 'SEV-1 CRITICAL').length;
  const spoofCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.interceptions.syntheticBlocked
      : incidents.filter((i) => i.aletheiaVerdict === 'FAKE').length;
  const driftCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.interceptions.hashDriftBlocked
      : incidents.filter((i) => i.title.toLowerCase().includes('drift') || i.title.toLowerCase().includes('mutation')).length;

  const exportDigest = () => {
    const blob = new Blob([JSON.stringify(incidents, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soc-incident-digest-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('SOC forensic digest exported.', 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1 font-mono-badge text-[10px]">
            <span className="px-2 py-0.5 rounded bg-[#fef2f2] border border-[rgba(181,71,71,0.25)] text-status-error">
              SOC TRIAGE ACTIVE
            </span>
            <span className="text-text-secondary">US-EAST-1 · FAIL-CLOSED GATEWAY</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Security Incidents &amp; Threat Triage</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-0.5">
            Analyst workspace for investigating synthetic voice spoofing attempts, action hash drift, and policy
            quarantine events.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (mode === 'live') {
                void refreshLiveData().then(() => notify('Security incidents synced from backend SQLite store.', 'info'));
              } else {
                notify('SOC telemetry synchronized with demo fixtures.', 'info');
              }
            }}
            className="px-3.5 py-2 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md"
          >
            Sync Telemetry
          </button>
          <button
            type="button"
            onClick={exportDigest}
            className="px-3.5 py-2 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Export SOC Digest
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="font-label-sm uppercase text-text-secondary">Open Incidents</span>
            <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-[#fef2f2] text-status-error">
              {criticalCount} CRITICAL
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">{openCount}</span>
            <span className="text-[12px] text-status-error">{incidents.length} total logged</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="font-label-sm uppercase text-text-secondary">Deepfake Spoofs Blocked</span>
            <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-[#f0fdfa] text-secondary">
              FAIL-CLOSED HOLD
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">{spoofCount}</span>
            <span className="text-[12px] text-secondary">Aletheia verdict=fake</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="font-label-sm uppercase text-text-secondary">Hash Drift Interceptions</span>
            <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-canvas-bg text-on-surface">
              SHA-256
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">{driftCount}</span>
            <span className="text-[12px] text-status-warning">Post-issuance mutations</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="font-label-sm uppercase text-text-secondary">Enforcement Mode</span>
            <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-[#f0f3ff] text-secondary">
              DETERMINISTIC
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-headline-md text-headline-md">HOLD on Anomaly</span>
            <span className="text-[12px] text-status-success">{mode === 'live' ? 'Persisted' : 'Fixtures'}</span>
          </div>
        </div>
      </div>

      {/* Split Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-7 bg-surface border border-border-subtle rounded-lg overflow-hidden">
          <div className="px-4 py-3.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-headline-sm text-headline-sm">Active Security Incidents</h2>
            <div className="flex gap-1">
              {(
                [
                  ['ALL', `All (${incidents.length})`],
                  ['SEV1', 'SEV-1 Critical'],
                  ['QUARANTINED', 'Quarantined'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilterTab(k)}
                  className={`px-2.5 py-1 rounded font-label-sm text-[11px] ${
                    filterTab === k ? 'bg-primary-container text-white' : 'bg-canvas-bg text-text-secondary'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-[11px] uppercase text-text-secondary">
                  <th className="py-2.5 px-4">Incident ID</th>
                  <th className="py-2.5 px-4">Severity</th>
                  <th className="py-2.5 px-4">Threat &amp; Target</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filtered.map((inc) => (
                  <tr
                    key={inc.id}
                    onClick={() => setSelectedId(inc.id)}
                    className={`cursor-pointer ${
                      active?.id === inc.id ? 'bg-surface-container-low/80' : 'hover:bg-[#f8fafc]'
                    }`}
                  >
                    <td className="py-3.5 px-4 font-mono-data font-medium text-on-surface">{inc.id}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`font-mono-badge text-[10px] px-2 py-0.5 rounded ${
                          inc.severity === 'SEV-1 CRITICAL'
                            ? 'bg-[#fef2f2] text-status-error'
                            : 'bg-[#fffbeb] text-status-warning'
                        }`}
                      >
                        {inc.severity}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-on-surface">{inc.title}</div>
                      <div className="font-mono-data text-[11px] text-text-secondary">
                        Target: {inc.target} ({inc.envelopeId})
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#fef2f2] text-status-error">
                        {inc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {active && (
          <div className="xl:col-span-5 bg-surface border border-border-subtle rounded-lg overflow-hidden">
            <div className="bg-primary-container text-white p-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono-badge text-[11px] text-primary-fixed">{active.id}</span>
                  <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-error text-white">
                    {active.severity}
                  </span>
                </div>
                <h2 className="font-headline-sm text-white mt-1">Incident Investigation &amp; Escalation</h2>
              </div>
              <span className="material-symbols-outlined text-primary-fixed">shield_lock</span>
            </div>

            <div className="p-4 flex flex-col gap-3.5">
              <div className="rounded-lg border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono-badge text-[10px] text-status-error">ACTION ENVELOPE LOCK STATUS</div>
                  <div className="font-mono-data text-[12px] text-on-surface mt-0.5">
                    {active.envelopeId} · {active.target}
                  </div>
                </div>
                <span className="font-mono-badge text-[10px] px-2 py-1 rounded bg-white border border-[rgba(181,71,71,0.3)] text-status-error">
                  FAIL-CLOSED HOLD
                </span>
              </div>

              <div className="rounded-lg border border-border-subtle bg-[#f8fafc] p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono-badge text-[10px]">
                  <span className="text-text-secondary">FORENSIC EVIDENCE SUMMARY</span>
                  <span className="text-secondary">DETECTIFAI ENGINE</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-text-secondary">Aletheia Synthetic Score</span>
                  <span className="font-mono-badge px-2 py-0.5 rounded bg-[#fef2f2] text-status-error">
                    {active.aletheiaScore} {active.aletheiaVerdict}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className={`h-full ${active.aletheiaVerdict === 'FAKE' ? 'bg-status-error' : 'bg-status-success'}`}
                    style={{ width: `${Math.max(5, active.aletheiaScore * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[12px] pt-1">
                  <span className="text-text-secondary">Eidos Speaker Verification</span>
                  <span className="font-mono-data text-on-surface">
                    {active.eidosDecision} (sim {active.eidosSimilarity})
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-text-secondary">Claimed Approver</span>
                  <span className="font-mono-data text-on-surface">{active.claimedApprover}</span>
                </div>
              </div>

              <div className="rounded-lg border border-[rgba(181,71,71,0.25)] bg-[#fef2f2] p-3">
                <div className="flex items-center justify-between font-mono-badge text-[10px] text-status-error mb-2">
                  <span>ACOUSTIC SPOOF SPECTRAL ANOMALY</span>
                  <span>{active.anomalyNote}</span>
                </div>
                <svg viewBox="0 0 320 40" className="w-full h-10">
                  <path
                    d="M0 20 Q 40 2, 80 20 T 160 20 T 240 20 T 320 20"
                    fill="none"
                    stroke="#B54747"
                    strokeWidth="2"
                  />
                  <path
                    d="M0 20 Q 40 38, 80 20 T 160 20 T 240 20 T 320 20"
                    fill="none"
                    stroke="#00696D"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                </svg>
              </div>

              <EvidenceBoundaryNotice compact />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void updateIncidentStatus(active.id, 'INVESTIGATING')}
                  className="py-2 px-3 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-[12px]"
                >
                  Escalate to SOC Tier-2
                </button>
                <button
                  type="button"
                  onClick={() => void updateIncidentStatus(active.id, 'BLOCKED')}
                  className="py-2 px-3 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] text-status-error font-label-md text-[12px]"
                >
                  Block &amp; Hold Action
                </button>
              </div>
              <button
                type="button"
                onClick={() => void updateIncidentStatus(active.id, 'RESOLVED')}
                className="w-full py-2 px-3 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-[12px]"
              >
                Resolve Incident (Logged in Audit Chain)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
