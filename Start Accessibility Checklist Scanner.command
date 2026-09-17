#!/usr/bin/env bash
# Double-click to start the scanner. Leave this window open while you use it.
cd "$(dirname "$0")"
clear 2>/dev/null || true
echo ""
echo "  Starting the Accessibility Checklist Scanner..."
echo "  Your browser will open in a moment. Leave this window open while you use the scanner."
echo "  To stop, close this window or press Ctrl+C."
echo ""
# The downloaded copy brings its own Node.js in runtime/; a copy from source uses the machine's.
if [ -x runtime/bin/node ]; then NODE=./runtime/bin/node
elif command -v node >/dev/null 2>&1; then NODE=node
else
  echo "  Node.js is not installed yet. Go to https://nodejs.org, install the LTS version, then double-click this file again."
  echo "  Press any key to close."; read -n 1 -s; exit 1
fi
[ -d node_modules ] || { echo "  First run: installing dependencies (about a minute)..."; npm install --silent --no-audit --no-fund || { echo "  Setup failed. Press any key to close."; read -n 1 -s; exit 1; }; }
exec "$NODE" bin/a11y.js ui
