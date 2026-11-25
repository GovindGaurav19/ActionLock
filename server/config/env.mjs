import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let loadedDotEnv = false;

/**
 * Loads key=value pairs from .env into process.env only when the key is not already set.
 * Never modifies or overwrites existing .env files.
 */
export function loadLocalEnvFile(envPath = path.resolve(process.cwd(), '.env')) {
  if (loadedDotEnv) return;
  loadedDotEnv = true;
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

const EPHEMERAL_DEV_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const EPHEMERAL_DEV_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');

export function getConfig() {
  loadLocalEnvFile();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  const sessionSecret = process.env.SESSION_SECRET || (isProd ? '' : EPHEMERAL_DEV_SESSION_SECRET);
  if (isProd && !sessionSecret) {
    throw new Error('SESSION_SECRET must be set in production mode');
  }

  return {
    port: Number(process.env.PORT || 8787),
    nodeEnv,
    isProd,
    sqliteDbPath: process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'actionlock.db'),
    databaseUrl: process.env.DATABASE_URL || '',
    sessionSecret,
    sessionCookieName: 'actionlock_sid',
    sessionTtlSeconds: 60 * 60 * 8,
    actionTokenSecret: process.env.ACTION_TOKEN_SECRET || (isProd ? '' : EPHEMERAL_DEV_TOKEN_SECRET),
    detectifAi: {
      apiKey: process.env.DETECTIF_API_KEY || '',
      baseUrl: process.env.DETECTIF_API_BASE_URL || 'https://platform.detectif.ai',
      webhookSecret: process.env.DETECTIF_WEBHOOK_SECRET || '',
    },
    stt: {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || '',
      credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
      languageCode: process.env.STT_LANGUAGE_CODE || 'en-US',
    },
    github: {
      appId: process.env.GITHUB_APP_ID || '',
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY || '',
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    },
    webauthn: {
      rpId: process.env.WEBAUTHN_RP_ID || 'localhost',
      rpName: process.env.WEBAUTHN_RP_NAME || 'ACTIONLOCK Enterprise',
      origin: process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173',
    },
  };
}
