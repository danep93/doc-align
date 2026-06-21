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

- **`docs.id` is NEVER provided in test mode — this is a Google limitation, not a code bug.**
  In the test account, `drive.file` is globally pre-authorized so Google skips the per-file dialog and sends
  an empty `docs` object (`{}`) in ALL events (homepage, onFileScopeGranted). There is no server-side fix.
  In production: the per-file dialog appears → user grants scope → `onFileScopeGrantedTrigger` fires WITH
  correct `docs.id` → correct card shown. The `ConnectDocument` + `onFileScopeGranted` flow is correct for prod.
  In test mode: `onFileScopeGranted` returns `popToRoot` when `docs.id` is empty, which re-fires the homepage.
  The homepage still gets empty `docs.id` and shows ConnectDocument again (an infinite loop of ConnectDocument).
  **Workaround for local dev:** test on a doc that was previously baseline'd in an earlier session — those docs
  had `drive.file` granted individually and their subsequent opens have `addonHasFileScopePermission=true`.

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
- **`docs.id` flow** — production flow is correct. Test env limitation: `docs.id` is always empty (see critical invariants). To test the owner flow locally, open a doc that was previously baseline'd (has a Firestore entry) — that doc will have `addonHasFileScopePermission=true` on reopen.
- **Email notifications** — SendGrid/Resend integration not built
- **History card** — not tested
- **Multi-user flows** — owner + signer in separate accounts

---

## Daily Run

**Terminal 1 — ngrok tunnel**
```bash
ngrok http --url=reactor-explore-crumb.ngrok-free.dev 8080
```

**Terminal 2 — Go server**
```bash
cd packages/addon-backend
OIDC_BYPASS=true \
DEBUG_EMAIL=rhlrtr44@gmail.com \
FIREBASE_PROJECT_ID=docaligntest \
BASE_URL=https://reactor-explore-crumb.ngrok-free.dev \
PORT=8080 \
go run .
```

`OIDC_BYPASS=true` skips OIDC JWT verification (required behind ngrok). `BASE_URL` is required — all Card Service action buttons embed it.

**Build without running:**
```bash
cd packages/addon-backend && go build ./...
```

**Open the add-on:** Go to any Google Doc → click the multicolor "G" icon in the right sidebar.

### GCP reference

| Resource | Value |
|---|---|
| GCP project | `docaligntest` (number `841259604072`) |
| Firestore | Native mode, us-east1 |
| OAuth consent | External; test user `rhlrtr44@gmail.com` |
| ngrok static URL | `https://reactor-explore-crumb.ngrok-free.dev` |
| Deployment config | `/tmp/addon-deployment.json` |

**Redeploy after changing ngrok URL or OAuth scopes:**
```bash
gcloud workspace-add-ons deployments replace my-addon \
  --deployment-file=/tmp/addon-deployment.json
gcloud workspace-add-ons deployments install my-addon
```

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
