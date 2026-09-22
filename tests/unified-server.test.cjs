const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { after, before, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'next-touch-unified-'));
const dataDir = path.join(temporaryRoot, 'data');
const userStateFile = path.join(dataDir, 'user_state.json');
const port = 5124;
const baseUrl = `http://127.0.0.1:${port}`;
const dashboardPassword = 'integration-dashboard-password';
const syncSecret = 'integration-sync-secret';
const sessionSecret = 'integration-session-secret';
const basicAuth = `Basic ${Buffer.from(`integration-user:${dashboardPassword}`).toString('base64')}`;

let child;
let firstCookie;
let firstCsrf;
let firstContactId;
let queueJobId;

function spawnServer(extraEnv = {}) {
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NEXT_TOUCH_DATA_DIR: dataDir,
      NEXT_TOUCH_STATE_FILE: userStateFile,
      DASHBOARD_PASSWORD: dashboardPassword,
      SYNC_SECRET: syncSecret,
      SESSION_SECRET: sessionSecret,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  child = null;
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`Server exited before becoming ready with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Retry until the short startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error('Timed out waiting for the unified server');
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0] || '';
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

before(async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  spawnServer();
  await waitForServer();
});

after(async () => {
  await stopServer();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('health is public while the dashboard fails closed without Basic Auth', async () => {
  const health = await request('/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const root = await request('/');
  assert.equal(root.status, 401);
  assert.match(root.headers.get('www-authenticate') || '', /Basic/);
});

test('green Personal Sales Desk and bootstrap data load behind Basic Auth', async () => {
  const root = await request('/', { headers: { Authorization: basicAuth } });
  assert.equal(root.status, 200);
  assert.match(await root.text(), /personal sales desk/i);

  const bootstrap = await request('/api/bootstrap', { headers: { Authorization: basicAuth } });
  assert.equal(bootstrap.status, 200);
  firstCookie = cookieFrom(bootstrap);
  const body = await bootstrap.json();
  firstCsrf = body.csrfToken;
  firstContactId = Object.keys(body.contacts)[0];
  assert.equal(body.ok, true);
  assert.ok(Object.keys(body.contacts).length >= 20);
  assert.ok(body.pipeline);
  assert.ok(firstCookie);
  assert.ok(firstCsrf);
  assert.ok(firstContactId);
});

test('completed progress and personal notes save with session and CSRF protection', async () => {
  const response = await request('/api/user-state', {
    method: 'PATCH',
    headers: {
      Authorization: basicAuth,
      Cookie: firstCookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': firstCsrf,
    },
    body: JSON.stringify({
      completed: { [firstContactId]: true },
      edits: { [firstContactId]: { notes: 'Integration note', action: 'Integration next action' } },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.completed[firstContactId], true);
  assert.equal(body.user.edits[firstContactId].notes, 'Integration note');
});

test('one-time device code links another browser to the same workspace', async () => {
  const codeResponse = await request('/api/device-code', {
    method: 'POST',
    headers: { Authorization: basicAuth, Cookie: firstCookie, 'X-CSRF-Token': firstCsrf },
  });
  assert.equal(codeResponse.status, 200);
  const { code } = await codeResponse.json();
  assert.ok(code);

  const secondBootstrap = await request('/api/bootstrap', { headers: { Authorization: basicAuth } });
  const secondCookie = cookieFrom(secondBootstrap);
  const secondBody = await secondBootstrap.json();
  const link = await request('/api/device-link', {
    method: 'POST',
    headers: {
      Authorization: basicAuth,
      Cookie: secondCookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': secondBody.csrfToken,
    },
    body: JSON.stringify({ code }),
  });
  assert.equal(link.status, 200);
  const linkedCookie = cookieFrom(link);
  assert.ok(linkedCookie);

  const linkedBootstrap = await request('/api/bootstrap', {
    headers: { Authorization: basicAuth, Cookie: linkedCookie },
  });
  const linkedBody = await linkedBootstrap.json();
  assert.equal(linkedBody.user.completed[firstContactId], true);
  assert.equal(linkedBody.user.edits[firstContactId].action, 'Integration next action');
});

test('required incremental sync endpoints and data endpoint remain available', async () => {
  const syncHeaders = {
    Authorization: `Bearer ${syncSecret}`,
    'Content-Type': 'application/json',
  };
  const requests = [
    ['/api/sync', {
      source: 'integration-test-full',
      nextTouch: { contacts: {} },
      pipelinePulse: null,
    }],
    ['/api/sync/contact', {
      slug: 'integration-probe',
      contact: { name: 'Integration Probe', priority: 'None' },
      source: 'integration-test',
      eventId: 'integration-contact-v1',
    }],
    ['/api/sync/batch', {
      items: [{
        slug: 'integration-batch-probe',
        contact: { name: 'Integration Batch Probe', priority: 'None' },
        source: 'integration-test',
        eventId: 'integration-batch-v1',
      }],
    }],
    ['/api/sync/section', {
      section: 'thisWeek',
      value: { weekLabel: 'Integration week', days: [] },
      source: 'integration-test',
    }],
  ];

  for (const [pathname, body] of requests) {
    const response = await request(pathname, {
      method: 'POST',
      headers: syncHeaders,
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, `${pathname} should return HTTP 200`);
    assert.equal((await response.json()).ok, true);
  }

  const data = await request('/api/data', { headers: { Authorization: basicAuth } });
  assert.equal(data.status, 200);
  const dataBody = await data.json();
  assert.equal(dataBody.nextTouch.contacts['integration-probe'].name, 'Integration Probe');
  assert.equal(dataBody.thisWeek.weekLabel, 'Integration week');
});

test('invalid sync payloads fail without partially changing saved data', async () => {
  const headers = {
    Authorization: `Bearer ${syncSecret}`,
    'Content-Type': 'application/json',
  };
  const invalidFull = await request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: 'invalid-missing-contacts' }),
  });
  assert.equal(invalidFull.status, 400);
  assert.equal((await invalidFull.json()).ok, false);

  const invalidBatch = await request('/api/sync/batch', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      items: [
        { slug: 'must-remain-absent', contact: { name: 'Must Remain Absent' } },
        { slug: '', contact: { name: 'Invalid Item' } },
      ],
    }),
  });
  assert.equal(invalidBatch.status, 400);
  assert.equal((await invalidBatch.json()).ok, false);

  const data = await request('/api/data', { headers: { Authorization: basicAuth } });
  const body = await data.json();
  assert.equal(body.nextTouch.contacts['must-remain-absent'], undefined);
  assert.equal(body.nextTouch.contacts['integration-probe'].name, 'Integration Probe');
});

test('AI queue mutations persist through the same protected API', async () => {
  const headers = {
    Authorization: `Bearer ${syncSecret}`,
    'Content-Type': 'application/json',
  };
  const enqueue = await request('/api/ai-queue', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'other',
      slug: 'integration-probe',
      payload: { purpose: 'integration test' },
      dedupeKey: 'integration-ai-job-v1',
    }),
  });
  assert.equal(enqueue.status, 201);
  const enqueued = await enqueue.json();
  queueJobId = enqueued.job.id;

  const claim = await request(`/api/ai-queue/${queueJobId}/claim`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ claimedBy: 'integration-test' }),
  });
  assert.equal(claim.status, 200);

  const complete = await request(`/api/ai-queue/${queueJobId}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ result: { ok: true } }),
  });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).status, 'completed');
});

test('saved workspace and incremental contacts survive a server restart', async () => {
  await stopServer();
  spawnServer();
  await waitForServer();

  const bootstrap = await request('/api/bootstrap', {
    headers: { Authorization: basicAuth, Cookie: firstCookie },
  });
  assert.equal(bootstrap.status, 200);
  const body = await bootstrap.json();
  assert.equal(body.user.completed[firstContactId], true);
  assert.equal(body.user.edits[firstContactId].notes, 'Integration note');
  assert.equal(body.contacts['integration-probe'].name, 'Integration Probe');

  const queue = await request('/api/ai-queue', {
    headers: { Authorization: `Bearer ${syncSecret}` },
  });
  assert.equal(queue.status, 200);
  const queueBody = await queue.json();
  assert.equal(queueBody.jobs.find((job) => job.id === queueJobId)?.status, 'completed');
});

test('batch sync returns a server error when its snapshot cannot be persisted', async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(dataDir, 'intentionally blocks directory creation');
  try {
    const response = await request('/api/sync/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${syncSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          slug: 'must-not-report-success',
          contact: { name: 'Persistence Failure Probe' },
          source: 'integration-test',
        }],
      }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).ok, false);
  } finally {
    fs.rmSync(dataDir, { force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  }
});

test('missing dashboard password fails closed', async () => {
  await stopServer();
  spawnServer({ DASHBOARD_PASSWORD: '' });
  await waitForServer();
  const response = await request('/');
  assert.equal(response.status, 503);
});

test('workspace credentials isolate synced data, dashboard state, and queue access', async () => {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const workspaceConfig = {
    alpha: { dashboardPassword: 'alpha-dashboard', syncSecret: 'alpha-sync' },
    beta: { dashboardPassword: 'beta-dashboard', syncSecret: 'beta-sync' },
  };
  spawnServer({
    DASHBOARD_PASSWORD: '',
    SYNC_SECRET: '',
    NEXT_TOUCH_DEFAULT_WORKSPACE: 'alpha',
    NEXT_TOUCH_WORKSPACES_JSON: JSON.stringify(workspaceConfig),
  });
  await waitForServer();

  const alphaDashboard = `Basic ${Buffer.from('alpha:alpha-dashboard').toString('base64')}`;
  const betaDashboard = `Basic ${Buffer.from('beta:beta-dashboard').toString('base64')}`;
  const pushContact = (workspaceId, secret, slug) => request('/api/sync/contact', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Workspace-Id': workspaceId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slug, contact: { name: `${workspaceId} contact` }, source: 'isolation-test' }),
  });

  assert.equal((await pushContact('alpha', 'alpha-sync', 'alpha-only')).status, 200);
  assert.equal((await pushContact('beta', 'beta-sync', 'beta-only')).status, 200);
  assert.equal((await pushContact('beta', 'alpha-sync', 'cross-workspace-attempt')).status, 401);

  const alphaData = await (await request('/api/data', { headers: { Authorization: alphaDashboard } })).json();
  const betaData = await (await request('/api/data', { headers: { Authorization: betaDashboard } })).json();
  assert.equal(alphaData.nextTouch.contacts['alpha-only'].name, 'alpha contact');
  assert.equal(alphaData.nextTouch.contacts['beta-only'], undefined);
  assert.equal(betaData.nextTouch.contacts['beta-only'].name, 'beta contact');
  assert.equal(betaData.nextTouch.contacts['alpha-only'], undefined);

  const enqueue = await request('/api/ai-queue', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer alpha-sync',
      'X-Workspace-Id': 'alpha',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'other', payload: {}, dedupeKey: 'alpha-private-job' }),
  });
  assert.equal(enqueue.status, 201);
  const betaQueue = await request('/api/ai-queue', {
    headers: { Authorization: 'Bearer beta-sync', 'X-Workspace-Id': 'beta' },
  });
  assert.equal((await betaQueue.json()).jobs.length, 0);
});