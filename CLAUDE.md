# doc-align

Privacy-first Chrome extension + Google Workspace Add-on for Google Docs sign-off and alignment.

## Project Structure

TypeScript monorepo with pnpm workspaces:
- `packages/shared` — types, validation (Zod), tier logic
- `packages/backend` — Express API (Firebase Auth, Firestore, Stripe)
- `packages/extension` — Chrome extension (Manifest V3, webpack)
- `packages/addon-backend` — **Go HTTP server** for the Workspace Add-on (Card Service)
- `packages/workspace-addon/manifest/appsscript.json` — Add-on manifest (OAuth scopes, trigger config)

---

## Active Work: Workspace Add-on (Go backend)

The add-on is an HTTP Card Service add-on. Google POSTs JSON events to HTTPS endpoints; the server returns Card Service JSON. No Apps Script, no React.

**Running notes** (what works, what's broken, what's left): `docs/superpowers/specs/2026-06-14-addon-backend-running-notes.md`
**Design spec**: `docs/superpowers/specs/2026-06-14-workspace-addon-card-service-design.md`
**Setup & run instructions** (ngrok install, daily run loop, GCP reference): `instructions.md`

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

### Critical invariants (learned the hard way)

- **Homepage triggers return bare `Card`; action callbacks return `RenderActions`.**  
  Use `writeErr` for homepage handlers, `writeActionErr` for all action handlers. Wrong type = silent failure.

- **`FormAction.function` must be a full HTTPS URL.**  
  `cards.BaseURL` is prepended by `actionButton()`. Never pass a relative path.

- **`docs.id` is empty in homepage triggers.**  
  `routes/homepage.go` falls back to `services.MostRecentDocID()` (Drive API, ~1-2s overhead).  
  All card builders accept `docID string` and embed it as a button parameter so subsequent action handlers get it via `ev.resolveDocID()`.

- **Use `materialIcon`, not `knownIcon`.**  
  KnownIcon enum is very limited. `HOURGLASS`, `CHECK_CIRCLE`, `WARNING` are invalid and render broken images.

---

## Inactive / Deprecated

The following packages exist but are not the current focus:

- `packages/extension` — Chrome extension. Build with `cd packages/extension && pnpm run watch`.
- `packages/backend` — Express API. Run with `cd packages/backend && pnpm run dev`.
- `packages/shared` — shared types, used by extension and backend.

E2E test workflow (`pnpm test:e2e`) applies to the extension/backend packages, not the Go add-on backend.

Monorepo commands (when working on extension or backend):
```bash
pnpm install          # install dependencies
pnpm run build-all    # build all TS packages
pnpm run test-all     # run all TS tests
pnpm run typecheck    # typecheck all TS packages
```
