// File-backed, workspace-isolated store for the latest dashboard snapshot.
//
// The default workspace keeps the original data/latest.json and
// data/sync-log.json paths for backward compatibility. Additional workspaces
// use data/workspaces/<workspace-id>/ so pushed contacts, sections, hashes,
// event IDs, and audit logs never share state.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.NEXT_TOUCH_DATA_DIR || path.join(__dirname, '..', 'data'));
const DEFAULT_WORKSPACE_ID = process.env.NEXT_TOUCH_DEFAULT_WORKSPACE || 'default';
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SYNC_LOG_CAPACITY = 500;
const RECENT_EVENT_IDS_PER_CONTACT = 20;
const MAX_BATCH_ITEMS = 500;
const ALLOWED_SECTIONS = new Set([
  'thisWeek',
  'dailyPriorities',
  'callVerbiage',
  'readingTheTape',
  'clientBriefs',
  'pipelinePulse',
]);

const workspaces = new Map();

function emptySnapshot() {
  return {
    source: null,
    syncedAt: null,
    receivedAt: null,
    nextTouch: { contacts: {} },
    thisWeek: null,
    dailyPriorities: null,
    callVerbiage: null,
    readingTheTape: null,
    clientBriefs: null,
    pipelinePulse: null,
    _meta: { note: 'No data pushed yet. Waiting on the first sync.' },
  };
}

function contentHashOf(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function normalizeWorkspaceId(workspaceId = DEFAULT_WORKSPACE_ID) {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    const error = new Error('Invalid workspace identifier.');
    error.statusCode = 400;
    throw error;
  }
  return workspaceId;
}

function workspaceDirectory(workspaceId) {
  return workspaceId === DEFAULT_WORKSPACE_ID
    ? DATA_DIR
    : path.join(DATA_DIR, 'workspaces', workspaceId);
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function createWorkspaceState(workspaceId) {
  const directory = workspaceDirectory(workspaceId);
  const state = {
    workspaceId,
    directory,
    snapshotFile: path.join(directory, 'latest.json'),
    syncLogFile: path.join(directory, 'sync-log.json'),
    latestData: emptySnapshot(),
    contactHashes: new Map(),
    contactRecentEvents: new Map(),
    syncLog: [],
    logWriteQueued: false,
  };
  ensureDirectory(directory);
  try {
    if (fs.existsSync(state.snapshotFile)) {
      const parsed = JSON.parse(fs.readFileSync(state.snapshotFile, 'utf8'));
      const contacts = parsed?.nextTouch?.contacts;
      state.latestData = {
        ...emptySnapshot(),
        ...parsed,
        nextTouch: {
          contacts: contacts && typeof contacts === 'object' && !Array.isArray(contacts) ? contacts : {},
        },
      };
      for (const [slug, contact] of Object.entries(state.latestData.nextTouch.contacts)) {
        state.contactHashes.set(slug, contentHashOf(contact));
      }
      for (const section of ALLOWED_SECTIONS) {
        if (state.latestData[section] !== null && state.latestData[section] !== undefined) {
          state.contactHashes.set(`__section__${section}`, contentHashOf(state.latestData[section]));
        }
      }
      console.log(`[store:${workspaceId}] Restored snapshot from disk (synced at ${state.latestData.syncedAt || 'unknown'}, ${state.contactHashes.size} hashes).`);
    }
  } catch (error) {
    console.error(`[store:${workspaceId}] Could not read snapshot, starting empty:`, error.message);
  }
  try {
    if (fs.existsSync(state.syncLogFile)) {
      const parsed = JSON.parse(fs.readFileSync(state.syncLogFile, 'utf8'));
      state.syncLog = Array.isArray(parsed) ? parsed.slice(-SYNC_LOG_CAPACITY) : [];
    }
  } catch (error) {
    console.error(`[store:${workspaceId}] Could not read sync log, starting empty:`, error.message);
  }
  return state;
}

function workspaceState(workspaceId = DEFAULT_WORKSPACE_ID) {
  const normalized = normalizeWorkspaceId(workspaceId);
  if (!workspaces.has(normalized)) workspaces.set(normalized, createWorkspaceState(normalized));
  return workspaces.get(normalized);
}

function persistSnapshot(state) {
  ensureDirectory(state.directory);
  const temporary = `${state.snapshotFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state.latestData, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, state.snapshotFile);
}

function captureMutableState(state) {
  return {
    latestData: structuredClone(state.latestData),
    contactHashes: new Map(state.contactHashes),
    contactRecentEvents: new Map([...state.contactRecentEvents].map(([slug, events]) => [slug, [...events]])),
  };
}

function restoreMutableState(state, previous) {
  state.latestData = previous.latestData;
  state.contactHashes = previous.contactHashes;
  state.contactRecentEvents = previous.contactRecentEvents;
}

function persistSyncLogSoon(state) {
  if (state.logWriteQueued) return;
  state.logWriteQueued = true;
  setImmediate(() => {
    state.logWriteQueued = false;
    try {
      ensureDirectory(state.directory);
      const temporary = `${state.syncLogFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state.syncLog, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, state.syncLogFile);
    } catch (error) {
      console.error(`[store:${state.workspaceId}] Failed to persist sync log:`, error.message);
    }
  });
}

function recordLog(entry, workspaceId = DEFAULT_WORKSPACE_ID) {
  const state = workspaceState(workspaceId);
  state.syncLog.push({ at: new Date().toISOString(), ...entry });
  if (state.syncLog.length > SYNC_LOG_CAPACITY) state.syncLog.shift();
  persistSyncLogSoon(state);
}

function touchSyncedAt(state, source) {
  state.latestData.syncedAt = new Date().toISOString();
  state.latestData.receivedAt = state.latestData.syncedAt;
  state.latestData.source = source || state.latestData.source || 'unknown';
  state.latestData._meta = { note: 'Live data from the last successful sync.' };
}

function validateSource(source) {
  if (source !== undefined && (typeof source !== 'string' || !source.trim())) {
    const error = new Error('source must be a non-empty string when provided.');
    error.statusCode = 400;
    throw error;
  }
}

function validateContactInput(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    const error = new Error('Each contact item must be an object.');
    error.statusCode = 400;
    throw error;
  }
  if (typeof item.slug !== 'string' || !item.slug.trim()) {
    const error = new Error('slug (non-empty string) is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!item.contact || typeof item.contact !== 'object' || Array.isArray(item.contact)) {
    const error = new Error('contact (object) is required.');
    error.statusCode = 400;
    throw error;
  }
  validateSource(item.source);
  if (item.eventId !== undefined && (typeof item.eventId !== 'string' || !item.eventId.trim())) {
    const error = new Error('eventId must be a non-empty string when provided.');
    error.statusCode = 400;
    throw error;
  }
}

function validateFullSync(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('Request body must be an object.');
    error.statusCode = 400;
    throw error;
  }
  const contacts = body.nextTouch?.contacts;
  if (!contacts || typeof contacts !== 'object' || Array.isArray(contacts)) {
    const error = new Error('nextTouch.contacts (object) is required.');
    error.statusCode = 400;
    throw error;
  }
  validateSource(body.source);
  return contacts;
}

function applyFullSync(body, meta = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  const incomingContacts = validateFullSync(body);
  for (const [slug, contact] of Object.entries(incomingContacts)) {
    validateContactInput({ slug, contact });
  }
  const state = workspaceState(workspaceId);
  const previous = captureMutableState(state);
  const receivedAt = new Date().toISOString();
  try {
    state.latestData = {
      ...emptySnapshot(),
      source: body.source || 'unknown',
      syncedAt: body.syncedAt || receivedAt,
      receivedAt,
      nextTouch: { contacts: incomingContacts },
      thisWeek: body.thisWeek ?? null,
      dailyPriorities: body.dailyPriorities ?? null,
      callVerbiage: body.callVerbiage ?? null,
      readingTheTape: body.readingTheTape ?? null,
      clientBriefs: body.clientBriefs ?? null,
      pipelinePulse: body.pipelinePulse ?? null,
      _meta: { note: 'Live data from the last successful full sync.' },
    };
    state.contactHashes = new Map(Object.entries(incomingContacts).map(([slug, contact]) => [slug, contentHashOf(contact)]));
    for (const section of ALLOWED_SECTIONS) {
      if (state.latestData[section] !== null) {
        state.contactHashes.set(`__section__${section}`, contentHashOf(state.latestData[section]));
      }
    }
    state.contactRecentEvents = new Map();
    persistSnapshot(state);
  } catch (error) {
    restoreMutableState(state, previous);
    throw error;
  }
  const contactCount = Object.keys(incomingContacts).length;
  recordLog({
    type: 'full',
    status: 'applied',
    contactCount,
    source: state.latestData.source,
    usedPreviousSecret: !!meta.usedPreviousSecret,
  }, workspaceId);
  return { ok: true, receivedAt, contactCount };
}

function seenEventRecently(state, slug, eventId) {
  return !!eventId && (state.contactRecentEvents.get(slug) || []).includes(eventId);
}

function rememberEvent(state, slug, eventId) {
  if (!eventId) return;
  const recent = state.contactRecentEvents.get(slug) || [];
  recent.push(eventId);
  while (recent.length > RECENT_EVENT_IDS_PER_CONTACT) recent.shift();
  state.contactRecentEvents.set(slug, recent);
}

function applyContactUpsert(item, meta = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  validateContactInput(item);
  const { slug, contact, source, eventId } = item;
  const state = workspaceState(workspaceId);
  if (seenEventRecently(state, slug, eventId)) {
    recordLog({ type: 'contact', slug, status: 'skipped-duplicate', eventId, source }, workspaceId);
    return { status: 'skipped-duplicate', slug };
  }
  const hash = contentHashOf(contact);
  if (state.contactHashes.get(slug) === hash) {
    rememberEvent(state, slug, eventId);
    recordLog({ type: 'contact', slug, status: 'skipped-unchanged', eventId, source }, workspaceId);
    return { status: 'skipped-unchanged', slug };
  }
  const previous = captureMutableState(state);
  try {
    state.latestData.nextTouch ||= { contacts: {} };
    state.latestData.nextTouch.contacts ||= {};
    state.latestData.nextTouch.contacts[slug] = contact;
    state.contactHashes.set(slug, hash);
    rememberEvent(state, slug, eventId);
    touchSyncedAt(state, source);
    persistSnapshot(state);
  } catch (error) {
    restoreMutableState(state, previous);
    throw error;
  }
  recordLog({
    type: 'contact',
    slug,
    status: 'updated',
    eventId,
    source,
    usedPreviousSecret: !!meta.usedPreviousSecret,
  }, workspaceId);
  return { status: 'updated', slug, hash };
}

function applyContactBatch(items, meta = {}, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('items (non-empty array) is required.');
    error.statusCode = 400;
    throw error;
  }
  if (items.length > MAX_BATCH_ITEMS) {
    const error = new Error(`items cannot contain more than ${MAX_BATCH_ITEMS} contacts.`);
    error.statusCode = 413;
    throw error;
  }
  // Validate the entire batch before writing any item so a bad item cannot
  // create a partial-success response or partially mutate the workspace.
  items.forEach(validateContactInput);
  return {
    ok: true,
    results: items.map((item) => ({ slug: item.slug, ...applyContactUpsert(item, meta, workspaceId) })),
  };
}

function applySectionUpdate(sectionName, value, source, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!ALLOWED_SECTIONS.has(sectionName)) {
    const error = new Error(`Unknown section "${sectionName}".`);
    error.statusCode = 400;
    throw error;
  }
  if (value === undefined) {
    const error = new Error('value is required, including null when intentionally clearing a section.');
    error.statusCode = 400;
    throw error;
  }
  validateSource(source);
  const state = workspaceState(workspaceId);
  const hash = contentHashOf(value);
  const hashKey = `__section__${sectionName}`;
  if (state.contactHashes.get(hashKey) === hash) {
    recordLog({ type: 'section', section: sectionName, status: 'skipped-unchanged', source }, workspaceId);
    return { status: 'skipped-unchanged', section: sectionName };
  }
  const previous = captureMutableState(state);
  try {
    state.latestData[sectionName] = value;
    state.contactHashes.set(hashKey, hash);
    touchSyncedAt(state, source);
    persistSnapshot(state);
  } catch (error) {
    restoreMutableState(state, previous);
    throw error;
  }
  recordLog({ type: 'section', section: sectionName, status: 'updated', source }, workspaceId);
  return { status: 'updated', section: sectionName };
}

function getSnapshot(workspaceId = DEFAULT_WORKSPACE_ID) {
  return workspaceState(workspaceId).latestData;
}

function getSyncLog(limit = 100, workspaceId = DEFAULT_WORKSPACE_ID) {
  return workspaceState(workspaceId).syncLog.slice(-limit).reverse();
}

function getStats(workspaceId = DEFAULT_WORKSPACE_ID) {
  const state = workspaceState(workspaceId);
  const now = Date.now();
  const last24h = state.syncLog.filter((entry) => now - new Date(entry.at).getTime() < 24 * 3600_000);
  const lastHour = state.syncLog.filter((entry) => now - new Date(entry.at).getTime() < 3600_000);
  const fullSyncsLast24h = last24h.filter((entry) => entry.type === 'full' && entry.status === 'applied');
  const contactUpdatesLast24h = last24h.filter((entry) => entry.type === 'contact' && entry.status === 'updated');
  const skippedLast24h = last24h.filter((entry) => entry.status?.startsWith('skipped'));
  return {
    workspaceId,
    contactCount: Object.keys(state.latestData.nextTouch?.contacts || {}).length,
    lastSyncedAt: state.latestData.syncedAt,
    lastSyncSource: state.latestData.source,
    last24h: {
      fullSyncs: fullSyncsLast24h.length,
      contactUpdates: contactUpdatesLast24h.length,
      skippedUnchangedOrDuplicate: skippedLast24h.length,
      totalLogEvents: last24h.length,
    },
    lastHour: {
      fullSyncs: lastHour.filter((entry) => entry.type === 'full' && entry.status === 'applied').length,
      contactUpdates: lastHour.filter((entry) => entry.type === 'contact' && entry.status === 'updated').length,
    },
    estimatedRelativeLoad: fullSyncsLast24h.length * 25 + contactUpdatesLast24h.length,
  };
}

// Load the default workspace at startup so configuration or disk errors are
// visible before the server begins accepting requests.
workspaceState(DEFAULT_WORKSPACE_ID);

module.exports = {
  applyFullSync,
  applyContactUpsert,
  applyContactBatch,
  applySectionUpdate,
  getSnapshot,
  getSyncLog,
  getStats,
  recordLog,
  contentHashOf,
  DEFAULT_WORKSPACE_ID,
};