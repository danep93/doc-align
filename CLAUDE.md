# doc-align

Privacy-first Google Workspace Add-on for Google Docs sign-off and alignment. A document owner snapshots a version and requests sign-offs; signers commit to that version; if the doc changes after sign-off, signers are notified and must re-review.

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
  routes/*.go                  — Route handlers (one file per endpoint)
  services/firestore.go        — Firestore CRUD
  services/recent_doc.go       — Drive API fallback for doc ID (MostRecentDocID)
  services/doc_text.go         — Docs API: fetch current text
  services/doc_revisions.go    — Drive Revisions API
  services/drift_detection.go  — LCS diff + section scoring
  services/owner_token.go      — Owner OAuth token store
```

### Core user flows

**Owner flow:** Opens sidebar → EmptyState → clicks "Create baseline" (pins current Drive revision) → AddSigners card (enters emails) → StatusOwner card showing `N signed · N drifted · N pending`.

**Signer flow:** Gets email with doc link → opens sidebar → StatusSigner card → clicks "Sign this doc" → SignForm (optional commit message or quick-sign chip) → signs → status = `signed`.

**Drift + re-review:** Owner edits doc → reopens sidebar → lazy drift check runs (compares `modifiedTime` vs `signedAt`, marks `drifted`) → owner clicks "Notify signatories" → AI generates change summary → drift email sent → signer re-opens sidebar → sees drift summary → clicks "View version history" (opens native revisions page) or "Re-sign".

**Drift check is lazy** — only runs on sidebar open, no background jobs. Post-MVP: replace `modifiedTime` comparison with Claude Haiku classification to ignore cosmetic edits.

### Card map

| Card | Shown when |
|---|---|
| `EmptyState` | No baseline exists |
| `AddSigners` | After "Create baseline" clicked |
| `StatusOwner` | Baseline exists; user is owner |
| `StatusSigner` | Baseline exists; user is a signer |
| `SignForm` | Signer clicks "Sign" or "Re-sign" |
| `History` | Owner clicks "History" |

### OAuth scopes

```json
[
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.addons.current.message.metadata"
]
```

`documents.readonly` is sensitive (requires Google verification). Evaluate early: if `drive.file` alone supports `files.export` for add-on-opened files, drop `documents.readonly` entirely.

### Firestore schema

```
documents/{docId}
  title, ownerId, ownerRefreshToken (encrypted KMS), baselineRevisionId, lastDriftCheckedAt, createdAt

documents/{docId}/signers/{email}
  status (pending | signed | drifted), signedAt, signedRevisionId, commitMessage

documents/{docId}/history/{id}
  action, actorEmail, commitMessage, revisionId, timestamp
```

Document content is **never stored**. Only revision IDs and metadata.

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

### What's working

- Homepage trigger → EmptyState card rendered in Google Docs sidebar
- "Create baseline" → AddSigners card
- AddSigners → submit → StatusOwner card with signer listed as pending
- Firestore writes confirmed: `documents/{docId}`, `documents/{docId}/signers/{email}`, history entry

### What's left to build

- **Signer flow** — StatusSigner → SignForm → Sign → back to StatusSigner (not tested)
- **Drift detection wiring** — `services/drift_detection.go` exists but nothing triggers it on homepage open
- **Owner token / OAuth callback** — `ownerRefreshToken` is never written; need an OAuth callback endpoint; manual Firestore write for testing in the meantime
- **Diff view** — blocked on `ownerRefreshToken` in Firestore
- **`docs.id` flow** — should work correctly on the Workspace account (`rraturi@docalign.app`) since `drive.file` is not globally pre-authorized. Per-file dialog appears on first open of each doc.
- **Email notifications** — SendGrid/Resend integration not built
- **History card** — not tested
- **Multi-user flows** — owner + signer in separate accounts

---

## Getting Started (new team member)

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

**1. Get access to the GCP project**

Ask Rahul to:
- Create a `@docalign.app` Workspace account for you (OAuth consent is Internal — only org members can use the add-on)
- Add you to `docalign-prod` in GCP with at least the `Cloud Datastore User` role (for Firestore) and `Workspace Add-ons Developer` role

**2. Authenticate gcloud**

Run all commands below from the **repo root** unless otherwise noted.

```bash
gcloud auth login --account=YOUR_NAME@docalign.app
gcloud config set account YOUR_NAME@docalign.app
gcloud config set project docalign-prod
```

**3. Set up Application Default Credentials (needed for Firestore)**
```bash
gcloud auth application-default login
```
A browser window opens — sign in with your `@docalign.app` account.

**4. Configure ngrok authtoken**

Log in to https://dashboard.ngrok.com, copy your authtoken from the "Your Authtoken" page, then:
```bash
ngrok config add-authtoken YOUR_AUTHTOKEN
```

Your static domain is listed at https://dashboard.ngrok.com/domains (free tier gives one).

**5. Redeploy the add-on to your ngrok URL and install it for your account**

From the repo root, update all three URLs in `packages/addon-backend/deployment.json` to your domain, then:

```bash
gcloud workspace-add-ons deployments replace my-addon \
  --deployment-file=packages/addon-backend/deployment.json \
  --project=docalign-prod \
  --account=YOUR_NAME@docalign.app

gcloud workspace-add-ons deployments install my-addon \
  --project=docalign-prod \
  --account=YOUR_NAME@docalign.app
```

The `install` step makes the add-on visible in the sidebar for your account. You must run it even if you're not changing the URL.

Don't commit your ngrok URL change to `deployment.json` — coordinate with the team first.

---

## Daily Run

**Terminal 1 — ngrok tunnel**

Replace `YOUR_NGROK_DOMAIN` with your static domain from https://dashboard.ngrok.com/domains:
```bash
ngrok http --url=YOUR_NGROK_DOMAIN 8080
```

**Terminal 2 — Go server**

Replace `YOUR_EMAIL` with your `@docalign.app` email and `YOUR_NGROK_DOMAIN` with your domain:
```bash
cd packages/addon-backend
OIDC_BYPASS=true \
DEBUG_EMAIL=YOUR_EMAIL@docalign.app \
FIREBASE_PROJECT_ID=docalign-prod \
BASE_URL=https://YOUR_NGROK_DOMAIN \
PORT=8080 \
go run .
```

`OIDC_BYPASS=true` skips OIDC JWT verification (required behind ngrok). `BASE_URL` is required — all Card Service action buttons embed it.

**Build without running:**
```bash
cd packages/addon-backend && go build ./...
```

**Open the add-on:** Go to any Google Doc on your `@docalign.app` account → click the multicolor "G" icon in the right sidebar.

---

### Redeploying (changing ngrok URL)

If you need to switch to a different ngrok domain, update all three URLs in `packages/addon-backend/deployment.json`, then from the repo root:

```bash
gcloud workspace-add-ons deployments replace my-addon \
  --deployment-file=packages/addon-backend/deployment.json \
  --project=docalign-prod \
  --account=YOUR_EMAIL@docalign.app
gcloud workspace-add-ons deployments install my-addon \
  --project=docalign-prod \
  --account=YOUR_EMAIL@docalign.app
```

Don't commit your ngrok URL change to `deployment.json` — coordinate with the team first.

---

### GCP reference

| Resource | Value |
|---|---|
| GCP project | `docalign-prod` (number `856331950906`) |
| GCP org | `docalign.app` (org ID `904470190675`) |
| Firestore | Native mode, nam5, free tier |
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
