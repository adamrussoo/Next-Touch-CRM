// Next Touch — Replit dashboard frontend
// Polls /api/data (this server's own store, populated by Claude's pushes)
// and renders it. No calls back to Claude ever happen from this file.

const POLL_MS = 60_000; // re-check every 60s for a fresh push

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

function normalizePriority(p) {
  if (p === "High" || p === "Medium" || p === "Low") return p;
  return "None"; // covers null/undefined/"No action"/anything else
}

function contactsAsArray(nextTouch) {
  const raw = nextTouch?.contacts;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
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

function renderCard(c) {
  const priority = normalizePriority(c.priority);
  return `
    <div class="card">
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(c.name || "Unnamed contact")}</div>
          <div class="card-business">${escapeHtml(c.business || "")}</div>
        </div>
        <span class="badge ${PRIORITY_BADGE_CLASS[priority]}">${escapeHtml(c.signal || PRIORITY_LABEL[priority])}</span>
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

function renderGroups(contacts) {
  const groups = { High: [], Medium: [], Low: [], None: [] };
  for (const c of contacts) groups[normalizePriority(c.priority)].push(c);

  document.getElementById("statHigh").textContent = groups.High.length;
  document.getElementById("statMedium").textContent = groups.Medium.length;
  document.getElementById("statLow").textContent = groups.Low.length;
  document.getElementById("statNone").textContent = groups.None.length;

  const container = document.getElementById("groups");
  if (contacts.length === 0) {
    container.innerHTML = `<div class="empty-state">No contact data yet — waiting on the first push from Claude.</div>`;
    return;
  }

  container.innerHTML = PRIORITY_ORDER.map((p) => {
    const list = groups[p];
    return `
      <section class="group" id="${PRIORITY_ANCHOR[p]}">
        <h2><span class="badge ${PRIORITY_BADGE_CLASS[p]}">${PRIORITY_LABEL[p]}</span> (${list.length})</h2>
        ${list.length ? list.map(renderCard).join("") : `<div class="empty-state">Nobody here right now.</div>`}
      </section>
    `;
  }).join("");
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