// lib/security.js
//
// Auth + abuse protection for the machine-to-machine endpoints
// (/api/sync, /api/sync/contact, /api/sync/batch, /api/ai-queue/*).
//
// What changed vs. the original inline check in server.js:
//   - timing-safe comparison (crypto.timingSafeEqual) instead of `!==`,
//     so the response time can't be used to brute-force the secret
//     character-by-character.
//   - secret ROTATION: SYNC_SECRET_PREVIOUS is accepted alongside
//     SYNC_SECRET for a grace period, so you can roll the secret without
//     a hard cutover (see "Rotating SYNC_SECRET" in REPLIT-SYNC-UPGRADE.md).
//   - every request is logged (accepted or rejected) to a capped
//     in-memory ring buffer, readable at GET /api/admin/security-log —
//     "reject silently" is no longer a thing that can happen.
//   - a per-IP failed-attempt limiter: after too many bad tokens from the
//     same source in a short window, that source gets a 429 for a cool-off
//     period instead of being allowed to keep guessing.

const crypto = require('crypto');

const FAILED_ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const FAILED_ATTEMPT_LIMIT = 20; // per IP, per window
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes once tripped
const LOG_CAPACITY = 500;
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DEFAULT_WORKSPACE_ID = process.env.NEXT_TOUCH_DEFAULT_WORKSPACE || 'default';

const securityLog = []; // ring buffer: { at, ip, path, ok, reason }
const failedAttempts = new Map(); // ip -> { count, windowStart, lockedUntil }

function loadWorkspaceConfig() {
  const raw = process.env.NEXT_TOUCH_WORKSPACES_JSON;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('NEXT_TOUCH_WORKSPACES_JSON must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) {
    throw new Error('NEXT_TOUCH_WORKSPACES_JSON must be a non-empty object.');
  }
  for (const [workspaceId, config] of Object.entries(parsed)) {
    if (!WORKSPACE_ID_PATTERN.test(workspaceId) || !config || typeof config !== 'object') {
      throw new Error(`Invalid workspace configuration for "${workspaceId}".`);
    }
    if (typeof config.dashboardPassword !== 'string' || !config.dashboardPassword
      || typeof config.syncSecret !== 'string' || !config.syncSecret) {
      throw new Error(`Workspace "${workspaceId}" requires dashboardPassword and syncSecret.`);
    }
  }
  if (!parsed[DEFAULT_WORKSPACE_ID]) {
    throw new Error(`NEXT_TOUCH_DEFAULT_WORKSPACE "${DEFAULT_WORKSPACE_ID}" is not configured.`);
  }
  return parsed;
}

const WORKSPACE_CONFIG = loadWorkspaceConfig();

function pushLog(entry) {
  securityLog.push(entry);
  if (securityLog.length > LOG_CAPACITY) securityLog.shift();
}

function clientIp(req) {
  // Replit sits behind a proxy; prefer the forwarded header, fall back to
  // the socket address. Good enough for rate-limiting, not for legal audit.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function isLockedOut(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry || !entry.lockedUntil) return false;
  if (Date.now() > entry.lockedUntil) {
    failedAttempts.delete(ip);
    return false;
  }
  return true;
}

function recordFailure(ip) {
  const now = Date.now();
  let entry = failedAttempts.get(ip);
  if (!entry || now - entry.windowStart > FAILED_ATTEMPT_WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: null };
  }
  entry.count += 1;
  if (entry.count >= FAILED_ATTEMPT_LIMIT) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
  failedAttempts.set(ip, entry);
}

function clearFailures(ip) {
  failedAttempts.delete(ip);
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against itself so the branch above doesn't leak a timing
    // signal based on length; the result here is discarded.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function workspaceConfiguration(workspaceId) {
  if (WORKSPACE_CONFIG) return WORKSPACE_CONFIG[workspaceId] || null;
  if (workspaceId !== DEFAULT_WORKSPACE_ID) return null;
  return {
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    syncSecret: process.env.SYNC_SECRET,
    syncSecretPrevious: process.env.SYNC_SECRET_PREVIOUS,
  };
}

function requestedSyncWorkspace(req) {
  const value = req.headers['x-workspace-id'] || req.body?.workspaceId || DEFAULT_WORKSPACE_ID;
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value) ? value : null;
}

function configuredSecrets(workspaceId = DEFAULT_WORKSPACE_ID) {
  const config = workspaceConfiguration(workspaceId);
  return [config?.syncSecret, config?.syncSecretPrevious].filter(Boolean);
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Express middleware: verifies the Authorization: Bearer <SYNC_SECRET>
 * header on every machine-to-machine route. Logs and rate-limits.
 * Attaches `req.syncAuth = { usedPreviousSecret }` on success.
 */
function requireSyncAuth(req, res, next) {
  const ip = clientIp(req);
  const path = req.originalUrl;
  const workspaceId = requestedSyncWorkspace(req);

  if (isLockedOut(ip)) {
    pushLog({ at: new Date().toISOString(), ip, path, workspaceId, ok: false, reason: 'locked_out' });
    return res.status(429).json({
      ok: false,
      error: 'Too many failed authentication attempts from this source. Try again later.',
    });
  }

  if (!workspaceId) {
    recordFailure(ip);
    pushLog({ at: new Date().toISOString(), ip, path, workspaceId: null, ok: false, reason: 'invalid_workspace' });
    return res.status(400).json({ ok: false, error: 'X-Workspace-Id must contain only letters, numbers, underscores, or hyphens.' });
  }

  const secrets = configuredSecrets(workspaceId);
  if (secrets.length === 0) {
    recordFailure(ip);
    pushLog({ at: new Date().toISOString(), ip, path, workspaceId, ok: false, reason: 'unknown_or_misconfigured_workspace' });
    return res.status(401).json({ ok: false, error: 'Invalid workspace or sync secret.' });
  }

  const token = extractBearerToken(req);
  if (!token) {
    recordFailure(ip);
    pushLog({ at: new Date().toISOString(), ip, path, workspaceId, ok: false, reason: 'missing_token' });
    return res.status(401).json({ ok: false, error: 'Missing Authorization: Bearer <token> header.' });
  }

  const matchIndex = secrets.findIndex((secret) => timingSafeStringEqual(token, secret));
  if (matchIndex === -1) {
    recordFailure(ip);
    pushLog({ at: new Date().toISOString(), ip, path, workspaceId, ok: false, reason: 'invalid_token' });
    return res.status(401).json({ ok: false, error: 'Invalid workspace or sync secret.' });
  }

  clearFailures(ip);
  const usedPreviousSecret = matchIndex > 0; // index 0 is always current SYNC_SECRET
  if (usedPreviousSecret) {
    // Still accepted (grace period), but worth surfacing so Adam notices
    // if a caller never got updated to the new secret.
    pushLog({ at: new Date().toISOString(), ip, path, workspaceId, ok: true, reason: 'accepted_previous_secret' });
  } else {
    pushLog({ at: new Date().toISOString(), ip, path, workspaceId, ok: true, reason: 'accepted' });
  }
  req.syncAuth = { usedPreviousSecret, workspaceId };
  next();
}

/**
 * Separate, simpler gate for read-only admin/metrics endpoints. Reuses
 * DASHBOARD_PASSWORD (Basic auth) if set; if it's not set, admin routes
 * are open on the theory that the whole dashboard is already open too.
 * Set DASHBOARD_PASSWORD in production if this dashboard URL is shared.
 */
function requireAdminAuth(req, res, next) {
  const fallbackConfig = workspaceConfiguration(DEFAULT_WORKSPACE_ID);
  if (!WORKSPACE_CONFIG && !fallbackConfig?.dashboardPassword) {
    return res.status(503).send('Dashboard access is disabled until DASHBOARD_PASSWORD is configured.');
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const username = idx >= 0 ? decoded.slice(0, idx) : '';
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
    const workspaceId = WORKSPACE_CONFIG ? username : DEFAULT_WORKSPACE_ID;
    const configured = workspaceConfiguration(workspaceId)?.dashboardPassword;
    if (configured && timingSafeStringEqual(pass, configured)) {
      req.workspaceId = workspaceId;
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Next Touch Admin"');
  return res.status(401).send('Authentication required.');
}

function getSecurityLog(limit = 100, workspaceId = DEFAULT_WORKSPACE_ID) {
  return securityLog.filter((entry) => entry.workspaceId === workspaceId).slice(-limit).reverse();
}

function getSecuritySummary(workspaceId = DEFAULT_WORKSPACE_ID) {
  const now = Date.now();
  const workspaceEntries = securityLog.filter((entry) => entry.workspaceId === workspaceId);
  const lastHour = workspaceEntries.filter((entry) => now - new Date(entry.at).getTime() < 3600_000);
  return {
    totalLogged: workspaceEntries.length,
    lastHour: {
      total: lastHour.length,
      accepted: lastHour.filter((e) => e.ok).length,
      rejected: lastHour.filter((e) => !e.ok).length,
      usedPreviousSecret: lastHour.filter((e) => e.reason === 'accepted_previous_secret').length,
    },
    currentlyLockedOutIps: [...failedAttempts.entries()]
      .filter(([, v]) => v.lockedUntil && v.lockedUntil > now)
      .map(([ip]) => ip),
    secretsConfigured: configuredSecrets(workspaceId).length, // 1 = normal, 2 = mid-rotation, 0 = misconfigured
  };
}

module.exports = {
  requireSyncAuth,
  requireAdminAuth,
  getSecurityLog,
  getSecuritySummary,
  timingSafeStringEqual,
  DEFAULT_WORKSPACE_ID,
};