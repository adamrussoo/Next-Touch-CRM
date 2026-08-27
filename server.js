// Next Touch / Pipeline Pulse — Replit receiving dashboard
//
// Purpose: this is the "display" half of a push architecture. A Claude Cowork
// scheduled task (the hourly "Next Touch sync" trigger) POSTs the latest
// contact/opportunity data here after every run. This server stores whatever
// it's given and serves a simple dashboard reading that stored data. Claude
// never reads from this server — data only flows one direction, Claude -> here.
//
// Setup (see README-SETUP.md for the full walkthrough):
//   1. In Replit's Secrets panel, set SYNC_SECRET to the value Claude gave you.
//      This is the shared secret Claude's scheduled task authenticates with
//      when it pushes data — treat it like a password.
//   2. Optionally set DASHBOARD_PASSWORD to protect the dashboard view itself
//      with a browser login prompt (recommended — this data includes prospect
//      names, emails, and business details).
//   3. Click Run. Replit will show a public URL — send that URL back to Claude
//      so it can be wired into the sync trigger.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'latest.json');

// ---- In-memory cache, restored from disk on boot so a Replit restart
// doesn't blank the dashboard until the next hourly push arrives. ----
let latestData = {
  source: null,
  syncedAt: null,
  nextTouch: null,
  pipelinePulse: null,
  _meta: { note: 'No data pushed yet. Waiting on the first sync from Claude.' },
};

try {
  if (fs.existsSync(DATA_FILE)) {
    latestData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`Restored last-known data from disk (synced at ${latestData.syncedAt || 'unknown'}).`);
  }
} catch (err) {
  console.error('Could not read existing data/latest.json, starting empty:', err.message);
}

app.use(express.json({ limit: '5mb' }));

// ---------------------------------------------------------------------
// Optional dashboard password gate (HTTP Basic Auth). Only enforced if
// DASHBOARD_PASSWORD is set as a Replit Secret. Does NOT apply to
// /api/sync, which has its own bearer-token check below, or /healthz.
// ---------------------------------------------------------------------
function requireDashboardAuth(req, res, next) {
  const configured = process.env.DASHBOARD_PASSWORD;
  if (!configured) return next(); // no password set -> dashboard is open

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
    if (pass === configured) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Next Touch Dashboard"');
  return res.status(401).send('Authentication required.');
}

// Health check — no auth, useful for confirming the server is up.
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

// ---------------------------------------------------------------------
// POST /api/sync — Claude's scheduled task calls this after every hourly
// run. Auth: `Authorization: Bearer <SYNC_SECRET>` header, checked against
// the SYNC_SECRET Replit Secret. Body is stored as-is and overwrites
// whatever was there before (this is a "latest snapshot" store, not a log).
// ---------------------------------------------------------------------
app.post('/api/sync', (req, res) => {
  const configured = process.env.SYNC_SECRET;
  if (!configured) {
    return res.status(500).json({ ok: false, error: 'Server misconfigured: SYNC_SECRET is not set.' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token !== configured) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing sync secret.' });
  }

  const body = req.body || {};
  const receivedAt = new Date().toISOString();

  latestData = {
    source: body.source || 'unknown',
    syncedAt: body.syncedAt || receivedAt,
    receivedAt,
    nextTouch: body.nextTouch || null,
    pipelinePulse: body.pipelinePulse || null,
    _meta: { note: 'Live data from the last successful sync.' },
  };

  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(latestData, null, 2));
  } catch (err) {
    console.error('Failed to persist synced data to disk:', err.message);
    // Not fatal — we still have it in memory for this run's lifetime.
  }

  const contactCount = latestData.nextTouch?.contacts?.length ?? 0;
  console.log(`[sync] Received push at ${receivedAt} — ${contactCount} contacts, source=${latestData.source}`);

  res.status(200).json({ ok: true, receivedAt, contactCount });
});

// GET /api/data — the dashboard's own frontend JS calls this to render.
// Sits behind the same password gate as the dashboard page itself.
app.get('/api/data', requireDashboardAuth, (req, res) => {
  res.status(200).json(latestData);
});

// Static dashboard frontend (public/index.html + app.js + style.css).
app.use(requireDashboardAuth, express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Next Touch Replit dashboard listening on port ${PORT}`);
  if (!process.env.SYNC_SECRET) {
    console.warn('WARNING: SYNC_SECRET is not set — /api/sync will reject all pushes until it is.');
  }
  if (!process.env.DASHBOARD_PASSWORD) {
    console.warn('NOTE: DASHBOARD_PASSWORD is not set — the dashboard is publicly viewable to anyone with the URL.');
  }
});