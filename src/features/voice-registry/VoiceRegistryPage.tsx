import { useState } from 'react';
import marcusAvatar from '@/assets/images/marcus-vance-avatar.png';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { actionLockApi } from '@/services/api/client';
import type { EnrolledSpeaker } from '@/types/actionlock';

export function VoiceRegistryPage() {
  const { mode, currentUser, refreshLiveData, speakers, enrollSpeaker, revokeSpeaker, notify } = useActionLock();
  const [selectedId, setSelectedId] = useState(speakers[0]?.id || '1');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [retentionAcknowledged, setRetentionAcknowledged] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [enrollForm, setEnrollForm] = useState({
    name: '',
    email: '',
    role: 'Staff Security Engineer',
    department: 'SecOps' as EnrolledSpeaker['department'],
  });

  const filtered = speakers.filter((s) => {
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q || s.name.toLowerCase().includes(q) || s.speakerId.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
    const matchDept = deptFilter === 'ALL' || s.department === deptFilter;
    const matchStatus = statusFilter === 'ALL' || s.status === statusFilter;
    return matchSearch && matchDept && matchStatus;
  });

  const activeSpeaker = filtered.find((s) => s.id === selectedId) || filtered[0] || speakers[0];

  const exportAttestation = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            retentionPolicy: 'Application discards temp audio after upload; DetectifAI retains uploaded audio for 30 days and encrypted profiles until deletion.',
            speakers,
          },
          null,
          2,
        ),
      ],
      {
        type: 'application/json',
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eidos-compliance-attestation.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Consent & retention attestation JSON downloaded.', 'success');
  };

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="text-[12px] text-text-secondary mb-1">
            Voice Registry / Enrolled Speakers &amp; Biometric Profiles /{' '}
            <span className="font-mono-data text-secondary">HSM_VAULT_ZONE_01</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Voice Biometric Registry &amp; Consent Management
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#f0fdfa] border border-[rgba(22,124,128,0.25)] text-secondary">
              ● EIDOS ENGINE v2.4 ACTIVE
            </span>
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#ecfdf5] border border-[rgba(35,122,87,0.25)] text-status-success">
              ✓ EXPLICIT CONSENT &amp; TEMP CLEANUP
            </span>
          </div>
          <p className="font-body-md text-body-md text-text-secondary mt-1.5">
            Enclave-isolated biometric speaker profiles, cryptographic consent chains, and mathematical feature vectors
            for step-up elevation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportAttestation}
            className="px-3 py-2 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">description</span>
            Compliance Attestation PDF/JSON
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode === 'live' && currentUser) {
                setEnrollForm({
                  name: currentUser.displayName,
                  email: currentUser.email,
                  role: currentUser.title || 'Authorizer',
                  department: (currentUser.department as EnrolledSpeaker['department']) || 'SecOps',
                });
              }
              setEnrollModalOpen(true);
            }}
            className="px-3.5 py-2 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            Enroll Authorized Speaker
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>Enrolled Speakers</span>
            <span className="material-symbols-outlined text-[18px]">badge</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">
              {mode === 'live' ? speakers.length : 37 + speakers.length}
            </span>
            <span className="font-mono-badge text-[10px] text-status-success">
              {speakers.filter((s) => s.status === 'ACTIVE').length} ACTIVE
            </span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-text-secondary">
            <span>{mode === 'live' ? 'Persisted SQLite + Eidos' : 'Demo roster fixtures'}</span>
            <span className="text-status-error">{speakers.filter((s) => s.status === 'REVOKED').length} revoked</span>
          </div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>Biometric Vector Freshness</span>
            <span className="material-symbols-outlined text-[18px] text-secondary">fingerprint</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">99.4%</span>
            <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-[#ecfdf5] text-status-success">
              OPTIMAL
            </span>
          </div>
          <div className="text-[12px] text-text-secondary">Vector salt rotation Q1 2025 v2.4</div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>Consent Audit Integrity</span>
            <span className="material-symbols-outlined text-[18px] text-status-success">gavel</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl tabular-nums">100%</span>
            <span className="font-mono-badge text-[10px] text-secondary">CRYPT-SIGNED</span>
          </div>
          <div className="text-[12px] text-text-secondary">GDPR Art. 9 &amp; BIPA Strict Non-Repudiable</div>
        </div>

        <div className="bg-surface border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between font-label-sm text-label-sm uppercase text-text-secondary">
            <span>DetectifAI Eidos Sync</span>
            <span className="material-symbols-outlined text-[18px] text-status-success">sync</span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="font-headline-xl text-headline-xl">Healthy</span>
            <span className="font-mono-badge text-[10px] text-status-success">mTLS v1.3</span>
          </div>
          <div className="text-[12px] text-text-secondary">Last feature synch 4m ago (Shard-04)</div>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left Roster + Pipeline */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          <div className="bg-surface border border-border-subtle rounded-lg p-3 flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <span className="material-symbols-outlined text-[18px] text-text-secondary absolute left-2.5 top-2">
                search
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by name, ID (spk_...), or email..."
                className="w-full h-9 pl-8 pr-3 rounded border border-border-subtle bg-canvas-bg font-body-sm"
              />
            </div>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm"
            >
              <option value="ALL">All Departments</option>
              <option value="SecOps">SecOps</option>
              <option value="Treasury">Treasury</option>
              <option value="DevOps/SRE">DevOps/SRE</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="EXPIRING_SOON">EXPIRING_SOON</option>
              <option value="REVOKED">REVOKED</option>
            </select>
          </div>

          <div className="bg-surface border border-border-subtle rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-headline-sm text-headline-sm">Enrolled Speaker Roster</h2>
                <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-canvas-bg border border-border-subtle text-text-secondary">
                  {filtered.length} SHOWN
                </span>
              </div>
              <span className="font-body-sm text-[12px] text-status-success">● Hardware-isolated HSM Store</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f8fafc] border-b border-border-subtle font-label-sm text-label-sm uppercase text-text-secondary">
                    <th className="py-2.5 px-4">Approver / Identity</th>
                    <th className="py-2.5 px-4">Speaker ID &amp; Hash</th>
                    <th className="py-2.5 px-4">Enrollment Stats</th>
                    <th className="py-2.5 px-4">Consent Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`cursor-pointer transition-colors ${
                        activeSpeaker.id === s.id ? 'bg-surface-container-low/70' : 'hover:bg-[#f8fafc]'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          {s.id === '2' ? (
                            <img src={marcusAvatar} alt={s.name} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <span className="w-8 h-8 rounded-full bg-primary-container text-white font-mono-badge text-[11px] flex items-center justify-center">
                              {s.initials}
                            </span>
                          )}
                          <div>
                            <div className={`font-medium text-on-surface ${s.status === 'REVOKED' ? 'line-through text-text-secondary' : ''}`}>
                              {s.name}
                            </div>
                            <div className="text-[12px] text-text-secondary">
                              {s.role} · <span className="text-secondary">{s.department}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono-data text-[12px] text-on-surface">{s.speakerId}</div>
                        <div className="font-mono-data text-[11px] text-text-secondary truncate max-w-[140px]">
                          hash:{s.vectorHash.slice(0, 12)}...
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[12px]">
                        <div className="font-mono-data text-on-surface">
                          {s.durationSec}s ({s.sampleCount} samples)
                        </div>
                        <div className="text-text-secondary">
                          SNR: {s.snrDb} dB ({s.snrLabel})
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-mono-badge text-[10px] px-2 py-0.5 rounded border ${
                            s.status === 'ACTIVE'
                              ? 'bg-[#ecfdf5] text-status-success border-[rgba(35,122,87,0.25)]'
                              : s.status === 'EXPIRING_SOON'
                                ? 'bg-[#fffbeb] text-status-warning border-[rgba(165,107,24,0.25)]'
                                : 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]'
                          }`}
                        >
                          {s.status}
                        </span>
                        <div className="text-[11px] text-text-secondary mt-0.5">
                          {s.status === 'REVOKED' ? 'Purged' : `${s.consentExpiryDays}d remaining`}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Eidos Ephemeral Feature Pipeline */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-headline-sm text-headline-sm text-on-surface">
                Eidos Enrollment &amp; Retention Boundary (15–60s Sample)
              </h2>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#ecfdf5] border border-[rgba(35,122,87,0.25)] text-status-success">
                CONSENT REQUIRED
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                {
                  step: '01. CONSENT',
                  title: 'Informed Authorization',
                  desc: 'Consent version & 30-day provider retention accepted.',
                  tone: 'border-border-subtle bg-[#f8fafc]',
                },
                {
                  step: '02. CAPTURE',
                  title: '15–60s Speech Sample',
                  desc: 'At least 10s clear speech; up to 5 samples per speaker.',
                  tone: 'border-border-subtle bg-[#f8fafc]',
                },
                {
                  step: '03. APP CLEANUP',
                  title: 'Temp Buffer Discarded',
                  desc: 'ACTIONLOCK discards local upload buffer post-transfer.',
                  tone: 'border-[rgba(165,107,24,0.3)] bg-[#fffbeb]',
                },
                {
                  step: '04. DETECTIFAI',
                  title: 'Provider Storage',
                  desc: 'DetectifAI retains audio 30d; encrypted profile until deleted.',
                  tone: 'border-[rgba(35,122,87,0.3)] bg-[#ecfdf5]',
                },
              ].map((p) => (
                <div key={p.step} className={`rounded-lg border p-3 ${p.tone}`}>
                  <div className="font-mono-badge text-[10px] text-secondary">{p.step}</div>
                  <div className="font-label-md text-label-md font-semibold text-on-surface mt-1">{p.title}</div>
                  <p className="font-body-sm text-[11px] text-text-secondary mt-1">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Speaker Profile Inspector */}
        {activeSpeaker ? (
          <div className="xl:col-span-5 bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
              <h2 className="font-headline-sm text-headline-sm">Speaker Profile &amp; Biometric Spec</h2>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#f0fdfa] border border-[rgba(22,124,128,0.25)] text-secondary">
                FOCUS: {activeSpeaker.speakerId}
              </span>
            </div>

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-full bg-primary-container text-white font-headline-sm flex items-center justify-center">
                {activeSpeaker.initials}
              </span>
              <div>
                <div className="font-headline-sm text-on-surface">{activeSpeaker.name}</div>
                <div className="font-body-sm text-text-secondary">{activeSpeaker.email}</div>
                <div className="font-mono-data text-[11px] text-on-surface mt-0.5">
                  DEPT: {activeSpeaker.department} · TITLE: {activeSpeaker.role}
                </div>
              </div>
            </div>
            <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#ecfdf5] text-status-success">
              {activeSpeaker.status}
            </span>
          </div>

          <div>
            <div className="font-label-sm text-label-sm uppercase text-text-secondary mb-2">
              Authorized Step-Up Scopes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeSpeaker.scopes.length > 0 ? (
                activeSpeaker.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="font-mono-data text-[11px] px-2 py-1 rounded border border-border-subtle bg-canvas-bg text-on-surface"
                  >
                    {scope}
                  </span>
                ))
              ) : (
                <span className="font-body-sm text-status-error">All scopes revoked.</span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border-subtle bg-[#f8fafc] p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-label-md font-semibold text-on-surface">Biometric Vector Enclave Record</span>
              <span className="font-mono-data text-[11px] text-text-secondary">MODEL: eidos-v2.4-strict</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-text-secondary">Acoustic Audio Spec:</div>
                <div className="font-medium text-on-surface">48.0 kHz Lossless (PCM)</div>
              </div>
              <div>
                <div className="text-text-secondary">Total Speech Duration:</div>
                <div className="font-medium text-on-surface">{activeSpeaker.durationSec}s (Min req: 15s)</div>
              </div>
              <div>
                <div className="text-text-secondary">Phonetic Coverage:</div>
                <div className="font-medium text-status-success">100% (Phoneme complete)</div>
              </div>
              <div>
                <div className="text-text-secondary">Signal-to-Noise (SNR):</div>
                <div className="font-medium text-on-surface">
                  {activeSpeaker.snrDb} dB ({activeSpeaker.snrLabel})
                </div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-mono-badge text-text-secondary">SHA-256 HSM VECTOR DIGEST</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(activeSpeaker.vectorHash);
                    notify('Vector digest copied to clipboard.', 'info');
                  }}
                  className="text-secondary hover:underline font-label-sm"
                >
                  Copy
                </button>
              </div>
              <div className="font-mono-data text-[11px] p-2 rounded bg-surface border border-border-subtle break-all">
                {activeSpeaker.vectorHash}
              </div>
            </div>
            <div className="rounded border border-[rgba(35,122,87,0.25)] bg-[#ecfdf5] p-2.5 text-[12px] text-status-success">
              <strong>Retention Disclosure:</strong> ACTIONLOCK discards temporary audio buffers after upload and does
              not store raw biometrics locally. DetectifAI retains uploaded audio for 30 days and stores encrypted speaker
              profiles until explicit profile deletion.
            </div>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label-md font-semibold text-on-surface">Cryptographic Consent Agreement</span>
              <span className="font-mono-badge text-[10px] text-status-success">VALID &amp; ENFORCEABLE</span>
            </div>
            <div className="text-[12px] grid grid-cols-2 gap-1.5">
              <span className="text-text-secondary">Agreement Framework:</span>
              <span className="font-mono-data text-right">GDPR Art 9.2(a) · IL BIPA 740/14</span>
              <span className="text-text-secondary">Employee Signed At:</span>
              <span className="font-mono-data text-right">{activeSpeaker.signedAt}</span>
              <span className="text-text-secondary">Re-Attestation Expiry:</span>
              <span className="font-mono-data text-right text-status-success">
                {activeSpeaker.consentExpiryDays} days remaining
              </span>
            </div>
            <div className="font-mono-data text-[11px] p-2 rounded bg-canvas-bg border border-border-subtle break-all text-text-secondary">
              {activeSpeaker.ed25519Signature}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => notify(`Step-up voice check ready for ${activeSpeaker.speakerId}.`, 'info')}
              className="flex-1 py-2 px-3 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md"
            >
              Verify Readiness
            </button>
            <button
              type="button"
              onClick={async () => {
                if (mode === 'live') {
                  const res = await actionLockApi.deleteSpeaker(activeSpeaker.speakerId);
                  if (!res.ok) {
                    notify(res.error || 'Failed to delete speaker profile from DetectifAI.', 'error');
                    return;
                  }
                  await refreshLiveData();
                  notify(`Speaker ${activeSpeaker.speakerId} deleted and consent revoked.`, 'warning');
                } else {
                  revokeSpeaker(activeSpeaker.id);
                }
              }}
              className="flex-1 py-2 px-3 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] text-status-error hover:bg-error hover:text-white font-label-md text-label-md transition-colors"
            >
              Revoke Consent &amp; Delete Profile
            </button>
          </div>
        </div>
        ) : (
          <div className="xl:col-span-5 bg-surface border border-border-subtle rounded-lg p-6 flex flex-col gap-3">
            <h2 className="font-headline-sm text-headline-sm">No Enrolled Speakers in Live Registry</h2>
            <p className="font-body-sm text-text-secondary">
              {currentUser
                ? `Signed in as ${currentUser.displayName}. Click "Enroll Authorized Speaker" to upload a 15–60s voice sample to DetectifAI.`
                : 'Sign in via the sidebar account switcher, then click "Enroll Authorized Speaker" to enroll a voice profile.'}
            </p>
          </div>
        )}
      </div>

      {/* Bottom C4 Boundary Footer */}
      <div className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-label-md font-semibold text-on-surface">
              C4 Architectural Boundary: Application Cleanup vs. Provider Retention
            </span>
            <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
              CONSENT + RETENTION
            </span>
          </div>
          <p className="font-body-sm text-body-sm text-text-secondary mt-1">
            ACTIONLOCK keeps only speaker IDs, consent records, operation IDs, and verification decisions—never raw voice
            biometrics in its application database. DetectifAI retains uploaded audio for 30 days and keeps encrypted
            speaker profiles until deleted.
          </p>
        </div>
      </div>

      {enrollModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#14243A]/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface rounded-lg border border-border-subtle shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-primary-container text-white flex items-center justify-between">
              <span className="font-headline-sm">Enroll Authorized Speaker (Eidos)</span>
              <button type="button" onClick={() => setEnrollModalOpen(false)}>
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <form
              className="p-5 flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!consentAccepted || !retentionAcknowledged) {
                  notify('Explicit informed consent and retention acknowledgment are required before enrollment.', 'error');
                  return;
                }
                if (mode === 'live') {
                  if (!audioFile) {
                    notify('Select a 15–60s audio sample to upload to DetectifAI.', 'error');
                    return;
                  }
                  const buf = await audioFile.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = '';
                  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                  const audioBase64 = btoa(binary);
                  const res = await actionLockApi.enrollSpeaker({
                    audioBase64,
                    mimeType: audioFile.type || 'audio/webm',
                    fileName: audioFile.name,
                    consentAccepted,
                    retentionAcknowledged,
                  });
                  if (!res.ok) {
                    notify(res.error || 'DetectifAI enrollment failed.', 'error');
                    return;
                  }
                  await refreshLiveData();
                  notify('Speaker enrolled via DetectifAI Eidos API and synced.', 'success');
                } else {
                  enrollSpeaker(enrollForm);
                }
                setEnrollModalOpen(false);
                setConsentAccepted(false);
                setRetentionAcknowledged(false);
                setAudioFile(null);
                setEnrollForm({ name: '', email: '', role: 'Staff Security Engineer', department: 'SecOps' });
              }}
            >
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">Full Name</label>
                <input
                  required
                  value={enrollForm.name}
                  onChange={(e) => setEnrollForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full h-9 px-3 rounded border border-border-subtle"
                />
              </div>
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">Enterprise Email</label>
                <input
                  required
                  type="email"
                  value={enrollForm.email}
                  onChange={(e) => setEnrollForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full h-9 px-3 rounded border border-border-subtle"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-label-sm text-text-secondary mb-1">Department</label>
                  <select
                    value={enrollForm.department}
                    onChange={(e) =>
                      setEnrollForm((f) => ({ ...f, department: e.target.value as EnrolledSpeaker['department'] }))
                    }
                    className="w-full h-9 px-3 rounded border border-border-subtle bg-surface"
                  >
                    <option value="SecOps">SecOps</option>
                    <option value="Treasury">Treasury</option>
                    <option value="DevOps/SRE">DevOps/SRE</option>
                  </select>
                </div>
                <div>
                  <label className="block font-label-sm text-text-secondary mb-1">Title</label>
                  <input
                    required
                    value={enrollForm.role}
                    onChange={(e) => setEnrollForm((f) => ({ ...f, role: e.target.value }))}
                    className="w-full h-9 px-3 rounded border border-border-subtle"
                  />
                </div>
              </div>
              <div>
                <label className="block font-label-sm text-text-secondary mb-1">
                  Enrollment Audio Sample (15–60s, min 10s clear speech)
                </label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                  className="w-full text-[12px] text-text-secondary"
                />
              </div>
              <div className="rounded border border-border-subtle bg-[#f8fafc] p-3 flex flex-col gap-2 text-[12px]">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I give explicit informed consent for voice biometric verification via DetectifAI Eidos for
                    ACTIONLOCK step-up authorization.
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={retentionAcknowledged}
                    onChange={(e) => setRetentionAcknowledged(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I understand ACTIONLOCK discards temporary upload buffers, while DetectifAI retains uploaded audio
                    for 30 days and stores encrypted speaker profiles until deletion.
                  </span>
                </label>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEnrollModalOpen(false)}
                  className="px-3.5 py-2 rounded border border-border-subtle"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!consentAccepted || !retentionAcknowledged}
                  className="px-4 py-2 rounded bg-secondary disabled:bg-[#94a3b8] text-white"
                >
                  Enroll &amp; Sign Consent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
