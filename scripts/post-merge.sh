#!/usr/bin/env bash
set -euo pipefail

node --check server.mjs
node --check app/app.js
node --check server.js
node --check public/app.js
node -e 'const p=require("./package.json"); if (p.main !== "server.js" || p.scripts?.start !== "node server.js") process.exit(1)'
grep -Fq 'run = ["node", "server.js"]' .replit
npm test

echo "Post-merge validation complete."