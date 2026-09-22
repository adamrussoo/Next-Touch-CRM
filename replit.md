# Next Touch on Replit

This workspace runs one unified Express application: the protected green Personal Sales Desk plus the incremental Next Touch / Pipeline Pulse receiving API.

## Active dashboard

- Workflow: `Next Touch`
- Command: `PORT=5000 npm start`
- Preview port: `5000`
- Server: `server.js`
- Production target: Reserved VM (required for the file-backed workspace and one-time device-code state)

The dashboard uses `data/contacts_data.json` and `data/pipeline_data.json` as its imported base snapshot, then overlays contacts and compatible pipeline data received by the sync API. Imported source data stays read-only. Completed work, personal notes, and manual next-action edits are saved separately in the protected `data/user_state.json` workspace store and never written back to CRM data.

`DASHBOARD_PASSWORD` protects the default dashboard workspace. Signed HTTP-only sessions isolate personal state, CSRF tokens protect writes, and the **Sync devices** control uses a short-lived one-time pairing code to connect another browser in the same workspace. `SYNC_SECRET` separately protects full, contact, batch, section, and AI-queue automation routes.

Optional multi-workspace mode uses `NEXT_TOUCH_DEFAULT_WORKSPACE` plus secret `NEXT_TOUCH_WORKSPACES_JSON`. In that mode Basic Auth usernames and `X-Workspace-Id` select a configured workspace; credentials, snapshots, logs, personal state, pairing codes, and AI jobs must remain workspace-scoped. Non-default workspaces must not inherit the default imported CRM snapshot.

## Approved design safeguard

The green Personal Sales Desk in `app/` is the approved visual baseline. When importing future ZIP or snapshot updates, merge functional changes into this interface rather than replacing it. Confirm intentional visual redesigns before applying them.

## Preserved legacy files

`server.mjs` and the prior `public/` command-center frontend remain as reference files only. They are not active workflow or deployment entrypoints.

The HTML files in `artifacts/live-pages/` remain point-in-time reference exports. Do not run the historical scripts in `build-scripts/` as a repeatable build pipeline.
