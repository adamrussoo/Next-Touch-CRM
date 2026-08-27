// Next Touch — Replit dashboard frontend
// Polls /api/data (this server's own store, populated by Claude's pushes)
// and renders it. No calls back to Claude ever happen from this file.

const POLL_MS = 60_000; // re-check every 60s for a fresh push

const CALL_VERBIAGE_URL = "https://claude.ai/code/artifact/19d06ea7-3178-46ff-bf4d-13f1dca37906";

const PRIORITY_ORDER = ["High", "Medium", "Low", "None"];
const PRIORITY_LABEL = {
  High: "High priority",
  Medium: "Medium priority",
  Low: "Low priority",
  None: "No action needed",
};
const PRIORITY_BADGE_CLASS = {
  High: "badge-high",
  Medium: "badge-medium",
  Low: "badge-low",
  None: "badge-none",
};
const PRIORITY_ANCHOR = {
  High: "group-high",
  Medium: "group-medium",
  Low: "group-low",
  None: "group-none",
};

let contactsBySlug = new Map();

function normalizePriority(p) {
  if (p === "High" || p === "Medium" || p === "Low") return p;
  return "None"; // covers null/undefined/"No action"/anything else
}

// Accepts either an array of contacts (each carrying its own `slug` field,
// which the sync trigger is expected to set) or an object keyed by slug
// (contacts_data.json's native shape) — either way, returns [slug, contact]
// pairs so nothing here depends on which shape was pushed.
function contactEntries(nextTouch) {
  const raw = nextTouch?.contacts;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((c, i) => [c.slug || c.id || String(i), c]);
  }
  return Object.entries(raw);
}

function timeAgo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderCard(slug, c) {
  const priority = normalizePriority(c.priority);
  const hasCoach = !!(c.coach && c.coach.lines && c.coach.lines.length);
  return `
    <div class="card">
      <div class="card-top">
        <div>
          <button class="card-name-btn" type="button" data-open-brief="${escapeHtml(slug)}">${escapeHtml(c.name || "Unnamed contact")}</button>
          <div class="card-business">${escapeHtml(c.business || "")}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="badge ${PRIORITY_BADGE_CLASS[priority]}">${escapeHtml(c.signal || PRIORITY_LABEL[priority])}</span>
          ${hasCoach ? `<button class="coach-btn" type="button" data-open-coach="${escapeHtml(slug)}">🎯 Coach</button>` : ""}
        </div>
      </div>
      <div class="card-meta">
        ${c.email ? `<span><span class="meta-label">Email</span>${escapeHtml(c.email)}</span>` : ""}
        ${c.lastContact ? `<span><span class="meta-label">Last contact</span>${escapeHtml(c.lastContact)}</span>` : ""}
        ${c.upcoming ? `<span><span class="meta-label">Upcoming</span>${escapeHtml(c.upcoming)}</span>` : ""}
      </div>
      ${c.action ? `<div class="card-action"><span class="meta-label">Next action</span>${escapeHtml(c.action)}</div>` : ""}
    </div>
  `;
}

function renderGroups(entries) {
  const groups = { High: [], Medium: [], Low: [], None: [] };
  for (const [slug, c] of entries) groups[normalizePriority(c.priority)].push([slug, c]);

  document.getElementById("statHigh").textContent = groups.High.length;
  document.getElementById("statMedium").textContent = groups.Medium.length;
  document.getElementById("statLow").textContent = groups.Low.length;
  document.getElementById("statNone").textContent = groups.None.length;

  const container = document.getElementById("groups");
  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state">No contact data yet — waiting on the first push from Claude.</div>`;
    return;
  }

  container.innerHTML = PRIORITY_ORDER.map((p) => {
    const list = groups[p];
    return `
      <section class="group" id="${PRIORITY_ANCHOR[p]}">
        <h2><span class="badge ${PRIORITY_BADGE_CLASS[p]}">${PRIORITY_LABEL[p]}</span> (${list.length})</h2>
        ${list.length ? list.map(([slug, c]) => renderCard(slug, c)).join("") : `<div class="empty-state">Nobody here right now.</div>`}
      </section>
    `;
  }).join("");
}

// ---------------------------------------------------------------------
// Contact Brief modal
// ---------------------------------------------------------------------

function renderCoachBody(c) {
  if (c.coach && Array.isArray(c.coach.lines) && c.coach.lines.length) {
    const situation = c.coach.situation
      ? `<p style="margin:0 0 10px;">${escapeHtml(c.coach.situation)}</p>`
      : "";
    const lines = c.coach.lines.map(([label, verbiage]) => `
      <div class="coach-line">
        <span class="coach-label">${escapeHtml(label)}</span>
        ${escapeHtml(verbiage)}
      </div>
    `).join("");
    return situation + lines;
  }
  return `<div class="coach-skip">${escapeHtml(c.coachSkipNote || "No Call Coach content for this contact yet.")}</div>`;
}

function openBrief(slug, opts = {}) {
  const c = contactsBySlug.get(slug);
  if (!c) return;

  const priority = normalizePriority(c.priority);
  document.getElementById("briefPriorityBadge").className = `badge ${PRIORITY_BADGE_CLASS[priority]}`;
  document.getElementById("briefPriorityBadge").textContent = c.signal || PRIORITY_LABEL[priority];
  document.getElementById("briefName").textContent = c.name || "Unnamed contact";
  document.getElementById("briefBusinessEmail").textContent = [c.business, c.email].filter(Boolean).join(" · ");

  const metaEl = document.getElementById("briefMeta");
  metaEl.innerHTML = [
    c.lastContact ? `<span><span class="meta-label">Last contact</span>${escapeHtml(c.lastContact)}</span>` : "",
    c.upcoming ? `<span><span class="meta-label">Upcoming</span>${escapeHtml(c.upcoming)}</span>` : "",
    c.signal ? `<span><span class="meta-label">Signal</span>${escapeHtml(c.signal)}</span>` : "",
  ].filter(Boolean).join("");

  document.getElementById("briefNotes").textContent = c.notes || "No notes captured yet.";
  document.getElementById("briefAction").textContent = c.action || "No recommended action yet.";
  document.getElementById("briefCoach").innerHTML = renderCoachBody(c);

  const resources = [];
  if (c.briefUrl) resources.push(`<a href="${escapeHtml(c.briefUrl)}" target="_blank" rel="noopener">Full Contact Brief ↗</a>`);
  if (c.readingTapeUrl) resources.push(`<a href="${escapeHtml(c.readingTapeUrl)}" target="_blank" rel="noopener">Reading the Tape ↗</a>`);
  resources.push(`<a href="${CALL_VERBIAGE_URL}" target="_blank" rel="noopener">Call Verbiage Field Guide ↗</a>`);
  document.getElementById("briefResources").innerHTML = resources.join("");

  const overlay = document.getElementById("briefOverlay");
  overlay.hidden = false;

  const coachSection = document.getElementById("briefCoachSection");
  coachSection.open = true;
  if (opts.focusCoach) {
    requestAnimationFrame(() => coachSection.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
}

function closeBrief() {
  document.getElementById("briefOverlay").hidden = true;
}

document.getElementById("briefClose").addEventListener("click", closeBrief);
document.getElementById("briefOverlay").addEventListener("click", (e) => {
  if (e.target.id === "briefOverlay") closeBrief();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("briefOverlay").hidden) closeBrief();
});

// Event delegation: card names and Coach buttons both live inside #groups,
// This Week matches live inside #thisweek — one listener per container.
document.getElementById("groups").addEventListener("click", (e) => {
  const nameBtn = e.target.closest("[data-open-brief]");
  if (nameBtn) return openBrief(nameBtn.dataset.openBrief);
  const coachBtn = e.target.closest("[data-open-coach]");
  if (coachBtn) return openBrief(coachBtn.dataset.openCoach, { focusCoach: true });
});

document.getElementById("thisweek").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-open-brief]");
  if (btn) openBrief(btn.dataset.openBrief);
});

// ---------------------------------------------------------------------
// This Week section
// ---------------------------------------------------------------------

function renderMeeting(m) {
  const timeStr = m.time || "--:--";
  let matchHtml;
  let metaHtml = "";
  let reviewHtml = "";

  if (m.match?.type === "next-touch" && m.match.nextTouchSlug) {
    const priority = normalizePriority(m.match.priority);
    matchHtml = `<button class="tw-match tw-match-nt" type="button" data-open-brief="${escapeHtml(m.match.nextTouchSlug)}">On Next Touch · ${PRIORITY_LABEL[priority]}</button>`;
    if (m.match.summary) metaHtml = `<div class="tw-meta">${escapeHtml(m.match.summary)}</div>`;
  } else if (m.match?.type === "salesforce") {
    matchHtml = `<span class="tw-match tw-match-sf">Salesforce match</span>`;
    const sf = m.match.salesforce || {};
    const bits = [
      sf.stage ? `Stage: ${escapeHtml(sf.stage)}` : "",
      sf.account ? `Account: ${escapeHtml(sf.account)}` : "",
    ].filter(Boolean).join(" · ");
    const link = sf.link
      ? ` · <a href="${escapeHtml(sf.link)}" target="_blank" rel="noopener">View in Salesforce ↗</a>`
      : " · Link pending — not yet captured";
    metaHtml = `<div class="tw-meta">${bits}${link}</div>`;
  } else {
    matchHtml = `<span class="tw-match tw-match-none">⚠ Not confidently matched</span>`;
  }

  if (m.review) {
    reviewHtml = `<div class="tw-review">${escapeHtml(m.review)}</div>`;
  }

  return `
    <div class="tw-meeting">
      <div class="tw-row1">
        <div style="display:flex; align-items:baseline; gap:10px;">
          <span class="tw-time">${escapeHtml(timeStr)}</span>
          <span class="tw-name${m.declined ? " tw-declined" : ""}">${escapeHtml(m.name || "Unknown attendee")}${m.business ? ` · ${escapeHtml(m.business)}` : ""}</span>
        </div>
        ${matchHtml}
      </div>
      ${metaHtml}
      ${reviewHtml}
      ${m.declined ? `<div class="tw-footnote">Declined — kept visible for context, not counted as a live meeting.</div>` : ""}
    </div>
  `;
}

function renderThisWeek(thisWeek) {
  const el = document.getElementById("thisweek");
  if (!thisWeek || !Array.isArray(thisWeek.days) || thisWeek.days.length === 0) {
    el.innerHTML = `
      <h2>This Week</h2>
      <p class="thisweek-caption">No This Week data has been pushed yet — this section will populate once the sync trigger includes it.</p>
    `;
    return;
  }

  const caption = [thisWeek.weekLabel, thisWeek.checkedAtLabel ? `checked ${thisWeek.checkedAtLabel}` : null]
    .filter(Boolean).join(" — ");

  const daysHtml = thisWeek.days.map((day) => {
    const meetings = Array.isArray(day.meetings) ? day.meetings : [];
    return `
      <div class="tw-day${day.isToday ? " tw-today" : ""}">
        <div class="tw-day-label">${escapeHtml(day.label || day.date || "")}${day.isToday ? " · Today" : ""}</div>
        ${meetings.length
          ? meetings.map(renderMeeting).join("")
          : `<div class="empty-state" style="padding:10px 0;">No prospect meetings.</div>`}
      </div>
    `;
  }).join("");

  el.innerHTML = `
    <h2>This Week</h2>
    ${caption ? `<p class="thisweek-caption">${escapeHtml(caption)}</p>` : ""}
    ${daysHtml}
  `;
}

async function refresh() {
  const statusEl = document.getElementById("syncStatus");
  try {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const contacts = contactsAsArray(data.nextTouch);
    renderGroups(contacts);

    if (!data.syncedAt) {
      statusEl.textContent = "No sync received yet";
      statusEl.className = "sync-status none";
    } else {
      statusEl.textContent = `Last synced ${timeAgo(data.syncedAt) || data.syncedAt}`;
      const staleHrs = (Date.now() - new Date(data.syncedAt).getTime()) / 3_600_000;
      statusEl.className = "sync-status" + (staleHrs > 3 ? " stale" : "");
    }

    document.getElementById("footerSource").textContent = data.source
      ? ` Source: ${data.source}.`
      : "";
  } catch (err) {
    statusEl.textContent = "Couldn't load data — will retry";
    statusEl.className = "sync-status stale";
    console.error(err);
  }
}

document.getElementById("statRow").addEventListener("click", (e) => {
  const tile = e.target.closest("[data-jump]");
  if (!tile) return;
  document.getElementById(tile.dataset.jump)?.scrollIntoView({ behavior: "smooth" });
});

refresh();
setInterval(refresh, POLL_MS);