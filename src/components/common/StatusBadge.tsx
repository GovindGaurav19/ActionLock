import type { ActionPolicyState, RiskTier } from '@/types/actionlock';

export function PolicyStateBadge({ state }: { state: ActionPolicyState }) {
  const styles: Record<ActionPolicyState, string> = {
    AUTHORIZED: 'bg-[#ecfdf5] text-status-success border-[rgba(35,122,87,0.25)]',
    VOICE_STAGE_PASSED: 'bg-[#f0fdfa] text-secondary border-[rgba(22,124,128,0.25)]',
    CHALLENGE_ISSUED: 'bg-[#fffbeb] text-status-warning border-[rgba(165,107,24,0.25)]',
    STEP_UP_PENDING: 'bg-[#fffbeb] text-status-warning border-[rgba(165,107,24,0.25)]',
    PEER_APPROVAL_PENDING: 'bg-[#fffbeb] text-status-warning border-[rgba(165,107,24,0.25)]',
    AWAITING_APPROVER: 'bg-[#fffbeb] text-status-warning border-[rgba(165,107,24,0.25)]',
    RECORDING: 'bg-[#f0fdfa] text-secondary border-[rgba(22,124,128,0.25)]',
    VERIFICATION_PENDING: 'bg-[#f0f3ff] text-on-tertiary-fixed-variant border-border-subtle',
    SUBMITTED: 'bg-[#f0f3ff] text-on-tertiary-fixed-variant border-border-subtle',
    DRAFT: 'bg-canvas-bg text-text-secondary border-border-subtle',
    ON_HOLD: 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]',
    REJECTED: 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]',
    EXPIRED: 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]',
    ACTION_CHANGED: 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]',
    INTEGRATION_ERROR: 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]',
    MANUAL_REVIEW: 'bg-[#fffbeb] text-status-warning border-[rgba(165,107,24,0.25)]',
  };

  return (
    <span
      className={`inline-flex items-center font-mono-badge text-mono-badge px-2 py-0.5 rounded border whitespace-nowrap ${styles[state]}`}
    >
      {state}
    </span>
  );
}

export function RiskTierBadge({ tier }: { tier: RiskTier }) {
  const cls =
    tier === 'CRITICAL'
      ? 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]'
      : tier === 'HIGH'
        ? 'bg-[#fffbeb] text-status-warning border-[rgba(165,107,24,0.25)]'
        : 'bg-[#f0f3ff] text-on-tertiary-fixed-variant border-border-subtle';

  return (
    <span className={`inline-flex items-center font-mono-badge text-mono-badge px-2 py-0.5 rounded border ${cls}`}>
      {tier}
    </span>
  );
}
