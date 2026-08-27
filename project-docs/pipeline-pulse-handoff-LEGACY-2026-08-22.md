# Pipeline Pulse — Salesforce tracker handoff (LEGACY SNAPSHOT — 2026-08-22)

> **This is a superseded, historical version of the handoff doc**, extracted from the uploaded PDF `pipeline_pulse_handoff.md.pdf` (created_at 2026-08-22). It predates the 2026-08-25/26 rework (owner-scoping on Leads, five-stage Opportunity filter, direct-hyperlink capture, the "This Week" tab, and the scheduled-automation trigger). **Do not follow this version for current operations** — use `pipeline-pulse-handoff.md` in this same folder, which is the live, current Project doc. This snapshot is kept only so a future reader can see how the system evolved (e.g. it still describes reconstructing Salesforce links from record IDs, an approach explicitly superseded by verbatim href capture; it still tracks all leads regardless of owner, later restricted to Owner = Adam Russo only).

Paste this whole message as your first message in the new chat. It gives a fresh Claude session everything it needs to pick this up with no other context — and no stale data, because the source of truth lives in the dashboard itself, not in this file.

## Context

I'm Adam Russo at Bench Accounting / Mainstreet Holdings. I don't have Salesforce admin access, so a proper API/OAuth integration (via Zapier MCP) is blocked on `invalid_client: app must be installed into org` until someone with Salesforce admin rights installs the connected app under Setup > Connected Apps OAuth Usage. Until that happens, the working approach is: use the Claude in Chrome browser tools to read my own already-logged-in Salesforce session directly (benchaccounting.lightning.force.com) — no API, no credentials entered by Claude, ever.

There's a live dashboard for this called Pipeline Pulse, published as a Claude Artifact at:
https://claude.ai/code/artifact/ce5924e8-918b-4ea5-b039-3b5ae79a3d95

This artifact is the actual source of truth — not this handoff file. It carries the full seenLeads and seenOpportunities diffing state inside its #pp-state JSON blob, and it's kept current by whichever Claude chat last ran a check, regardless of which chat that was. Because Chrome tabs can close unpredictably, there's no way to know in advance which chat holds the "last standing" state — so never trust a frozen snapshot (including any old copy of this file). Always pull the live version first.

Important: since this is a new conversation, republishing that dashboard requires passing url: "https://claude.ai/code/artifact/ce5924e8-918b-4ea5-b039-3b5ae79a3d95" explicitly to the Artifact tool — otherwise it creates a duplicate artifact instead of updating this one.

## First step: pull the live state — do NOT recreate it from memory

1. Call Artifact with action: "read" and url: "https://claude.ai/code/artifact/ce5924e8-918b-4ea5-b039-3b5ae79a3d95".
2. In the returned HTML, find the <script type="application/json" id="pp-state"> block and parse it. It contains seenLeads and seenOpportunities maps (same shape as below) plus display fields (stats, freshness, refreshRequest).
3. Recreate /home/claude/sf_tracker/state.json and /home/claude/sf_tracker/activity_log.jsonl in this session's workspace from that live data, not from any snapshot pasted into a chat. Shape:
```json
{
 "last_run_iso": "<from the artifact's state>",
 "last_status": "<from the artifact's state>",
 "notes": "Recreated from the live Pipeline Pulse artifact, not a frozen snapshot.",
 "seen_leads": { "<same shape as the artifact's seenLeads>": {} },
 "seen_opportunities": { "<same shape as the artifact's seenOpportunities>": {} }
}
```
4. Only if the artifact read ever fails or the blob is missing seenLeads/seenOpportunities (shouldn't happen going forward), fall back to a fresh manual browse of Salesforce to rebuild a baseline from scratch — tell me you had to do this.

## Then: run the check

1. Get the current browser tab (tabs_context_mcp, createIfEmpty: true if needed). Navigate to https://benchaccounting.lightning.force.com/lightning/o/Lead/list?filterName=__Recent.
2. If it bounces to a Salesforce login page instead of the Leads list: stop, don't log in, and tell me the session is logged out.
3. Find the "Sort by: Created Date" column-header button and click it exactly twice (first click = ascending, second = descending — you want descending/newest-first). Refs change per page load, so use find or read_page fresh each time.
4. Use read_page (not get_page_text) so you capture each row's record link (the href contains the Salesforce ID, e.g. /lightning/r/00Q.../view) alongside Name, Company, Email, Lead Status, Lead Source, Owner Alias, Created Date. Read the top ~30 rows.
5. Key each lead by its record ID if parseable, else fall back to "Name|Company" (matching the seed style above). Anything not already in seen_leads (and not a fuzzy name+company match) is a genuinely new lead — log it and add it to seen_leads.
6. Navigate to https://benchaccounting.lightning.force.com/lightning/o/Opportunity/list?filterName=__Recent. Same login check. Before reading rows, switch the list view to "My Opportunities" (or equivalent owner-scoped view) using the list view picker dropdown at the top-left of the list. "Recently Viewed" pulls records recently viewed by anyone on the team, not just mine — that caused teammates' opportunities (owned by other reps) to leak into the dashboard once already. Don't rely on a guessed URL filterName for this — list view API names vary by org — use the visible picker UI. Once on the right view, snapshot via read_page (Name, Account, Stage, Close Date, Owner, and the record ID / Bench ID from the link).
7. Owner filter is a hard requirement, enforced twice: even after switching to "My Opportunities," explicitly check each row's Owner field before adding it. Only keep opportunities where Owner = Adam Russo (alias adam.rus). Discard/skip anything owned by another rep — do not add it to seen_opportunities, do not surface it as new/updated on the dashboard, even if it shows up in the list. This is a deliberate belt-and-suspenders check in case the list view still shows cross-rep records.
8. For each remaining (mine-only) opportunity, compare against seen_opportunities by ID. Not present = new. Present with a changed stage/close_date/owner = updated — log the old vs new values. Update seen_opportunities either way.
9. Update state.json (new last_run_iso, last_status).
10. Append any new lines to activity_log.jsonl.
11. Read the dashboard's current HTML by fetching the artifact again (Artifact tool, action: "read", same URL — do this fresh, don't reuse the copy from step 1 in case someone else updated it in between), update its #pp-state JSON blob (stats, freshness text, new/updated lists, and the full updated seenLeads/seenOpportunities), and republish with Artifact, passing url: "https://claude.ai/code/artifact/ce5924e8-918b-4ea5-b039-3b5ae79a3d95" and favicon: "📈" so it updates the same page instead of forking a new one.

## Notes

- Never enter Salesforce credentials or attempt to log in on my behalf — if the session's logged out, just tell me.
- The dashboard has a "Request refresh" button (uses the Artifact artifact capability) — clicking it just flags a request visibly on the page; it can't wake a Claude session on its own, so a human still has to ask in chat.
- Because the artifact itself carries the full diffing state, it doesn't matter which chat runs a given check — old or new, this one or a future one. Whichever chat runs last just needs to read-before-diff-before-republish, and the single artifact stays the one consistent record. Don't keep a second "authoritative" copy anywhere else.
- Owner scoping applies to Opportunities only for now (see step 7 above) — the dashboard should only ever show deals I own. Leads currently are NOT filtered by owner, since some leads assigned to other reps (e.g. inbound emails routed to iris.sin) may still be prospects I end up working — flag this to me if it turns out leads need the same "mine only" treatment.
- If Salesforce admin ever installs the Zapier connected app (Setup > Connected Apps OAuth Usage), the whole browser-piggyback approach becomes unnecessary — the Zapier MCP server ("Claude MCP Server") already has Salesforce SOQL/SOSL query actions enabled and ready, just unauthenticated.

---
*Extracted from the uploaded file `pipeline_pulse_handoff.md.pdf` (Project file upload, created_at 2026-08-22) on 2026-08-26 for the project package export. Superseded by `pipeline-pulse-handoff.md` in this same folder.*
