# Baseline-centric drift detection & owner-confirmed re-review

**Date:** 2026-07-04
**Status:** Approved in discussion; permissions open question flagged below.

## Problem

Signer drift detection is silently broken. When a signer signs, `routes/sign.go` and
`routes/quick_sign.go` call `services.LatestRevisionID` with the **signer's** OAuth token.
Drive's Revisions API only returns revision data to the file **owner**; for anyone else it
silently returns an empty list. The empty string is stored as `signedRevisionId`, and
`CheckDrift` skips signers with an empty revision ID — so drift is never detected for them,
with no visible error. Confirmed live in Firestore and Cloud Run logs.

The same owner-only restriction applies to `ExportRevisionText`, so the current
`CheckDrift` (which exports each signer's signed revision using the *requesting user's*
token) only works when the owner happens to be the one opening the sidebar.

## Design decisions (settled)

1. **No per-signer revision tracking.** Signing and drift-checking never call the
   Revisions API with a signer's token. Signers sign against the document's single
   pinned **baseline**, not a personal revision.
2. **Drift locks everyone.** If the doc has changed since the baseline, *all* signers are
   blocked from signing/re-signing until the owner explicitly confirms the new version.
   Nobody can sign off on an unconfirmed version.
3. **Owner-confirm is the only place document content is touched**, and only with the
   owner's **live** OAuth token from the confirm request. No stored refresh token.
4. **Document content is never stored.** The confirm step computes an LCS diff (existing
   `services/drift_detection.go`) and persists only a **change summary**: section
   headings + added/removed line counts + an optional owner-typed note. Headings are the
   accepted structural leak, same class as the already-stored `title`. Full diff hunks
   are explicitly out of scope — that would be storing content.
5. **Google renders the actual diff.** Signers get a best-effort link to Google's version
   history (`showrevision?start={rev}&end={rev}&id={docId}`, undocumented, verified
   working with cookies only) plus the plain version-history page as fallback. These are
   conveniences: version history is only visible to users with **edit** access, so the
   stored summary is the guaranteed-for-everyone oversight mechanism.
6. **Ruled out:** storing owner refresh tokens (unneeded — confirm has a live token);
   named Drive revisions (no API support); storing doc text or paragraph fingerprints
   (fingerprints noted as the post-MVP path to owner-free drift detection).

## Data model changes (Firestore)

```
documents/{docId}
  title, ownerId, createdAt                    — unchanged
  baselineRevisionId                            — unchanged (owner token pins it)
  confirmedVersion: int                         — NEW, starts at 1 on baseline creation,
                                                  incremented on each owner confirm
  confirmedModifiedTime: timestamp              — NEW, Drive modifiedTime captured at confirm
                                                  (drift = current modifiedTime is after this;
                                                  Drive-clock vs Drive-clock, no server-clock skew)
  changeSummary: {                              — NEW, replaced wholesale on each confirm
    note: string                                — owner-typed note (optional)
    sections: [{title, added, removed}]         — from DetectDrift
    totalAdded, totalRemoved: int
    fromRevisionId, toRevisionId: string        — for the showrevision deep link
  }
  ownerRefreshToken                             — REMOVE (never written, ruled out)
  lastDriftCheckedAt                            — REMOVE (superseded)

documents/{docId}/signers/{email}
  status: pending | signed | drifted            — unchanged values, new meaning:
                                                  "drifted" = signed an older confirmedVersion
  signedAt, commitMessage, notifiedAt           — unchanged
  signedVersion: int                            — NEW, the confirmedVersion signed against
  signedRevisionId                              — REMOVE (always empty/wrong for signers)
  driftDetectedAt                               — keep (set when doc-level drift confirmed)
```

Drift state for a signer is derived: `signer.signedVersion < doc.confirmedVersion`.

## Flow changes

**Sign / QuickSign** (`routes/sign.go`, `routes/quick_sign.go`)
- Remove the `LatestRevisionID` call entirely.
- Server-side gate: run the doc-changed check (below); if the doc has changed since the
  last confirmed version, refuse with "the owner needs to confirm the latest changes
  before sign-offs can continue" — for **all** signers, not just drifted ones.
- On success write `signedVersion = doc.confirmedVersion` (no revision ID).

**Doc-changed check** (replaces `services/drift_check.go` per-signer logic)
- On sidebar open (homepage), compare Drive `modifiedTime` of the file against
  `doc.confirmedModifiedTime`. `files.get(fields=modifiedTime)` works with any user's `drive.file`
  token — no Revisions API. This is the cheap lazy check from CLAUDE.md, applied at the
  document level instead of per-signer.
- If changed: doc is in **unconfirmed drift**. Signers with `signedVersion ==
  confirmedVersion` flip to `drifted` (stamp `driftDetectedAt`); pending signers stay
  pending but are locked.
- False-positive tolerance accepted for MVP (cosmetic edits count as drift); Haiku
  classification is the post-MVP refinement, unchanged from CLAUDE.md.

**Owner confirm** (evolve `routes/mark_revised.go` → "Confirm new version")
- Owner-only. With the owner's live token: fetch current text (`FetchDocText`), export
  the **baseline** revision text (`ExportRevisionText` — works, owner token), run
  `DetectDrift`, and:
  - store the change summary + owner note on the doc record,
  - increment `confirmedVersion`, set `confirmedAt`,
  - pin the new latest revision as the new `baselineRevisionId`
    (`LatestRevisionID` + `KeepRevisionForever`, both valid with owner token),
  - email drifted signers (existing `SendDriftNotification`, now including section
    summary and the version-history link).
- This is the only unlock path. `notifiedAt`-vs-`driftDetectedAt` gating is replaced by
  the version comparison.

**Signer drift card** (`cards/status_signer.go`)
- Locked state: summary of "owner is reviewing changes", **Notify owner** button
  (email nudge; new lightweight route) instead of sign button.
- Unlocked drifted state: render stored `changeSummary` (sections + counts + owner note),
  **View changes in Google Docs** link built from `fromRevisionId`/`toRevisionId`
  (best-effort; plain version-history URL as fallback), and **Re-sign** button.
- `cards/diff_view.go` / `routes/diff.go` switch from live per-signer diffing to
  rendering the stored `changeSummary` (no Drive calls, works for viewer-signers).

**Baseline creation** (`routes/create_baseline.go`)
- Unchanged except: initialize `confirmedVersion = 1`, `confirmedAt = now`. The existing
  empty-revID fallback stays (baseline still owner-token, still works).

## Error handling

- Homepage `modifiedTime` fetch failure: log, render from stored state (fail open on
  display, but sign remains gated by a server-side re-check at sign time — fail closed
  on the action).
- Confirm-step Drive failures: surface to owner via `writeActionErr`; nothing is
  half-committed (write summary + version bump only after diff succeeds; revision
  pinning stays non-fatal as today).
- All homepage handlers keep `writeErr`; all actions keep `writeActionErr` (Card vs
  RenderActions invariant).

## Open question (resolve during implementation)

**Do signers have real Drive access?** `SaveSigners` never calls Drive's Permissions
API — it only writes Firestore and emails a link. If a signer lacks access, the doc link
404s and the sidebar gate is unreachable for them. Decide at implementation: (a) require
owner to share the doc first (document it in the AddSigners card), or (b) call
Permissions API at save-signers time (needs owner token — available, it's an owner
action). Also determines whether editor-signers can use the version-history links at all.

## Out of scope

- Paragraph-fingerprint drift detection (post-MVP)
- Haiku cosmetic-edit classification (post-MVP)
- Storing document text or diff hunks (never)
- Owner refresh-token storage / OAuth callback (ruled out)
- Rendered redline for viewer-signers (requires content storage)

## Testing

- Unit: version-comparison gating logic; summary construction from `DriftResult`;
  schema round-trip for new fields.
- Manual multi-account (owner `@docalign.app` + signer): sign → owner edits → both
  sidebars show locked state → confirm → signer sees summary → re-sign. Verify
  Firestore never contains doc text and `signedRevisionId` is gone.
