#!/bin/bash
set -e

SMOKE_DOC="https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit"
EXTENSION_DIR="$(cd "$(dirname "$0")/../packages/extension/dist" && pwd)"
DEV_PROFILE="/tmp/doc-align-dev"

cd "$(dirname "$0")/.."

echo ""
echo "=== doc-align Local Dev ==="
echo ""
echo "Deploying Firestore indexes to staging..."
pnpm run deploy:indexes:staging > /dev/null 2>&1 || echo "Warning: index deploy failed (may need 'firebase login' first)"
echo ""
echo "Building extension pointing at localhost:8080 (staging Firebase)..."
FIREBASE_PROJECT_ID=doc-align-staging pnpm --filter @doc-align/extension run build > /dev/null 2>&1
echo "Build complete."
echo ""
echo "Make sure your backend is running: cd packages/backend && pnpm run dev"
echo ""
echo "Launching Chrome with the extension..."
echo ""

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="$DEV_PROFILE" \
  --load-extension="$EXTENSION_DIR" \
  --no-first-run \
  --disable-default-apps \
  "$SMOKE_DOC" 2>/dev/null

echo ""
echo "Dev session ended."
echo ""
