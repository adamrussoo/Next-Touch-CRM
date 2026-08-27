#!/usr/bin/env bash
set -euo pipefail

node --check server.mjs
node --check app/app.js

echo "Post-merge validation complete."