import { useEffect, useState } from 'react';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { EvidenceBoundaryNotice } from '@/components/common/EvidenceBoundaryNotice';
import { PolicyStateBadge } from '@/components/common/StatusBadge';

export function FinanceBeneficiaryPage() {
  const {
    envelopes,
    createProtectedAction,
    mutateFinancePayload,
    revertFinanceToOriginal,
    triggerPasskeyStepUp,
    authorizeEnvelope,
    rejectEnvelope,
    notify,
  } = useActionLock();

  const env =
    envelopes.find((e) => e.id === 'env_fin_982410_wire') ||
    envelopes.find((e) => e.id === 'env_fin_sim_9824') ||
    envelopes.find((e) => e.details.kind === 'finance');
  const fin = env && env.details.kind === 'finance' ? env.details : null;

  const [resolutionChoice, setResolutionChoice] = useState<'revert' | 'approve_mutated'>('revert');
  const [showRawDiff, setShowRawDiff] = useState(false);
  const [testBeneficiary, setTestBeneficiary] = useState(fin?.beneficiaryReference || '');
  const [testAmount, setTestAmount] = useState(fin?.amount || '$420,000.00');

  useEffect(() => {
    if (fin) {
      setTestBeneficiary(fin.beneficiaryReference);
      setTestAmount(fin.amount);
    }
  }, [fin]);

  if (!env || !fin) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-[rgba(165,107,24,0.3)] bg-[#fffbeb] px-4 py-3 mb-4 font-mono-badge text-[11px] text-on-surface">
          SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED.
        </div>
        <div className="bg-surface border border-border-subtle rounded-lg p-6 max-w-xl">
          <h2 className="font-headline-sm text-headline-sm">No Simulated Finance Envelope Loaded</h2>
          <p className="font-body-sm text-text-secondary mt-1">
            Sign in via the sidebar account switcher or create a simulated treasury approval envelope to test SHA-256
            beneficiary drift detection.
          </p>
          <button
            type="button"
            onClick={() =>
              void createProtectedAction({
                category: 'Financial',
                targetTitle: 'Simulated Treasury Wire Batch',
                targetSubtitle: 'CloudScale Corp US',
                requester: 'dan.sullivan@acme.corp',
                claimedApprover: 'elena.rostova@acme.corp',
                amountOrRepo: '420000',
              })
            }
            className="mt-4 px-4 py-2 rounded bg-secondary text-white font-label-md text-[12px]"
          >
            Create Simulated Treasury Envelope
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Simulation Sub-Banner */}
      <div className="rounded-lg border border-[rgba(165,107,24,0.3)] bg-[#fffbeb] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
          <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-status-warning text-white">
            SIMULATION ONLY — NO REAL MONEY IS TRANSFERRED.
          </span>
          <span className="text-on-surface">
            Simulated ERP Treasury Sandbox only — no real funds move and no banking credentials are stored or exposed.
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono-badge text-[10px] text-text-secondary">
          <span className="px-2 py-0.5 rounded bg-surface border border-border-subtle">ENCLAVE: JCS-RFC8785-STRICT</span>
          <span className="text-status-success">● ZERO-LEAK AIRGAP PASS</span>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <div className="text-[12px] text-text-secondary mb-1">
            Action Inbox / Financial Operations / ERP Treasury Direct /{' '}
            <span className="font-mono-data text-on-surface">{env.id}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            High-Consequence Treasury Authorization: Vendor Beneficiary Change
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <PolicyStateBadge state={env.state} />
            {env.hashDriftDetected && (
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#fef2f2] border border-[rgba(181,71,71,0.25)] text-status-error">
                BENEFICIARY_HASH_MISMATCH
              </span>
            )}
          </div>
          <p className="font-body-md text-body-md text-text-secondary mt-1.5">
            Wire batch #{fin.paymentRequestId} · Destination routing altered post-invoice approval by unauthorized delta
            injection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="bg-surface border border-border-subtle rounded-lg px-4 py-2.5">
            <div className="font-label-sm text-[10px] uppercase text-text-secondary">Exposure Value</div>
            <div className="font-headline-md text-headline-md text-on-surface tabular-nums">
              {fin.amount} <span className="text-[12px] font-normal text-text-secondary">{fin.currency}</span>
            </div>
          </div>
          <div className="bg-surface border border-border-subtle rounded-lg px-4 py-2.5">
            <div className="font-label-sm text-[10px] uppercase text-text-secondary">Quorum Gate</div>
            <div className="font-label-md font-semibold text-status-warning mt-0.5">
              Tier 1 ({env.quorumSigners.filter((q) => q.passkeyStatus === 'VERIFIED').length} / 2 Signed)
            </div>
          </div>
        </div>
      </div>

      {/* Critical Security Interception */}
      {env.hashDriftDetected && (
        <div className="rounded-lg border border-[rgba(181,71,71,0.35)] bg-[#fef2f2] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-status-error text-[22px] mt-0.5">gpp_maybe</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-label-md font-semibold text-status-error">
                  CRITICAL SECURITY INTERCEPTION: ACTION ENVELOPE CORRUPTED
                </span>
                <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-error text-white">SEV-1 HOLD</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface mt-1">
                <strong>BENEFICIARY ACCOUNT MODIFIED POST-ISSUANCE.</strong> Cryptographic envelope digest drifted from
                canonical ingress snapshot. Pre-existing voice approvals and automated ERP routing have been quarantined.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowRawDiff((v) => !v)}
            className="px-3 py-1.5 rounded border border-border-subtle bg-surface font-mono-badge text-[11px] shrink-0"
          >
            {showRawDiff ? 'Hide JCS Diff' : 'Raw JCS Diff'}
          </button>
        </div>
      )}

      {/* Main 2-column grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 7 cols */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          {/* Digest Comparison */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
              <h2 className="font-headline-sm text-headline-sm">Cryptographic Action Envelope Digest</h2>
              <span className="font-mono-badge text-[10px] text-text-secondary">SPEC: JCS_RFC8785 + SHA256</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div className="rounded-lg border border-border-subtle bg-[#f8fafc] p-3.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono-badge text-[10px] text-text-secondary">INGRESS HASH (ORIGINAL)</span>
                  <span className="font-mono-badge text-[9px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-text-secondary">
                    {env.hashDriftDetected ? 'INVALIDATED' : 'MATCH'}
                  </span>
                </div>
                <div className="font-mono-data text-[12px] break-all text-on-surface">
                  {env.ingressHash || env.actionHash}
                </div>
                <div className="text-[11px] text-status-success mt-2">✓ Locked 2025-04-19 14:12:04 UTC</div>
              </div>

              <div
                className={`rounded-lg border p-3.5 ${
                  env.hashDriftDetected
                    ? 'border-[rgba(181,71,71,0.35)] bg-[#fef2f2]'
                    : 'border-[rgba(35,122,87,0.3)] bg-[#ecfdf5]'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`font-mono-badge text-[10px] ${
                      env.hashDriftDetected ? 'text-status-error' : 'text-status-success'
                    }`}
                  >
                    CURRENT STATE HASH
                  </span>
                  <span
                    className={`font-mono-badge text-[9px] px-1.5 py-0.5 rounded ${
                      env.hashDriftDetected ? 'bg-error text-white' : 'bg-status-success text-white'
                    }`}
                  >
                    {env.hashDriftDetected ? 'DRIFT DETECTED' : 'INTACT'}
                  </span>
                </div>
                <div className="font-mono-data text-[12px] break-all text-on-surface">{env.actionHash}</div>
                <div className={`text-[11px] mt-2 ${env.hashDriftDetected ? 'text-status-error' : 'text-status-success'}`}>
                  {env.hashDriftDetected ? '✱ Altered in flight via external API patch #P-882' : '✓ Zero canonical drift'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-border-subtle text-[12px]">
              <div>
                <div className="text-text-secondary">Canonical Action ID</div>
                <div className="font-mono-data font-medium text-on-surface">{env.id}</div>
              </div>
              <div>
                <div className="text-text-secondary">Requisitioner</div>
                <div className="font-medium text-on-surface">{env.requester}</div>
              </div>
              <div>
                <div className="text-text-secondary">Target Clearance Gate</div>
                <div className="font-mono-data font-medium text-on-surface">{fin.egressGate}</div>
              </div>
            </div>
          </div>

          {/* Side-by-Side Mutation Diff */}
          <div className="bg-surface border border-border-subtle rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Side-by-Side Beneficiary Mutation Diff</h2>
              <span
                className={`font-mono-badge text-[10px] px-2 py-0.5 rounded ${
                  env.hashDriftDetected ? 'bg-[#fef2f2] text-status-error' : 'bg-[#ecfdf5] text-status-success'
                }`}
              >
                {env.hashDriftDetected ? 'PAYLOAD TAMPERED' : '0 FIELDS DRIFTED'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-[11px] uppercase text-text-secondary">
                    <th className="py-2.5 px-4">Envelope Attribute</th>
                    <th className="py-2.5 px-4">Original Stored Vendor Profile</th>
                    <th className="py-2.5 px-4 text-status-error">Current / Mutated In-Flight Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  <tr>
                    <td className="py-3 px-4 text-text-secondary">Beneficiary Entity</td>
                    <td className="py-3 px-4 font-medium">{fin.originalVendor || fin.vendor}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-1 rounded ${
                          fin.vendor !== fin.originalVendor ? 'bg-[#fef2f2] text-status-error font-medium' : ''
                        }`}
                      >
                        {fin.vendor}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-text-secondary">Depository Bank</td>
                    <td className="py-3 px-4 font-medium">{fin.originalDepositoryBank || fin.depositoryBank}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-1 rounded ${
                          fin.depositoryBank !== fin.originalDepositoryBank
                            ? 'bg-[#fef2f2] text-status-error font-medium'
                            : ''
                        }`}
                      >
                        {fin.depositoryBank}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-text-secondary">Account Number / IBAN</td>
                    <td className="py-3 px-4 font-mono-data">{fin.originalBeneficiaryReference || fin.beneficiaryReference}</td>
                    <td className="py-3 px-4 font-mono-data">
                      <span
                        className={`inline-block px-2 py-1 rounded ${
                          fin.beneficiaryReference !== fin.originalBeneficiaryReference
                            ? 'bg-[#fef2f2] text-status-error font-medium'
                            : ''
                        }`}
                      >
                        {fin.beneficiaryReference}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-text-secondary">Invoice Reference</td>
                    <td className="py-3 px-4 font-mono-data">{fin.invoiceReference}</td>
                    <td className="py-3 px-4 font-mono-data flex items-center justify-between">
                      <span>{fin.invoiceReference}</span>
                      <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-[#ecfdf5] text-status-success">
                        MATCH
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-text-secondary">Net Authorized Sum</td>
                    <td className="py-3 px-4 font-semibold tabular-nums">$420,000.00 USD</td>
                    <td className="py-3 px-4 font-semibold tabular-nums">
                      {fin.amount} {fin.currency}{' '}
                      <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-[#fffbeb] text-status-warning ml-1">
                        EXCEEDS $100K QUORUM TIER
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {fin.sanctionsNote && (
              <div className="m-4 rounded-lg border border-[rgba(181,71,71,0.25)] bg-[#fef2f2] p-3.5 text-[12px]">
                <div className="flex items-center justify-between font-label-sm text-status-error font-semibold mb-1">
                  <span>⚑ Risk Engine Heuristics &amp; Sanctions Screen</span>
                  <span className="font-mono-badge">RISK SCORE: {fin.riskScore} / 100</span>
                </div>
                <p className="text-on-surface-variant">{fin.sanctionsNote}</p>
              </div>
            )}

            {/* Critical Test: Interactive Mutation Trigger */}
            <div className="px-5 py-4 bg-[#f8fafc] border-t border-border-subtle">
              <div className="font-label-sm text-label-sm uppercase text-text-secondary mb-2">
                Critical Hash-Drift Test (Mutate Beneficiary or Amount)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={testBeneficiary}
                  onChange={(e) => setTestBeneficiary(e.target.value)}
                  placeholder="Beneficiary Account / IBAN"
                  className="h-9 px-2.5 rounded border border-border-subtle bg-surface font-mono-data text-[12px]"
                />
                <input
                  value={testAmount}
                  onChange={(e) => setTestAmount(e.target.value)}
                  placeholder="Amount"
                  className="h-9 px-2.5 rounded border border-border-subtle bg-surface font-mono-data text-[12px]"
                />
                <button
                  type="button"
                  onClick={() =>
                    void mutateFinancePayload(env.id, {
                      beneficiaryReference: testBeneficiary,
                      amount: testAmount,
                    })
                  }
                  className="h-9 px-3 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] text-status-error hover:bg-error hover:text-white font-label-md text-[12px] transition-colors"
                >
                  Test Mutation → Force HOLD
                </button>
              </div>
            </div>
          </div>

          {showRawDiff && (
            <pre className="rounded-lg bg-[#0d1826] text-[#d4e3ff] p-4 font-mono-data text-[12px] overflow-x-auto">
              {JSON.stringify(
                {
                  ingress_hash: env.ingressHash,
                  current_hash: env.actionHash,
                  drift_detected: env.hashDriftDetected,
                  mutated_fields: {
                    vendor: [fin.originalVendor, fin.vendor],
                    depository_bank: [fin.originalDepositoryBank, fin.depositoryBank],
                    beneficiary_reference: [fin.originalBeneficiaryReference, fin.beneficiaryReference],
                    amount: fin.amount,
                  },
                },
                null,
                2,
              )}
            </pre>
          )}

          {/* Target State Resolution Options */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-headline-sm text-headline-sm">Target State Resolution Options</h2>
              <span className="font-mono-badge text-[10px] text-text-secondary">ARBITRATION PROTOCOL</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setResolutionChoice('revert')}
                className={`text-left rounded-lg border p-4 transition-colors ${
                  resolutionChoice === 'revert'
                    ? 'border-secondary bg-[#f0fdfa]'
                    : 'border-border-subtle bg-surface hover:bg-canvas-bg'
                }`}
              >
                <div className="font-label-md font-semibold text-on-surface">
                  Revert to Stored Domestic Beneficiary
                </div>
                <p className="font-body-sm text-body-sm text-text-secondary mt-1">
                  Discards mutated Cyprus account. Executes $420k to JPMorgan Chase NYC vendor vault. Keeps normal
                  approvals.
                </p>
                <div className="font-mono-badge text-[10px] text-status-success mt-2">✓ RECOMMENDED BY POLICY SEC-409</div>
              </button>

              <button
                type="button"
                onClick={() => setResolutionChoice('approve_mutated')}
                className={`text-left rounded-lg border p-4 transition-colors ${
                  resolutionChoice === 'approve_mutated'
                    ? 'border-status-warning bg-[#fffbeb]'
                    : 'border-border-subtle bg-surface hover:bg-canvas-bg'
                }`}
              >
                <div className="font-label-md font-semibold text-on-surface">Approve Mutated Beneficiary Change</div>
                <p className="font-body-sm text-body-sm text-text-secondary mt-1">
                  Requires discarding invalidated approvals, re-signing fresh voice nonces, and 2x physical FIDO2
                  passkeys.
                </p>
                <div className="font-mono-badge text-[10px] text-status-error mt-2">ⓘ ELEVATED AUDIT TRAIL LOGGED</div>
              </button>
            </div>
          </div>
        </div>

        {/* Right 5 cols */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          {/* Ephemeral Voice Attestation */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Ephemeral Voice Challenge Attestation</h2>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                NONCE {env.challenge.nonceId}
              </span>
            </div>
            <div className="rounded-lg border border-border-subtle bg-[#f8fafc] p-3.5">
              <div className="flex items-center justify-between font-mono-badge text-[10px] text-secondary mb-1.5">
                <span>STRICT SPOKEN CHALLENGE PHRASE</span>
                <span>VALIDITY: 04:18 REMAINING</span>
              </div>
              <p className="font-body-md italic text-on-surface font-medium">&ldquo;{env.challenge.phrase}&rdquo;</p>
            </div>
            <div className="rounded-lg bg-[#0d1826] text-white p-4">
              <div className="flex items-center justify-between text-[12px] mb-3">
                <div>
                  <div className="font-mono-data font-medium">Elena_Rostova_WireNonce_839.wav</div>
                  <div className="text-[11px] text-outline-variant">48kHz Lossless PCM · 18.4s / 30.0s Analyzed</div>
                </div>
                <span className="font-mono-data text-[12px]">00:18.4</span>
              </div>
              <div className="h-12 flex items-center justify-between gap-1">
                {env.challenge.waveformBars.map((b, idx) => (
                  <div key={idx} className="w-1.5 rounded-full bg-[#38bdf8]" style={{ height: `${Math.max(12, b * 0.48)}px` }} />
                ))}
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1E385B] text-[11px]">
                <span className="font-mono-badge text-[#4ade80]">● INGESTION COMPLETE</span>
                <button
                  type="button"
                  onClick={() => notify('Re-prompted Elena Rostova for fresh dynamic wire nonce.', 'info')}
                  className="px-2.5 py-1 rounded bg-[#172b45] text-white hover:bg-secondary font-label-sm"
                >
                  ↻ Re-prompt Elena
                </button>
              </div>
            </div>
          </div>

          {/* DetectifAI Dual Engine Bus */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">DetectifAI Dual-Engine Biometric Bus</h2>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                ENCLAVE SECURED
              </span>
            </div>
            <div className="rounded border border-border-subtle bg-[#f8fafc] p-3">
              <div className="flex items-center justify-between">
                <span className="font-label-md font-semibold">Detector 01 · Aletheia Synthetic Engine</span>
                <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#ecfdf5] text-status-success">
                  VERDICT: {env.aletheia.verdict?.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px] mt-1.5">
                <span className="text-text-secondary">Synthetic Deepfake Score:</span>
                <span className="font-mono-data font-semibold text-status-success">{env.aletheia.score} (LOW RISK)</span>
              </div>
            </div>
            <div className="rounded border border-border-subtle bg-[#f8fafc] p-3">
              <div className="flex items-center justify-between">
                <span className="font-label-md font-semibold">Detector 02 · Eidos Speaker Verification</span>
                <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#ecfdf5] text-status-success">
                  {env.eidos.decision?.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px] mt-1.5">
                <span className="text-text-secondary">Cosine Similarity (-1 to 1):</span>
                <span className="font-mono-data font-semibold text-on-surface">{env.eidos.similarity} (Min Req: 0.850)</span>
              </div>
            </div>
            <EvidenceBoundaryNotice compact />
          </div>

          {/* Executive Quorum & Passkey */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Executive Quorum &amp; Passkey Step-Up</h2>
              <span className="font-mono-badge text-[10px] text-status-warning">
                {env.quorumSigners.filter((q) => q.passkeyStatus === 'VERIFIED').length} OF 2 READY
              </span>
            </div>
            {env.quorumSigners.map((q) => (
              <div key={q.id} className="rounded border border-border-subtle p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-full bg-primary-container text-white font-mono-badge text-[11px] flex items-center justify-center">
                    {q.initials}
                  </span>
                  <div>
                    <div className="font-medium text-on-surface text-[13px]">{q.name}</div>
                    <div className="text-[11px] text-text-secondary">{q.role}</div>
                  </div>
                </div>
                <span
                  className={`font-mono-badge text-[10px] px-2 py-0.5 rounded ${
                    q.passkeyStatus === 'VERIFIED'
                      ? 'bg-[#ecfdf5] text-status-success'
                      : 'bg-[#fffbeb] text-status-warning'
                  }`}
                >
                  {q.passkeyStatus}
                </span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => void triggerPasskeyStepUp(env.id)}
              className="w-full py-2.5 px-4 rounded bg-primary-container hover:bg-primary text-white font-label-md text-label-md flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">passkey</span>
              Touch Security Key to Sign
            </button>
          </div>
        </div>
      </div>

      {/* Audit Ledger + Bottom Action Bar */}
      <div className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col gap-3">
        <div className="font-label-sm text-label-sm uppercase text-text-secondary">
          Envelope Arbitration Audit Ledger
        </div>
        {env.auditEvents.map((ev) => (
          <div key={ev.eventId} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border-subtle last:border-0 text-[12px]">
            <div className="flex items-center gap-3">
              <span className="font-mono-data text-text-secondary">{ev.timestamp}</span>
              <div>
                <span className="font-semibold text-on-surface">{ev.title}: </span>
                <span className="text-text-secondary">{ev.detail}</span>
              </div>
            </div>
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-canvas-bg border border-border-subtle">
              {ev.badge}
            </span>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="text-[12px]">
          <span className="font-mono-badge text-status-error font-semibold mr-2">● FAIL-CLOSED ENFORCEMENT</span>
          <span className="text-text-secondary">
            Envelope hold prevents SAP ERP direct disbursement. Release requires zero hash drift and explicit co-signing.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void rejectEnvelope(env.id, 'Quarantined and flagged as suspected fraud')}
            className="px-3.5 py-2 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] text-status-error font-label-md text-label-md"
          >
            Quarantine &amp; Flag Fraud
          </button>
          <button
            type="button"
            onClick={() => void revertFinanceToOriginal(env.id)}
            className="px-3.5 py-2 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md"
          >
            Revert to Domestic Beneficiary
          </button>
          <button
            type="button"
            onClick={() => void authorizeEnvelope(env.id)}
            className="px-4 py-2 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md"
          >
            Authorize &amp; Sign Execution Permit
          </button>
        </div>
      </div>
    </div>
  );
}
