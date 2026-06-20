# Workspace Add-on Backend — Running Notes

Last updated: 2026-06-14

This doc captures what actually works, what's broken, what's been learned, and what's left to build. It complements the design spec; the design spec describes intent, this doc describes reality.

---

## What's Working (verified end-to-end)

- Homepage trigger → EmptyState card rendered in Google Docs sidebar
- "Create baseline" button → navigates to AddSigners card
- AddSigners → type email → "Done" → StatusOwner card with signer listed as pending
- Firestore writes confirmed: `documents/{docId}`, `documents/{docId}/signers/{email}`, history entry

## What's Not Tested Yet

- Signer flow (StatusSigner → SignForm → Sign → back to StatusSigner)
- History card
- Diff view (requires `ownerRefreshToken` in Firestore — see below)
- Drift detection trigger
- Gmail contextual trigger
- Quick-sign buttons
- Multi-user flows (owner + signer in separate accounts)

---

## GCP / Deployment State

- **GCP project**: `docaligntest` (project number `841259604072`)
- **Firestore**: Native mode, us-east1
- **OAuth consent screen**: External, test user `rhlrtr44@gmail.com`
- **Add-on deployment**: HTTP deployment via `gcloud workspace-add-ons deployments` (not Apps Script)
- **ngrok static URL**: `https://reactor-explore-crumb.ngrok-free.dev` (saved to `~/.config/doc-align/ngrok-token`)
- **Current deployment config**: `/tmp/addon-deployment.json`

OAuth scopes in deployment:
```
https://www.googleapis.com/auth/documents.readonly
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/gmail.addons.current.message.metadata
```

---

## How to Run Locally

```bash
# 1. Start ngrok (static URL, no need to update deployment each time)
ngrok http --url=reactor-explore-crumb.ngrok-free.dev 8080

# 2. Start server (new terminal)
cd packages/addon-backend
OIDC_BYPASS=true \
DEBUG_EMAIL=rhlrtr44@gmail.com \
FIREBASE_PROJECT_ID=docaligntest \
BASE_URL=https://reactor-explore-crumb.ngrok-free.dev \
PORT=8080 \
go run .
```

`BASE_URL` is required — action button `function` fields must be full HTTPS URLs for HTTP add-ons.

---

## Key Technical Learnings (hard-won)

### docs.id is empty in homepage triggers
HTTP add-on homepage triggers never populate `docs.id` in the event payload when using `drive.file` (per-file scope). With `drive.readonly` it may be populated — there's a log statement in `routes/homepage.go` to check this. Current workaround: Drive API `files.list?orderBy=viewedByMeTime desc` to get the most recently opened Doc.

**TODO**: once we confirm `docs.id` is populated with `drive.readonly`, remove the `MostRecentDocID` fallback from `routes/homepage.go`. It adds ~1-2s of latency.

### Action callbacks require RenderActions, homepage requires Card
Homepage trigger endpoints must return a bare `Card` JSON object.
Action callback endpoints (button clicks) must return `RenderActions` with `{ "action": { "navigations": [...] } }`.
Returning the wrong type causes Google to silently drop the response — the UI shows "nothing happened".

Two separate error helpers exist for this:
- `writeErr(w, msg)` — for homepage handlers
- `writeActionErr(w, msg)` — for all action handlers

### FormAction.function must be a full HTTPS URL
For HTTP add-ons, `FormAction.function` must be an absolute URL like `https://xxxx.ngrok-free.dev/addon/create-baseline`. Relative paths (`/addon/create-baseline`) are silently ignored — button clicks do nothing.

`cards.BaseURL` must be set at startup from the `BASE_URL` env var. `actionButton()` prepends it automatically.

### KnownIcon values are limited — use materialIcon
`google.apps.card.v1` KnownIcon enum does not include `HOURGLASS`, `CHECK_CIRCLE`, or `WARNING`. Using invalid values renders a broken image placeholder. Use `materialIcon` instead:
```json
{ "materialIcon": { "name": "check_circle" } }
```

### docId must be threaded through button parameters
`docs.id` is empty in homepage triggers (see above). Once the homepage resolves `docID` via fallback, it embeds it as a `docId` parameter on every action button. Action handlers call `ev.resolveDocID()` which reads `param("docId")` first, then falls back to `ev.Docs.ID`.

### drive.file scope doesn't grant write access via user token
`KeepRevisionForever` (marking a Drive revision as permanent) requires write access. The user's OAuth token with `drive.file` scope should have it, but we're seeing 403s. May need `drive` (full) scope or the revision API behaves differently for add-ons. Currently non-fatal — baseline creation succeeds without pinning the revision.

---

## What Needs to Be Built

### Latency (5s round-trip)
- ngrok: ~200ms overhead (acceptable)
- `MostRecentDocID` Drive API call: ~1-2s — eliminate if `docs.id` is now populated
- Firestore reads: ~200-500ms each — acceptable
- `go run .` is fine for dev; compiled binary would save ~0ms (it's already compiled on start)

### Diff View (not working — missing owner token)
The diff view (`/addon/diff`) fetches the signed revision text using the owner's stored refresh token. `ownerRefreshToken` must be in `documents/{docId}` in Firestore. It's currently never written because:
1. The OAuth callback that captures the refresh token hasn't been built
2. `create-baseline` would need to exchange a code for a refresh token and store it

**MVP workaround**: manually write `ownerRefreshToken` into Firestore for testing.
**Proper fix**: build an OAuth callback endpoint that stores the refresh token when the owner first authorises.

### Drift Detection (not wired up)
`services/drift_detection.go` exists but nothing triggers it. Needs:
- A scheduled job or webhook that periodically calls `/addon/check-drift` per active document
- Or: run drift check on every homepage load (simple but expensive)

### Sign flow validation
When a signer signs, we store `signedRevisionId`. But if `LatestRevisionID` fails (e.g. `drive.file` 403), we store an empty string. The diff view will then fail to fetch the signed revision. Need either:
- Ensure `drive.file` scope grants revision read access (it should — investigate the 403)
- Or fall back to a different revision strategy

### Gmail trigger
`/addon/gmail-trigger` handler exists (`routes/gmail_trigger.go`) but hasn't been tested. Should show drift notifications for docs the user has signed.

### UI polish remaining
- Card headers could use the doc title more consistently
- StatusOwner: no way to add more signers after initial setup
- No "Remove signer" action
- "Simulate drift" overflow menu item mentioned in walkthrough — not implemented
- Empty AddSigners multi-select (no collaborator pre-population) — Drive collaborators fetch is Phase 2

---

## Files Changed This Session

```
cards/types.go              — BaseURL var, materialIcon/matIcon, FormAction full-URL prefixing
cards/empty_state.go        — EmptyState(isOwner, docID) — docID in button param
cards/add_signers.go        — AddSigners(collaborators, docID) — docID in button param
cards/status_owner.go       — StatusOwner(..., docID), materialIcon icons
cards/status_signer.go      — StatusSigner(..., docID), materialIcon icons
cards/sign_form.go          — SignForm(..., docID) — docID in all button params
cards/history_view.go       — materialIcon icons
routes/event.go             — writeActionErr(), resolveDocID()
routes/homepage.go          — MostRecentDocID fallback, pass docID to all card builders
routes/on_file_scope_granted.go — docID threading, writeActionErr
routes/create_baseline.go   — resolveDocID, writeActionErr, guard on empty docID
routes/save_signers.go      — resolveDocID, writeActionErr
routes/sign_form.go         — decode event, resolveDocID
routes/sign.go              — resolveDocID, writeActionErr
routes/quick_sign.go        — resolveDocID, writeActionErr
routes/diff.go              — resolveDocID, writeActionErr
routes/history.go           — resolveDocID, writeActionErr
routes/recent_doc.go (NEW)  — MostRecentDocID() Drive API fallback
main.go                     — cards.BaseURL = BASE_URL env var
```
