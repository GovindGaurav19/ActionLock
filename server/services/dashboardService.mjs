/**
 * Aggregates real persisted telemetry from SQLite for Overview, Action Inbox,
 * Security Policies, and Integrations & Webhook Monitor.
 */
export function getDashboardSummary(db, config, organisationId) {
  const actionStates = db
    .prepare('SELECT current_state, COUNT(*) AS cnt FROM action_requests WHERE organisation_id = ? GROUP BY current_state')
    .all(organisationId);

  const stateCounts = {};
  let totalEnvelopes = 0;
  for (const row of actionStates) {
    stateCounts[row.current_state] = row.cnt;
    totalEnvelopes += row.cnt;
  }

  const terminalStates = new Set(['CONSUMED', 'REJECTED', 'EXPIRED']);
  const voiceReqStates = new Set(['PENDING', 'CHALLENGE_ISSUED', 'VOICE_CHECK_PENDING']);
  const stepUpStates = new Set(['VOICE_VERIFIED', 'WAITING_FOR_PASSKEY', 'WAITING_FOR_PEER_APPROVAL', 'APPROVED']);

  let activeCount = 0;
  let voiceRequiredCount = 0;
  let stepUpCount = 0;
  let holdCount = (stateCounts.HOLD || 0) + (stateCounts.INVALIDATED || 0);
  let authorizedCount = (stateCounts.TOKEN_ISSUED || 0) + (stateCounts.CONSUMED || 0);

  for (const [st, cnt] of Object.entries(stateCounts)) {
    if (!terminalStates.has(st)) activeCount += cnt;
    if (voiceReqStates.has(st)) voiceRequiredCount += cnt;
    if (stepUpStates.has(st)) stepUpCount += cnt;
  }

  const verifications = db
    .prepare(
      `SELECT vv.eidos_decision, vv.aletheia_verdict
       FROM voice_verifications vv
       JOIN action_requests ar ON ar.id = vv.action_request_id
       WHERE ar.organisation_id = ?`,
    )
    .all(organisationId);

  let completedVerifications = 0;
  let genuineVoicePasses = 0;
  let syntheticFlaggedCount = 0;
  let speakerMismatchCount = 0;
  for (const v of verifications) {
    if (v.eidos_decision || v.aletheia_verdict) completedVerifications += 1;
    if (v.aletheia_verdict === 'fake') syntheticFlaggedCount += 1;
    if (v.eidos_decision === 'no_match') speakerMismatchCount += 1;
    if (v.aletheia_verdict === 'real' && v.eidos_decision === 'match') genuineVoicePasses += 1;
  }

  const voicePassRatePct =
    completedVerifications > 0 ? Number(((genuineVoicePasses / completedVerifications) * 100).toFixed(1)) : null;

  const hashDriftCount =
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM action_requests
         WHERE organisation_id = ? AND (current_state = 'INVALIDATED' OR current_version > 1)`,
      )
      .get(organisationId)?.cnt || 0;

  const tokensRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN consumed_at IS NOT NULL THEN 1 ELSE 0 END) AS consumed
       FROM authorization_tokens WHERE organisation_id = ?`,
    )
    .get(organisationId);

  const policyRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
       FROM approval_policies WHERE organisation_id = ?`,
    )
    .get(organisationId);

  const webhookRows = db
    .prepare(
      `SELECT processing_status, signature_valid, COUNT(*) AS cnt
       FROM webhook_events
       GROUP BY processing_status, signature_valid`,
    )
    .all();

  let whTotal = 0;
  let whProcessed = 0;
  let whFailed = 0;
  let whPending = 0;
  let whSigValid = 0;
  for (const w of webhookRows) {
    whTotal += w.cnt;
    if (w.signature_valid) whSigValid += w.cnt;
    if (w.processing_status === 'PROCESSED') whProcessed += w.cnt;
    else if (w.processing_status === 'FAILED') whFailed += w.cnt;
    else if (w.processing_status === 'PENDING' || w.processing_status === 'RETRYING') whPending += w.cnt;
  }

  const openIncidents =
    db
      .prepare("SELECT COUNT(*) AS cnt FROM security_incidents WHERE organisation_id = ? AND status = 'OPEN'")
      .get(organisationId)?.cnt || 0;

  return {
    generatedAt: new Date().toISOString(),
    envelopes: {
      total: totalEnvelopes,
      activeCount,
      voiceRequiredCount,
      holdCount,
      stepUpCount,
      authorizedCount,
      rejectedCount: stateCounts.REJECTED || 0,
      byState: stateCounts,
    },
    verifications: {
      completedCount: completedVerifications,
      genuinePassCount: genuineVoicePasses,
      syntheticFlaggedCount,
      speakerMismatchCount,
      passRatePct: voicePassRatePct,
    },
    interceptions: {
      totalBlocked: syntheticFlaggedCount + speakerMismatchCount + hashDriftCount,
      syntheticBlocked: syntheticFlaggedCount,
      hashDriftBlocked: hashDriftCount,
      openIncidents,
    },
    tokens: {
      mintedCount: tokensRow?.total || 0,
      consumedCount: tokensRow?.consumed || 0,
    },
    policies: {
      totalCount: policyRow?.total || 0,
      activeCount: policyRow?.active || 0,
    },
    webhooks: {
      totalCount: whTotal,
      processedCount: whProcessed,
      pendingCount: whPending,
      failedCount: whFailed,
      signatureValidCount: whSigValid,
      verifiedRatePct: whTotal > 0 ? Number(((whSigValid / whTotal) * 100).toFixed(1)) : 100,
    },
    integrations: {
      detectifAiConfigured: Boolean(config.detectifAi?.apiKey),
      sttConfigured: Boolean(config.stt?.projectId),
      githubConfigured: Boolean(config.github?.appId && config.github?.privateKey),
      webauthnRpId: config.webauthn?.rpId || 'localhost',
    },
  };
}
