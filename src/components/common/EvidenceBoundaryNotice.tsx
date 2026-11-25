import { AI_EVIDENCE_DISCLAIMER } from '@/types/actionlock';

export function EvidenceBoundaryNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-border-subtle bg-surface-container-low/60 flex items-start gap-2.5 ${
        compact ? 'p-2.5' : 'p-3.5'
      }`}
    >
      <span className="material-symbols-outlined text-[18px] text-secondary shrink-0 mt-0.5">shield</span>
      <div>
        <div className="font-label-sm text-label-sm font-semibold text-on-surface">
          C4 Architectural Boundary: Evidence vs Authority
        </div>
        <p className="font-body-sm text-body-sm text-text-secondary mt-0.5 leading-relaxed">
          {AI_EVIDENCE_DISCLAIMER} Voice match is never sufficient to issue a scoped execution permit without policy
          RBAC, unchanged Action Envelope hash, and hardware FIDO2 / peer step-up.
        </p>
      </div>
    </div>
  );
}
