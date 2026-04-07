# Document Tracking Feature

## Overview

Allow users to track documents before signing them. Tracking captures a baseline revision so users can monitor changes over time and decide when to sign. Signed documents are implicitly tracked; tracked documents are not implicitly signed.

## Data Model

### New type: `TrackedDoc`

```typescript
interface TrackedDoc {
  id: string;                  // auto-generated unique ID (e.g., "td_1234")
  documentId: string;          // Google Docs document ID
  userId: string;
  title: string;
  baselineRevisionId: string;  // captured at track time
  trackedAt: string;           // ISO timestamp
}
```

Note: `id` is a unique record identifier (consistent with `SignOff.id`). `documentId` is the Google Doc ID (consistent with `SignOff.documentId`). One tracking record per document per user — re-tracking after untracking creates a new record with a fresh baseline.

### Zod validation schema

Add `TrackedDocSchema` and `CreateTrackedDocSchema` to `packages/shared/src/validation.ts`, following the pattern of existing schemas.

### Tier limit: `maxTrackedDocuments` (already exists)

Uses the existing `maxTrackedDocuments` field in `TierLimits` (`packages/shared/src/tiers.ts`):

| Tier | Tracked docs limit |
|---|---|
| Free | 5 |
| Pro | 500 |
| Enterprise | 500 |

Signed docs do NOT count against the tracking limit. Only tracked-but-unsigned docs count.

### Storage

- `chrome.storage.local` key: `local_tracked_docs` (array of `TrackedDoc`)
- Snapshots stored with existing pattern: `snapshot_{documentId}_{baselineRevisionId}`
- Snapshot cleanup: on untrack, delete the baseline snapshot. On signing (which removes tracking), the sign-off creates its own snapshot so the tracking snapshot can be deleted.
- Backend (when available): `tracked-docs` Firestore collection

## Sign Off Tab Changes

Below the existing sign-off button, add a secondary button for tracking:

| Doc state | Sign-off button | Track button |
|---|---|---|
| Never seen | "Sign This Doc" | "Track This Doc" |
| Tracked, not signed | "Sign This Doc" | "Already Tracking" (disabled) |
| Signed (any tier) | "Re-Sign This Doc" / "Add Another Signature" | No track button shown |

When "Track This Doc" is clicked:
1. Check `canTrackDocument(tier, currentTrackedCount)` — if at limit, show upgrade message
2. Get doc ID and title from content script (via `ensureContentScript` + `GET_DOC_INFO`)
3. Get latest revision ID:
   - Production: `getLatestRevisionId(docId)` via Drive API
   - DEV_MODE: `getDocTextHash()` from content script
4. Store text snapshot with key `snapshot_{docId}_{revisionId}`
5. Create `TrackedDoc` record in storage
6. Show toast: "Now tracking this document"
7. Button changes to "Already Tracking" (disabled)
8. Invalidate My Documents tab

When at tracking limit:
- Track button text: "Tracking limit reached" (disabled)
- Below it: "Upgrade to Pro for up to 500 tracked documents" link (navigates to Settings/upgrade)

## My Documents Tab Changes

### Toggle

Add a toggle at the top of the documents view (above the summary stats):

```
[ Signed ] [ Tracked ]
```

- **Signed** (default): current behavior — signed docs with change detection, diff viewer, re-sign-off
- **Tracked**: tracked-but-unsigned docs

Toggle uses same visual style as the theme toggle (selected has thicker accent border via `theme-btn-selected` class).

### Tracked View

Each tracked doc card shows:
- Document title
- "Tracking since [date]"
- Change indicator (green dot = unchanged, orange dot = changed since tracking started)

Clicking a tracked doc card opens a detail panel (reuses the diff modal as a layout container — no diff content shown, just metadata and actions):
- Document title
- "Tracking since [date]"
- Change status (changed / unchanged since baseline)
- **"Open in Google Docs"** button — opens `https://docs.google.com/document/d/{documentId}/edit` in new Chrome tab
- **"Sign This Doc"** button — uses `signatures[0]` (same as sign-off view), copies signature to clipboard, creates sign-off with a fresh revision ID (not the baseline), removes the tracked doc record + baseline snapshot, shows toast. If no active signature exists, shows "Create a signature first" message.
- **"Stop Tracking"** button — removes the tracked doc record + baseline snapshot, refreshes the view

### Summary Stats

Update the summary stats bar based on active toggle:
- **Signed view**: Documents / Sign-offs / Changed (current behavior)
- **Tracked view**: Tracked / Changed / limit usage
  - Free tier: "3 of 5"
  - Pro/Enterprise: just the count (no limit shown)

## API Changes

### New methods on all API layers (localApi, devApi, realApi, proxyApi):

- `getTrackedDocs()` — returns all tracked docs for the current user
- `trackDoc(data: { documentId, title, baselineRevisionId })` — creates a TrackedDoc, enforces tier limit
- `untrackDoc(docId: string)` — removes tracking record + deletes baseline snapshot
- `isDocTracked(docId: string)` — returns boolean

### localApi implementation:
- Uses `chrome.storage.local` key `local_tracked_docs`
- `trackDoc` checks `canTrackDocument(tier, count)` before creating
- `untrackDoc` calls `deleteSnapshot(documentId, baselineRevisionId)` then removes record

### devApi implementation:
- Same as localApi but uses `dev_tracked_docs` storage key (consistent with existing `dev_signoffs` pattern)

### realApi implementation:
- `getTrackedDocs()` → `GET /tracked-docs`
- `trackDoc(data)` → `POST /tracked-docs`
- `untrackDoc(docId)` → `DELETE /tracked-docs/{docId}`
- `isDocTracked(docId)` → `GET /tracked-docs/{docId}/status`

### Sign-off interaction:
When a tracked doc gets signed (from either the Sign Off tab or the tracked doc detail panel):
1. Create the sign-off record (existing flow)
2. Remove the `TrackedDoc` record via `untrackDoc(docId)`
3. Doc now appears in the Signed view only

## Change Detection for Tracked Docs

Same mechanism as signed docs: compare `baselineRevisionId` with current revision from Drive API (or text hash in DEV_MODE). Shows changed/unchanged indicator on the card — no diff viewer for tracked docs since there's no sign-off to diff against.
