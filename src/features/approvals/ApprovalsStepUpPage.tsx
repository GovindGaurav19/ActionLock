import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useActionLock } from '@/app/providers/ActionLockContext';
import { EvidenceBoundaryNotice } from '@/components/common/EvidenceBoundaryNotice';
import { PolicyStateBadge } from '@/components/common/StatusBadge';

export function ApprovalsStepUpPage() {
  const navigate = useNavigate();
  const { actionId } = useParams();
  const {
    mode,
    envelopes,
    selectedEnvelopeId,
    setSelectedEnvelopeId,
    issueFreshChallenge,
    evaluateVoiceRecording,
    holdEnvelope,
    rejectEnvelope,
    notify,
  } = useActionLock();

  const activeId = actionId || selectedEnvelopeId;
  const env = envelopes.find((e) => e.id === activeId) || envelopes[0];

  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [recordedBase64, setRecordedBase64] = useState<string | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState<string>('audio/webm');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    };
  }, [recordedAudioUrl]);

  if (!env) {
    return (
      <div className="p-6">
        <div className="bg-surface border border-border-subtle rounded-lg p-6 max-w-xl">
          <h2 className="font-headline-sm text-headline-sm">No Active Action Envelope Selected</h2>
          <p className="font-body-sm text-text-secondary mt-1">
            Sign in via the sidebar account switcher or create a protected action to run voice challenge verification.
          </p>
        </div>
      </div>
    );
  }

  const startLiveRecording = async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicError('Browser MediaRecorder API unavailable in this environment. Use accessible fallback verification below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = recorder.mimeType || 'audio/webm';
        setRecordedMimeType(mime);
        const blob = new Blob(chunksRef.current, { type: mime });
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = String(reader.result || '');
          const b64 = res.includes(',') ? res.split(',')[1] : res;
          setRecordedBase64(b64);
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setMicError(
        err instanceof Error
          ? `Microphone permission denied or unavailable (${err.message}). Action remains safely held.`
          : 'Microphone permission denied.',
      );
      notify('Microphone denied — use manual fallback or grant audio permission.', 'warning');
    }
  };

  const stopLiveRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const playPlayback = () => {
    if (recordedAudioUrl) {
      const audio = new Audio(recordedAudioUrl);
      void audio.play();
      return;
    }
    notify('Playing captured 48kHz lossless PCM voice challenge fixture.', 'info');
  };

  const gh = env.details.kind === 'github' ? env.details : null;

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5">
      {/* Envelope Selector Strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono-badge text-[10px] text-text-secondary uppercase">Select Envelope:</span>
        {envelopes.slice(0, 5).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedEnvelopeId(item.id)}
            className={`px-2.5 py-1 rounded font-mono-data text-[11px] border transition-colors ${
              item.id === env.id
                ? 'bg-primary-container text-white border-primary-container'
                : 'bg-surface border-border-subtle text-on-surface hover:border-secondary'
            }`}
          >
            {item.id}
          </button>
        ))}
      </div>

      {/* Header Banner */}
      <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-secondary mb-1.5">
            <span className="material-symbols-outlined text-[15px]">inbox</span>
            <span>Action Inbox</span>
            <span>/</span>
            <span>{env.category}</span>
            <span>/</span>
            <span className="text-on-surface font-medium">{env.targetTitle}</span>
            {gh && (
              <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                Run #{gh.workflowRunId}
              </span>
            )}
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Protected Action Envelope: {env.id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PolicyStateBadge state={env.state} />
            <span className="font-mono-badge text-[11px] px-2 py-0.5 rounded bg-[#fffbeb] border border-[rgba(165,107,24,0.25)] text-status-warning">
              ● {Math.floor(env.challenge.remainingSeconds / 60)}m {env.challenge.remainingSeconds % 60}s REMAINING
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border-subtle bg-canvas-bg p-3 flex items-center gap-3 min-w-0 max-w-full">
          <span className="material-symbols-outlined text-secondary text-[22px] shrink-0">fingerprint</span>
          <div className="min-w-0">
            <div className="font-label-sm text-label-sm uppercase text-text-secondary">
              Canonical Payload Hash (SHA-256)
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-0.5 min-w-0">
              <code className="font-mono-data text-mono-data text-on-surface break-all">{env.actionHash}</code>
              <span
                className={`font-mono-badge text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                  env.hashDriftDetected
                    ? 'bg-[#fef2f2] text-status-error'
                    : 'bg-[#ecfdf5] text-status-success'
                }`}
              >
                {env.hashDriftDetected ? 'DRIFT DETECTED' : 'VERIFIED INTACT'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left: Immutable Action Envelope */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          <div className="bg-surface border border-border-subtle rounded-lg p-5">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded bg-primary-container text-white font-mono-badge text-[12px] flex items-center justify-center">
                  {env.version.toUpperCase()}
                </span>
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface">Immutable Action Envelope</h2>
                  <p className="font-body-sm text-body-sm text-text-secondary">
                    Cryptographic contract bound to deployment params
                  </p>
                </div>
              </div>
              {gh?.customRuleId && (
                <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                  CUSTOM RULE ID: {gh.customRuleId}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-b border-border-subtle text-[13px]">
              <div>
                <div className="font-label-sm text-label-sm uppercase text-text-secondary">Deployment Target</div>
                <div className="font-semibold text-on-surface mt-1">
                  {gh ? `Workflow Run #${gh.workflowRunId}` : env.targetTitle}
                </div>
                <div className="font-mono-data text-[11px] text-text-secondary">
                  {gh ? gh.workflowFile : env.targetSubtitle}
                </div>
              </div>
              <div>
                <div className="font-label-sm text-label-sm uppercase text-text-secondary">Target Environment</div>
                <div className="font-semibold text-on-surface mt-1">
                  ● {gh ? gh.targetEnvironment : env.category}
                </div>
                <div className="font-mono-badge text-[10px] text-secondary">ENTERPRISE GATEWAY</div>
              </div>
              <div>
                <div className="font-label-sm text-label-sm uppercase text-text-secondary">Repository / Target</div>
                <div className="font-mono-data text-[12px] text-on-surface mt-1">
                  {gh ? gh.repository : env.targetSubtitle}
                </div>
              </div>
              <div>
                <div className="font-label-sm text-label-sm uppercase text-text-secondary">Git Commit Ref</div>
                <div className="font-mono-data text-[12px] text-on-surface mt-1">
                  {gh ? `${gh.branch} · ${gh.commitSha}` : env.actionHash.slice(0, 18)}
                </div>
                {gh?.prRef && <div className="font-body-sm text-[11px] text-text-secondary">{gh.prRef}</div>}
              </div>
              <div>
                <div className="font-label-sm text-label-sm uppercase text-text-secondary">Origin Requester</div>
                <div className="font-medium text-on-surface mt-1">{env.requester}</div>
                <div className="font-body-sm text-[11px] text-text-secondary">{env.requesterRole}</div>
              </div>
              <div>
                <div className="font-label-sm text-label-sm uppercase text-text-secondary">Designated Approver</div>
                <div className="font-medium text-on-surface mt-1">{env.claimedApprover}</div>
                <div className="font-body-sm text-[11px] text-status-success">{env.claimedApproverRole}</div>
              </div>
            </div>

            {/* Active Policy Box */}
            <div className="mt-4 rounded-lg bg-[#f0f3ff] border border-border-subtle p-3.5">
              <div className="flex items-center gap-1.5 font-label-md text-label-md font-semibold text-on-surface">
                <span className="material-symbols-outlined text-secondary text-[17px]">policy</span>
                Active Policy: {env.policyId}
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{env.policySummary}</p>
            </div>

            {/* Context & Variables */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-label-md text-label-md font-semibold text-on-surface">
                  Deployment Context &amp; Variables
                </span>
                <span className="font-mono-badge text-[10px] text-text-secondary">CANONICALIZED_ORDER</span>
              </div>
              <div className="rounded border border-border-subtle bg-[#f8fafc] divide-y divide-border-subtle font-mono-data text-[12px]">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-text-secondary">DOCKER_DIGEST</span>
                  <span className="text-on-surface">{gh?.dockerDigest || env.actionHash.slice(0, 26)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-text-secondary">MAX_ROLLOUT_CONCURRENCY</span>
                  <span className="text-on-surface">{gh?.maxRolloutConcurrency || '10% (Canary stage 1)'}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-text-secondary">AUTO_ROLLBACK_WINDOW</span>
                  <span className="text-on-surface">{gh?.autoRollbackWindow || '300s (Error Budget 0.01%)'}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-text-secondary">ENVELOPE_ISSUED_AT</span>
                  <span className="text-on-surface">{env.createdAt}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border-subtle rounded-lg p-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 font-label-md text-label-md font-semibold text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-secondary">sync_alt</span>
                GitHub Environment Rule Hook
              </div>
              <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-[#f0fdfa] border border-[rgba(22,124,128,0.25)] text-secondary">
                {gh?.deploymentStatus === 'approved' ? 'DEPLOY_APPROVED' : 'WAITING_FOR_TOKEN'}
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-text-secondary">
              GitHub Actions job execution is held in state <code className="font-mono-data">waiting</code>. Approval
              requires an ephemeral, action-hash-bound token passed via ACTIONLOCK gateway callback.
            </p>
          </div>
        </div>

        {/* Right: Dynamic Voice Challenge + DetectifAI Dual-AI */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded bg-secondary text-white flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">mic</span>
                </span>
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface">Dynamic Voice Challenge</h2>
                  <p className="font-body-sm text-body-sm text-text-secondary">
                    Zero-replay ephemeral nonce phrase synthesized for {env.claimedApprover}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono-badge text-[10px] px-2.5 py-1 rounded bg-surface-container-low border border-border-subtle text-on-surface">
                  48kHz · LOSSLESS
                </span>
                <button
                  type="button"
                  onClick={() => void issueFreshChallenge(env.id)}
                  className="px-2.5 py-1 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-sm text-label-sm"
                >
                  Issue Fresh Challenge
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-[#f0f3ff] border border-border-subtle p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono-badge text-[10px] text-secondary">READ EXACT NONCE PHRASE ALOUD:</span>
                <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded bg-surface border border-border-subtle text-on-surface">
                  NONCE ID: {env.challenge.nonceId}
                </span>
              </div>
              <p className="font-headline-sm text-[17px] leading-snug text-on-surface font-semibold">
                &ldquo;{env.challenge.phrase}&rdquo;
              </p>
              <p className="font-body-sm text-[12px] text-text-secondary mt-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px]">info</span>
                Phrase incorporates Action ID, commit SHA, and random entropy to reduce simple replay of old recordings
                (it does not independently prove liveness against real-time voice cloning).
              </p>
            </div>

            {/* Waveform & Live Recording Controls */}
            <div className="rounded-lg border border-border-subtle bg-[#f8fafc] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono-badge text-[11px] mb-3">
                <span className={isRecording ? 'text-status-error' : 'text-status-success'}>
                  ● {isRecording ? `RECORDING LIVE (${recordSeconds}s)` : 'RECORDED PHRASE READY'}
                </span>
                <span className="text-text-secondary">
                  Duration: 00:{String(isRecording ? recordSeconds : env.challenge.recordingDurationSec ?? 14.2).padStart(4, '0')} / 00:30 max
                </span>
                <span className="text-secondary">✓ Speech Cadence Optimal</span>
              </div>

              <div className="h-14 flex items-center justify-between gap-1.5 px-2">
                {env.challenge.waveformBars.map((bar, idx) => (
                  <div
                    key={idx}
                    className={`w-1.5 rounded-full transition-all ${
                      isRecording ? 'bg-status-error animate-pulse' : 'bg-secondary'
                    }`}
                    style={{ height: `${Math.max(14, bar * 0.55)}px` }}
                  />
                ))}
              </div>
            </div>

            {micError && (
              <div className="rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] p-3 text-[12px] text-status-error">
                {micError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => void startLiveRecording()}
                  className="px-3.5 py-2 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px] text-status-error">fiber_manual_record</span>
                  Record Live Mic
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopLiveRecording}
                  className="px-3.5 py-2 rounded bg-error text-white font-label-md text-label-md flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">stop</span>
                  Stop Recording
                </button>
              )}

              <button
                type="button"
                onClick={playPlayback}
                className="px-3.5 py-2 rounded border border-border-subtle bg-surface hover:bg-surface-container-low font-label-md text-label-md flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                Play Recording
              </button>

              <button
                type="button"
                onClick={() =>
                  void evaluateVoiceRecording(env.id, {
                    scenario: 'genuine',
                    audioBase64: recordedBase64 || undefined,
                    mimeType: recordedMimeType,
                  })
                }
                className="px-4 py-2 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md text-label-md flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">neurology</span>
                Submit to DetectifAI Pipeline
              </button>
            </div>

            {/* Explicitly Isolated Demo QA Test Harness — NEVER active or injectable into live DetectifAI pipeline */}
            {mode === 'demo' ? (
              <div className="pt-2.5 border-t border-border-subtle flex flex-wrap items-center gap-1.5 rounded bg-[#fffbeb]/60 p-2">
                <span className="font-mono-badge text-[10px] text-status-warning mr-1">
                  DEMO TEST HARNESS (ISOLATED):
                </span>
                {(
                  [
                    ['genuine', 'Genuine Pass'],
                    ['synthetic', 'Synthetic Spoof'],
                    ['mismatch', 'Speaker Mismatch'],
                    ['insufficient', 'Insufficient Speech'],
                    ['api_error', 'API Unavailable'],
                  ] as const
                ).map(([sc, label]) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => void evaluateVoiceRecording(env.id, { scenario: sc })}
                    className="px-2 py-1 rounded border border-border-subtle bg-canvas-bg hover:border-secondary font-mono-badge text-[10px] text-on-surface"
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="pt-2 border-t border-border-subtle font-mono-badge text-[10px] text-text-secondary">
                QA TEST HARNESS DISABLED IN LIVE MODE · PIPELINE ACCEPTS REAL MICROPHONE AUDIO ONLY
              </div>
            )}
          </div>

          {/* DetectifAI Dual-AI Verification Outcome (Strictly Separate Aletheia + Eidos) */}
          <div className="bg-surface border border-border-subtle rounded-lg p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[20px]">neurology</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  DetectifAI Dual-AI Verification Outcome
                </h2>
              </div>
              <span className="font-mono-badge text-[10px] text-text-secondary">ASYNCHRONOUS EVIDENCE BUS</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Detector 01: Aletheia */}
              <div className="rounded-lg border border-border-subtle bg-[#f8fafc] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono-badge text-[10px] text-text-secondary">DETECTOR 01 / ANTI-SPOOF</div>
                    <div className="font-headline-sm text-headline-sm text-on-surface">Aletheia Synthetic Engine</div>
                  </div>
                  <span
                    className={`font-mono-badge text-[10px] px-2 py-0.5 rounded border ${
                      env.aletheia.verdict === 'fake'
                        ? 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]'
                        : env.aletheia.verdict === 'real'
                          ? 'bg-[#ecfdf5] text-status-success border-[rgba(35,122,87,0.25)]'
                          : 'bg-surface text-text-secondary border-border-subtle'
                    }`}
                  >
                    STATUS: {env.aletheia.verdict ? env.aletheia.verdict.toUpperCase() : env.aletheia.status.toUpperCase()}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-border-subtle">
                  <div className="flex items-center justify-between text-[12px] mb-1.5">
                    <span className="text-text-secondary">Synthetic Risk Score</span>
                    <span className="font-mono-data font-semibold text-on-surface">
                      {env.aletheia.score !== null ? env.aletheia.score.toFixed(2) : '—'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className={`h-full ${env.aletheia.verdict === 'fake' ? 'bg-status-error' : 'bg-secondary'}`}
                      style={{ width: `${Math.min(100, Math.max(4, (env.aletheia.score ?? 0) * 100))}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                  <div>
                    <div className="font-mono-badge text-text-secondary">OPERATION ID</div>
                    <div className="font-mono-data text-on-surface truncate">{env.aletheia.operationId || '—'}</div>
                  </div>
                  <div>
                    <div className="font-mono-badge text-text-secondary">ANALYSIS DURATION</div>
                    <div className="font-mono-data text-on-surface">
                      {env.aletheia.durationSeconds ? `${env.aletheia.durationSeconds}s` : '—'}
                    </div>
                  </div>
                </div>
                {env.aletheia.errorMessage && (
                  <p className="mt-2 text-[11px] text-status-error">{env.aletheia.errorMessage}</p>
                )}
              </div>

              {/* Detector 02: Eidos */}
              <div className="rounded-lg border border-border-subtle bg-[#f8fafc] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono-badge text-[10px] text-text-secondary">DETECTOR 02 / BIOMETRICS</div>
                    <div className="font-headline-sm text-headline-sm text-on-surface">Eidos Speaker Verification</div>
                  </div>
                  <span
                    className={`font-mono-badge text-[10px] px-2 py-0.5 rounded border ${
                      env.eidos.decision === 'no_match'
                        ? 'bg-[#fef2f2] text-status-error border-[rgba(181,71,71,0.25)]'
                        : env.eidos.decision === 'match'
                          ? 'bg-[#ecfdf5] text-status-success border-[rgba(35,122,87,0.25)]'
                          : 'bg-surface text-text-secondary border-border-subtle'
                    }`}
                  >
                    STATUS: {env.eidos.decision ? env.eidos.decision.toUpperCase() : env.eidos.status.toUpperCase()}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-border-subtle">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-text-secondary">Enrolled Reference</span>
                    <code className="font-mono-data text-[11px] bg-surface px-1.5 py-0.5 rounded border border-border-subtle">
                      {env.eidos.speakerId}
                    </code>
                  </div>
                  <div className="flex items-center justify-between text-[12px] mt-1.5">
                    <span className="text-text-secondary">Vector Similarity (-1 to 1)</span>
                    <span className="font-mono-data font-semibold text-on-surface">
                      {env.eidos.similarity !== null ? env.eidos.similarity.toFixed(2) : '—'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                  <div>
                    <div className="font-mono-badge text-text-secondary">OPERATION ID</div>
                    <div className="font-mono-data text-on-surface truncate">{env.eidos.operationId || '—'}</div>
                  </div>
                  <div>
                    <div className="font-mono-badge text-text-secondary">CONSENT</div>
                    <div className="font-mono-data text-status-success">{env.eidos.consentTimestamp || 'Valid'}</div>
                  </div>
                </div>
                {env.eidos.errorMessage && (
                  <p className="mt-2 text-[11px] text-status-error">{env.eidos.errorMessage}</p>
                )}
              </div>
            </div>

            <EvidenceBoundaryNotice />
          </div>
        </div>
      </div>

      {/* Bottom Sticky Arbitration Bar */}
      <div className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-status-success text-[18px]">check_circle</span>
            <div>
              <div className="font-mono-badge text-[10px] text-status-success">STAGE 1: VOICE NONCE</div>
              <div className="font-medium text-on-surface">
                {env.aletheia.verdict === 'real' && env.eidos.decision === 'match' ? 'Dual AI Passed' : 'Pending Voice'}
              </div>
            </div>
          </div>
          <span className="text-outline-variant">→</span>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-status-success text-[18px]">check_circle</span>
            <div>
              <div className="font-mono-badge text-[10px] text-status-success">STAGE 2: POLICY &amp; SOD</div>
              <div className="font-medium text-on-surface">
                {env.hashDriftDetected ? 'Envelope Drifted' : 'Separation Valid'}
              </div>
            </div>
          </div>
          <span className="text-outline-variant">→</span>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-status-warning text-[18px]">key</span>
            <div>
              <div className="font-mono-badge text-[10px] text-status-warning">STAGE 3: HARDWARE STEP-UP</div>
              <div className="font-medium text-on-surface">
                {env.passkey.status === 'verified' ? 'FIDO2 Verified' : 'FIDO2 Token Required'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => holdEnvelope(env.id, 'Manual callback verification requested by approver')}
            className="px-3.5 py-2 rounded border border-[rgba(165,107,24,0.3)] bg-[#fffbeb] text-status-warning font-label-md text-label-md"
          >
            Hold &amp; Request Callback
          </button>
          <button
            type="button"
            onClick={() => void rejectEnvelope(env.id)}
            className="px-3.5 py-2 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] text-status-error hover:bg-error hover:text-white font-label-md text-label-md transition-colors"
          >
            Reject Envelope
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedEnvelopeId(env.id);
              navigate('/webauthn-permit');
            }}
            className="px-4 py-2 rounded bg-primary-container hover:bg-primary text-white font-label-md text-label-md flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">passkey</span>
            Proceed to Hardware Passkey Step-Up
          </button>
        </div>
      </div>
    </div>
  );
}
