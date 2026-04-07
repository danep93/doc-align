# doc-align

Privacy-first Chrome extension for Google Docs sign-off and alignment.

## Project Structure

TypeScript monorepo with pnpm workspaces:
- `packages/shared` — types, validation (Zod), tier logic
- `packages/backend` — Express API (Firebase Auth, Firestore, Stripe)
- `packages/extension` — Chrome extension (Manifest V3, webpack)

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
