#!/usr/bin/env bash
set -euo pipefail

node --check server.mjs
node --check app/app.js
node --check server.js
node --check public/app.js

echo "Post-merge validation complete."