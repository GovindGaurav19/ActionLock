import { useEffect, useRef, useState } from 'react';
import { useActionLock } from '@/app/providers/ActionLockContext';

export function IntegrationsWebhookPage({ focusWebhooks = false }: { focusWebhooks?: boolean }) {
  const { mode, dashboardSummary, integrations, webhooks, liveHealthNote, checkLiveIntegrations, notify } = useActionLock();
  const [whSearch, setWhSearch] = useState('');
  const [whFilter, setWhFilter] = useState<'ALL' | 'PROCESSED' | 'RETRYING' | 'FAILED'>('ALL');
  const [selectedWhId, setSelectedWhId] = useState(webhooks[0]?.eventId || '');
  const webhookSectionRef = useRef<HTMLDivElement>(null);

  const healthyAdapters = integrations.filter((i) => i.status === 'CONNECTED' || i.status === 'ENFORCED').length;
  const whTotal = mode === 'live' && dashboardSummary ? dashboardSummary.webhooks.totalCount : webhooks.length;
  const whVerifiedPct =
    mode === 'live' && dashboardSummary
      ? `${dashboardSummary.webhooks.verifiedRatePct}%`
      : webhooks.length
        ? `${((webhooks.filter((w) => w.hmacStatus === 'VERIFIED').length / webhooks.length) * 100).toFixed(1)}%`
        : '100%';
  const whFailedCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.webhooks.failedCount
      : webhooks.filter((w) => w.status === 'FAILED').length;
  const whPendingCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.webhooks.pendingCount
      : webhooks.filter((w) => w.status === 'RETRYING').length;

  useEffect(() => {
    if (focusWebhooks) {
      webhookSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [focusWebhooks]);

  const filteredWebhooks = webhooks.filter((w) => {
    if (whFilter !== 'ALL' && w.status !== whFilter) return false;
    const q = whSearch.trim().toLowerCase();
    return !q || w.eventId.toLowerCase().includes(q) || w.relatedActionId.toLowerCase().includes(q) || w.eventType.toLowerCase().includes(q);
  });

  const activeWh = filteredWebhooks.find((w) => w.eventId === selectedWhId) || filteredWebhooks[0] || webhooks[0];

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="text-[12px] text-text-secondary mb-1">
            INTEGRATIONS &amp; WEBHOOK MONITOR / Enclave Adapters &amp; Event Bus ·{' '}
            <span className="font-mono-badge text-secondary">
              {mode === 'demo' ? 'DEMO ENVIRONMENT · FIXTURES' : 'LIVE BACKEND MODE'}
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Integrations &amp; Webhook Monitor</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-0.5">
            Backend-validated external adapters, DetectifAI API health, and normalized webhook delivery telemetry.
          </p>
          {liveHealthNote && (
            <p className="font-mono-data text-[12px] text-status-warning mt-1">{liveHealthNote}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => notify('Webhook HMAC signing key rotation scheduled in backend enclave.', 'info')}
            className="px-3 py-2 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md"
          >
            Rotate Webhook Secrets
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode === 'live') void checkLiveIntegrations();
              else notify('All demo enclave adapters passed synthetic health check.', 'success');
            }}
            className="px-3.5 py-2 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">verified_user</span>
            Test Adapter Health
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm text-label-sm uppercase text-text-secondary">Connected Adapters</div>
          <div className="font-headline-xl text-headline-xl mt-2 tabular-nums">
            {healthyAdapters}/{integrations.length}
          </div>
          <div className="font-mono-badge text-[10px] text-status-success mt-1">
            {mode === 'live' ? 'LIVE CONFIGURED ADAPTERS' : 'DEMO ADAPTER FIXTURES'}
          </div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm text-label-sm uppercase text-text-secondary">HMAC-SHA256 Verified</div>
          <div className="font-headline-xl text-headline-xl mt-2 tabular-nums">{whVerifiedPct}</div>
          <div className="font-mono-badge text-[10px] text-text-secondary mt-1">{whTotal} RECORDED EVENTS</div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm text-label-sm uppercase text-text-secondary">Pending / Retrying</div>
          <div className="font-headline-xl text-headline-xl mt-2 tabular-nums">{whPendingCount}</div>
          <div className="font-mono-badge text-[10px] text-secondary mt-1">ASYNC QUEUE RECONCILIATION</div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="font-label-sm text-label-sm uppercase text-text-secondary">Replay Window Guard</div>
          <div className="font-headline-xl text-headline-xl mt-2 tabular-nums">±300s</div>
          <div className="font-mono-badge text-[10px] text-status-warning mt-1">{whFailedCount} FAILED DELIVERIES</div>
        </div>
      </div>

      {/* 01 Integration Adapters */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-headline-sm text-headline-sm">
            <span className="font-mono-data text-secondary mr-2">01</span>Integration Adapters
          </h2>
          <span className="font-body-sm text-text-secondary">All credentials isolated in backend enclave secret manager</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {integrations.map((adp) => (
            <div key={adp.id} className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-lg bg-[#f0fdfa] border border-border-subtle flex items-center justify-center text-secondary">
                      <span className="material-symbols-outlined text-[18px]">{adp.icon}</span>
                    </span>
                    <div>
                      <div className="font-label-md font-semibold text-on-surface">{adp.name}</div>
                      <div
                        className={`font-mono-badge text-[10px] ${
                          adp.status === 'ERROR' || adp.status === 'DISCONNECTED'
                            ? 'text-status-error'
                            : adp.status === 'SANDBOX'
                              ? 'text-status-warning'
                              : 'text-status-success'
                        }`}
                      >
                        {adp.subtitle}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full mt-1 ${
                      adp.status === 'ERROR' || adp.status === 'DISCONNECTED'
                        ? 'bg-status-error'
                        : adp.status === 'SANDBOX'
                          ? 'bg-status-warning'
                          : 'bg-status-success'
                    }`}
                  />
                </div>

                <div className="mt-3 pt-3 border-t border-border-subtle flex flex-col gap-1.5 text-[12px]">
                  {adp.rows.map((r) => (
                    <div key={r.label} className="flex items-start justify-between gap-2">
                      <span className="text-text-secondary shrink-0">{r.label}</span>
                      <span className="font-mono-data text-on-surface text-right">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded border border-border-subtle bg-[#f8fafc] p-2.5 text-[11px] text-text-secondary">
                {adp.note}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 02 Normalized Webhook Monitor */}
      <div ref={webhookSectionRef} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-headline-sm text-headline-sm">
            <span className="font-mono-data text-secondary mr-2">02</span>Normalized Webhook Monitor
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={whSearch}
              onChange={(e) => setWhSearch(e.target.value)}
              placeholder="Search Event ID or Action ID..."
              className="h-8 px-3 rounded border border-border-subtle bg-surface font-body-sm"
            />
            <div className="flex rounded border border-border-subtle bg-surface p-0.5">
              {(
                [
                  ['ALL', 'All Events'],
                  ['PROCESSED', 'Validated'],
                  ['RETRYING', 'Pending'],
                  ['FAILED', 'Failed / Retry'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWhFilter(k)}
                  className={`px-2.5 py-1 rounded font-label-sm ${
                    whFilter === k ? 'bg-primary-container text-white' : 'text-text-secondary'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          <div className="xl:col-span-7 bg-surface border border-border-subtle rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-label-sm uppercase text-text-secondary">
                  <th className="py-2.5 px-3.5">Event ID</th>
                  <th className="py-2.5 px-3.5">Event Type</th>
                  <th className="py-2.5 px-3.5">Related Action</th>
                  <th className="py-2.5 px-3.5">Source</th>
                  <th className="py-2.5 px-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-[12px]">
                {filteredWebhooks.map((w) => (
                  <tr
                    key={w.eventId}
                    onClick={() => setSelectedWhId(w.eventId)}
                    className={`cursor-pointer ${
                      activeWh?.eventId === w.eventId ? 'bg-surface-container-low/70' : 'hover:bg-[#f8fafc]'
                    }`}
                  >
                    <td className="py-3 px-3.5 font-mono-data">{w.eventId}</td>
                    <td className="py-3 px-3.5 font-mono-data">{w.eventType}</td>
                    <td className="py-3 px-3.5 font-mono-data text-secondary underline">{w.relatedActionId}</td>
                    <td className="py-3 px-3.5">{w.source}</td>
                    <td className="py-3 px-3.5">
                      <span
                        className={`font-mono-badge text-[10px] px-2 py-0.5 rounded ${
                          w.status === 'PROCESSED'
                            ? 'bg-[#ecfdf5] text-status-success'
                            : w.status === 'RETRYING'
                              ? 'bg-[#fffbeb] text-status-warning'
                              : 'bg-[#fef2f2] text-status-error'
                        }`}
                      >
                        {w.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeWh && (
            <div className="xl:col-span-5 bg-surface border border-border-subtle rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono-badge text-[10px] text-text-secondary">WEBHOOK PAYLOAD &amp; SIGNATURE INSPECTOR</div>
                  <div className="font-mono-data font-semibold text-on-surface">{activeWh.eventId}</div>
                </div>
                <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-canvas-bg border border-border-subtle">
                  {activeWh.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] rounded border border-border-subtle bg-[#f8fafc] p-2.5">
                <div>
                  <div className="text-text-secondary">HMAC-SHA256</div>
                  <div className={`font-mono-badge ${activeWh.hmacStatus === 'VERIFIED' ? 'text-status-success' : 'text-status-error'}`}>
                    {activeWh.hmacStatus}
                  </div>
                </div>
                <div>
                  <div className="text-text-secondary">Timestamp Window</div>
                  <div className="font-mono-data">{activeWh.timestampSkew}</div>
                </div>
                <div>
                  <div className="text-text-secondary">Idempotency Key</div>
                  <div className="font-mono-data truncate">{activeWh.idempotencyKey}</div>
                </div>
              </div>

              <pre className="rounded-lg bg-[#0d1826] text-[#d4e3ff] p-3.5 font-mono-data text-[11px] overflow-x-auto">
                {JSON.stringify(activeWh.payload, null, 2)}
              </pre>

              <div className="rounded border border-border-subtle bg-surface-container-low/50 p-2.5 text-[12px] text-text-secondary flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-secondary">verified_user</span>
                Frontend never trusts raw webhooks directly; all events are backend-normalized.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
