# doc-align

Google Workspace Add-on for Google Docs sign-off and alignment. A document owner snapshots a version and requests sign-offs; signers commit to that version; if the doc changes after sign-off, signers are notified and must re-review.

**Note on "privacy-first":** earlier versions of this doc framed doc-align as privacy-first above all else. As of 2026-09-01, hitting product goals takes priority over that framing — transient LLM-based analysis of fetched doc content (e.g. for coaching/classification) is acceptable and should not be avoided on privacy grounds alone. Full document text is still never persisted, but **extracted/derived content will need to be stored going forward** — e.g. the section-level `changeSummary` already stores headings and counts, and later, whatever baseline fields get carried into a converted Linear project so that drift can be tracked against them (comparing what the Linear project turned into versus what the doc originally said, to surface inaccuracy or scope drift). Don't assume "never store anything derived from doc content" — the constraint is against storing full raw document text, not against storing the specific fields a feature is built to track.

**What it is NOT:** not an approval gate (sign-off is tracked, not enforced), not a diff renderer (uses Google's native version history), not a Chrome extension.

## Project Structure

TypeScript monorepo with pnpm workspaces:
- `packages/shared` — types, validation (Zod), tier logic
- `packages/backend` — Express API (Firebase Auth, Firestore, Stripe)
- `packages/extension` — Chrome extension (Manifest V3, webpack)
- `packages/addon-backend` — **Go HTTP server** for the Workspace Add-on (Card Service) ← active
- `packages/workspace-addon/manifest/appsscript.json` — Add-on manifest (OAuth scopes, trigger config)

---

## Active Work: Workspace Add-on (Go backend)

The add-on is an HTTP Card Service add-on. Google POSTs JSON events to HTTPS endpoints; the server returns Card Service JSON. No Apps Script, no React. Only surface: **Google Docs sidebar** (Gmail contextual trigger is out of scope for MVP).

### Key files

```
packages/addon-backend/
  main.go                      — server startup, route registration, cards.BaseURL init
  middleware/verify_oidc.go    — OIDC JWT verification (bypass with OIDC_BYPASS=true)
  cards/types.go               — Card Service JSON structs, BaseURL, actionButton helper
  cards/*.go                   — Card builders (one file per view)
  routes/event.go              — AddonEvent decode, writeErr/writeActionErr, resolveDocID
  routes/status_card.go        — resolveStatusCard: single source of truth for "what does this user see right now"
  routes/*.go                  — Route handlers (one file per endpoint)
  services/firestore.go        — Firestore CRUD
  services/recent_doc.go       — Drive API fallback for doc ID (MostRecentDocID)
  services/doc_text.go         — Docs API: fetch current text
  services/doc_revisions.go    — Drive Revisions API
  services/drift_detection.go  — LCS diff + section scoring
```

### Core user flows

**Owner flow:** Opens sidebar → EmptyState → clicks "Create baseline" (pins current Drive revision) → AddSigners card (enters emails) → StatusOwner card showing `N signed · N drifted · N pending`. The owner is added as a signer on their own doc too (a `pending` signer record created alongside the doc record on first baseline creation) — they appear in the same signer list as everyone they invite, with a "Sign this document" / "Re-sign" button on StatusOwner itself, using the same SignForm/Sign flow as any other signer.

**Signer flow:** Gets email with doc link → opens sidebar → StatusSigner card → clicks "Sign this doc" → SignForm (optional commit message) → signs → status = `signed`. Same flow for the owner signing their own doc, except signing routes back to StatusOwner instead of StatusSigner.

**Returning to the status view:** `SignForm`'s Cancel, `DiffView`'s Back, and `AddSigners`'s Cancel all hit `/addon/back-to-status` — a dedicated action route sharing `resolveStatusCard` with the homepage trigger. Don't point a "back"/"cancel" button at `/addon/homepage` directly: that handler reads `docs.id` (only populated on the real trigger event, not action-callback events) and returns a bare `Card`, which is the wrong response shape for an action callback (see Critical invariants below).

**Drift + re-review:** Signing has exactly one bottleneck: nobody but the owner can sign until the owner has completed their own first sign-off. After that, every signer (owner included, on later re-signs) can sign or re-sign at any time — there is no confirm-gate blocking anyone. Each signature's staleness is tracked independently: on sidebar open (or a manual "Refresh" click — Card Service add-ons have no client-side JS or server-push, so a one-click refresh is the closest this architecture allows to auto-detection), the lazy per-signer check compares the doc's live `modifiedTime` against that signer's own `signedModifiedTime` (captured when they signed) and flips `signed` → `drifted` independently per signer. A drifted signer sees "Re-sign" immediately, no waiting on anyone. "Confirm new version" is optional, not required: the owner can click it any time to leave a note and compute a fresh, rich `changeSummary` diff for signers (and now the owner too, via a "What changed" button on their own status card) to review — but nothing about anyone's ability to sign depends on this ever running.

**Drift check is lazy** — only runs on sidebar open, no background jobs. Post-MVP: replace `modifiedTime` comparison with Claude Haiku classification to ignore cosmetic edits.

### Card map

| Card | Shown when |
|---|---|
| `ConnectDocument` | `docs.id` not yet populated — drive.file per-file access not yet granted |
| `EmptyState` | No baseline exists |
| `AddSigners` | After "Create baseline" clicked |
| `StatusOwner` | Baseline exists; user is owner |
| `StatusSigner` | Baseline exists; user is a signer |
| `SignForm` | Owner or signer clicks "Sign" or "Re-sign" |
| `DiffView` | Owner clicks "What changed", or a signer follows a stored diff link |
| `History` | Owner clicks "History" |

### OAuth scopes

```json
[
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email"
]
```

`drive.file` covers per-file access granted via the in-add-on dialog. `documents.readonly` and `drive.readonly` were dropped — `drive.file` alone is sufficient for `files.export` on add-on-opened files and avoids the sensitive-scope review requirement.

Gmail contextual trigger was removed — the `gmail.addons.current.message.metadata` scope added unnecessary permission friction for a feature that wasn't built. Sign-off notifications use email-with-doc-link instead.

### Firestore schema

```
config/secrets
  resendApiKey — Resend API key (read by server at startup; env var RESEND_API_KEY overrides)

documents/{docId}
  title, ownerId, baselineRevisionId, confirmedVersion, confirmedModifiedTime, changeSummary {note, sections[], totalAdded, totalRemoved, fromRevisionId, toRevisionId}, createdAt

documents/{docId}/signers/{email}
  status (pending | signed | drifted), signedAt, signedModifiedTime, commitMessage, driftDetectedAt, notifiedAt

documents/{docId}/history/{id}
  action, actorEmail, commitMessage, revisionId, timestamp
```

Document content is not persisted in full. Firestore stores metadata plus a small set of intentionally-extracted fields: the section-level `changeSummary` (headings + counts + note). See the privacy-first note above.

### Critical invariants

- **Homepage triggers return bare `Card`; action callbacks return `RenderActions`.**
  Use `writeErr` for homepage handlers, `writeActionErr` for all action handlers. Wrong type = silent failure.

- **`FormAction.function` must be a full HTTPS URL.**
  `cards.BaseURL` is prepended by `actionButton()`. Never pass a relative path.

- **`docs.id` behavior on Workspace account (docalign.app):**
  With a fresh Workspace account and no pre-authorized `drive.file`, the per-file dialog appears normally →
  `onFileScopeGrantedTrigger` fires WITH correct `docs.id` → correct card shown. This is the expected prod flow.
  The old personal-Gmail issue (globally pre-authorized `drive.file` → empty `docs` object → infinite
  ConnectDocument loop) was specific to the developer install on a personal account and should not occur here.

- **Use `materialIcon`, not `knownIcon`.**
  KnownIcon enum is very limited. `HOURGLASS`, `CHECK_CIRCLE`, `WARNING` are invalid and render broken images.

- **`drive.file` scope 403 on revision writes.**
  `KeepRevisionForever` is currently non-fatal — baseline creation succeeds without pinning. Investigate scope issue; may need `drive` (full) scope or owner token for revision management.

- **Signer tokens never call the Revisions API — it silently returns an empty list for non-owners** (root cause of the original drift bug). Revision operations are owner-live-token only.

- **`/healthz` does not work through Cloud Run's `*.run.app` URL — only through ngrok.**
  Confirmed 2026-07-02: `GET /healthz` on the Cloud Run URL returns a Google-branded 404 HTML page that never reaches the container (no entry in Cloud Run request logs, no `server: Google Frontend` header). Any other unregistered path (e.g. `/foobar`) *does* reach the container and gets Go's own `404 page not found`. This means Google's edge intercepts `/healthz` specifically for `*.run.app` domains before it hits Cloud Run — it's not a bug in this app, and not something a redeploy fixes. Don't use `curl .../healthz` to verify a Cloud Run deploy; instead hit a real route (e.g. `POST /addon/homepage` without a token should return `401 missing Bearer token`). The documented `curl $NGROK_URL/healthz` check still works fine for local dev since it never goes through Cloud Run's edge.

### What's working

- Cloud Run deployment confirmed live at `https://doc-align-addon-856331950906.us-central1.run.app`
- Firestore connection from Cloud Run (IAM: `roles/datastore.user` on `856331950906-compute@developer.gserviceaccount.com`)
- `docs.id` flow on `rraturi@docalign.app` — per-file dialog → `onFileScopeGranted` fires with correct doc ID
- Homepage trigger → EmptyState card rendered in Google Docs sidebar
- "Create baseline" → AddSigners card
- AddSigners → submit → StatusOwner card with all signers listed
- Email: sign-off request sent via Resend on `save-signers`
- Email: owner notification sent when signer signs (Sign route)
- StatusSigner card shows all signers sorted by status (drifted → pending → signed)

### What's left to build

- **Signer flow** — StatusSigner → SignForm → Sign → back to StatusSigner (in active testing)
- **Drift detection wiring** — done: per-signer `modifiedTime` staleness check runs on homepage open (and on manual "Refresh"), owner confirm via `/addon/mark-revised` is optional enrichment only, never a signing gate
- **History card** — not tested
- **Multi-user flows** — owner + signer in separate accounts
- **Verify signers' Drive access at save-signers time** (Permissions API) — open question from spec

---

## Getting Started (new team member)

### How add-on deployment works

Two separate concepts — understand these before running any commands:

- **Deployment** (`my-addon` in `docalign-prod`): The add-on definition — HTTP endpoints, OAuth scopes, trigger config. There is **one** deployment shared by the whole org. It points to one server URL at a time. Only the project owner needs to update this when the server URL or config changes (`deployments replace`).

- **Install**: doc-align is published in the Google Workspace Marketplace, so individual `gcloud workspace-add-ons deployments install` is **no longer required**. Team members get the add-on from the Marketplace listing like any other user. The only reason to touch `deployments replace` day-to-day is to point the shared deployment at your local ngrok tunnel for testing.

> During local dev, whoever last ran `deployments replace` controls where Google routes requests for *everyone* (owner and Marketplace-installed users alike). Coordinate with the team — only one person's ngrok server can be active at a time, and remember to `deployments replace` back to Cloud Run (`deployment.json` as committed) when you're done testing.

---

### Prerequisites

Check each tool is installed — if not, install it first.

**Go 1.22+**
```bash
go version   # must be 1.22 or higher
```
Not installed? Download from https://go.dev/dl/

**ngrok**
```bash
ngrok version
```
Not installed? Download from https://ngrok.com/download and create a free account.  
You need a **static domain** (ngrok free tier gives one). Find yours at https://dashboard.ngrok.com/domains.

**gcloud CLI**
```bash
gcloud version
```
Not installed? Follow https://cloud.google.com/sdk/docs/install

---

### One-time setup

**1. Authenticate gcloud**

Run all commands below from the **repo root** unless otherwise noted.

```bash
gcloud auth login --account=YOUR_NAME@docalign.app
gcloud config set account YOUR_NAME@docalign.app
gcloud config set project docalign-prod
```

**2. Set up Application Default Credentials (needed for Firestore)**
```bash
gcloud auth application-default login
```
A browser window opens — sign in with your `@docalign.app` account.

**3. Configure ngrok authtoken**

Log in to https://dashboard.ngrok.com, copy your authtoken from the "Your Authtoken" page, then:
```bash
ngrok config add-authtoken YOUR_AUTHTOKEN
```

Your static domain is listed at https://dashboard.ngrok.com/domains (free tier gives one).

**4. (Local dev only) Point the deployment at your ngrok tunnel**

No install step is needed to get the add-on into your sidebar — doc-align is published in the Workspace Marketplace, so it's already available to install from there like any other add-on. The step below is only for testing local changes before they're deployed.

If you want to develop locally and have Google route requests to your ngrok tunnel, update all three URLs in `packages/addon-backend/deployment.json` to your ngrok URL, then:

```bash
gcloud workspace-add-ons deployments replace my-addon \
  --deployment-file=packages/addon-backend/deployment.json \
  --project=docalign-prod \
  --account=YOUR_NAME@docalign.app
```

This overwrites the shared deployment for everyone — coordinate with the team. **Do not commit** your ngrok URL change to `deployment.json`; the committed file always points to Cloud Run.

---

## Production Server (Cloud Run)

The add-on backend runs on Cloud Run at a permanent URL — no ngrok required for day-to-day use.

**Cloud Run URL:** `https://doc-align-addon-856331950906.us-central1.run.app`

### Deploying a new version

From the repo root, authenticated as your `@docalign.app` account (needs `Cloud Run Developer` role in `docalign-prod`):

```bash
gcloud run deploy doc-align-addon \
  --source packages/addon-backend/ \
  --region us-central1 \
  --project docalign-prod \
  --quiet
```

`--source packages/addon-backend/` is relative to your **current shell working directory**, not the repo — if a prior command in the same shell session `cd`'d into `packages/addon-backend`, this fails with `could not find source [packages/addon-backend/]`. Run `pwd` first, or use `cd /path/to/doc-align &&` before the command, to be sure you're at the repo root.

Cloud Build builds the image and rolls out the new revision automatically. Takes ~3 minutes. To verify it worked, don't curl `/healthz` (see Critical invariants above) — curl a real route instead, e.g. `curl -X POST https://doc-align-addon-856331950906.us-central1.run.app/addon/homepage` should return `401 missing Bearer token`.

### Pointing the Workspace add-on at Cloud Run

`deployment.json` already points to the Cloud Run URL. To push it:

```bash
gcloud workspace-add-ons deployments replace my-addon \
  --deployment-file=packages/addon-backend/deployment.json \
  --project=docalign-prod \
  --account=rraturi@docalign.app
```

---

## Local Dev (ngrok)

Only needed when you want to test changes before deploying to Cloud Run.

**Before first run:** copy `packages/addon-backend/.env.example` to `packages/addon-backend/.env` and fill in your values — especially `NGROK_URL` (your static domain from https://dashboard.ngrok.com/domains) and `DEBUG_EMAIL` (your `@docalign.app` email). The server auto-loads `.env` on startup.

**Terminal 1 — ngrok tunnel**

```bash
source packages/addon-backend/.env && ngrok http --url=$NGROK_URL 8080
```

**Terminal 2 — Go server**

```bash
source packages/addon-backend/.env && go run ./packages/addon-backend/
```

`OIDC_BYPASS=true` skips OIDC JWT verification (required behind ngrok). `BASE_URL` must match your ngrok URL. Both are set via `source .env`. The server reads `RESEND_API_KEY` from `.env` and falls back to Firestore `config/secrets` if not set.

**Build without running:**
```bash
cd packages/addon-backend && go build ./...
```

**Verify the stack is up** (run in a third terminal after both ngrok and the server are running):

```bash
source packages/addon-backend/.env && curl -s https://$NGROK_URL/healthz
```

Should return `200 OK`. If it hangs or errors, check that ngrok is running and the tunnel URL in `.env` matches your ngrok domain.

**Open the add-on:** Go to any Google Doc on your `@docalign.app` account → click the doc-align icon in the right sidebar (install from the Workspace Marketplace first if you haven't already).

---

### GCP reference

| Resource | Value |
|---|---|
| GCP project | `docalign-prod` (number `856331950906`) |
| GCP org | `docalign.app` (org ID `904470190675`) |
| Firestore | Native mode, nam5, free tier |
| Cloud Run service account | `856331950906-compute@developer.gserviceaccount.com` — needs `roles/datastore.user` |
| OAuth consent | Internal (docalign.app org only, no Google review needed) |
| Deployment config | `packages/addon-backend/deployment.json` |
| Add-on deployment | `my-addon` in `docalign-prod` |

---

## Inactive / Deprecated

- `packages/extension` — Chrome extension. Build with `cd packages/extension && pnpm run watch`.
- `packages/backend` — Express API. Run with `cd packages/backend && pnpm run dev`.
- `packages/shared` — shared types, used by extension and backend.

E2E test workflow (`pnpm test:e2e`) applies to the extension/backend packages, not the Go add-on backend.

Monorepo commands (when working on extension or backend):
```bash
pnpm install
pnpm run build-all
pnpm run test-all
pnpm run typecheck
```
