#!/bin/bash
set -e

ENV="${1:-staging}"
SMOKE_DOC="https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit"
EXTENSION_DIR="$(cd "$(dirname "$0")/../packages/extension/dist" && pwd)"
SMOKE_PROFILE="/tmp/doc-align-smoke-$ENV"

# Clean previous smoke test profile
rm -rf "$SMOKE_PROFILE"

cd "$(dirname "$0")/.."

echo ""
echo "=== doc-align Smoke Test ($ENV) ==="
echo ""
echo "Building extension with $ENV config..."
if [ "$ENV" = "production" ] || [ "$ENV" = "prod" ]; then
  pnpm run build:extension:prod > /dev/null 2>&1
else
  pnpm run build:extension:staging > /dev/null 2>&1
fi
echo "Build complete."
echo ""
echo "Launching Chrome with the extension and test doc..."
echo ""
echo "------------------------------------------------------------"
echo "  SMOKE TEST CHECKLIST ($ENV)"
echo "------------------------------------------------------------"
echo ""
echo "  1. SIGN IN"
echo "     - Click the doc-align extension icon (puzzle piece)"
echo "     - Click 'Sign in with Google'"
echo "     - Verify: popup shows your email and tier badge"
echo ""
echo "  2. DETECT DOCUMENT"
echo "     - The test doc should already be open"
echo "     - Close and re-open the extension popup"
echo "     - Verify: sign-off tab shows the document title"
echo ""
echo "  3. CREATE SIGNATURE (skip if you already have one)"
echo "     - Go to Settings tab > Create New Signature"
echo "     - Draw a signature, enter your name, save"
echo "     - Verify: modal closes, settings shows your signature"
echo ""
echo "  4. SIGN OFF"
echo "     - Go to Sign Off tab"
echo "     - Click 'Sign Off' button"
echo "     - Verify: 'Signature copied to clipboard' toast appears"
echo "     - Paste (Cmd+V) into the Google Doc"
echo "     - Verify: signature image appears in the doc"
echo ""
echo "  5. CHECK DOCUMENTS TAB"
echo "     - Go to My Documents tab"
echo "     - Verify: the test doc appears in the signed list"
echo ""
echo "  6. TRACK DOCUMENT (optional)"
echo "     - Go to Sign Off tab > click 'Track This Doc'"
echo "     - Go to My Documents tab > switch to 'Tracked' toggle"
echo "     - Verify: the doc appears in tracked list"
echo ""
echo "------------------------------------------------------------"
echo "  When done, close Chrome (Cmd+Q) to end the smoke test."
echo "------------------------------------------------------------"
echo ""

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="$SMOKE_PROFILE" \
  --load-extension="$EXTENSION_DIR" \
  --no-first-run \
  --disable-default-apps \
  "$SMOKE_DOC" 2>/dev/null

echo ""
echo "Smoke test session ended."
echo ""
