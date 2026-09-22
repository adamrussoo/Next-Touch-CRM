import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 5000);
const sessionSecret = process.env.SESSION_SECRET || "next-touch-development-secret";
const sessionCookie = "next-touch-session";
const sessionMaxAge = 60 * 60 * 24 * 365;
const stateFile = resolve(process.env.NEXT_TOUCH_STATE_FILE || "data/user_state.json");
const syncFile = resolve(process.env.NEXT_TOUCH_SYNC_FILE || "data/latest.json");
const publicFiles = new Map([
  ["/", resolve("app/index.html")],
  ["/app/styles.css", resolve("app/styles.css")],
  ["/app/app.js", resolve("app/app.js")],
]);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const pairingCodes = new Map();
let persistenceQueue = Promise.resolve();
let userStore = { version: 1, users: {} };
let latestData = {
  source: null,
  syncedAt: null,
  nextTouch: null,
  thisWeek: null,
  pipelinePulse: null,
  _meta: { note: "No data pushed yet. Waiting on the first sync from Claude." },
};

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

userStore = await loadJson(stateFile, userStore);
if (!userStore || typeof userStore !== "object" || !userStore.users) {
  userStore = { version: 1, users: {} };
}
latestData = await loadJson(syncFile, latestData);

function digest(value) {
  return createHmac("sha256", sessionSecret).update(value).digest("hex");
}

function signedSession(id) {
  return `${id}.${digest(`session:${id}`)}`;
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter((part) => part.length));
}

function sessionIdFromRequest(request) {
  const value = parseCookies(request)[sessionCookie] || "";
  const [id, signature] = value.split(".");
  return id && signature && constantTimeEqual(signature, digest(`session:${id}`)) ? id : null;
}

function setSessionCookie(request, response, id) {
  const host = String(request.headers.host || "");
  const secure = request.headers["x-forwarded-proto"] === "https" || (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
  response.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(signedSession(id))}; Path=/; Max-Age=${sessionMaxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
}

function csrfToken(id) {
  return digest(`csrf:${id}`);
}

function getUser(id) {
  if (!userStore.users[id]) {
    userStore.users[id] = { completed: {}, edits: {}, revision: 0, createdAt: new Date().toISOString(), updatedAt: null };
  }
  const user = userStore.users[id];
  user.completed ||= {};
  user.edits ||= {};
  user.revision ||= 0;
  return user;
}

async function persistUserStore() {
  const snapshot = JSON.stringify(userStore, null, 2);
  const operation = persistenceQueue.then(async () => {
    await mkdir(dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, snapshot, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, stateFile);
  });
  persistenceQueue = operation.catch(() => {});
  return operation;
}

function safeText(value, max = 4000) {
  return typeof value === "string" && value.length <= max ? value : null;
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 200_000) throw new Error("Request body is too large");
  }
  if (!body) return {};
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON body must be an object");
  return parsed;
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  sendJson(response, status, { ok: false, error: message });
}

function dashboardAuthorized(request, response) {
  const configured = process.env.DASHBOARD_PASSWORD;
  if (!configured) {
    response.statusCode = 503;
    response.end("Dashboard access is disabled until DASHBOARD_PASSWORD is configured.");
    return false;
  }
  const [scheme, encoded] = (request.headers.authorization || "").split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (constantTimeEqual(password, configured)) return true;
  }
  response.setHeader("WWW-Authenticate", 'Basic realm="Next Touch Dashboard"');
  response.statusCode = 401;
  response.end("Authentication required.");
  return false;
}

async function sessionFor(request, response) {
  const existing = sessionIdFromRequest(request);
  const id = existing || randomUUID();
  if (!existing) setSessionCookie(request, response, id);
  return { id, user: getUser(id) };
}

async function sourceSnapshot() {
  const [contacts, pipeline] = await Promise.all([
    loadJson(resolve("data/contacts_data.json"), {}),
    loadJson(resolve("data/pipeline_data.json"), null),
  ]);
  return { contacts, pipeline };
}

function publicUserState(user) {
  return {
    completed: user.completed,
    edits: user.edits,
    revision: user.revision,
    updatedAt: user.updatedAt,
  };
}

function requireCsrf(request, response, id) {
  if (!constantTimeEqual(request.headers["x-csrf-token"] || "", csrfToken(id))) {
    sendError(response, 403, "Invalid request token.");
    return false;
  }
  return true;
}

function contactExists(contacts, id) {
  return Object.prototype.hasOwnProperty.call(contacts, id);
}

function applyStatePatch(user, body, contacts) {
  if (body.completed !== undefined) {
    if (!body.completed || typeof body.completed !== "object" || Array.isArray(body.completed)) {
      throw new Error("Completed state must be an object.");
    }
    for (const [id, value] of Object.entries(body.completed)) {
      if (!contactExists(contacts, id) || typeof value !== "boolean") continue;
      if (value) user.completed[id] = true;
      else delete user.completed[id];
    }
  }
  if (body.edits !== undefined) {
    if (!body.edits || typeof body.edits !== "object" || Array.isArray(body.edits)) {
      throw new Error("Contact edits must be an object.");
    }
    for (const [id, edit] of Object.entries(body.edits)) {
      if (!contactExists(contacts, id)) continue;
      if (edit === null) {
        delete user.edits[id];
        continue;
      }
      if (!edit || typeof edit !== "object") continue;
      const notes = safeText(edit.notes);
      const action = safeText(edit.action);
      if (notes === null || action === null) throw new Error("Notes and next actions must be text under 4,000 characters.");
      user.edits[id] = { notes, action, updatedAt: new Date().toISOString() };
    }
  }
  user.revision += 1;
  user.updatedAt = new Date().toISOString();
}

function hashPairingCode(code) {
  return digest(`pair:${code}`);
}

function createPairingCode(id) {
  const code = randomBytes(6).toString("hex").toUpperCase();
  pairingCodes.set(hashPairingCode(code), { id, expiresAt: Date.now() + 10 * 60 * 1000 });
  return code;
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
    if (pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (pathname === "/api/sync" && request.method === "POST") {
      const configured = process.env.SYNC_SECRET;
      const authorization = request.headers.authorization || "";
      if (!configured || !authorization.startsWith("Bearer ") || !constantTimeEqual(authorization.slice(7), configured)) {
        sendError(response, configured ? 401 : 500, configured ? "Invalid or missing sync secret." : "Server misconfigured: SYNC_SECRET is not set.");
        return;
      }
      const body = await readRequestBody(request);
      const receivedAt = new Date().toISOString();
      latestData = {
        source: body.source || "unknown",
        syncedAt: body.syncedAt || receivedAt,
        receivedAt,
        nextTouch: body.nextTouch || null,
        thisWeek: body.thisWeek || null,
        pipelinePulse: body.pipelinePulse || null,
        _meta: { note: "Live data from the last successful sync." },
      };
      await mkdir(dirname(syncFile), { recursive: true });
      await writeFile(syncFile, JSON.stringify(latestData, null, 2), { mode: 0o600 });
      sendJson(response, 200, { ok: true, receivedAt, contactCount: latestData.nextTouch?.contacts?.length ?? 0 });
      return;
    }
    if (!dashboardAuthorized(request, response)) return;

    if (pathname.startsWith("/api/")) {
      const { id, user } = await sessionFor(request, response);
      if (pathname === "/api/bootstrap" && request.method === "GET") {
        const snapshot = await sourceSnapshot();
        sendJson(response, 200, {
          ok: true,
          ...snapshot,
          user: publicUserState(user),
          csrfToken: csrfToken(id),
        });
        return;
      }
      if (pathname === "/api/user-state" && request.method === "PATCH") {
        if (!requireCsrf(request, response, id)) return;
        const body = await readRequestBody(request);
        const contacts = (await sourceSnapshot()).contacts;
        applyStatePatch(user, body, contacts);
        await persistUserStore();
        sendJson(response, 200, { ok: true, user: publicUserState(user) });
        return;
      }
      if (pathname === "/api/device-code" && request.method === "POST") {
        if (!requireCsrf(request, response, id)) return;
        sendJson(response, 200, { ok: true, code: createPairingCode(id), expiresInSeconds: 600 });
        return;
      }
      if (pathname === "/api/device-link" && request.method === "POST") {
        if (!requireCsrf(request, response, id)) return;
        const body = await readRequestBody(request);
        const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
        const pairing = pairingCodes.get(hashPairingCode(code));
        if (!pairing || pairing.expiresAt < Date.now()) {
          if (pairing) pairingCodes.delete(hashPairingCode(code));
          sendError(response, 400, "That device code is invalid or has expired.");
          return;
        }
        pairingCodes.delete(hashPairingCode(code));
        setSessionCookie(request, response, pairing.id);
        sendJson(response, 200, { ok: true });
        return;
      }
      sendError(response, 404, "Not found");
      return;
    }

    const filePath = publicFiles.get(pathname);
    if (!filePath || request.method !== "GET") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    if (pathname === "/") await sessionFor(request, response);
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    console.error("Request failed:", error.message);
    if (!response.headersSent) sendError(response, 400, "The request could not be completed.");
    else response.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Next Touch is listening on port ${port}`);
  if (!process.env.SESSION_SECRET) console.warn("WARNING: SESSION_SECRET is not set; using a development-only fallback.");
  if (!process.env.DASHBOARD_PASSWORD) console.warn("WARNING: DASHBOARD_PASSWORD is not set; dashboard access is disabled.");
});