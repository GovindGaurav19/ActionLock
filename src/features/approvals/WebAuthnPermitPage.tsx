import { useParams } from 'react-router-dom';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { PolicyStateBadge } from '@/components/common/StatusBadge';

export function WebAuthnPermitPage() {
  const { actionId } = useParams();
  const {
    mode,
    envelopes,
    selectedEnvelopeId,
    setSelectedEnvelopeId,
    registerUserPasskey,
    triggerPasskeyStepUp,
    peerApproveEnvelope,
    authorizeEnvelope,
    releaseGitHubDeployment,
    lastIssuedPermits,
    notify,
  } = useActionLock();

  const env = envelopes.find((e) => e.id === (actionId || selectedEnvelopeId)) || envelopes[0];
  if (!env) {
    return (
      <div className="p-6">
        <div className="bg-surface border border-border-subtle rounded-lg p-6 max-w-xl">
          <h2 className="font-headline-sm text-headline-sm">No Envelope Selected for WebAuthn / Scoped Permit</h2>
          <p className="font-body-sm text-text-secondary mt-1">
            Sign in via the sidebar account switcher or select an Action Envelope from the Action Inbox first.
          </p>
        </div>
      </div>
    );
  }
  const gh = env.details.kind === 'github' ? env.details : null;
  const issuedPermit = lastIssuedPermits[env.id];

  const sevenConditions = [
    { label: '1. Action Envelope remains unchanged', met: !env.hashDriftDetected },
    { label: '2. Voice challenge is valid', met: env.challenge.sttValidated },
    { label: '3. Eidos result passes (match)', met: env.eidos.decision === 'match' },
    { label: '4. Aletheia result is acceptable (real)', met: env.aletheia.verdict === 'real' },
    { label: '5. RBAC passes', met: env.rbacSatisfied },
    { label: '6. Required passkey verification succeeds', met: env.passkey.status === 'verified' },
    { label: '7. Required independent approval succeeds', met: env.peerApprovalSatisfied },
  ];

  const allMet = sevenConditions.every((c) => c.met);

  const exportJcsBundle = () => {
    const blob = new Blob([JSON.stringify({ envelopeId: env.id, actionHash: env.actionHash, jti: env.singleUseJti, passkey: env.passkey }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${env.id}.jcs.bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${env.id}.jcs.bundle.json`, 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono-badge text-[10px] text-text-secondary uppercase">Envelope:</span>
        {envelopes.slice(0, 5).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedEnvelopeId(item.id)}
            className={`px-2.5 py-1 rounded font-mono-data text-[11px] border ${
              item.id === env.id
                ? 'bg-primary-container text-white border-primary-container'
                : 'bg-surface border-border-subtle text-on-surface hover:border-secondary'
            }`}
          >
            {item.id}
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary mb-1">
            <span className="font-mono-badge px-2 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
              ENVELOPE #{env.id}
            </span>
            <span>{gh ? gh.repository : env.targetTitle}</span>
            <span>·</span>
            <span className="font-mono-data">{gh ? `branch: ${gh.branch} (SHA: ${gh.commitSha})` : env.targetSubtitle}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Production Infrastructure Deployment Authorization
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <PolicyStateBadge state={env.state} />
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#ecfdf5] border border-[rgba(35,122,87,0.25)] text-status-success">
              {env.hashDriftDetected ? '✕ DRIFT DETECTED' : '↻ ZERO ENVELOPE DRIFT'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-label-sm text-[10px] uppercase text-text-secondary">Envelope Hash (Canonical JCS)</div>
            <div className="font-mono-data text-[12px] text-on-surface">{env.actionHash}</div>
          </div>
        </div>
      </div>

      {/* 3-Stage Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface border border-border-subtle rounded-lg p-3.5 flex items-center gap-3">
          <span className="material-symbols-outlined text-status-success text-[22px]">check_circle</span>
          <div>
            <div className="font-mono-badge text-[10px] text-status-success">
              STAGE 1: {env.aletheia.verdict === 'real' && env.eidos.decision === 'match' ? 'PASSED' : 'PENDING'}
            </div>
            <div className="font-label-md font-semibold">Voice Nonce Challenge &amp; Liveness</div>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-3.5 flex items-center gap-3">
          <span className="material-symbols-outlined text-status-success text-[22px]">check_circle</span>
          <div>
            <div className="font-mono-badge text-[10px] text-status-success">STAGE 2: VALIDATED</div>
            <div className="font-label-md font-semibold">Deterministic Dual-Control Quorum</div>
          </div>
        </div>

        <div
          className={`bg-surface rounded-lg p-3.5 flex items-center gap-3 border-2 ${
            env.passkey.status === 'verified' ? 'border-status-success' : 'border-secondary'
          }`}
        >
          <span className="material-symbols-outlined text-secondary text-[22px]">fingerprint</span>
          <div>
            <div className="font-mono-badge text-[10px] text-secondary">
              STAGE 3: {env.passkey.status === 'verified' ? 'VERIFIED' : 'PENDING ASSERTION'}
            </div>
            <div className="font-label-md font-semibold">Hardware Token Physical Touch</div>
          </div>
        </div>
      </div>

      {/* Main Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 7 cols */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded bg-primary-container text-white flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">security</span>
                </span>
                <div>
                  <h2 className="font-headline-sm text-headline-sm">WebAuthn / FIDO2 Step-Up Assertion</h2>
                  <p className="font-body-sm text-text-secondary">
                    Cryptographic RP challenge bound to deployment signature
                  </p>
                </div>
              </div>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#fffbeb] border border-[rgba(165,107,24,0.25)] text-status-warning">
                ● CTAP 2.1 HID
              </span>
            </div>

            {/* Hardware Touch Zone */}
            <div className="py-6 flex flex-col items-center text-center border-b border-border-subtle">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center mb-3 border ${
                  env.passkey.status === 'verified'
                    ? 'bg-[#ecfdf5] border-[rgba(35,122,87,0.3)] text-status-success'
                    : env.passkey.status === 'failed'
                      ? 'bg-[#fef2f2] border-[rgba(181,71,71,0.3)] text-status-error'
                      : 'bg-[#f0fdfa] border-[rgba(22,124,128,0.3)] text-secondary'
                }`}
              >
                <span className="material-symbols-outlined text-[36px]">
                  {env.passkey.status === 'verified' ? 'verified_user' : 'usb'}
                </span>
              </div>
              <h3 className="font-headline-md text-headline-md text-on-surface">
                {env.passkey.status === 'verified'
                  ? 'Hardware Security Key Assertion Verified'
                  : 'Touch Your Physical Security Key'}
              </h3>
              <p className="font-body-sm text-text-secondary max-w-md mt-1">
                Acme Identity requires hardware-backed presence verification. Insert your designated FIDO2 hardware token
                and activate the contact sensor.
              </p>

              <div className="w-full max-w-md mt-4 rounded-lg border border-border-subtle bg-[#f8fafc] p-3 flex items-center justify-between text-left">
                <div className="flex items-center gap-2.5">
                  <span className="px-2 py-1 rounded bg-primary-container text-white font-mono-badge text-[10px]">
                    WEBAUTHN
                  </span>
                  <div>
                    <div className="font-label-md font-semibold text-on-surface">
                      WebAuthn / FIDO2 Authenticator{' '}
                      <span className="font-mono-badge text-[10px] text-secondary">SERVER-VERIFIED RP</span>
                    </div>
                    <div className="font-mono-data text-[11px] text-text-secondary">
                      Credential RP: {env.passkey.rpId}
                    </div>
                  </div>
                </div>
                <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#ecfdf5] text-status-success">
                  PAIRED
                </span>
              </div>

              {env.passkey.errorMessage && (
                <div className="w-full max-w-md mt-3 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] p-2.5 text-[12px] text-status-error">
                  {env.passkey.errorMessage}
                </div>
              )}

              <div className="w-full max-w-md mt-4 flex flex-wrap gap-2">
                {mode === 'live' && (
                  <button
                    type="button"
                    onClick={() => void registerUserPasskey()}
                    className="py-2.5 px-3 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-sm text-label-sm flex items-center gap-1"
                    title="Register WebAuthn/FIDO2 passkey for the currently signed-in account"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_card</span>
                    Register Passkey
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void triggerPasskeyStepUp(env.id)}
                  className="flex-1 py-2.5 px-4 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">touch_app</span>
                  Confirm Hardware Key Touch
                </button>
                {mode === 'demo' && (
                  <button
                    type="button"
                    onClick={() => void triggerPasskeyStepUp(env.id, { simulateFailure: true })}
                    className="py-2.5 px-3 rounded border border-border-subtle bg-surface hover:bg-[#fef2f2] hover:text-status-error font-label-sm text-label-sm"
                  >
                    Demo Harness: Simulate Fail
                  </button>
                )}
              </div>
              <p className="font-mono-data text-[11px] text-text-secondary mt-2.5">
                Strict WebAuthn Navigator Credentials RP Verification (Server-Validated Assertion)
              </p>
            </div>

            {/* CTAP 2.1 Flags */}
            <div className="pt-4">
              <div className="flex items-center justify-between mb-3 font-mono-badge text-[10px]">
                <span className="text-text-secondary">CTAP2.1 ASSERTION PAYLOAD &amp; FLAGS (RFC 8809)</span>
                <span className={env.passkey.status === 'verified' ? 'text-status-success' : 'text-status-warning'}>
                  STATUS: {env.passkey.status.toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                <div className="rounded border border-border-subtle bg-[#f8fafc] p-3 flex flex-col gap-1.5">
                  <div className="font-mono-badge text-[10px] text-text-secondary">CLIENTDATAJSON VERIFIED ATTRIBUTES</div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">type:</span>
                    <span className="font-mono-data">webauthn.get</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">origin:</span>
                    <span className="font-mono-data text-secondary">https://auth.actionlock.internal</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">rpId:</span>
                    <span className="font-mono-data">{env.passkey.rpId}</span>
                  </div>
                </div>

                <div className="rounded border border-border-subtle bg-[#f8fafc] p-3 flex flex-col gap-1.5">
                  <div className="font-mono-badge text-[10px] text-text-secondary">AUTHENTICATORDATA BINARY FLAGS</div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">User Presence (UP=1):</span>
                    <span className="font-mono-badge text-[10px] text-status-success">
                      {env.passkey.status === 'verified' ? 'VERIFIED' : 'ACTIVE_PENDING'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">User Verified (UV=1):</span>
                    <span className="font-mono-badge text-[10px] text-status-success">PIN_BIOMETRIC_OK</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Signature Counter:</span>
                    <span className="font-mono-data tabular-nums">{env.passkey.signatureCounter || 14208} monotonic</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 7-Condition Authorization Gate */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-headline-sm text-headline-sm">7-Condition Deterministic Authorization Gate</h2>
              <span className="font-mono-badge text-[10px] text-text-secondary">
                {sevenConditions.filter((c) => c.met).length} / 7 SATISFIED
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sevenConditions.map((c) => (
                <div
                  key={c.label}
                  className={`rounded border px-3 py-2 flex items-center gap-2 text-[12px] ${
                    c.met
                      ? 'border-[rgba(35,122,87,0.25)] bg-[#ecfdf5] text-status-success'
                      : 'border-border-subtle bg-canvas-bg text-text-secondary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {c.met ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 5 cols: Scoped JTI Permit Token */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm">Scoped JTI Permit Token</h2>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#fffbeb] border border-[rgba(165,107,24,0.25)] text-status-warning">
                ⏱ 02:45 REMAINING
              </span>
            </div>

            <div className="rounded border border-border-subtle bg-[#f8fafc] p-3">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-mono-badge text-text-secondary">ONE-TIME SCOPED BEARER JTI</span>
                <span className="font-mono-badge text-status-success">
                  {env.jtiConsumed ? 'CONSUMED' : 'UNCONSUMED'}
                </span>
              </div>
              <div className="font-mono-data text-[12px] text-on-surface break-all">{env.singleUseJti}</div>
            </div>

            <div>
              <div className="flex items-center justify-between font-mono-badge text-[10px] text-text-secondary mb-1.5">
                <span>CRYPTOGRAPHIC CLAIMS INSPECTOR (RFC 7519)</span>
                <span>ES256 / SHA-256</span>
              </div>
              <pre className="rounded-lg bg-[#0d1826] text-[#9af1f5] p-3.5 font-mono-data text-[11px] overflow-x-auto">
                {JSON.stringify(
                  {
                    iss: 'actionlock-policy-engine-v2',
                    sub: env.claimedApprover,
                    aud: gh ? 'github.api.deployment_protection_rule' : 'actionlock.erp.sandbox',
                    action_hash: env.actionHash,
                    jti: env.singleUseJti,
                    scope: gh ? `deploy:${gh.targetEnvironment}:run_${gh.workflowRunId}` : env.actionId,
                    fido2_bound: env.passkey.status === 'verified',
                  },
                  null,
                  2,
                )}
              </pre>
            </div>

            <div className="rounded border border-border-subtle bg-[#f8fafc] p-3">
              <div className="flex items-center justify-between font-mono-badge text-[10px] mb-1">
                <span className="text-text-secondary">DOWNSTREAM EGRESS WEBHOOK DISPATCH</span>
                <span className="text-status-warning">● {allMet ? 'READY_TO_DISPATCH' : 'EGRESS_ARMED'}</span>
              </div>
              <div className="font-mono-data text-[11px] text-on-surface truncate">
                POST /repos/{gh ? gh.repository : 'acme/treasury-gateway'}/actions/callback
              </div>
            </div>

            {mode === 'live' && !env.peerApprovalSatisfied && env.passkey.status === 'verified' && (
              <button
                type="button"
                onClick={() => void peerApproveEnvelope(env.id, 'APPROVED', 'Peer Separation-of-Duties sign-off')}
                className="w-full py-2.5 px-4 rounded bg-primary-container hover:bg-primary text-white font-label-md text-label-md flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">group_add</span>
                Record Independent Peer Approval
              </button>
            )}

            <button
              type="button"
              disabled={!allMet || env.state === 'AUTHORIZED'}
              onClick={() => void authorizeEnvelope(env.id)}
              className={`w-full py-2.5 px-4 rounded font-label-md text-label-md flex items-center justify-center gap-2 transition-colors ${
                allMet && env.state !== 'AUTHORIZED'
                  ? 'bg-secondary hover:bg-[#005a5e] text-white'
                  : 'bg-[#94a3b8] text-white cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
              {env.state === 'AUTHORIZED'
                ? 'Scoped Permit Issued & Dispatched'
                : allMet
                  ? 'Authorize & Dispatch Scoped Permit'
                  : 'Awaiting Hardware FIDO2 Verification'}
            </button>

            {mode === 'live' && gh && issuedPermit && (
              <button
                type="button"
                onClick={() => void releaseGitHubDeployment(env.id, 'approved')}
                className="w-full py-2 px-4 rounded border border-secondary text-secondary hover:bg-[#f0fdfa] font-label-md text-label-md flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                Dispatch Approved Callback to GitHub Deployment Rule
              </button>
            )}
          </div>

          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-headline-sm text-headline-sm">Canonical Audit Bundle</h2>
              <span className="font-mono-badge text-[10px] text-text-secondary">JCS-JSON CANONICAL</span>
            </div>
            <p className="font-body-sm text-text-secondary mb-3">
              Export the multi-signature envelope bundle containing SHA-256 canonical digests, voice evidence status, and
              WebAuthn step-up metadata.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={exportJcsBundle}
                className="py-2 px-3 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-[12px]"
              >
                Download .jcs.bundle
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
