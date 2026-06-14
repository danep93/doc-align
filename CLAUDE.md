# doc-align

Privacy-first Chrome extension for Google Docs sign-off and alignment.

## Project Structure

TypeScript monorepo with pnpm workspaces:
- `packages/shared` — types, validation (Zod), tier logic
- `packages/backend` — Express API (Firebase Auth, Firestore, Stripe)
- `packages/extension` — Chrome extension (Manifest V3, webpack)
- `packages/addon-backend` — **Go HTTP server** for the Workspace Add-on (Card Service, NOT pnpm)
- `packages/workspace-addon/manifest/appsscript.json` — Add-on manifest (OAuth scopes, trigger config)

## Commands

- `pnpm install` — install all dependencies
- `pnpm run build-all` — build all packages
- `pnpm run test-all` — run all tests
- `pnpm run typecheck` — typecheck all packages
- `cd packages/extension && pnpm run watch` — dev build with watch
- `cd packages/backend && pnpm run dev` — dev server with hot reload

## Key Conventions

- All types shared via `@doc-align/shared` workspace package
- Backend stores NO document content — only signature metadata and doc references
- Diff computation is always client-side (extension)
- Firebase Auth for both extension auth and backend API auth
- Zod schemas validate at API boundaries
- Tests use vitest

## Verifying Changes

After ANY change to extension UI, backend routes, auth flow, or shared types:
1. Build all: `pnpm run build-all`
2. Run E2E tests: `pnpm test:e2e`
3. Do NOT claim a fix works unless E2E tests pass
4. If a relevant E2E test doesn't exist for the change, write one first

If E2E tests fail, read the screenshot and trace output to diagnose.
Do not say "I can't verify because I can't click in the extension."
The E2E tests ARE the verification.

### Bug fix workflow
1. Write a failing E2E test that reproduces the bug
2. Fix the bug
3. Run `pnpm test:e2e` — new test passes, existing tests don't regress
4. Only then report the fix as complete

---

## Workspace Add-on (Go backend)

The add-on is a native Card Service add-on backed by a Go HTTP server. No React, no Apps Script logic — Google POSTs to HTTPS endpoints and the server returns Card Service JSON.

Design spec: `docs/superpowers/specs/2026-06-14-workspace-addon-card-service-design.md`

### Go backend commands

```bash
# Build
cd packages/addon-backend && go build ./...

# Run locally (dev mode — skips OIDC verification)
cd packages/addon-backend
OIDC_BYPASS=true DEBUG_EMAIL=rhlrtr44@gmail.com FIREBASE_PROJECT_ID=<project-id> PORT=8080 go run .
```

`OIDC_BYPASS=true` skips Google OIDC JWT verification and reads the user email from `DEBUG_EMAIL` instead. Required for local ngrok testing since Google won't issue real JWTs to a dev machine.

### Running with ngrok (full local test)

Prerequisites:
- Go 1.22+ installed (`brew install go`)
- `gcloud` CLI authenticated: `gcloud auth application-default login`
- ngrok installed: `brew install ngrok/ngrok/ngrok`
- A Google Cloud project with Firestore enabled (Native mode)

Steps:
```bash
# 1. Authenticate
gcloud auth application-default login
export FIREBASE_PROJECT_ID=your-gcp-project-id   # the Firebase/GCP project with Firestore

# 2. Start server
cd packages/addon-backend
OIDC_BYPASS=true DEBUG_EMAIL=rhlrtr44@gmail.com FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID go run .
# → "listening on :8080"

# 3. In a new terminal: start ngrok
ngrok http 8080
# → copy the https://xxxx.ngrok-free.app URL

# 4. Register in Google Cloud Console
#    Go to: console.cloud.google.com → APIs & Services → Workspace Add-on SDK
#    Click "MANAGE" → "Configuration" → "HTTP Deployments"
#    Set endpoint URL: https://xxxx.ngrok-free.app
#    Docs homepage trigger: https://xxxx.ngrok-free.app/addon/homepage
#    Gmail contextual trigger: https://xxxx.ngrok-free.app/addon/gmail-trigger
#    OAuth scopes: documents.readonly, drive.file, userinfo.email, gmail.addons.current.message.metadata
#    Click "Install for testing" and add rhlrtr44@gmail.com

# 5. Open any Google Doc
#    Extensions menu → doc-align → Open
#    → hits POST /addon/homepage → returns EmptyState card
```

### Test walkthrough (all Docs card views)

Walk these in order to exercise the full flow:
1. Open sidebar in a Google Doc → **Empty State** card → click "Create baseline"
2. **Add Signers** card → type one or more emails → "Done"
3. **Status card (owner view)** → shows signers as pending
4. Open same doc logged in as a signer → **Status card (signer view)** → "Sign this doc"
5. **Sign Form** card → optionally enter commit message → "Sign"
6. Back to **Status card** → signer shows as signed with timestamp
7. Click "History" → **History card** → shows baseline created + sign events
8. Edit the doc, wait for drift check (or use "Simulate drift" overflow menu item) → "View changes" → **Diff View**

### Diff view prerequisite

The diff view fetches the signed revision text using the owner's OAuth token stored in Firestore. For this to work you need `ownerRefreshToken` in `documents/{docId}`. This is stored automatically when the owner creates a baseline — but requires the owner's refresh token to have been captured via OAuth. For local testing you can manually write a token into Firestore via the console, or ask Claude to wire up the OAuth callback endpoint.

### Key files

```
packages/addon-backend/
  main.go                         — HTTP server, route registration
  middleware/verify_oidc.go       — OIDC JWT verification (bypass with OIDC_BYPASS=true)
  cards/types.go                  — Card Service JSON structs
  cards/*.go                      — Card builders (one per view)
  routes/*.go                     — Route handlers (one per endpoint)
  services/firestore.go           — Firestore CRUD for documents/{docId}, signers, history
  services/doc_text.go            — Docs API: fetch current text + parse sections by heading
  services/doc_revisions.go       — Drive Revisions API: keepForever, export text
  services/drift_detection.go     — LCS diff + section similarity scoring
  services/owner_token.go         — Owner OAuth token store (plaintext MVP; KMS in Phase 2)
packages/workspace-addon/manifest/appsscript.json — OAuth scopes and trigger config reference
```

### Firestore data model

```
documents/{docId}
  title, ownerId, ownerRefreshToken, baselineRevisionId, lastDriftCheckedAt, createdAt

documents/{docId}/signers/{email}
  status (pending|signed|drifted), signedAt, signedRevisionId, commitMessage

documents/{docId}/history/{id}
  action, actorEmail, commitMessage, revisionId, timestamp
```

No document content is ever written to Firestore. Only revision IDs and metadata.
