// Next Touch / Pipeline Pulse — Replit receiving dashboard
//
// Purpose: this is the "display" half of a push architecture. A Claude
// Cowork session (manual "Launch Sync", or a scheduled task) pushes
// contact/opportunity data here; this server stores it and serves a
// dashboard reading that stored data. Claude never reads from this
// server for its own detection logic — data only flows Claude -> here.
//
// v2 changes from the original single-file version (see
// REPLIT-SYNC-UPGRADE.md for the full writeup):
//   - Auth is now timing-safe, supports secret ROTATION (SYNC_SECRET +
//     SYNC_SECRET_PREVIOUS), and every accept/reject is logged and
//     rate-limited. See lib/security.js.
//   - POST /api/sync (full snapshot overwrite) still exists, but is now
//     explicitly the "full rebuild" path — rate-limited, and everything
//     else should prefer the incremental routes below.
//   - POST /api/sync/contact and POST /api/sync/batch let a sync push
//     just the contacts that actually changed. Unchanged content is
//     detected by hash and skipped — no write, no log noise beyond
//     "skipped-unchanged." See lib/store.js.
//   - POST /api/sync/section updates one non-contact section (thisWeek,
//     dailyPriorities, callVerbiage, readingTheTape, clientBriefs,
//     pipelinePulse) without touching contacts.
//   - A small AI task queue (/api/ai-queue/*) so Claude sessions are only
//     spun up for genuinely AI-specific work, and only process the
//     specific items waiting — not a full re-scan. See lib/aiQueue.js.
//   - /api/admin/* read-only endpoints expose what's actually been
//     happening (sync log, job counts, security log) so "how much is
//     this costing" is answerable instead of guessed at.
//
// Setup: unchanged from before — SYNC_SECRET and (optionally)
// DASHBOARD_PASSWORD as Replit Secrets. See REPLIT-SYNC-UPGRADE.md for
// the new SYNC_SECRET_PREVIOUS rotation variable.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const security = require('./lib/security');
const store = require('./lib/store');
const aiQueue = require('./lib/aiQueue');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.NEXT_TOUCH_DATA_DIR || path.join(__dirname, 'data'));
const IMPORT_DATA_DIR = path.resolve(process.env.NEXT_TOUCH_IMPORT_DATA_DIR || path.join(__dirname, 'data'));
const USER_STATE_FILE = path.resolve(process.env.NEXT_TOUCH_STATE_FILE || path.join(__dirname, 'data', 'user_state.json'));
const DEFAULT_WORKSPACE_ID = security.DEFAULT_WORKSPACE_ID;
const SESSION_COOKIE = 'next-touch-session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required so browser workspaces remain stable across restarts.');
}
const SESSION_SECRET = process.env.SESSION_SECRET;
const pairingCodes = new Map();
let persistenceQueue = Promise.resolve();
let userStore = readJsonSync(USER_STATE_FILE, { version: 1, users: {} });
if (!userStore || typeof userStore !== 'object' || !userStore.users) {
  userStore = { version: 1, users: {} };
}

// Cap for how many full-snapshot rebuilds are allowed per rolling hour.
// This is the guardrail against "Launch Sync accidentally full-rebuilds
// every time" eating Replit/Claude effort for no reason — incremental
// pushes are uncapped since they're cheap by construction (hash-skipped
// if nothing changed).
const MAX_FULL_SYNCS_PER_HOUR = 6;

app.use(express.json({ limit: '5mb' }));

// -----------------------------------------------------------------------
// Protected personal workspace state.
//
// Imported CRM data remains read-only. Check-offs, personal notes, and
// manual next actions are stored separately and keyed to a signed browser
// session. A one-time device code can point another browser at the same
// workspace record.
// -----------------------------------------------------------------------

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function digest(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function constantTimeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter((part) => part.length));
}

function signedSession(id) {
  return `${id}.${digest(`session:${id}`)}`;
}

function sessionIdFromRequest(req) {
  const value = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
  const [id, signature] = value.split('.');
  return id && signature && constantTimeEqual(signature, digest(`session:${id}`)) ? id : null;
}

function setSessionCookie(req, res, id) {
  const secure = req.headers['x-forwarded-proto'] === 'https'
    || (!String(req.headers.host || '').startsWith('localhost') && !String(req.headers.host || '').startsWith('127.0.0.1'));
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(signedSession(id))}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
  ].filter(Boolean);
  res.append('Set-Cookie', attributes.join('; '));
}

function csrfToken(id) {
  return digest(`csrf:${id}`);
}

function getUser(id, workspaceId) {
  if (!userStore.users[id]) {
    userStore.users[id] = {
      workspaceId,
      completed: {},
      edits: {},
      revision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
  }
  const user = userStore.users[id];
  user.workspaceId ||= DEFAULT_WORKSPACE_ID;
  user.completed ||= {};
  user.edits ||= {};
  user.revision ||= 0;
  return user;
}

function sessionFor(req, res) {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const candidate = sessionIdFromRequest(req);
  const existing = candidate && userStore.users[candidate]
    && (userStore.users[candidate].workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
    ? candidate
    : null;
  const id = existing || crypto.randomUUID();
  if (!existing) setSessionCookie(req, res, id);
  return { id, user: getUser(id, workspaceId), workspaceId };
}

function publicUserState(user) {
  return {
    completed: user.completed,
    edits: user.edits,
    revision: user.revision,
    updatedAt: user.updatedAt,
  };
}

function persistUserStore() {
  const snapshot = JSON.stringify(userStore, null, 2);
  const operation = persistenceQueue.then(async () => {
    await fs.promises.mkdir(path.dirname(USER_STATE_FILE), { recursive: true });
    const temporary = `${USER_STATE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, snapshot, { mode: 0o600 });
    await fs.promises.chmod(temporary, 0o600);
    await fs.promises.rename(temporary, USER_STATE_FILE);
  });
  persistenceQueue = operation.catch(() => {});
  return operation;
}

function contactMap(rawContacts) {
  if (!rawContacts) return {};
  if (Array.isArray(rawContacts)) {
    return Object.fromEntries(rawContacts.map((contact, index) => [
      contact.slug || contact.id || String(index),
      contact,
    ]));
  }
  return typeof rawContacts === 'object' ? rawContacts : {};
}

function workspaceImportFile(workspaceId, filename) {
  return workspaceId === DEFAULT_WORKSPACE_ID
    ? path.join(IMPORT_DATA_DIR, filename)
    : path.join(IMPORT_DATA_DIR, 'workspaces', workspaceId, filename);
}

function sourceSnapshot(workspaceId = DEFAULT_WORKSPACE_ID) {
  const importedContacts = contactMap(readJsonSync(workspaceImportFile(workspaceId, 'contacts_data.json'), {}));
  const importedPipeline = readJsonSync(workspaceImportFile(workspaceId, 'pipeline_data.json'), null);
  const liveSnapshot = store.getSnapshot(workspaceId);
  const liveContacts = contactMap(liveSnapshot.nextTouch?.contacts);
  const livePipeline = liveSnapshot.pipelinePulse;
  const pipelineHasDashboardShape = livePipeline
    && typeof livePipeline === 'object'
    && (Array.isArray(livePipeline.opportunities) || Array.isArray(livePipeline.leads) || livePipeline.metadata);

  return {
    contacts: { ...importedContacts, ...liveContacts },
    pipeline: pipelineHasDashboardShape ? livePipeline : importedPipeline,
    sections: {
      thisWeek: liveSnapshot.thisWeek,
      dailyPriorities: liveSnapshot.dailyPriorities,
      callVerbiage: liveSnapshot.callVerbiage,
      readingTheTape: liveSnapshot.readingTheTape,
      clientBriefs: liveSnapshot.clientBriefs,
    },
  };
}

function safeText(value, max = 4000) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function applyStatePatch(user, body, contacts) {
  if (body.completed !== undefined) {
    if (!body.completed || typeof body.completed !== 'object' || Array.isArray(body.completed)) {
      const error = new Error('Completed state must be an object.');
      error.statusCode = 400;
      throw error;
    }
    for (const [id, value] of Object.entries(body.completed)) {
      if (!Object.prototype.hasOwnProperty.call(contacts, id) || typeof value !== 'boolean') continue;
      if (value) user.completed[id] = true;
      else delete user.completed[id];
    }
  }
  if (body.edits !== undefined) {
    if (!body.edits || typeof body.edits !== 'object' || Array.isArray(body.edits)) {
      const error = new Error('Contact edits must be an object.');
      error.statusCode = 400;
      throw error;
    }
    for (const [id, edit] of Object.entries(body.edits)) {
      if (!Object.prototype.hasOwnProperty.call(contacts, id)) continue;
      if (edit === null) {
        delete user.edits[id];
        continue;
      }
      if (!edit || typeof edit !== 'object') continue;
      const notes = safeText(edit.notes);
      const action = safeText(edit.action);
      if (notes === null || action === null) {
        const error = new Error('Notes and next actions must be text under 4,000 characters.');
        error.statusCode = 400;
        throw error;
      }
      user.edits[id] = { notes, action, updatedAt: new Date().toISOString() };
    }
  }
  user.revision += 1;
  user.updatedAt = new Date().toISOString();
}

function requireCsrf(req, res, id) {
  if (!constantTimeEqual(req.headers['x-csrf-token'] || '', csrfToken(id))) {
    res.status(403).json({ ok: false, error: 'Invalid request token.' });
    return false;
  }
  return true;
}

function createPairingCode(id, workspaceId) {
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  pairingCodes.set(digest(`pair:${code}`), { id, workspaceId, expiresAt: Date.now() + 10 * 60 * 1000 });
  return code;
}

// -----------------------------------------------------------------------
// Health check — no auth.
// -----------------------------------------------------------------------
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

// -----------------------------------------------------------------------
// POST /api/sync — FULL REBUILD. Overwrites the entire stored snapshot.
// Use this only for the first sync, recovering from a bad state, or a
// deliberate full rebuild — not for routine "something changed" pushes.
// -----------------------------------------------------------------------
app.post('/api/sync', security.requireSyncAuth, (req, res) => {
  const { workspaceId } = req.syncAuth;
  const stats = store.getStats(workspaceId);
  if (stats.lastHour.fullSyncs >= MAX_FULL_SYNCS_PER_HOUR) {
    return res.status(429).json({
      ok: false,
      error: `Full-rebuild rate limit hit (${MAX_FULL_SYNCS_PER_HOUR}/hour). Use POST /api/sync/contact or /api/sync/batch for routine updates instead.`,
    });
  }
  try {
    const result = store.applyFullSync(req.body || {}, { usedPreviousSecret: req.syncAuth.usedPreviousSecret }, workspaceId);
    console.log(`[sync] Full rebuild at ${result.receivedAt} — ${result.contactCount} contacts, source=${req.body?.source || 'unknown'}`);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------
// POST /api/sync/contact — upsert ONE contact. Body:
//   { slug, contact, source, eventId }
// `eventId` (optional) should be a stable id for the real-world event
// that triggered this push (a Gmail message id, a calendar event id, a
// call-notes doc id) — it makes a retried push a no-op instead of a
// duplicate write.
// -----------------------------------------------------------------------
app.post('/api/sync/contact', security.requireSyncAuth, (req, res) => {
  try {
    const { slug, contact, source, eventId } = req.body || {};
    const result = store.applyContactUpsert(
      { slug, contact, source, eventId },
      { usedPreviousSecret: req.syncAuth.usedPreviousSecret },
      req.syncAuth.workspaceId,
    );
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------
// POST /api/sync/batch — upsert several contacts in one call. Body:
//   { items: [{ slug, contact, source, eventId }, ...] }
// Use this when a single Launch Sync pass has a handful of changed
// contacts, to avoid one HTTP round trip per contact.
// -----------------------------------------------------------------------
app.post('/api/sync/batch', security.requireSyncAuth, (req, res) => {
  try {
    const result = store.applyContactBatch(
      req.body?.items,
      { usedPreviousSecret: req.syncAuth.usedPreviousSecret },
      req.syncAuth.workspaceId,
    );
    res.status(200).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------
// POST /api/sync/section — update one non-contact section. Body:
//   { section: "thisWeek" | "dailyPriorities" | "callVerbiage" |
//              "readingTheTape" | "clientBriefs" | "pipelinePulse",
//     value: <the section's data>, source }
// -----------------------------------------------------------------------
app.post('/api/sync/section', security.requireSyncAuth, (req, res) => {
  try {
    const { section, value, source } = req.body || {};
    const result = store.applySectionUpdate(section, value, source, req.syncAuth.workspaceId);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------
// AI task queue — the ONLY place Claude-specific work should be tracked.
// A detection pass (still running inside a Claude session, since Replit
// doesn't hold Gmail/Calendar/Apollo/Salesforce credentials) enqueues a
// job here when it finds something that genuinely needs AI reasoning.
// A separate, possibly-scheduled Claude session drains the queue later —
// it does NOT need to be the same session, and it does nothing at all if
// the queue is empty.
// -----------------------------------------------------------------------

// Enqueue a new AI task. Body: { type, slug, payload, priority, dedupeKey }
app.post('/api/ai-queue', security.requireSyncAuth, (req, res) => {
  try {
    const result = aiQueue.enqueue(req.body || {}, req.syncAuth.workspaceId);
    res.status(result.status === 'duplicate' ? 200 : 201).json({ ok: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// List work waiting to be done. A draining session should call this
// FIRST and do nothing else if it comes back empty.
app.get('/api/ai-queue', security.requireSyncAuth, (req, res) => {
  try {
    const status = req.query.status;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    if (status === 'pending') {
      return res.status(200).json({ ok: true, jobs: aiQueue.listPending(limit, req.syncAuth.workspaceId) });
    }
    res.status(200).json({ ok: true, jobs: aiQueue.listAll({ status, limit, workspaceId: req.syncAuth.workspaceId }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Claim a job before working on it (marks 'processing', enforces the
// concurrency cap). Body: { claimedBy: "<session/run identifier>" }
app.post('/api/ai-queue/:id/claim', security.requireSyncAuth, (req, res) => {
  try {
    const result = aiQueue.claim(req.params.id, req.body?.claimedBy, req.syncAuth.workspaceId);
    const statusCode = { claimed: 200, not_found: 404, invalid_state: 409, concurrency_limit: 429 }[result.status] || 200;
    res.status(statusCode).json({ ok: result.status === 'claimed', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Post the AI-generated result. Body: { result: <whatever the task produced> }
app.post('/api/ai-queue/:id/complete', security.requireSyncAuth, (req, res) => {
  try {
    const result = aiQueue.complete(req.params.id, req.body?.result, req.syncAuth.workspaceId);
    res.status(result.status === 'not_found' ? 404 : 200).json({ ok: result.status === 'completed', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Report a failure. Body: { error: "message" }. Retries with backoff up
// to the job's maxAttempts, then moves to 'failed' permanently.
app.post('/api/ai-queue/:id/fail', security.requireSyncAuth, (req, res) => {
  try {
    const result = aiQueue.fail(req.params.id, req.body?.error, req.syncAuth.workspaceId);
    res.status(result.status === 'not_found' ? 404 : 200).json({ ok: result.status !== 'not_found', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Mark a job intentionally skipped (e.g. on review it turned out not to
// need AI processing after all). Body: { reason: "..." }
app.post('/api/ai-queue/:id/skip', security.requireSyncAuth, (req, res) => {
  try {
    const result = aiQueue.skip(req.params.id, req.body?.reason, req.syncAuth.workspaceId);
    res.status(result.status === 'not_found' ? 404 : 200).json({ ok: result.status !== 'not_found', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------
// Green Personal Sales Desk workspace APIs.
// -----------------------------------------------------------------------

app.get('/api/bootstrap', security.requireAdminAuth, (req, res) => {
  const { id, user, workspaceId } = sessionFor(req, res);
  const snapshot = sourceSnapshot(workspaceId);
  res.status(200).json({
    ok: true,
    workspaceId,
    ...snapshot,
    user: publicUserState(user),
    csrfToken: csrfToken(id),
  });
});

app.patch('/api/user-state', security.requireAdminAuth, async (req, res) => {
  const { id, user, workspaceId } = sessionFor(req, res);
  if (!requireCsrf(req, res, id)) return;
  const previousUser = structuredClone(user);
  try {
    const contacts = sourceSnapshot(workspaceId).contacts;
    applyStatePatch(user, req.body || {}, contacts);
    await persistUserStore();
    res.status(200).json({ ok: true, user: publicUserState(user) });
  } catch (err) {
    userStore.users[id] = previousUser;
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

app.post('/api/device-code', security.requireAdminAuth, (req, res) => {
  const { id, workspaceId } = sessionFor(req, res);
  if (!requireCsrf(req, res, id)) return;
  res.status(200).json({ ok: true, code: createPairingCode(id, workspaceId), expiresInSeconds: 600 });
});

app.post('/api/device-link', security.requireAdminAuth, (req, res) => {
  const { id, workspaceId } = sessionFor(req, res);
  if (!requireCsrf(req, res, id)) return;
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const key = digest(`pair:${code}`);
  const pairing = pairingCodes.get(key);
  if (!pairing || pairing.workspaceId !== workspaceId || pairing.expiresAt < Date.now()) {
    if (pairing) pairingCodes.delete(key);
    return res.status(400).json({ ok: false, error: 'That device code is invalid or has expired.' });
  }
  pairingCodes.delete(key);
  setSessionCookie(req, res, pairing.id);
  res.status(200).json({ ok: true });
});

// -----------------------------------------------------------------------
// GET /api/data — the dashboard's own frontend JS calls this to render.
// Unchanged contract from before.
// -----------------------------------------------------------------------
app.get('/api/data', security.requireAdminAuth, (req, res) => {
  res.status(200).json(store.getSnapshot(req.workspaceId));
});

// -----------------------------------------------------------------------
// Read-only visibility into what's actually been happening — this is
// what answers "is this costing more than it should" without guessing.
// -----------------------------------------------------------------------
app.get('/api/admin/stats', security.requireAdminAuth, (req, res) => {
  res.status(200).json({
    ok: true,
    workspaceId: req.workspaceId,
    sync: store.getStats(req.workspaceId),
    aiQueue: aiQueue.getStats(req.workspaceId),
    security: security.getSecuritySummary(req.workspaceId),
  });
});

app.get('/api/admin/sync-log', security.requireAdminAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.status(200).json({ ok: true, entries: store.getSyncLog(limit, req.workspaceId) });
});

app.get('/api/admin/security-log', security.requireAdminAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.status(200).json({ ok: true, entries: security.getSecurityLog(limit, req.workspaceId) });
});

app.get('/api/admin/ai-queue', security.requireAdminAuth, (req, res) => {
  const status = req.query.status;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.status(200).json({ ok: true, jobs: aiQueue.listAll({ status, limit, workspaceId: req.workspaceId }) });
});

// -----------------------------------------------------------------------
// Canonical frontend: the green Personal Sales Desk.
// -----------------------------------------------------------------------
app.use('/app', security.requireAdminAuth, express.static(path.join(__dirname, 'app'), {
  index: false,
  etag: false,
  maxAge: 0,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

app.get('/', security.requireAdminAuth, (req, res) => {
  sessionFor(req, res);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Next Touch Replit dashboard listening on port ${PORT}`);
  if (!process.env.SYNC_SECRET) {
    console.warn('WARNING: SYNC_SECRET is not set — sync/AI-queue routes will reject all requests until it is.');
  }
  if (!process.env.DASHBOARD_PASSWORD && !process.env.NEXT_TOUCH_WORKSPACES_JSON) {
    console.warn('WARNING: dashboard access is disabled until DASHBOARD_PASSWORD or NEXT_TOUCH_WORKSPACES_JSON is configured.');
  }
});