# doc-align

Google Workspace Add-on for Google Docs sign-off and alignment. A document owner
snapshots a version and invites signers to sign off; if the doc changes after someone
signs, their signature is flagged as stale (drifted) so they know to re-review — with no
single-person bottleneck blocking anyone else from signing in the meantime.

## Demo

https://github.com/user-attachments/assets/6f800144-837e-43fb-8b57-f0ab22c28b28

**Active surface:** a Google Docs sidebar, implemented as an HTTP Card Service add-on
(no Apps Script, no client-side JavaScript) — see [`packages/addon-backend/`](packages/addon-backend)
(Go). Everything else in this monorepo (`packages/extension`, `packages/backend`,
`packages/shared`) is an earlier, now-inactive Chrome-extension-based approach — see
[`CLAUDE.md`](CLAUDE.md) for the full breakdown of what's active vs. deprecated.

This README covers running the active Go add-on backend locally. For architecture,
Firestore schema, card map, and implementation details, see [`CLAUDE.md`](CLAUDE.md).

## Prerequisites

- **Go 1.22+** — `go version` (install: https://go.dev/dl/)
- **ngrok** — `ngrok version` (install: https://ngrok.com/download). You'll need a free
  account and a static domain (find yours at https://dashboard.ngrok.com/domains).
- **gcloud CLI** — `gcloud version` (install: https://cloud.google.com/sdk/docs/install)
- A Google Workspace account in the `docalign.app` org (internal OAuth consent — this
  add-on isn't published for general use)
- **[Claude Code](https://claude.com/claude-code)** (optional but recommended) — this
  repo ships project-scoped Claude Code commands that automate the whole local dev
  loop; see [Fast path](#fast-path-claude-code-commands) below. Everything they do can
  also be run manually — see [Manual path](#manual-path).

## One-time setup

Run these once, from the repo root, authenticated as your own `@docalign.app` account.

```bash
gcloud auth login --account=YOUR_NAME@docalign.app
gcloud config set account YOUR_NAME@docalign.app
gcloud config set project docalign-prod

# Needed for the Go server's Firestore client (separate credential store from
# `gcloud auth login` above — both expire independently and need re-running
# periodically, e.g. after a long break or overnight).
gcloud auth application-default login
```

Configure ngrok:

```bash
ngrok config add-authtoken YOUR_AUTHTOKEN   # from https://dashboard.ngrok.com
```

Your free static domain is listed at https://dashboard.ngrok.com/domains.

Copy the env template and fill in your own values (never commit this file — it's
gitignored):

```bash
cp packages/addon-backend/.env.example packages/addon-backend/.env
```

Edit `packages/addon-backend/.env`:

```
NGROK_URL=your-domain.ngrok-free.app        # your static domain from the ngrok dashboard
BASE_URL=https://your-domain.ngrok-free.app # same value, with https://
DEBUG_EMAIL=your-name@docalign.app          # your own @docalign.app address
FIREBASE_PROJECT_ID=docalign-prod
PORT=8080
OIDC_BYPASS=true
```

No passwords, API keys, or tokens belong in this file for local dev — `RESEND_API_KEY`
and `ANTHROPIC_API_KEY` are optional and only needed if you're testing
email-sending or LLM-backed features; leaving them unset degrades those features
gracefully rather than failing.

## Fast path: Claude Code commands

If you're using Claude Code, this repo includes three project-scoped slash commands
under [`.claude/commands/`](.claude/commands) that automate the entire local loop:

- **`/local-addon-test`** — starts ngrok and the Go server, points the shared Workspace
  add-on deployment at your tunnel, and opens the test doc in Chrome. Run this first.
- **`/local-addon-reload`** — after you edit Go code, rebuilds and restarts just the Go
  server (leaves ngrok and the deployment pointer untouched). Use this for fast
  iteration instead of re-running `/local-addon-test`.
- **`/local-addon-stop`** — points the shared deployment back at Cloud Run and stops
  the local ngrok/Go processes. **Always run this when you're done** — the deployment
  is shared org-wide, so leaving it pointed at your laptop breaks the add-on for
  everyone else until this runs.

These commands were written for one team member's local setup — open them in
`.claude/commands/` and adjust the `Repo root:` / `Test doc:` / `GCP account:` values
at the top of each file to match your own machine, test document, and account before
first use.

## Manual path

**Terminal 1 — ngrok tunnel:**

```bash
source packages/addon-backend/.env && ngrok http --url=$NGROK_URL 8080
```

**Terminal 2 — Go server** (must run from inside `packages/addon-backend/` — there's no
`go.mod` at the repo root, so running from the repo root fails with "cannot find main
module"):

```bash
cd packages/addon-backend && source .env && go run .
```

**Terminal 3 — point the shared Workspace deployment at your tunnel** (coordinate with
your team first — this affects everyone's add-on session, not just yours):

```bash
# Edit the three URLs in packages/addon-backend/deployment.json to your ngrok URL first.
# Don't commit that edit — revert it once you're done (git checkout -- packages/addon-backend/deployment.json).
gcloud workspace-add-ons deployments replace my-addon \
  --deployment-file=packages/addon-backend/deployment.json \
  --project=docalign-prod \
  --account=YOUR_NAME@docalign.app
```

Then open any Google Doc on your `@docalign.app` account and click the doc-align icon
in the right sidebar (install the add-on from the internal Workspace Marketplace
listing first if you haven't).

**When you're done:** point the deployment back at Cloud Run using the committed
(unedited) `deployment.json`, and stop ngrok and the Go server.

## Running tests

```bash
cd packages/addon-backend
go build ./...
go vet ./...
go test ./...
```

Some end-to-end tests require a running Firestore emulator and skip (not fail) without
one:

```bash
firebase emulators:start --only firestore
FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./... -v
```

## More detail

[`CLAUDE.md`](CLAUDE.md) is the fuller reference: architecture, Firestore schema, the
Card Service card map, deployment (Cloud Run), and the invariants that have caused real
bugs before (e.g. why "back"/"cancel" buttons can't point at `/addon/homepage`).
