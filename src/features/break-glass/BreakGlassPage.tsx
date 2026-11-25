import { useState } from 'react';
import { useActionLock } from '@/app/providers/ActionLockContext';

export function BreakGlassPage() {
  const { mode, currentUser, breakGlassEvents, submitBreakGlassEvent, notify } = useActionLock();

  const [ticketId, setTicketId] = useState('INC-2026-0891');
  const [custodian1, setCustodian1] = useState('sarah.jenkins@acme.corp');
  const [custodian2, setCustodian2] = useState('marcus.vance@acme.corp');
  const [ttlMinutes, setTtlMinutes] = useState(60);
  const [targetScope, setTargetScope] = useState('aws.iam.role/EmergencyBreakGlass_ProdVault_Breakout');
  const [justification, setJustification] = useState(
    'DetectifAI or primary IdP outage verified out-of-band. Manual runbook escalation required for bounded failover recovery.',
  );
  const [acknowledgedRunbook, setAcknowledgedRunbook] = useState(false);
  const [ackPostRotation, setAckPostRotation] = useState(false);

  const distinctCustodians = [...new Set([custodian1.trim(), custodian2.trim()].filter(Boolean))];
  const canSubmit =
    ticketId.trim().length >= 3 &&
    justification.trim().length >= 15 &&
    targetScope.trim().length >= 3 &&
    distinctCustodians.length >= 2 &&
    acknowledgedRunbook &&
    ackPostRotation;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      notify('Complete manual runbook acknowledgment, 2 distinct custodians, ticket ID, and justification.', 'error');
      return;
    }
    const ok = await submitBreakGlassEvent({
      ticketId: ticketId.trim(),
      justification: justification.trim(),
      targetScope: targetScope.trim(),
      custodians: distinctCustodians,
      ttlMinutes,
      acknowledgedRunbook: true,
    });
    if (ok) {
      setAcknowledgedRunbook(false);
      setAckPostRotation(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Dark Navy Emergency Hero */}
      <div className="rounded-lg bg-sidebar-bg text-white p-6 border border-[#1E385B]">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="font-mono-badge text-[10px] px-2.5 py-1 rounded bg-error text-white">
                ● MANUAL OUT-OF-BAND BREAK-GLASS RUNBOOK
              </span>
              <span className="font-mono-badge text-[10px] px-2.5 py-1 rounded bg-[#1b2f4a] text-primary-fixed">
                NO VOICE / NO GATEWAY BYPASS IN APP
              </span>
              <span className="font-mono-badge text-[10px] px-2.5 py-1 rounded bg-[#3b1c24] text-error-container">
                AUDIT-LOGGED CUSTODIAN REGISTRY
              </span>
            </div>
            <h1 className="font-headline-xl text-[26px] font-semibold text-white mt-1">
              Break-Glass Outage Procedure &amp; Emergency Access Log
            </h1>
            <p className="font-body-md text-outline-variant max-w-3xl mt-1.5">
              Normal ACTIONLOCK authorization strictly fails closed when DetectifAI or the primary IdP is unreachable.
              This screen documents the manual out-of-band cloud/infrastructure break-glass runbook and records an
              append-only audit entry with dual custodians, ticket reference, and bounded expiry.
            </p>
          </div>

          <div className="rounded-lg bg-[#0d1826] border border-[#2c4469] px-4 py-3 text-right shrink-0">
            <div className="font-mono-badge text-[9px] text-outline-variant">MAX BOUNDED WINDOW</div>
            <div className="font-mono-data text-[20px] font-semibold text-white tabular-nums">{ttlMinutes} MIN</div>
            <div className="font-mono-badge text-[9px] text-status-warning mt-0.5">
              {mode === 'live' ? `ACTOR: ${currentUser?.email || 'SIGN IN REQUIRED'}` : 'DEMO MODE FIXTURE'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <div className="rounded bg-[#1b2f4a]/70 border border-[#2a456b] p-3">
            <div className="font-mono-badge text-[10px] text-outline-variant">EXECUTION MODEL</div>
            <div className="font-mono-data text-[13px] text-white mt-0.5">Manual Out-of-Band Cloud / CLI Runbook</div>
          </div>
          <div className="rounded bg-[#1b2f4a]/70 border border-[#2a456b] p-3">
            <div className="font-mono-badge text-[10px] text-outline-variant">DUAL CUSTODIAN ACCOUNTABILITY</div>
            <div className="font-mono-data text-[13px] text-white mt-0.5">Minimum 2 Distinct Named Custodians</div>
          </div>
          <div className="rounded bg-[#1b2f4a]/70 border border-[#2a456b] p-3">
            <div className="font-mono-badge text-[10px] text-outline-variant">AUDIT RECORDING</div>
            <div className="font-mono-data text-[13px] text-white mt-0.5">SHA-256 Append-Only SQLite Event</div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 7 cols: Honest Runbook + Logging Form */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Out-of-Band Manual Recovery Runbook</h2>
              <span className="font-mono-badge text-[10px] text-text-secondary">SURVIVES ACTIONLOCK OUTAGE</span>
            </div>
            <ol className="list-decimal list-inside flex flex-col gap-2 text-[13px] text-on-surface-variant">
              <li>Confirm primary DetectifAI / IdP / Gateway unavailability and open an incident ticket.</li>
              <li>Contact two independent emergency custodians via verified out-of-band voice or incident bridge.</li>
              <li>Log the ticket ID, bounded target scope, custodian names, and expiry window below before actioning.</li>
              <li>
                Retrieve sealed emergency IAM/root credentials stored outside ACTIONLOCK in your cloud break-glass vault
                and execute only the minimum bounded remediation steps.
              </li>
              <li>Immediately rotate all used emergency credentials upon expiry or restoration of normal controls.</li>
            </ol>
          </div>

          <form onSubmit={handleSubmit} className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Log Audited Break-Glass Invocation</h2>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#fef2f2] text-status-error">
                APPEND-ONLY AUDIT EVENT
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">Incident / Ticket ID</label>
                <input
                  required
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  className="w-full h-9 px-3 rounded border border-border-subtle bg-canvas-bg font-mono-data text-[12px]"
                  placeholder="INC-2026-0891"
                />
              </div>
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">Bounded Expiry (Minutes, 15–120)</label>
                <input
                  type="number"
                  min={15}
                  max={120}
                  value={ttlMinutes}
                  onChange={(e) => setTtlMinutes(Number(e.target.value) || 60)}
                  className="w-full h-9 px-3 rounded border border-border-subtle bg-canvas-bg font-mono-data text-[12px]"
                />
              </div>
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">Custodian #1 (Distinct Identity)</label>
                <input
                  required
                  value={custodian1}
                  onChange={(e) => setCustodian1(e.target.value)}
                  className="w-full h-9 px-3 rounded border border-border-subtle bg-canvas-bg font-mono-data text-[12px]"
                />
              </div>
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">Custodian #2 (Distinct Co-Custodian)</label>
                <input
                  required
                  value={custodian2}
                  onChange={(e) => setCustodian2(e.target.value)}
                  className="w-full h-9 px-3 rounded border border-border-subtle bg-canvas-bg font-mono-data text-[12px]"
                />
              </div>
            </div>

            <div>
              <label className="block font-label-sm text-text-secondary mb-1">Target Scope / Bounded Resource</label>
              <input
                required
                value={targetScope}
                onChange={(e) => setTargetScope(e.target.value)}
                className="w-full h-9 px-3 rounded border border-border-subtle bg-canvas-bg font-mono-data text-[12px]"
              />
            </div>

            <div>
              <label className="block font-label-sm text-text-secondary mb-1">Incident Justification (min 15 chars)</label>
              <textarea
                required
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                className="w-full p-3 rounded border border-border-subtle bg-canvas-bg font-body-sm text-on-surface"
              />
            </div>

            <label className="flex items-start gap-2 text-[12px] text-on-surface">
              <input
                type="checkbox"
                checked={acknowledgedRunbook}
                onChange={(e) => setAcknowledgedRunbook(e.target.checked)}
                className="mt-1"
              />
              <span>
                I confirm manual out-of-band confirmation was obtained from both named custodians for ticket{' '}
                <strong>{ticketId}</strong>.
              </span>
            </label>

            <label className="flex items-start gap-2 text-[12px] text-on-surface">
              <input
                type="checkbox"
                checked={ackPostRotation}
                onChange={(e) => setAckPostRotation(e.target.checked)}
                className="mt-1"
              />
              <span>
                I acknowledge that all emergency credentials used outside ACTIONLOCK must be rotated immediately upon expiry.
              </span>
            </label>

            <div className="pt-2 border-t border-border-subtle flex items-center justify-between gap-3">
              <span className="text-[11px] text-text-secondary">
                {distinctCustodians.length < 2
                  ? 'Requires 2 distinct custodian identifiers'
                  : 'SECOPS_ADMIN permission enforced on POST /api/break-glass'}
              </span>
              <button
                type="submit"
                disabled={!canSubmit}
                className={`px-4 py-2 rounded font-label-md text-label-md flex items-center gap-1.5 ${
                  canSubmit
                    ? 'bg-secondary hover:bg-[#005a5e] text-white'
                    : 'bg-surface-container-low text-text-secondary border border-border-subtle cursor-not-allowed'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">fact_check</span>
                Record Audited Break-Glass Log
              </button>
            </div>
          </form>
        </div>

        {/* Right 5 cols */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Excluded &amp; Non-Bypassable Controls</h2>
              <span className="font-mono-badge text-[10px] text-status-error">GOVERNANCE BOUNDARY</span>
            </div>
            <div className="rounded border border-border-subtle bg-canvas-bg p-3 font-mono-data text-[12px] break-all">
              {targetScope}
            </div>
            <div className="rounded border border-[rgba(181,71,71,0.25)] bg-[#fef2f2] p-2.5 font-mono-badge text-[10px] text-status-error">
              APP POLICY: NEVER SILENTLY APPROVES VOICE OR WEBAUTHN CHECKS FROM BREAK-GLASS
            </div>
          </div>

          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Post-Access Obligations</h2>
              <span className="font-mono-badge text-[10px] text-secondary">MANDATORY</span>
            </div>
            {[
              ['Bounded Expiration Timestamp', 'Break-glass window expires automatically after the logged TTL (15–120 min).'],
              ['Mandatory Credential Rotation', 'Rotate out-of-band cloud IAM keys and emergency secrets immediately after recovery.'],
              ['Hash-Chained Audit Entry', 'Every logged break-glass request is linked into audit_events via SHA-256 chain.'],
            ].map(([t, d]) => (
              <div key={t} className="rounded border border-border-subtle bg-[#f8fafc] p-3">
                <div className="font-label-md font-semibold text-on-surface">{t}</div>
                <div className="text-[12px] text-text-secondary mt-0.5">{d}</div>
              </div>
            ))}
          </div>

          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono-badge text-[11px] text-secondary">
                PERSISTED BREAK-GLASS REGISTRY ({breakGlassEvents.length})
              </span>
              <span className="font-mono-data text-[11px] text-text-secondary">
                {mode === 'live' ? 'SQLite audit log' : 'Demo session log'}
              </span>
            </div>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {breakGlassEvents.length === 0 ? (
                <div className="rounded bg-canvas-bg border border-border-subtle p-3 text-[12px] text-text-secondary">
                  No Break-Glass invocations recorded yet.
                </div>
              ) : (
                breakGlassEvents.map((ev) => (
                  <div key={String(ev.id)} className="rounded border border-border-subtle bg-[#0d1826] text-[#d4e3ff] p-3 font-mono-data text-[11px]">
                    <div className="flex items-center justify-between text-[#4ade80]">
                      <span>{String(ev.ticketId || '')}</span>
                      <span>{String(ev.id || '')}</span>
                    </div>
                    <div className="mt-1 text-white">Scope: {String(ev.targetScope || '')}</div>
                    <div className="text-outline-variant mt-0.5">
                      Custodians: {Array.isArray(ev.custodians) ? ev.custodians.join(', ') : ''}
                    </div>
                    <div className="text-outline-variant mt-0.5">Expires: {String(ev.expiresAt || '')}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
