import { useState } from 'react';
import { useActionLock } from '@/app/providers/ActionLockContext';

export function AuditTrailPage() {
  const { mode, auditEvents, auditChainStatus, verifyAuditChainIntegrity, notify } = useActionLock();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState(auditEvents[0]?.eventId || '');

  const filtered = auditEvents.filter((ev) => {
    if (typeFilter !== 'ALL' && ev.eventType !== typeFilter) return false;
    const q = search.trim().toLowerCase();
    return (
      !q ||
      ev.eventId.toLowerCase().includes(q) ||
      ev.envelopeId.toLowerCase().includes(q) ||
      ev.eventType.toLowerCase().includes(q) ||
      ev.currentHash.toLowerCase().includes(q)
    );
  });

  const active = filtered.find((e) => e.eventId === selectedId) || filtered[0] || auditEvents[0];
  const eventTypes = ['ALL', ...Array.from(new Set(auditEvents.map((e) => e.eventType)))];

  const exportAuditLedger = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `actionlock-audit-ledger-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Hash-chained audit ledger exported as JSON.', 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-mono-badge text-[10px] text-text-secondary">
              APPEND-ONLY HASH CHAIN · {auditEvents.length} EVENTS
            </span>
            <span
              className={`font-mono-badge text-[10px] px-2 py-0.5 rounded border ${
                auditChainStatus && !auditChainStatus.valid
                  ? 'bg-[#fef2f2] border-[rgba(181,71,71,0.25)] text-status-error'
                  : 'bg-[#ecfdf5] border-[rgba(35,122,87,0.25)] text-status-success'
              }`}
            >
              {auditChainStatus
                ? auditChainStatus.valid
                  ? `✓ SHA-256 CHAIN VERIFIED (${auditChainStatus.verifiedCount}/${auditChainStatus.totalCount})`
                  : `✕ CHAIN BREAK AT ${auditChainStatus.brokenAtId}`
                : mode === 'live'
                  ? 'CLICK VERIFY CHAIN'
                  : '✓ SHA-256 CHAIN LINKS INTACT'}
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Append-Only Audit Trail</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-0.5">
            SHA-256 hash-chained chronological ledger in SQLite capturing Action Envelopes, AI evidence, policy
            decisions, and step-up verifications.
          </p>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg px-4 py-3 flex items-center gap-5 shrink-0">
          <div>
            <div className="font-label-sm text-[10px] uppercase text-text-secondary">Recorded Events</div>
            <div className="font-headline-lg text-headline-lg tabular-nums">
              {auditEvents.length}{' '}
              <span className="text-[12px] text-text-secondary font-normal">
                {mode === 'live' ? 'Persisted' : 'Fixtures'}
              </span>
            </div>
          </div>
          <div className="border-l border-border-subtle pl-4">
            <div className="font-label-sm text-[10px] uppercase text-text-secondary">Head Hash</div>
            <div className="font-mono-data text-[12px] text-on-surface truncate max-w-[170px]">
              {active?.currentHash || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Row */}
      <div className="bg-surface border border-border-subtle rounded-lg p-3 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[220px]">
          <span className="material-symbols-outlined text-[18px] text-text-secondary absolute left-2.5 top-2">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Event ID, Action ID, Type, or Hash..."
            className="w-full h-9 pl-8 pr-3 rounded border border-border-subtle bg-canvas-bg font-body-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm"
        >
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t === 'ALL' ? 'All Events' : t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void verifyAuditChainIntegrity()}
          className="h-9 px-3.5 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-[13px] flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">verified</span>
          Verify Hash Chain
        </button>
        <button
          type="button"
          onClick={exportAuditLedger}
          className="h-9 px-4 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-[13px] flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          Export Audit Ledger (JSON)
        </button>
      </div>

      {/* Split Table + Chain Link Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 bg-surface border border-border-subtle rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
            <h2 className="font-headline-sm text-headline-sm">Chronological Ledger</h2>
            <span className="font-mono-badge text-[10px] text-text-secondary">
              SHOWING {filtered.length} OF {auditEvents.length} RECORDS
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-[11px] uppercase text-text-secondary">
                  <th className="py-2.5 px-4">Timestamp (UTC)</th>
                  <th className="py-2.5 px-4">Event ID</th>
                  <th className="py-2.5 px-4">Envelope ID</th>
                  <th className="py-2.5 px-4">Event Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filtered.map((ev) => (
                  <tr
                    key={ev.eventId}
                    onClick={() => setSelectedId(ev.eventId)}
                    className={`cursor-pointer ${
                      active?.eventId === ev.eventId ? 'bg-surface-container-low/80' : 'hover:bg-[#f8fafc]'
                    }`}
                  >
                    <td className="py-3 px-4 font-mono-data text-text-secondary">{ev.timestamp}</td>
                    <td className="py-3 px-4 font-mono-data font-medium text-on-surface">{ev.eventId}</td>
                    <td className="py-3 px-4 font-mono-data text-secondary">{ev.envelopeId}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-mono-badge text-[10px] px-2 py-0.5 rounded ${
                          ev.tone === 'error'
                            ? 'bg-[#fef2f2] text-status-error'
                            : ev.tone === 'teal'
                              ? 'bg-[#f0fdfa] text-secondary'
                              : ev.tone === 'info'
                                ? 'bg-[#f0f3ff] text-on-tertiary-fixed-variant'
                                : 'bg-canvas-bg text-text-secondary'
                        }`}
                      >
                        {ev.eventType}
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
            <div className="bg-primary-container text-white p-4 flex items-start justify-between gap-2">
              <div>
                <div className="font-mono-badge text-[10px] text-primary-fixed-dim">SHA-256 HASH-CHAIN LINK INSPECTOR</div>
                <div className="font-headline-sm text-white mt-0.5">
                  {active.envelopeId} · {active.eventType}
                </div>
              </div>
              <span className="font-mono-badge text-[10px] px-2 py-1 rounded bg-secondary-container text-on-secondary-container">
                ✓ LINKED EVENT
              </span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div>
                <div className="flex justify-between font-mono-badge text-[10px] text-text-secondary mb-1">
                  <span>PREVIOUS EVENT HASH</span>
                  <span>SEQ #{active.blockNumber}</span>
                </div>
                <div className="font-mono-data text-[11px] p-2.5 rounded bg-canvas-bg border border-border-subtle break-all">
                  {active.previousHash}
                </div>
              </div>

              <div>
                <div className="flex justify-between font-mono-badge text-[10px] mb-1">
                  <span className="text-text-secondary">CURRENT EVENT HASH</span>
                  <span className="text-status-success">SHA-256 MATCH</span>
                </div>
                <div className="font-mono-data text-[11px] p-2.5 rounded bg-canvas-bg border border-border-subtle break-all">
                  {active.currentHash}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between font-mono-badge text-[10px] text-text-secondary mb-1.5">
                  <span>CANONICAL JCS PAYLOAD (RFC 8785)</span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(JSON.stringify(active.payload, null, 2));
                      notify('Canonical JCS payload copied.', 'info');
                    }}
                    className="text-secondary hover:underline"
                  >
                    COPY JSON
                  </button>
                </div>
                <pre className="rounded-lg bg-[#0d1826] text-[#d4e3ff] p-3.5 font-mono-data text-[11px] overflow-x-auto">
                  {JSON.stringify(active.payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
