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
