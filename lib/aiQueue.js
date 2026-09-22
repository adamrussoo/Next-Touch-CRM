// lib/aiQueue.js
//
// A queue of AI-specific work items — the only kind of work this system
// should ever spend Claude credits on (summarizing a call, extracting
// structured intelligence, classifying/scoring a prospect, drafting a
// follow-up, writing a Client Brief). Everything else — storing data,
// computing days-since-contact, sorting the dashboard, rendering HTML —
// is plain code and runs in Replit for free.
//
// How this gets drained: a Claude session (manual "Launch Sync", or a
// scheduled task on a modest interval — see REPLIT-SYNC-UPGRADE.md) calls
// GET /api/ai-queue?status=pending. If it's empty, the session does
// nothing further and costs almost nothing. If it's not empty, the
// session claims and processes only those items, then posts results
// back. No full rebuild, no re-scanning every contact "just in case."
//
// Idempotency & concurrency:
//   - `dedupeKey` (e.g. `slug:gmail-thread-id`) prevents a second pending/
//     processing job for the same real-world event from being created.
//   - `claim()` marks a job 'processing' and stamps `claimedBy`/`claimedAt`;
//     a job stuck in 'processing' past STALE_CLAIM_MS is treated as
//     abandoned (the session that claimed it probably crashed/timed out)
//     and is returned to 'pending' automatically the next time the queue
//     is listed, so it isn't lost.
//   - failures retry with backoff up to maxAttempts, then move to
//     'failed' permanently rather than looping forever.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.NEXT_TOUCH_DATA_DIR || path.join(__dirname, '..', 'data'));
const QUEUE_FILE = path.join(DATA_DIR, 'ai-queue.json');

const STALE_CLAIM_MS = 10 * 60 * 1000; // 10 minutes — a session that claims and vanishes releases the job
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [0, 2 * 60 * 1000, 10 * 60 * 1000]; // immediate, +2min, +10min
const MAX_CONCURRENT_PROCESSING = 3;
const QUEUE_CAPACITY = 2000; // oldest completed/failed jobs get trimmed past this
const DEFAULT_WORKSPACE_ID = process.env.NEXT_TOUCH_DEFAULT_WORKSPACE || 'default';

const VALID_TYPES = new Set([
  'summarize-call',
  'extract-intelligence',
  'classify-prospect',
  'draft-followup',
  'generate-brief',
  'other',
]);

let jobs = new Map(); // id -> job
let seq = 0;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFromDisk() {
  ensureDataDir();
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const arr = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      jobs = new Map(arr.map((job) => [job.id, { workspaceId: job.workspaceId || DEFAULT_WORKSPACE_ID, ...job }]));
      seq = arr.reduce((max, j) => Math.max(max, Number(j.id.split('_').pop()) || 0), 0);
      console.log(`[aiQueue] Restored ${jobs.size} job(s) from disk.`);
    }
  } catch (err) {
    console.error('[aiQueue] Could not read data/ai-queue.json, starting empty:', err.message);
  }
}

function captureQueueState() {
  return {
    jobs: new Map([...jobs].map(([id, job]) => [id, structuredClone(job)])),
    seq,
  };
}

function restoreQueueState(previous) {
  jobs = previous.jobs;
  seq = previous.seq;
}

function persistNow() {
  ensureDataDir();
  // Trim old terminal jobs so this file doesn't grow forever.
  const arr = [...jobs.values()];
  if (arr.length > QUEUE_CAPACITY) {
    const terminal = arr.filter((job) => job.status === 'completed' || job.status === 'failed')
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    const toDrop = arr.length - QUEUE_CAPACITY;
    for (let index = 0; index < toDrop && index < terminal.length; index += 1) jobs.delete(terminal[index].id);
  }
  const temporary = `${QUEUE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify([...jobs.values()], null, 2), { mode: 0o600 });
  fs.renameSync(temporary, QUEUE_FILE);
}

function releaseStaleClaims(workspaceId = DEFAULT_WORKSPACE_ID) {
  const previous = captureQueueState();
  const now = Date.now();
  let changed = false;
  for (const job of jobs.values()) {
    if (job.workspaceId === workspaceId && job.status === 'processing' && now - new Date(job.updatedAt).getTime() > STALE_CLAIM_MS) {
      job.status = 'retrying';
      job.claimedBy = null;
      job.updatedAt = new Date().toISOString();
      job.history.push({ at: job.updatedAt, event: 'stale_claim_released' });
      changed = true;
    }
  }
  if (!changed) return;
  try {
    persistNow();
  } catch (err) {
    restoreQueueState(previous);
    throw err;
  }
}

function activeDuplicate(dedupeKey, workspaceId) {
  if (!dedupeKey) return null;
  for (const job of jobs.values()) {
    if (job.workspaceId === workspaceId && job.dedupeKey === dedupeKey
      && (job.status === 'pending' || job.status === 'processing' || job.status === 'retrying')) {
      return job;
    }
  }
  return null;
}

function enqueue({ type, slug, payload, priority = 'normal', dedupeKey, maxAttempts }, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!VALID_TYPES.has(type)) {
    const err = new Error(`Unknown AI task type "${type}". Valid: ${[...VALID_TYPES].join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  const dup = activeDuplicate(dedupeKey, workspaceId);
  if (dup) return { status: 'duplicate', job: dup };

  const previous = captureQueueState();
  const id = `job_${Date.now()}_${++seq}`;
  const now = new Date().toISOString();
  const job = {
    id,
    workspaceId,
    type,
    slug: slug || null,
    payload: payload || {},
    priority, // 'high' | 'normal' | 'low'
    dedupeKey: dedupeKey || null,
    status: 'pending',
    attempts: 0,
    maxAttempts: maxAttempts || DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: now,
    claimedBy: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, event: 'created' }],
  };
  jobs.set(id, job);
  try {
    persistNow();
  } catch (err) {
    restoreQueueState(previous);
    throw err;
  }
  return { status: 'created', job };
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

function listPending(limit = 20, workspaceId = DEFAULT_WORKSPACE_ID) {
  releaseStaleClaims(workspaceId);
  const now = Date.now();
  const eligible = [...jobs.values()].filter(
    (job) => job.workspaceId === workspaceId
      && (job.status === 'pending' || job.status === 'retrying')
      && new Date(job.nextAttemptAt).getTime() <= now
  );
  eligible.sort((a, b) => {
    const pr = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (pr !== 0) return pr;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  return eligible.slice(0, limit);
}

function currentlyProcessingCount(workspaceId = DEFAULT_WORKSPACE_ID) {
  return [...jobs.values()].filter((job) => job.workspaceId === workspaceId && job.status === 'processing').length;
}

function claim(id, claimedBy, workspaceId = DEFAULT_WORKSPACE_ID) {
  const job = jobs.get(id);
  if (!job || job.workspaceId !== workspaceId) return { status: 'not_found' };
  if (job.status !== 'pending' && job.status !== 'retrying') {
    return { status: 'invalid_state', job };
  }
  if (currentlyProcessingCount(workspaceId) >= MAX_CONCURRENT_PROCESSING) {
    return { status: 'concurrency_limit', job };
  }
  const previous = captureQueueState();
  job.status = 'processing';
  job.claimedBy = claimedBy || 'unknown';
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
  job.history.push({ at: job.updatedAt, event: 'claimed', by: job.claimedBy, attempt: job.attempts });
  try {
    persistNow();
  } catch (err) {
    restoreQueueState(previous);
    throw err;
  }
  return { status: 'claimed', job };
}

function complete(id, result, workspaceId = DEFAULT_WORKSPACE_ID) {
  const job = jobs.get(id);
  if (!job || job.workspaceId !== workspaceId) return { status: 'not_found' };
  const previous = captureQueueState();
  job.status = 'completed';
  job.result = result ?? null;
  job.error = null;
  job.updatedAt = new Date().toISOString();
  job.history.push({ at: job.updatedAt, event: 'completed' });
  try {
    persistNow();
  } catch (err) {
    restoreQueueState(previous);
    throw err;
  }
  return { status: 'completed', job };
}

function fail(id, errorMessage, workspaceId = DEFAULT_WORKSPACE_ID) {
  const job = jobs.get(id);
  if (!job || job.workspaceId !== workspaceId) return { status: 'not_found' };
  const previous = captureQueueState();
  job.error = errorMessage || 'Unknown error';
  if (job.attempts >= job.maxAttempts) {
    job.status = 'failed';
    job.updatedAt = new Date().toISOString();
    job.history.push({ at: job.updatedAt, event: 'failed_permanently', error: job.error });
  } else {
    job.status = 'retrying';
    const backoff = RETRY_BACKOFF_MS[Math.min(job.attempts, RETRY_BACKOFF_MS.length - 1)];
    job.nextAttemptAt = new Date(Date.now() + backoff).toISOString();
    job.updatedAt = new Date().toISOString();
    job.history.push({ at: job.updatedAt, event: 'retry_scheduled', nextAttemptAt: job.nextAttemptAt, error: job.error });
  }
  try {
    persistNow();
  } catch (err) {
    restoreQueueState(previous);
    throw err;
  }
  return { status: job.status, job };
}

function skip(id, reason, workspaceId = DEFAULT_WORKSPACE_ID) {
  const job = jobs.get(id);
  if (!job || job.workspaceId !== workspaceId) return { status: 'not_found' };
  const previous = captureQueueState();
  job.status = 'skipped';
  job.error = reason || null;
  job.updatedAt = new Date().toISOString();
  job.history.push({ at: job.updatedAt, event: 'skipped', reason });
  try {
    persistNow();
  } catch (err) {
    restoreQueueState(previous);
    throw err;
  }
  return { status: 'skipped', job };
}

function getJob(id, workspaceId = DEFAULT_WORKSPACE_ID) {
  const job = jobs.get(id);
  return job?.workspaceId === workspaceId ? job : null;
}

function getStats(workspaceId = DEFAULT_WORKSPACE_ID) {
  releaseStaleClaims(workspaceId);
  const all = [...jobs.values()].filter((job) => job.workspaceId === workspaceId);
  const byStatus = {};
  for (const j of all) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  return {
    total: all.length,
    byStatus,
    currentlyProcessing: currentlyProcessingCount(workspaceId),
    maxConcurrent: MAX_CONCURRENT_PROCESSING,
  };
}

function listAll({ status, limit = 100, workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
  releaseStaleClaims(workspaceId);
  let arr = [...jobs.values()]
    .filter((job) => job.workspaceId === workspaceId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (status) arr = arr.filter((j) => j.status === status);
  return arr.slice(0, limit);
}

loadFromDisk();

module.exports = {
  enqueue,
  listPending,
  claim,
  complete,
  fail,
  skip,
  getJob,
  getStats,
  listAll,
  VALID_TYPES,
};