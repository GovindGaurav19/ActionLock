import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { OverviewDashboardPage } from '@/features/dashboard/OverviewDashboardPage';
import { ActionInboxPage } from '@/features/action-inbox/ActionInboxPage';
import { ApprovalsStepUpPage } from '@/features/approvals/ApprovalsStepUpPage';
import { VoiceRegistryPage } from '@/features/voice-registry/VoiceRegistryPage';
import { FinanceBeneficiaryPage } from '@/features/finance-sandbox/FinanceBeneficiaryPage';
import { WebAuthnPermitPage } from '@/features/approvals/WebAuthnPermitPage';
import { BreakGlassPage } from '@/features/break-glass/BreakGlassPage';
import { IntegrationsWebhookPage } from '@/features/integrations/IntegrationsWebhookPage';
import { SecurityPoliciesPage } from '@/features/policies/SecurityPoliciesPage';
import { AuditTrailPage } from '@/features/audit/AuditTrailPage';
import { SecurityIncidentsPage } from '@/features/incidents/SecurityIncidentsPage';

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<OverviewDashboardPage />} />
          <Route path="/inbox" element={<ActionInboxPage />} />
          <Route path="/approvals" element={<ApprovalsStepUpPage />} />
          <Route path="/approvals/:actionId" element={<ApprovalsStepUpPage />} />
          <Route path="/voice-registry" element={<VoiceRegistryPage />} />
          <Route path="/finance-beneficiary" element={<FinanceBeneficiaryPage />} />
          <Route path="/webauthn-permit" element={<WebAuthnPermitPage />} />
          <Route path="/webauthn-permit/:actionId" element={<WebAuthnPermitPage />} />
          <Route path="/break-glass" element={<BreakGlassPage />} />
          <Route path="/integrations" element={<IntegrationsWebhookPage />} />
          <Route path="/webhooks" element={<IntegrationsWebhookPage focusWebhooks />} />
          <Route path="/security-policies" element={<SecurityPoliciesPage />} />
          <Route path="/audit-trail" element={<AuditTrailPage />} />
          <Route path="/incidents" element={<SecurityIncidentsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
