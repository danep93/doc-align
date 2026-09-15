# Remove the Owner Confirm Bottleneck; Per-Signer Staleness

After using the add-on hands-on, two problems surfaced with the drift/re-review model: (1) a signer has no way to know their signature just went stale without fully closing and reopening the sidebar, and (2) once *any* signature goes stale, the current design locks every other signer from signing at all until the document owner explicitly clicks "Confirm new version" — a single-person bottleneck the product should never have.

## Problem

**No live staleness signal.** Card Service add-ons (this one, per CLAUDE.md: "No Apps Script, no React") have no client-side JavaScript and no server-push channel to an already-open sidebar — confirmed against Google's own documentation. A card only re-renders when the user clicks something or fully reopens the panel. There is no way to make the open sidebar auto-update; the best available mitigation is a one-click "Refresh" action.

**A shared confirm-gate blocks everyone.** Today, `docChanged` (comparing the doc's live Drive `modifiedTime` against the owner's last-confirmed `ConfirmedModifiedTime`) is a single, doc-wide flag. When true, `StatusOwner` shows "Sign-offs are paused until you confirm" and `StatusSigner` shows "Signing is paused until the owner confirms" — for *everyone*, regardless of whose signature actually went stale. `completeSign` enforces this same gate server-side, rejecting any sign attempt while `docChanged` is true. This makes every re-review pass through one person (the owner), which is exactly the bottleneck the product must not have.

## Decision

**Exactly one gate remains: the owner's first sign-off.** Nobody else can sign until the document owner has signed at least once. After that, every signer (including the owner, on later re-signs) can sign or re-sign at any time against the current document — no confirm step, ever, blocks anyone.

**Drift becomes purely a per-signer staleness indicator, computed independently per signer** — not a shared doc-wide flag. A signature goes stale (status flips `signed` → `drifted`) when the document's live `modifiedTime` is newer than *that signer's own* `SignedModifiedTime` (the Drive `modifiedTime` captured at the moment they signed) — completely independent of whether the owner has confirmed anything, and independent of any other signer's state.

**"Confirm new version" becomes optional, not required.** The owner can still click it any time to leave a note and compute a fresh, rich "what changed" diff (`changeSummary`) that signers can review. It no longer blocks or unblocks anyone's ability to sign — that already works via the per-signer check above. Accepted trade-off: if the owner hasn't confirmed recently, a drifted signer sees "the document has changed since you signed" without a detailed diff, until the owner does confirm (whenever they choose to).

**Owner gets a way to view the diff too.** Today only `StatusSigner`'s inline "What changed" section can show `changeSummaryWidgets`; `StatusOwner` has no path to it at all. `StatusOwner` gets a "What changed" button (linking to the existing `DiffView` card/`/addon/diff` route) whenever a `changeSummary` exists.

**"How stale" uses the right timestamp.** Today a drifted row's relative-time display is computed from `SignedAt` (when they originally signed) instead of `DriftDetectedAt` (when the signature actually went stale) — the wrong number for "how stale is this."

**A manual Refresh action compensates for the platform's lack of push updates.** `StatusOwner` and `StatusSigner` both get a "Refresh" button using the already-built `/addon/back-to-status` route, so re-checking staleness is one click instead of closing and reopening the whole sidebar.

**The now-obsolete "nudge the owner to unblock" feature is removed entirely.** `NotifyOwner`/`SendOwnerNudge`/the "Remind owner" button existed specifically to nudge the owner out of the confirm-gate that no longer exists. Its own email copy ("...but the document has unconfirmed changes... confirm the new version so signing can continue") would be false under the new model. Delete, don't disable, per this project's established convention.

## Data model change

`SignerRecord.SignedVersion int` (compared against the doc-wide `ConfirmedVersion` counter) is replaced by `SignerRecord.SignedModifiedTime time.Time` (the Drive `modifiedTime` at the moment this specific signer signed — captured via the same `FileModifiedTime` call `completeSign` already makes). This is the only schema change; `ConfirmedVersion`/`ConfirmedModifiedTime`/`BaselineRevisionID` on `DocRecord` are unchanged and keep their existing role: bookkeeping and rich-diff generation for the now-optional confirm action, plus the owner-facing "your last confirmed diff may be stale" nudge (informational only, never a gate).

## Scope boundaries

**In scope:**
- `services/version.go`: `SignersToDrift` takes the live `modifiedTime` and compares per-signer against `SignedModifiedTime`, not a shared `docChanged`/`confirmedVersion` pair.
- `services/drift_check.go`: `CheckDocDrift` unchanged in shape (still fetches `modifiedTime` once, still returns `(docChanged bool, signers map[string]SignerRecord)`), but `docChanged`'s meaning narrows to "owner's confirm-nudge only" — it stops being used to lock signing anywhere.
- `services/firestore.go`: `SignerRecord.SignedVersion int` → `SignerRecord.SignedModifiedTime time.Time`.
- `routes/sign_common.go` (`completeSign`): remove the `DocChanged` sign-blocking check entirely; add the one new gate (reject signing if the signer isn't the owner and the owner's own signer record status is still `pending`); write `signedModifiedTime` instead of `signedVersion`.
- `routes/mark_revised.go`: stop doing any signer-status mutation in its own loop (the live per-signer check already handles that on next view) — just notify signers who are *currently* drifted with the fresh note/summary. Update its doc comment: no longer "the sole unlock path for signing."
- `routes/status_card.go` (`resolveStatusCard`): compute `ownerHasSignedOnce` from the owner's own entry in the signer map and pass it to `StatusSigner`; pass `doc.ChangeSummary != nil` to `StatusOwner`.
- `cards/status_owner.go`: remove the hard-lock "Unconfirmed changes... paused" section, replace with a non-blocking nudge; owner's own Sign/Re-sign button no longer conditioned on `docChanged`; add "What changed" button; add "Refresh" button; fix drifted-row relative-time source to `DriftDetectedAt`.
- `cards/status_signer.go`: drop the `docChanged`-locks-everyone branch; add the `ownerHasSignedOnce` gate for the `pending` case ("waiting for owner to sign first"); add "Refresh" button; fix drifted-row relative-time source to `DriftDetectedAt`.
- Delete: `routes/notify_owner.go`, the `SendOwnerNudge` function in `services/email.go`, its `main.go` route registration, and the "Remind owner" button in `cards/status_signer.go`.
- Update existing tests: `services/version_test.go` (`TestSignersToDrift` against the new signature), `routes/create_baseline_test.go` / `routes/remove_signer_test.go` (both call `cards.StatusOwner` indirectly through routes whose signatures are changing — verify they still compile and pass), `cards/status_owner_test.go` (new params).
- New tests: the owner-first-sign-off gate (a signer can't sign before the owner has), a signer *can* sign immediately after a drift with no confirm having happened, per-signer independent staleness (one signer's drift doesn't affect another's "signed" status).
- CLAUDE.md: rewrite the "Drift + re-review" section to describe the new non-blocking, per-signer model.

**Out of scope:**
- Any background Drive-watch webhook / push-notification system (considered, explicitly deferred — see the auto-refresh research above; it wouldn't make the open sidebar auto-update anyway, it would only pre-warm server-side state).
- Any change to `History`, `AddSigners`, `EmptyState`, `ConnectDocument`, remove-signer.
- Any change to how the rich diff itself is computed (`DetectDrift`, `BuildChangeSummary`, `ExportRevisionText`) — only when/whether it's required, not how it's built.
