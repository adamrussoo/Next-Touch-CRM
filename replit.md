# Next Touch on Replit

This workspace serves a dependency-free local command center built from the imported contact snapshot.

## Run

- Workflow: `Next Touch`
- Command: `node server.mjs`
- Preview port: `5000`

The app reads `data/contacts_data.json` and stores completed-task check-offs in the browser's local storage. It does not currently sync changes to Gmail, Calendar, Salesforce, Apollo, or the original Claude Artifacts.

The HTML files in `artifacts/live-pages/` remain point-in-time reference exports. Do not run the historical scripts in `build-scripts/` as a repeatable build pipeline.