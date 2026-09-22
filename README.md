# Next Touch / Pipeline Pulse — Project Package

Exported 2026-08-26 for Adam Russo (adam.russo@bench.co), Bench Accounting / Mainstreet Holdings.

This is a complete snapshot of the live "Next Touch" sales relationship tracker and its companion "Pipeline Pulse" Salesforce tracker — everything needed to understand, edit, or continue developing the system in a fresh Claude session. It contains fresh copies of every live page, the current data model, both scheduled automations, and all governing documentation, as they existed at export time.

> **Current Replit runtime:** The export notes below describe the system's historical source material. The production app now runs from `server.js` with the protected green frontend in `app/`. A Reserved VM is required because synced snapshots, personal workspace state, and the AI queue are file-backed.
>
> `DASHBOARD_PASSWORD`, `SYNC_SECRET`, and `SESSION_SECRET` configure the existing single workspace. For multiple isolated workspaces, set `NEXT_TOUCH_DEFAULT_WORKSPACE` and a secret `NEXT_TOUCH_WORKSPACES_JSON` object whose keys are workspace IDs and whose values contain `dashboardPassword`, `syncSecret`, and optional `syncSecretPrevious`. Dashboard Basic Auth uses the workspace ID as its username; automation requests send the same ID in `X-Workspace-Id`. Every non-default workspace receives separate snapshot/log files under `data/workspaces/<workspace-id>/` and does not inherit the default workspace's imported CRM data.

## 1. Architecture — read this first

**There is no traditional codebase here.** Every page in this system is a self-contained HTML/CSS/JS document published directly as a Claude Artifact (a hosted page with its own URL, editable by fetch → edit → republish). There is no build step, no server, no framework, no package.json, no repo. The `.py` files in `build-scripts/` are **one-time historical transform scripts**, not a build pipeline — see section 4.

Because of that, this package is organized around what actually exists:

```
project_package/
  README.md                        ← this file
  artifacts/live-pages/             ← fresh HTML dump of every published page, as of export
  data/contacts_data.json           ← the Next Touch dashboard's single source of truth (20 contacts)
  project-docs/                     ← the governing docs (source of truth for HOW the system behaves)
  automation/                       ← the two scheduled tasks that keep everything current
  build-scripts/                    ← historical one-off scripts used to build the modal system (reference only)
```

**The most important files to read, in order:** `project-docs/next-touch-system-state.md`, then `project-docs/pipeline-pulse-handoff.md`, then this README's remaining sections.

## 2. Live pages

All fetched fresh via `Artifact action:"read"` immediately before packaging — these are exact snapshots of what's live right now, not stale local copies.

| Page | Purpose | Live URL | Local file |
|---|---|---|---|
| Next Touch (dashboard) | Main CRM-style tracker — one card per contact, priority-sorted, Contact Brief modal on every name, "This Week" section | `https://claude.ai/code/artifact/c2f940ca-0052-4c5c-8af8-50dda88f49e3` | `artifacts/live-pages/next-touch-dashboard.html` |
| Daily Priorities | "What to work on today" — urgent responses, today/tomorrow's meetings with prep, Apollo tier backlog | `https://claude.ai/code/artifact/c683bd30-99e5-4085-9208-433136744f20` | `artifacts/live-pages/daily-priorities.html` |
| Pipeline Pulse | Salesforce Leads/Opportunities tracker (Chrome-piggyback, no live API), plus its own "This Week" tab | `https://claude.ai/code/artifact/ce5924e8-918b-4ea5-b039-3b5ae79a3d95` | `artifacts/live-pages/pipeline-pulse.html` |
| Contact brief — Nathan Moser | Full standalone brief page; **the template every new brief page is copied from** | `https://claude.ai/code/artifact/0f4cad15-00f0-4120-b68d-0dece99f5687` | `artifacts/live-pages/contact-brief-nathan-moser.html` |
| Contact brief — Andrew Bravo | Standalone brief page | `https://claude.ai/code/artifact/da7aab07-b0f9-4669-9026-0feef51c167b` | `artifacts/live-pages/contact-brief-andrew-bravo.html` |
| Contact brief — Dana Hansen | Standalone brief page | `https://claude.ai/code/artifact/d2d7c6da-706d-4f68-b936-b6704b6899d8` | `artifacts/live-pages/contact-brief-dana-hansen.html` |
| Call Verbiage Field Guide | One general live-call talk-track reference (not per-contact) | `https://claude.ai/code/artifact/19d06ea7-3178-46ff-bf4d-13f1dca37906` | `artifacts/live-pages/call-verbiage-field-guide.html` |
| Reading the Tape (Nathan Moser) | Original Call Coach pilot review — kept as a worked example | `https://claude.ai/code/artifact/7e63e020-1d8f-40d2-b06a-293983c5c04c` | `artifacts/live-pages/reading-the-tape-nathan-moser.html` |

Only 3 of the system's 20 tracked contacts have standalone brief pages (Nathan Moser, Andrew Bravo, Dana Hansen); the rest are covered through the Next Touch modal system alone (see section 3) and get a brief page built on demand — see `project-docs/next-touch-system-state.md`, "Contact briefs built so far."

**To continue development:** fetch the page fresh (`Artifact action:"read"`, passing the URL above), make edits on top of that live copy, and republish with the same `url` parameter so it updates in place rather than forking a new artifact. **Never edit the local HTML dumps in `artifacts/live-pages/` and republish them** — they are a point-in-time snapshot for reference/backup only and will be stale the moment the hourly sync runs again. This is a hard-won lesson in this project's history: an early near-miss where a stale local copy would have silently erased several automation-added contacts. Always fetch fresh immediately before editing.

**Publish gotcha:** the Artifact tool's publish gate requires the Read tool to have covered every line of the current saved dump file in the same turn. A saved dump with no trailing newline after its final line makes `wc -l` under-report the line count by one (it counts newline characters, not lines), so a Read call covering exactly the reported count can silently miss the true last line and cause a false "identical content already refused" rejection. Fix: after `wc -l`, also check `python3 -c "print(open(f,'rb').read().endswith(b'\n'))"` (or do one extra offset-based Read past the reported count) before assuming full coverage.

## 3. Data model — `data/contacts_data.json`

The Next Touch dashboard's entire contact-level dataset lives in one JSON blob embedded in the page itself, at `<script type="application/json" id="contacts-data">` inside `next-touch-dashboard.html`. `data/contacts_data.json` in this package is that exact blob, extracted fresh and pretty-printed — 20 contacts as of export.

Each contact object holds: `name`, `business`, `email`, `priority`, `tier`, `signal`, `lastContact`, `upcoming`, `notes`, `action`, `briefUrl` (optional — only set for the 3 contacts with a standalone brief page), `coach` (the Call Coach object — see below), and optionally `readingTapeUrl`.

`coach` is either:
- `{ situation: "<one-line summary>", lines: [["<label>", "<verbiage>"], ...] }` — a short situation summary plus talking points grounded in that contact's real notes/objections/transcript and the Call Verbiage Field Guide, or
- `null`, paired with a one-line `coachSkipNote` explaining why (e.g. no call has happened yet) — never a fabricated section.

**The shared modal system:** the dashboard has one `#briefOverlay`/`#briefModal` DOM block and one `openBrief(slug)` / `closeBrief()` JS pair, used by every contact. Every clickable name anywhere in the system (dashboard cards, This Week entries) is wrapped in `onclick="openBrief('<slug>')"`; `openBrief` looks up that slug in the `contacts-data` blob and populates the modal. To add a new contact: add one object to the JSON blob (with a real `coach`, not a placeholder) and wire its name element the same way — don't invent new modal markup per contact.

**Cross-artifact linking:** Next Touch, Pipeline Pulse, and Daily Priorities are three separate published Artifacts on separate origins with no shared live DOM/JS state, so a name on Pipeline Pulse or Daily Priorities can't pop Next Touch's modal in place. The working approximation: those pages link out (`target="_blank"`) to `https://claude.ai/code/artifact/c2f940ca-0052-4c5c-8af8-50dda88f49e3#c-<slug>`, and Next Touch auto-opens that contact's modal on load via `location.hash` + a short `setTimeout`.

Full design rationale, every convention, and the complete build history are in `project-docs/next-touch-system-state.md` — read it before making structural changes to the modal or data model.

## 4. Build scripts (`build-scripts/`) — historical reference, not a re-run pipeline

These are the actual Python scripts used at various points to transform the live pages into their current form:

- `transform_next_touch.py` — early transform pass on the Next Touch dashboard.
- `build_contacts_data.py` — built the original `contacts_data.json` from source call notes/transcripts.
- `build_modal.py` — rewrote the dashboard from the old `toggleRes`/`.resources` toggle-panel pattern to the current `#briefOverlay`/`#briefModal` shared-modal system (rewrote onclick handlers, stripped old panel divs, injected modal CSS/HTML).
- `build_modal_js.py` — embedded the `contacts-data` JSON blob and the `openBrief`/`closeBrief` JS into the dashboard.
- `build_pp_links.py` — added the clickable cross-artifact name links on Pipeline Pulse (`nameWithNextTouchLink()`, the `by_email`/`by_biz` matching maps).

**Important: these are one-time recipes written against specific historical file states, not idempotent tools.** They were run once each, by hand, against whatever the dashboard's HTML looked like at that moment, and their output was manually verified before publishing. Running one of them today against the current `artifacts/live-pages/*.html` will very likely fail or produce wrong output, because the assumptions baked into each script (exact string patterns to find/replace, an assumed prior state of the file) no longer match what's actually live. Treat them as documentation of *how the modal system came to exist* — useful for understanding the page's structure and writing new edits by hand or with fresh Claude assistance — not as scripts to execute against the current pages.

## 5. Automation (`automation/`)

Two scheduled tasks (Claude Code Remote "Routines" — **not local cron**; each firing starts a fresh session with no memory of prior runs) keep this system current:

- **Next Touch sync** (`trig_01YDk8RyRDVi8JMwLVfbq7Qq`) — hourly at :52 past the hour, every day. Reads the state doc, checks Gmail/Calendar for new activity since the watermark, updates/creates contact brief pages, rebuilds the Next Touch dashboard and Daily Priorities page, refreshes the This Week section from Pipeline Pulse's data, and (once an hour, at 7am Mountain Time) refreshes a manual-Salesforce-check reminder banner on Daily Priorities. Full prompt: `automation/next-touch-sync-prompt.txt`.
- **Pipeline Pulse — calendar-triggered Salesforce refresh** (`trig_01SWnQQaWcLWBX3iq9EKpE7b`) — hourly, weekdays, ~7am-6pm Mountain Time. Pulls Calendar (no device needed) to keep Pipeline Pulse's This Week tab current, and — only once local device binding is approved — searches Salesforce per attendee email and writes results back. **As of export, device binding is NOT approved** (Adam's account isn't logged into any desktop yet), so this trigger currently runs its calendar-only half every hour and silently skips the Salesforce half. Full prompt: `automation/pipeline-pulse-refresh-prompt.txt`.

`automation/triggers.json` has both triggers' cron expressions, notification settings, and current status in one place. To recreate either trigger in a new environment, use the `create_trigger` tool (Claude Code Remote MCP server) with the `name`, `cron_expression`, and the corresponding prompt file's full text — **never** the local in-process cron tools (`CronCreate`/`CronList`/`CronDelete`), which don't survive a session ending and would make the schedule silently stop working.

## 6. Project documentation (`project-docs/`)

These are exact copies of the governing Project docs, fetched fresh at export time — they are the durable source of truth for every design decision, convention, and open issue in the system, and are normally read/written via the Projects tool (`project_read`/`project_write`), not this static copy:

- **`next-touch-system-state.md`** — the Next Touch system's full working memory: live page URLs, the Contact Brief modal design (section 3 above, in full detail), the This Week section design, the "Team access to call knowledge" requirements every brief page must have, the Apollo priority-tier table with campaign IDs, all behavior rules (never-silently-overwrite, consolidate-don't-fragment, end-of-day missing-notes flag, etc.), the sync watermark, and a full dated Run log of every change made to the system.
- **`pipeline-pulse-handoff.md`** — the current, live Pipeline Pulse procedure doc: scope rules (Owner = adam.rus only, five specific open Opportunity stages), required per-record fields (verbatim-hyperlink-capture rule), the full Salesforce-check procedure, the This Week tab design and its Contact/Account-matching limitations, the scheduled-automation section (device-binding status), and a known-issues/changelog section.
- **`pipeline-pulse-handoff-LEGACY-2026-08-22.md`** — an earlier, superseded snapshot of the Pipeline Pulse handoff doc (extracted from the uploaded PDF, dated 2026-08-22), kept only as a historical reference showing the pre-rework scope (all leads regardless of owner, ID-reconstructed links, no This Week tab). **Do not follow this version for current operations.**
- **`nathan-moser-2026-08-25.md`** — Nathan Moser's Aug 25 discovery-call notes in the standard (a)-(e) call-notes format used throughout this system; also the worked example behind the Nathan Moser contact brief page and the "Reading the Tape" Call Coach pilot.

## 7. Known limitations (as of export)

- **No live Salesforce API access.** Blocked on `invalid_client: app must be installed into org` until a Salesforce admin installs the connected app under Setup > Connected Apps OAuth Usage. Until then, Pipeline Pulse relies on Chrome-browser piggybacking on Adam's own logged-in Salesforce session — never credentials entered by Claude.
- **Pipeline Pulse's device binding is not yet approved** — Adam's account isn't logged into any desktop. The calendar-triggered refresh trigger runs its Calendar-only half hourly regardless; the Salesforce/Chrome half is a no-op until binding is approved.
- **Cross-artifact linking is deep-link-only, not a live inline modal.** Since Next Touch, Pipeline Pulse, and Daily Priorities are separate published Artifacts with no shared DOM, a name click on Pipeline Pulse/Daily Priorities opens Next Touch in a new tab (hash-deep-linked to the right contact) rather than popping an inline modal in place. This is the deliberate, working approximation — not a bug to "fix" without redesigning the whole cross-artifact architecture.
- **No in-page AI question-answering.** Confirmed against the runtime contract: the only Artifact capabilities available (`artifact`, `downloads`, `mcp`, `self`) do not support LLM inference from inside a published page. Open-ended questions about a contact are answered by a human asking Claude directly in a session, grounded in that contact's brief page and transcript.
- **Only 3 of 20 tracked contacts have a standalone brief page.** The rest are covered via the Next Touch modal only; new brief pages are built on demand (next call/email/priority-engine touch), not speculatively.
- **Gmail inbound-response watcher is not yet proven unattended.** A same-day, pre-watermark message (Tyler Chartier, 2026-08-25) was caught only by manual review, not the watermark logic — the sync trigger now also re-checks today's messages regardless of watermark as a guard, but this hasn't been verified across many automated runs yet. Spot-check the Run log in `next-touch-system-state.md` periodically.

## 8. Not included in this package

`/home/claude/call-analysis/` (large local audio/video/frame files from ad-hoc call review sessions, tens of MB each) was deliberately excluded — it is scratch analysis output, not a component required to run, edit, or continue developing either live system, and including it would balloon this archive without adding anything reconstructible from the sources above. If a future session needs to redo that kind of call-recording analysis, the source Gemini transcripts and Drive docs referenced throughout `project-docs/` are the durable starting point.
