# E2E Testing & CI/CD Pipeline Design

## Problem

Claude cannot verify its own changes to the Chrome extension. It claims fixes work without evidence, forcing the developer to manually click through the extension to confirm. Configuration bugs (extension pointing at wrong backend/Firebase project) pass typecheck and build but fail at runtime and are invisible to Claude. The existing E2E test infrastructure (Playwright + Chrome extension fixtures) exists but isn't frictionless enough to be part of the development workflow.

## Goal

Make `pnpm test:e2e` the definitive verification command. If it passes, the extension works. If it fails, it doesn't. Claude runs this after every change and cannot claim a fix without a passing suite. The CI/CD pipeline enforces this at every stage from PR to production.

## Approach

Playwright-only. No Meticulous AI (designed for web apps, can't load `chrome-extension://` URLs or access `chrome.*` APIs). No Claude-in-Chrome MCP for verification (session-dependent, not reproducible in CI). Playwright already supports Chrome extension testing natively and the project has existing fixtures.

## Design

### 1. Test Infrastructure & Developer Experience

#### Single-command execution

- `pnpm test:e2e` — all E2E tests, headless, against staging backend
- `pnpm test:e2e:headed` — visible browser for debugging
- `pnpm test:e2e --grep "sign-off"` — run a subset by name

#### Auto-setup guard

A Playwright global setup script runs before any test and checks three preconditions:

1. **Auth state exists** — `.auth-state/` directory contains saved Google auth. If missing, fail with: `"Run pnpm test:e2e:save-auth first (one-time Google sign-in)"`
2. **Extension is built with staging config** — `packages/extension/dist/` exists and was built with `API_BASE` pointing to the staging Cloud Run URL and `FIREBASE_PROJECT_ID=doc-align-staging`. If missing or stale, auto-build with staging config.
3. **Staging backend is reachable** — Hit `GET <staging-url>/api/health`. If unreachable, fail with: `"Staging backend at <url> is not reachable. Check VPN/network."`

This eliminates the entire class of "tests fail for environmental reasons and you have to figure out why" problems.

#### Extension build targeting

E2E tests always build the extension pointing at the staging backend. This is non-negotiable — it catches the exact "local UI pointed at wrong database" bugs that caused the most friction. The build config for E2E is:

```
API_BASE=<staging Cloud Run URL>
FIREBASE_PROJECT_ID=doc-align-staging
```

#### Test output on failure

- Playwright auto-captures screenshot + trace on failure (already supported via config)
- Custom assertion messages on all critical checks: `"Expected sign-off to appear in document list, but list was empty"` rather than generic timeout errors
- Trace files viewable via `npx playwright show-trace <trace.zip>`

### 2. Test Coverage — Critical User Flows

Each flow maps to a Playwright spec file. Together they cover every user-facing behavior in the extension.

#### `auth.spec.ts` — Authentication

- Open popup, see sign-in screen
- Sign in with saved auth state, popup shows user email and correct tier badge
- All tabs visible after auth (Sign Off, My Documents, Groups, Settings)
- Auth persists across popup close/reopen — no double sign-in required
- Sign out returns to sign-in screen

#### `signature.spec.ts` — Signature Management

- Create signature via canvas (simulated stroke drawing)
- New signature appears in signature list
- Delete signature, confirm removed from list
- Cannot proceed to sign-off without at least one signature

#### `signoff.spec.ts` — Sign-Off Flow

- Select document, select signature, execute sign-off
- Sign-off recorded and visible in My Documents
- Co-signers displayed for a signed document/revision
- Tier limits enforced: free user cannot exceed checkpoint limit

#### `documents.spec.ts` — Document Tracking

- Add a document to tracking
- Document appears in My Documents list
- Document card shows correct metadata (title, last modified)

#### `groups.spec.ts` — Groups & Organizations

- Create organization
- Create group within organization
- Tier gating: free users cannot create organizations

#### `settings.spec.ts` — Settings

- Settings tab loads and displays correctly
- User profile information shown

#### `config.spec.ts` — Configuration Validation (New)

This spec catches misconfiguration bugs that are invisible to typecheck/build:

- Extension built with correct `API_BASE` (staging URL, not `localhost:8080`)
- Extension built with correct `FIREBASE_PROJECT_ID` (`doc-align-staging`, not dev project)
- API health endpoint reachable from the extension's configured base URL
- Firebase Auth project matches expected staging project

### 3. CI/CD Pipeline Integration

#### PR gate (every PR to `main`)

Current CI already runs: install → typecheck → build → unit tests.

Add after unit tests:
1. Build extension with staging config
2. Restore auth state from CI secret
3. Run full E2E suite against staging backend
4. PR cannot merge if E2E fails

Updated CI job sequence:
```
install → typecheck → build-all → unit tests → build extension (staging) → E2E tests (staging)
```

#### Post-merge to `main` (staging deploy)

Current flow: auto-deploy backend to staging Cloud Run.

Add after deploy:
1. Wait for Cloud Run deployment to stabilize
2. Run full E2E suite against freshly deployed staging
3. If E2E fails → GitHub Actions notification, block production deploy eligibility

This catches regressions introduced by the deploy itself (e.g., environment variable misconfiguration in Cloud Run).

#### Production deploy (manual trigger)

Current flow: manual `workflow_dispatch`.

Add:
1. Pre-check: require latest staging E2E run passed (check via GitHub Actions API or status check)
2. Deploy to production
3. Run smoke E2E subset against production: auth flow + sign-off flow only
4. If smoke fails → immediate alert

#### Pipeline summary

```
PR:
  typecheck → build → unit tests → E2E (staging) → merge allowed

main push:
  deploy staging → E2E (staging) → ✅ prod-ready

manual trigger:
  verify staging E2E passed → deploy prod → smoke E2E (prod) → ✅ done
```

#### CI auth strategy

- Create a dedicated Google test account for CI (not a personal account)
- Run `pnpm test:e2e:save-auth` once with this test account
- Store the resulting `.auth-state/` contents as an encrypted GitHub Actions secret or secure artifact
- Tests in CI restore this auth state before running
- When tokens expire (infrequent — Google tokens last weeks to months), re-run `save-auth` manually and update the CI secret
- This is the only manual step in the entire pipeline

### 4. Claude's Self-Verification Workflow

#### CLAUDE.md update

Add to the project's `CLAUDE.md`:

```markdown
## Verifying Changes

After ANY change to extension UI, backend routes, auth flow, or shared types:
1. Build all: `pnpm run build-all`
2. Run E2E tests: `pnpm test:e2e`
3. Do NOT claim a fix works unless E2E tests pass
4. If a relevant E2E test doesn't exist for the change, write one first

If E2E tests fail, read the screenshot and trace output to diagnose.
Do not say "I can't verify because I can't click in the extension."
The E2E tests ARE the verification.
```

#### Test-first bug fixing

When a bug is reported, Claude's workflow is:

1. Write a failing E2E test that reproduces the bug
2. Fix the bug in the source code
3. Run the full E2E suite — new test passes, no regressions
4. Only then report "fixed" with the test output as evidence

#### No escape hatch

The phrase "I can't verify this" is not acceptable when E2E tests exist. If Claude encounters a scenario it can't write a test for, that's a gap in the test infrastructure that should be addressed as part of the fix, not a reason to skip verification.

#### Failure diagnostics

Playwright produces on failure:
- Screenshot of the extension popup at the moment of failure
- Full trace file (replayable via `npx playwright show-trace`)
- Console logs from the extension

Claude can read screenshots (multimodal) and trace output to diagnose failures without needing to interact with the browser directly.

## What This Does NOT Cover

- **Visual regression testing** — not a primary pain point. If it becomes one, Playwright screenshot comparison can be added later.
- **Google Docs content script testing** — testing signature injection into a real Google Doc requires a live Google Docs session. This is deferred; current tests verify the extension popup flows. Content script unit tests (existing in `packages/extension/__tests__/`) cover diff computation and rendering logic.
- **Load/performance testing** — out of scope. The extension serves individual users, not high-concurrency scenarios.
- **Mobile/cross-browser** — Chrome-only extension, Chrome-only testing.

## Implementation Order

1. Fix test infrastructure: global setup guard, staging build config, auth state management
2. Expand test coverage: flesh out existing specs, add `config.spec.ts`
3. CI integration: add E2E step to PR workflow, post-deploy staging verification
4. Update CLAUDE.md with verification instructions
5. Production smoke tests: add post-deploy prod smoke subset
