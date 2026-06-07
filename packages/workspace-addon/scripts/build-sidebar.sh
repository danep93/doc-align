#!/bin/bash
set -euo pipefail

SIDEBAR_DIR="$(cd "$(dirname "$0")/../sidebar" && pwd)"
APPS_SCRIPT_DIR="$(cd "$(dirname "$0")/../apps-script" && pwd)"

echo "Building sidebar..."
cd "$SIDEBAR_DIR"
pnpm run build

echo "Copying to apps-script/sidebar.html..."
cp "$SIDEBAR_DIR/dist/index.html" "$APPS_SCRIPT_DIR/sidebar.html"

echo "Done. sidebar.html is ready for Apps Script deployment."
