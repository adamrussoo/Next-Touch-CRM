# Next Touch on Replit

This workspace contains both the original dependency-free local command center and the active Express receiving dashboard for the imported Next Touch / Pipeline Pulse snapshot.

## Active dashboard

- Workflow: `Next Touch`
- Command: `PORT=5000 npm start`
- Preview port: `5000`
- Server: `server.js`

The active dashboard receives the latest snapshot through its authenticated sync endpoint and serves it from its local persisted snapshot. The frontend is display-only: it polls the local `/api/data` endpoint and does not reach into Claude, Salesforce, Apollo, Gmail, or Calendar directly.

## Approved design safeguard

The personal command-center interface is the approved visual baseline. When importing future ZIP or snapshot updates, merge functional changes into the existing dashboard rather than replacing its `public/` frontend. Confirm intentional visual redesigns before applying them.

## Preserved original workspace

The original local command center remains available in `server.mjs` with its imported data files. Salesforce and Apollo records are shown with their source freshness and missing fields intact; the local runtime does not sync changes back to either service.

The HTML files in `artifacts/live-pages/` remain point-in-time reference exports. Do not run the historical scripts in `build-scripts/` as a repeatable build pipeline.