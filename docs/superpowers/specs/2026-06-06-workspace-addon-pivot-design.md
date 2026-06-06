# Workspace Add-on Pivot Design

## Overview

Pivot doc-align from a Chrome Extension to a Google Workspace Add-on. The add-on embeds a React SPA in Google Docs' native 300px sidebar, providing seamless integration. Signatures are displayed exclusively in the side panel (never pasted into the doc), with git-style commit messages, revision anchoring, and a full audit trail.

The backend, shared types, and privacy model remain unchanged. This is a frontend platform migration, not a backend rewrite.

## Motivation

**Problems with the Chrome Extension approach:**
1. Signature images pasted into the doc pollute the document and lack audit context
2. `chrome.identity` auth adds friction; Workspace Add-on OAuth is native to Google Docs
3. Content scripts are fragile (DOM manipulation on Google Docs' rendered canvas)
4. Chrome Web Store review process adds friction

**What the Workspace Add-on gives us:**
- Native sidebar that Google Docs users already expect (like Keep, Tasks, Calendar)
- Apps Script OAuth with no `chrome.identity` dependency
- Google Docs API access without content script DOM hacks
- Persistent across all docs -- no per-tab extension popup
- Discoverability via Google Workspace Marketplace

## Architecture

### Package Structure

```
packages/
├── shared/           # Unchanged: types, Zod schemas, tier logic
├── backend/          # Unchanged: Express + Firestore + Firebase Auth + Stripe
├── extension/        # KEPT, deprecated: shows upgrade banner, maintenance-only
├── workspace-addon/  # NEW: replaces extension long-term
│   ├── apps-script/        # Apps Script wrapper
│   │   ├── appsscript.json # OAuth scopes, manifest
│   │   └── Code.gs         # Thin glue: google.script.run endpoints
│   ├── sidebar/            # React SPA (Vite + TypeScript)
│   │   ├── views/          # SignOff, Changes, History, Settings
│   │   ├── components/     # SigCard, DiffViewer, StatusBar, CommitInput
│   │   └── lib/            # api.ts, auth.ts, google-apis.ts, diff-engine.ts
│   └── shared-lib/         # Migrated from extension/src/lib (reused)
└── e2e/             # Updated for Workspace Add-on testing
```

### Auth Flow

1. User installs Workspace Add-on from Google Workspace Marketplace
2. Apps Script manifest declares OAuth scopes (`drive.file`, `documents`)
3. On first open, iframe prompts Firebase Auth sign-in (Google provider)
4. Backend validates Firebase Auth tokens (unchanged)
5. Google API calls use Apps Script's `ScriptApp.getOAuthToken()` for Drive/Docs APIs

No `chrome.identity`. No content script auth. Backend auth unchanged.

### Data Flow

```
Browser (Google Docs)
├── Google Doc (left) ─── rendered by Google
└── Sidebar iframe (right, 300px) ─── React SPA
    │
    ├── Firebase Auth ──→ Backend (Firebase token, unchanged)
    ├── Apps Script ──→ Google Docs/Drive APIs (user's OAuth token)
    └── google.script.run ──→ Apps Script backend (for Docs API operations)
```

### Storage Changes

| Data | Current | Post-pivot |
|------|---------|------------|
| SignOff records | Firestore | Unchanged |
| Signature templates | Firestore | Unchanged |
| TrackedDocs | chrome.storage.local + Firestore | Firestore only |
| Doc snapshots (for diff) | chrome.storage.local | Firestore (`signoffSnapshots` collection) |
| User preferences | chrome.storage.local | Firestore (`userPrefs` subcollection) |

### New Entity: SignoffSnapshot

```typescript
interface SignoffSnapshot {
  id: string             // Firestore auto-ID
  signOffId: string      // Links to the SignOff record
  documentId: string     // Google Doc ID
  revisionId: string     // Revision at sign-off time
  textContent: string    // Plain text snapshot of doc at sign-off
  createdAt: string
}
```

Snapshot is client-side only in practice (the server never reads `textContent`). Stored in Firestore so it's available across devices and survives cache clears.

## Signature UX

### Old Behavior (REMOVED)
- User draws signature on canvas → renders PNG → pastes image into doc at cursor
- `imageHash` stored for tamper detection
- Other viewers see a random image in the doc
- No commit message, no context, no audit trail beyond a date stamp

### New Behavior
- No signature ever touches the document content
- Side panel displays all signatures on the current doc:
  - Signer avatar (initials), name, role
  - Git-style commit message explaining intent
  - Timestamp + revision ID anchored to Google Docs revision
  - Status indicator (green = unchanged, yellow = drifted since their sign-off)
- "Sign This Doc" button opens inline commit input in the sidebar:
  - Textarea for commit message (required)
  - Signature preview (reused from existing signature templates)
  - "Sign" button → creates SignOff + SignoffSnapshot in Firestore
- Sign-off is an event, not an image

### Sidebar Tabs

1. **Signatures** (default) -- current sign-off status, all signers with commit messages, "Sign This Doc" / "Re-Sign" button
2. **Changes** -- when doc has changed since sign-off: structural drift summary, "View Diff" button
3. **History** -- chronological audit trail: who signed when at which revision, what changed between revisions

### SignOff Schema Change

Add one field:
```typescript
interface SignOff {
  // ... existing fields unchanged ...
  commitMessage: string   // NEW: git-style commit message explaining intent
}
```

Remove:
- `imageHash` -- no signature image in doc, no tamper to detect

## Migration Strategy

### Phase 1: Build & Ship (4-6 weeks)
- Build `packages/workspace-addon` with React SPA sidebar
- Migrate core features: sign-off, diff viewer, document tracking, orgs/groups
- Implement new signature UX (side panel, commit messages)
- Publish to Google Workspace Marketplace

### Phase 2: Coexistence (3 months)
- Workspace Add-on is the primary product
- Chrome Extension remains published but shows a banner: "doc-align is now available as a native Workspace Add-on. Install it from the Google Workspace Marketplace for a better experience."
- Extension gets security fixes only, no new features

### Phase 3: Sunset
- Unpublish Chrome Extension from Chrome Web Store
- Remove `packages/extension` from monorepo
- All users migrated or churned

## Deferred Features (Post-MVP)

In priority order:

| Priority | Feature | Notes |
|----------|---------|-------|
| 1 | Drift Detection (structural hashing) | Client-side SHA-256 of sections. Green/yellow/red in sidebar. Catches ~80% of meaningful changes with zero privacy exposure. |
| 2 | Horse Race Dashboard | Monday.com-style pipeline: ideating → filled out → signatures gathered → ready for dev → complete. Major UX differentiator. Standalone SPA, not sidebar. |
| 3 | LLM Deep Analysis (BYOK) | User provides API key. On drift detection, diff chunks sent to LLM. Classifies changes as formatting/clarification/structural. Labels stored server-side. |
| 4 | Linear/Jira Two-Way Sync | Final sign-off → create tickets. Changes in Linear → reflected in doc status/color. |
| 5 | Retro Reports | PM spec stability scoring after project completes. How many revisions? How much drift? |

## Open Decisions

1. **React framework**: Vite vs Create React App for the sidebar SPA. Vite is faster but CRA has more Google ecosystem examples.
2. **Apps Script vs standalone hosting**: The sidebar iframe can be served from Apps Script HTML service or hosted on Firebase Hosting/Cloud Run. Hosting externally gives better dev experience (hot reload). Apps Script HTML service is simpler but has 6-min execution limits.
3. **Sidebar SPA routing**: React Router vs simple state-based view switching. The sidebar is small enough that state-based switching may be simpler.
4. **E2E testing strategy**: Current E2E tests use Playwright against Chrome extension. Workspace Add-on needs a different approach -- likely Playwright against the hosted SPA with mocked Google Docs context.

## Google API Access from the Iframe

The sidebar React SPA runs in an iframe. It cannot directly call `google.script.run` methods or Google APIs. Instead:

1. Apps Script (`Code.gs`) exposes functions via `google.script.run` that the iframe calls
2. These functions use `ScriptApp.getOAuthToken()` to call Drive/Docs APIs
3. The iframe calls: `google.script.run.withSuccessHandler(cb).getDocRevision(docId)`
4. Apps Script returns results to the iframe callback

This is the standard Workspace Add-on pattern. The iframe never holds a raw OAuth token.

## Backend Changes (minor)

The SignOff schema change requires small backend updates:

- `POST /api/signoffs`: Accept optional `commitMessage` field. Remove `imageHash` requirement.
- `GET /api/signoffs`: Return `commitMessage` in response. Stop returning `imageHash`.
- Firestore: No migration needed. New fields are additive. Old `imageHash` field can remain or be ignored.
- `CreateSignOffSchema` in `packages/shared`: Add `commitMessage: z.string().min(1)`, remove `imageHash`.

No Stripe, tier, or auth changes. These are schema-only updates.

## What Stays the Same

- **Privacy model**: Backend stores zero document content. Only metadata.
- **Tier system**: Free/Pro/Enterprise, Stripe billing, feature gating (unchanged)
- **Backend**: Express + Firestore + Firebase Auth + Stripe (non-signoff routes unchanged)
- **Shared types/validation**: Zod schemas, tier logic (two fields changed in SignOff schema)
- **Diff engine**: Client-side diff-match-patch (unchanged, migrated to shared-lib)
- **Orgs/Groups RBAC**: Firestore collections + Express routes (unchanged)
