// Next Touch — personal sales command center
//
// The page remains a display-only client for the push architecture:
// Claude -> POST /api/sync -> this server -> GET /api/data -> this page.
// The presentation layer is interactive, but it never writes back to the CRM
// or changes the latest snapshot.

const POLL_MS = 60_000;
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
let lastFocusedElement = null;
let toastTimer = null;
const state = {
  data: null,
  entries: [],
  filter: "All",
  query: "",
};

function normalizePriority(priority) {
  if (priority === "High" || priority === "Medium" || priority === "Low") return priority;
  return "None";
}

// Accept both the array shape emitted by the sync trigger and the native
// object-keyed contacts_data.json shape.
function contactEntries(nextTouch) {
  const raw = nextTouch?.contacts;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((contact, index) => [contact.slug || contact.id || String(index), contact]);
  }
  return Object.entries(raw);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function timeAgo(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function initialsFor(contact) {
  const explicit = contact.initials || contact.avatar;
  if (explicit) return String(explicit).slice(0, 3).toUpperCase();
  return String(contact.name || "NT")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function firstFocusEntry() {
  return state.entries.find(([, contact]) => normalizePriority(contact.priority) === "High")
    || state.entries.find(([, contact]) => normalizePriority(contact.priority) === "Medium")
    || state.entries[0]
    || null;
}

function focusEntries() {
  return state.entries.filter(([, contact]) => {
    const priority = normalizePriority(contact.priority);
    return priority === "High" || priority === "Medium";
  });
}

function visibleEntries() {
  const normalizedQuery = state.query.trim().toLowerCase();
  return state.entries.filter(([, contact]) => {
    const priority = normalizePriority(contact.priority);
    const matchesFilter = state.filter === "All"
      || (state.filter === "Focus" && (priority === "High" || priority === "Medium"))
      || state.filter === priority;
    const haystack = `${contact.name || ""} ${contact.business || ""} ${contact.email || ""} ${contact.action || ""} ${contact.signal || ""}`.toLowerCase();
    return matchesFilter && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
}

function renderCard(slug, contact) {
  const priority = normalizePriority(contact.priority);
  const hasCoach = Boolean(contact.coach?.lines?.length);
  const meta = [
    contact.email ? `<span class="meta-item"><span class="meta-label">Email</span>${escapeHtml(contact.email)}</span>` : "",
    contact.lastContact ? `<span class="meta-item"><span class="meta-label">Last contact</span>${escapeHtml(contact.lastContact)}</span>` : "",
    contact.upcoming ? `<span class="meta-item"><span class="meta-label">Upcoming</span>${escapeHtml(contact.upcoming)}</span>` : "",
  ].filter(Boolean).join("");

  return `
    <article class="card contact-card">
      <div class="card-top">
        <div class="card-identity">
          <button class="card-name-btn" type="button" data-open-brief="${escapeHtml(slug)}">${escapeHtml(contact.name || "Unnamed contact")}</button>
          <div class="card-business">${escapeHtml(contact.business || contact.company || "Relationship record")}</div>
        </div>
        <div class="card-signal">
          <span class="badge ${PRIORITY_BADGE_CLASS[priority]}">${escapeHtml(contact.signal || PRIORITY_LABEL[priority])}</span>
          ${hasCoach ? `<button class="coach-btn" type="button" data-open-coach="${escapeHtml(slug)}">🎯 Coach</button>` : ""}
        </div>
      </div>
      ${meta ? `<div class="card-meta">${meta}</div>` : ""}
      ${contact.action ? `<div class="card-action"><span class="meta-label">Next move</span>${escapeHtml(contact.action)}</div>` : ""}
      <div class="card-footer">
        <span class="source-chip">${escapeHtml(contact.source || "Next Touch")} · ${escapeHtml(contact.status || "Active")}</span>
        ${hasCoach ? `<button class="coach-btn" type="button" data-open-coach="${escapeHtml(slug)}">Open coach <span aria-hidden="true">↗</span></button>` : ""}
      </div>
    </article>
  `;
}

function renderGroups(entries) {
  const visibleGroups = { High: [], Medium: [], Low: [], None: [] };
  const totalGroups = { High: [], Medium: [], Low: [], None: [] };

  for (const [slug, contact] of entries) visibleGroups[normalizePriority(contact.priority)].push([slug, contact]);
  for (const [, contact] of state.entries) totalGroups[normalizePriority(contact.priority)].push(contact);

  document.getElementById("statHigh").textContent = totalGroups.High.length;
  document.getElementById("statMedium").textContent = totalGroups.Medium.length;
  document.getElementById("statLow").textContent = totalGroups.Low.length;
  document.getElementById("statNone").textContent = totalGroups.None.length;
  document.getElementById("queueCount").textContent = entries.length;

  const container = document.getElementById("groups");
  if (state.entries.length === 0) {
    container.innerHTML = `<div class="empty-state">No contact data yet — waiting on the first push from Claude.</div>`;
    return;
  }
  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state">No relationship matches this view.<br /><small>Try another filter or clear your search.</small></div>`;
    return;
  }

  container.innerHTML = PRIORITY_ORDER.map((priority) => {
    const list = visibleGroups[priority];
    return `
      <section class="group" id="${PRIORITY_ANCHOR[priority]}">
        <h3 class="group-heading"><span class="badge ${PRIORITY_BADGE_CLASS[priority]}">${PRIORITY_LABEL[priority]}</span><span>${list.length}</span></h3>
        ${list.length
          ? `<div class="card-list">${list.map(([slug, contact]) => renderCard(slug, contact)).join("")}</div>`
          : `<div class="empty-state">Nobody here right now.</div>`}
      </section>
    `;
  }).join("");
}

function renderHero() {
  const entries = state.entries;
  const focus = focusEntries();
  const first = firstFocusEntry();
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const timeLabel = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  document.getElementById("heroDate").textContent = dateLabel;
  document.getElementById("heroClock").textContent = timeLabel;
  document.getElementById("focusCount").textContent = focus.length;
  document.getElementById("focusLabel").textContent = focus.length === 1 ? "active touch" : "active touches";
  document.getElementById("focusBadge").textContent = focus.length ? `${focus.length} need attention` : "Clear runway";
  document.getElementById("focusSync").textContent = state.data?.syncedAt ? "Live snapshot" : "Ready";
  document.getElementById("focusBar").style.width = entries.length ? `${Math.max((focus.length / entries.length) * 100, 8)}%` : "0%";

  if (!entries.length) {
    document.getElementById("heroTitle").innerHTML = `A clear day<br /><em>starts with one good move.</em>`;
    document.getElementById("heroLead").textContent = "Your relationships are moving. We’ll surface the people who need your attention and the reason it matters.";
    document.getElementById("focusHint").textContent = "Your next sync will bring the queue to life.";
    document.getElementById("focusCopy").textContent = "Your focus queue will appear here after the first sync.";
    document.getElementById("signalCopy").textContent = "When new activity arrives, this space will explain who to contact, why now, and what to accomplish.";
    document.getElementById("signalValue").textContent = "Waiting";
    document.getElementById("signalBar").style.width = "0%";
    document.getElementById("systemsNote").textContent = "Waiting for the first sync";
    return;
  }

  const firstName = first?.[1]?.name || "your next relationship";
  document.getElementById("heroTitle").innerHTML = `A clearer pipeline<br /><em>starts with one good move.</em>`;
  document.getElementById("heroLead").textContent = `${focus.length || entries.length} relationship${(focus.length || entries.length) === 1 ? "" : "s"} need your attention. Start with ${firstName} and keep the thread moving.`;
  document.getElementById("focusHint").textContent = focus.length ? "Start with the strongest signal." : "Your queue is calm for now.";
  document.getElementById("focusCopy").textContent = first?.[1]?.action || "Review your relationship queue and choose the next useful move.";
  document.getElementById("signalCopy").textContent = first?.[1]?.action
    ? `${firstName} is currently the clearest next move: ${first[1].action}. The queue is sorted so the context arrives before the task.`
    : "Your latest snapshot is ready. Review the queue to decide where a thoughtful follow-up will matter most.";
  document.getElementById("signalValue").textContent = focus.length ? `${focus.length} active` : "Steady";
  document.getElementById("signalBar").style.width = `${Math.max((focus.length / entries.length) * 100, 8)}%`;
  document.getElementById("systemsNote").textContent = state.data?.syncedAt ? `Last synced ${timeAgo(state.data.syncedAt) || "recently"}` : "Snapshot loaded";
}

function renderNotifications() {
  const candidates = focusEntries().slice(0, 2);
  const dot = document.getElementById("notificationDot");
  dot.hidden = candidates.length === 0;
  if (!candidates.length) {
    document.getElementById("notificationCopy").textContent = "No new signals yet. The next sync will surface them here.";
    return;
  }
  const [, contact] = candidates[0];
  document.getElementById("notificationCopy").textContent = `${contact.name || "A contact"} needs attention: ${contact.action || "review the recommended next move"}.`;
}

function renderNavigation() {
  const focusCount = focusEntries().length;
  const week = state.data?.thisWeek;
  const meetingCount = Array.isArray(week?.days)
    ? week.days.reduce((sum, day) => sum + (Array.isArray(day.meetings) ? day.meetings.filter((meeting) => !meeting.declined).length : 0), 0)
    : 0;
  document.getElementById("todayNavCount").textContent = focusCount;
  document.getElementById("calendarNavCount").textContent = meetingCount;
}

// ---------------------------------------------------------------------
// Contact Brief modal
// ---------------------------------------------------------------------

function renderCoachBody(contact) {
  if (contact.coach && Array.isArray(contact.coach.lines) && contact.coach.lines.length) {
    const situation = contact.coach.situation
      ? `<p>${escapeHtml(contact.coach.situation)}</p>`
      : "";
    const lines = contact.coach.lines.map(([label, verbiage]) => `
      <div class="coach-line">
        <span class="coach-label">${escapeHtml(label)}</span>
        ${escapeHtml(verbiage)}
      </div>
    `).join("");
    return situation + lines;
  }
  return `<div class="coach-skip">${escapeHtml(contact.coachSkipNote || "No Call Coach content for this contact yet.")}</div>`;
}

function openBrief(slug, options = {}) {
  const contact = contactsBySlug.get(String(slug));
  if (!contact) return;
  lastFocusedElement = document.activeElement;

  const priority = normalizePriority(contact.priority);
  const badge = document.getElementById("briefPriorityBadge");
  badge.className = `badge ${PRIORITY_BADGE_CLASS[priority]}`;
  badge.textContent = contact.signal || PRIORITY_LABEL[priority];
  document.getElementById("briefName").textContent = contact.name || "Unnamed contact";
  document.getElementById("briefBusinessEmail").textContent = [contact.business || contact.company, contact.email].filter(Boolean).join(" · ");

  document.getElementById("briefMeta").innerHTML = [
    contact.lastContact ? `<span><span class="meta-label">Last contact</span>${escapeHtml(contact.lastContact)}</span>` : "",
    contact.upcoming ? `<span><span class="meta-label">Upcoming</span>${escapeHtml(contact.upcoming)}</span>` : "",
    contact.signal ? `<span><span class="meta-label">Signal</span>${escapeHtml(contact.signal)}</span>` : "",
  ].filter(Boolean).join("");
  document.getElementById("briefNotes").textContent = contact.notes || "No notes captured yet.";
  document.getElementById("briefAction").textContent = contact.action || "No recommended action yet.";
  document.getElementById("briefCoach").innerHTML = renderCoachBody(contact);

  const resources = [];
  if (contact.briefUrl) resources.push(`<a href="${escapeHtml(contact.briefUrl)}" target="_blank" rel="noopener">Full Contact Brief ↗</a>`);
  if (contact.readingTapeUrl) resources.push(`<a href="${escapeHtml(contact.readingTapeUrl)}" target="_blank" rel="noopener">Reading the Tape ↗</a>`);
  resources.push(`<a href="${CALL_VERBIAGE_URL}" target="_blank" rel="noopener">Call Verbiage Field Guide ↗</a>`);
  document.getElementById("briefResources").innerHTML = resources.join("");

  const overlay = document.getElementById("briefOverlay");
  overlay.hidden = false;
  document.body.classList.add("modal-open");
  const coachSection = document.getElementById("briefCoachSection");
  coachSection.open = true;
  if (options.focusCoach) {
    requestAnimationFrame(() => coachSection.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  requestAnimationFrame(() => document.getElementById("briefClose").focus());
}

function closeBrief() {
  const overlay = document.getElementById("briefOverlay");
  if (overlay.hidden) return;
  overlay.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
}

// ---------------------------------------------------------------------
// This Week
// ---------------------------------------------------------------------

function renderMeeting(meeting) {
  const time = meeting.time || "--:--";
  let matchHtml;
  let metaHtml = "";

  if (meeting.match?.type === "next-touch" && meeting.match.nextTouchSlug) {
    const priority = normalizePriority(meeting.match.priority);
    matchHtml = `<button class="tw-match tw-match-nt" type="button" data-open-brief="${escapeHtml(meeting.match.nextTouchSlug)}">On Next Touch · ${PRIORITY_LABEL[priority]}</button>`;
    if (meeting.match.summary) metaHtml = `<div class="tw-meta">${escapeHtml(meeting.match.summary)}</div>`;
  } else if (meeting.match?.type === "salesforce") {
    matchHtml = `<span class="tw-match tw-match-sf">Salesforce match</span>`;
    const salesforce = meeting.match.salesforce || {};
    const bits = [
      salesforce.stage ? `Stage: ${escapeHtml(salesforce.stage)}` : "",
      salesforce.account ? `Account: ${escapeHtml(salesforce.account)}` : "",
    ].filter(Boolean).join(" · ");
    const link = salesforce.link
      ? ` · <a href="${escapeHtml(salesforce.link)}" target="_blank" rel="noopener">View in Salesforce ↗</a>`
      : " · Link pending — not yet captured";
    metaHtml = `<div class="tw-meta">${bits}${link}</div>`;
  } else {
    matchHtml = `<span class="tw-match tw-match-none">⚠ Not confidently matched</span>`;
  }

  return `
    <div class="tw-meeting${meeting.match?.type === "next-touch" ? " is-clickable" : ""}">
      <div class="tw-row1">
        <div class="tw-name-line"><span class="tw-time">${escapeHtml(time)}</span><span class="tw-name${meeting.declined ? " tw-declined" : ""}">${escapeHtml(meeting.name || "Unknown attendee")}${meeting.business ? ` · ${escapeHtml(meeting.business)}` : ""}</span></div>
        ${matchHtml}
      </div>
      ${metaHtml}
      ${meeting.review ? `<div class="tw-review">${escapeHtml(meeting.review)}</div>` : ""}
      ${meeting.declined ? `<div class="tw-footnote">Declined — kept visible for context, not counted as a live meeting.</div>` : ""}
    </div>
  `;
}

function renderThisWeek(thisWeek) {
  const element = document.getElementById("thisweek");
  if (!thisWeek || !Array.isArray(thisWeek.days) || thisWeek.days.length === 0) {
    element.innerHTML = `
      <div class="rail-heading"><div><div class="eyebrow">Stay oriented</div><h2>This week</h2></div><button class="icon-button" type="button" data-nav="Calendar" aria-label="Open calendar">□</button></div>
      <p class="thisweek-caption">No This Week data has been pushed yet — this section will populate once the sync trigger includes it.</p>
    `;
    return;
  }

  const caption = [thisWeek.weekLabel, thisWeek.checkedAtLabel ? `checked ${thisWeek.checkedAtLabel}` : null].filter(Boolean).join(" — ");
  const daysHtml = thisWeek.days.map((day) => {
    const meetings = Array.isArray(day.meetings) ? day.meetings : [];
    return `
      <div class="tw-day${day.isToday ? " tw-today" : ""}">
        <div class="tw-day-label">${escapeHtml(day.label || day.date || "")}${day.isToday ? " · Today" : ""}</div>
        ${meetings.length ? meetings.map(renderMeeting).join("") : `<div class="empty-state">No prospect meetings.</div>`}
      </div>
    `;
  }).join("");

  element.innerHTML = `
    <div class="rail-heading"><div><div class="eyebrow">Stay oriented</div><h2>This week</h2></div><button class="icon-button" type="button" data-nav="Calendar" aria-label="Open calendar">□</button></div>
    ${caption ? `<p class="thisweek-caption">${escapeHtml(caption)}</p>` : ""}
    ${daysHtml}
    <button class="calendar-link" type="button" data-nav="Calendar">Open calendar <span aria-hidden="true">→</span></button>
  `;
}

// ---------------------------------------------------------------------
// Interaction and rendering
// ---------------------------------------------------------------------

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
}

function renderFilters() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.filter);
  });
  document.getElementById("focusToday").textContent = state.filter === "Focus" ? "Show all" : "Focus today";
}

function renderAll() {
  renderHero();
  renderGroups(visibleEntries());
  renderThisWeek(state.data?.thisWeek);
  renderNotifications();
  renderNavigation();
  renderFilters();
}

function setFilter(filter) {
  state.filter = filter;
  renderAll();
}

function handleNavigation(label) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.nav === label));
  document.getElementById("activeNavLabel").textContent = `${label} · personal command center`;
  if (label === "Calendar") {
    document.getElementById("thisweek").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (label === "Campaigns") {
    showToast("Campaign context will appear when it is included in a sync snapshot.");
  } else {
    document.getElementById("groups").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

document.getElementById("briefClose").addEventListener("click", closeBrief);
document.getElementById("briefOverlay").addEventListener("click", (event) => {
  if (event.target.id === "briefOverlay") closeBrief();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("briefOverlay").hidden) closeBrief();
});

document.getElementById("groups").addEventListener("click", (event) => {
  const nameButton = event.target.closest("[data-open-brief]");
  if (nameButton) return openBrief(nameButton.dataset.openBrief);
  const coachButton = event.target.closest("[data-open-coach]");
  if (coachButton) return openBrief(coachButton.dataset.openCoach, { focusCoach: true });
});
document.getElementById("thisweek").addEventListener("click", (event) => {
  const briefButton = event.target.closest("[data-open-brief]");
  if (briefButton) openBrief(briefButton.dataset.openBrief);
  const navButton = event.target.closest("[data-nav]");
  if (navButton) handleNavigation(navButton.dataset.nav);
});
document.getElementById("statRow").addEventListener("click", (event) => {
  const tile = event.target.closest("[data-jump]");
  if (tile) document.getElementById(tile.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("filterRow").addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) setFilter(filterButton.dataset.filter);
});
document.querySelectorAll("[data-nav]").forEach((button) => {
  if (button.closest("#thisweek")) return;
  button.addEventListener("click", () => handleNavigation(button.dataset.nav));
});
document.getElementById("contactSearch").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderAll();
});
document.getElementById("notificationToggle").addEventListener("click", () => {
  const button = document.getElementById("notificationToggle");
  const popover = document.getElementById("notificationPopover");
  const open = popover.hidden;
  popover.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (event) => {
  const wrapper = document.querySelector(".notification-wrap");
  if (!wrapper.contains(event.target)) {
    document.getElementById("notificationPopover").hidden = true;
    document.getElementById("notificationToggle").setAttribute("aria-expanded", "false");
  }
});
document.getElementById("focusToday").addEventListener("click", () => {
  setFilter(state.filter === "Focus" ? "All" : "Focus");
  showToast(state.filter === "Focus" ? "Showing the relationships with the strongest signals." : "Showing all relationships.");
});
document.getElementById("refineQueue").addEventListener("click", () => {
  document.getElementById("contactSearch").focus();
  showToast("Search by person, company, signal, or next action.");
});
document.getElementById("reviewDay").addEventListener("click", () => {
  setFilter(state.filter === "Focus" ? "All" : "Focus");
  document.getElementById("groups").scrollIntoView({ behavior: "smooth", block: "start" });
});
function openFirstFocus(coach = false) {
  const first = firstFocusEntry();
  if (first) return openBrief(first[0], { focusCoach: coach });
  document.getElementById("groups").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Your focus queue is ready for its first sync.");
}
document.getElementById("heroTouch").addEventListener("click", () => openFirstFocus(true));
document.getElementById("topbarTouch").addEventListener("click", () => openFirstFocus(false));
document.getElementById("focusAction").addEventListener("click", () => openFirstFocus(true));

async function refresh() {
  const status = document.getElementById("syncStatus");
  try {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.entries = contactEntries(state.data.nextTouch);
    contactsBySlug = new Map(state.entries);
    renderAll();

    if (!state.data.syncedAt) {
      status.textContent = "No sync received yet";
      status.className = "sync-status none";
    } else {
      status.textContent = `Last synced ${timeAgo(state.data.syncedAt) || state.data.syncedAt}`;
      const staleHours = (Date.now() - new Date(state.data.syncedAt).getTime()) / 3_600_000;
      status.className = `sync-status${staleHours > 3 ? " stale" : ""}`;
    }
    document.getElementById("footerSource").textContent = state.data.source ? ` Source: ${state.data.source}.` : "";
  } catch (error) {
    status.textContent = "Couldn’t load data — will retry";
    status.className = "sync-status stale";
    console.error(error);
  }
}

refresh();
setInterval(refresh, POLL_MS);