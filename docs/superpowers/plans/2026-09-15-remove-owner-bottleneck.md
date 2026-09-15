# Remove Owner Confirm Bottleneck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the single-person confirm bottleneck from sign-off drift handling, replace it with independent per-signer staleness tracking, and close two related UI gaps (owner can't view the diff, no manual refresh, stale-time shown from the wrong timestamp).

**Architecture:** `SignerRecord.SignedVersion int` (compared against a shared, doc-wide `ConfirmedVersion`) is replaced by `SignerRecord.SignedModifiedTime time.Time`, compared per-signer against the document's live Drive `modifiedTime`. The only remaining signing gate is a one-time check — has the document owner completed their own first sign-off — enforced in `completeSign`. `DocChanged`/`ConfirmedModifiedTime` survive only as an owner-facing "your last confirmed diff may be stale" nudge, never a lock. "Confirm new version" becomes optional enrichment (rich diff + note), not a requirement for anyone to sign.

**Tech Stack:** Go 1.22+, `cloud.google.com/go/firestore`, this repo's `cards` package (Card Service JSON), Firestore emulator for e2e tests.

**Spec:** `docs/superpowers/specs/2026-09-15-remove-owner-bottleneck-design.md`

## Global Constraints

- Exactly one signing gate survives: nobody but the owner can sign until the owner's own signer record status is not `pending`. No other gate may block signing, ever.
- `docChanged`/"Confirm new version" must never block or unblock anyone's ability to sign — it's informational only (owner-facing nudge + optional rich-diff refresh).
- Delete, don't disable: `routes/notify_owner.go`, `SendOwnerNudge` in `services/email.go`, and its `main.go` registration are fully removed, not commented out or flag-gated (their entire premise — "nudge the owner to unblock signing" — no longer exists).
- `History`, `AddSigners`, `EmptyState`, `ConnectDocument`, `DiffView`'s own rendering logic, and how the rich diff is computed (`DetectDrift`, `BuildChangeSummary`, `ExportRevisionText`) are unchanged.
- `go build ./...` and `go vet ./...` must pass after every task. `go test ./...` must show no FAIL (SKIP without `FIRESTORE_EMULATOR_HOST` is expected and fine).
- The Firestore emulator in this environment cannot be started (no Java runtime installed) — e2e tests that need real Drive API success (a full sign round-trip) are not achievable via the existing "bogus token" e2e pattern, since `completeSign` requires a real `FileModifiedTime` call to succeed past the point being tested. Task 2's e2e test is scoped to what the bogus-token pattern *can* prove (the gate correctly blocks); the full live round-trip (owner signs, signer signs, drift, re-sign with no confirm) is verified manually in Task 4 against the real local ngrok/Drive stack, where real OAuth tokens are available.

---

### Task 1: Service layer — per-signer staleness

**Files:**
- Modify: `services/firestore.go`, `services/version.go`, `services/drift_check.go`, `services/version_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SignerRecord.SignedModifiedTime time.Time` (replaces `SignedVersion int`); `services.SignersToDrift(modifiedTime time.Time, signers map[string]SignerRecord) []string` (signature changes from `(docChanged bool, confirmedVersion int, signers map[string]SignerRecord)`); `services.CheckDocDrift(...)` keeps its existing signature `(ctx, store, userToken, docID, doc, signers) (bool, map[string]SignerRecord)` — Task 2's `routes/sign_common.go` and `routes/status_card.go` consume both.

- [ ] **Step 1: Update the `SignerRecord` schema**

In `services/firestore.go`, change:
```go
type SignerRecord struct {
	Status          string    `firestore:"status"` // pending | signed | drifted
	SignedAt        time.Time `firestore:"signedAt"`
	SignedVersion   int       `firestore:"signedVersion"`
	CommitMessage   string    `firestore:"commitMessage"`
	DriftDetectedAt time.Time `firestore:"driftDetectedAt"`
	NotifiedAt      time.Time `firestore:"notifiedAt"`
}
```
to:
```go
type SignerRecord struct {
	Status             string    `firestore:"status"` // pending | signed | drifted
	SignedAt           time.Time `firestore:"signedAt"`
	SignedModifiedTime time.Time `firestore:"signedModifiedTime"`
	CommitMessage      string    `firestore:"commitMessage"`
	DriftDetectedAt    time.Time `firestore:"driftDetectedAt"`
	NotifiedAt         time.Time `firestore:"notifiedAt"`
}
```

- [ ] **Step 2: Rewrite `services/version.go`**

Replace the entire file with:
```go
package services

import "time"

// DocChanged reports whether the file was modified after the owner's last confirmed
// version. Both times come from Drive's modifiedTime (captured at confirm), so no
// server-clock comparison is involved. A zero confirmedModifiedTime (pre-schema doc)
// always reads as changed, forcing one owner confirm to heal the record.
//
// This is purely an owner-facing "your last confirmed diff may be stale" nudge — it
// never gates anyone's ability to sign. Per-signer staleness (SignersToDrift) is a
// separate, independent check.
func DocChanged(modifiedTime, confirmedModifiedTime time.Time) bool {
	return modifiedTime.After(confirmedModifiedTime)
}

// SignersToDrift returns the emails of "signed" signers whose signature is now stale:
// the document's live modifiedTime is newer than their own SignedModifiedTime. This is
// independent per signer — there is no shared "everyone is drifted" flag, since nothing
// gates signing on the document owner confirming a new version (see mark_revised.go and
// sign_common.go). Pending and already-drifted signers are never returned.
func SignersToDrift(modifiedTime time.Time, signers map[string]SignerRecord) []string {
	var out []string
	for email, rec := range signers {
		if rec.Status != "signed" {
			continue
		}
		if modifiedTime.After(rec.SignedModifiedTime) {
			out = append(out, email)
		}
	}
	return out
}
```

- [ ] **Step 3: Rewrite `services/version_test.go`**

Replace the entire file with:
```go
package services

import (
	"testing"
	"time"
)

func TestDocChanged(t *testing.T) {
	confirmed := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	if DocChanged(confirmed, confirmed) {
		t.Error("same modifiedTime should not count as changed")
	}
	if DocChanged(confirmed.Add(-time.Minute), confirmed) {
		t.Error("older modifiedTime should not count as changed")
	}
	if !DocChanged(confirmed.Add(time.Minute), confirmed) {
		t.Error("newer modifiedTime must count as changed")
	}
	// Doc records created before this schema have zero confirmedModifiedTime:
	// any real modifiedTime must read as changed so the owner is pushed to confirm once.
	if !DocChanged(confirmed, time.Time{}) {
		t.Error("zero confirmed time must count as changed")
	}
}

func TestSignersToDrift(t *testing.T) {
	base := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	signers := map[string]SignerRecord{
		"pending@x.com": {Status: "pending"},
		"current@x.com": {Status: "signed", SignedModifiedTime: base.Add(time.Hour)},
		"old@x.com":     {Status: "signed", SignedModifiedTime: base.Add(-time.Hour)},
		"drifted@x.com": {Status: "drifted", SignedModifiedTime: base.Add(-time.Hour)},
	}

	// Live modifiedTime sits between old@x.com's and current@x.com's own signed
	// times: only old@x.com (signed before this edit) should flip. current@x.com
	// signed after this edit, so their signature is still fresh — independent of
	// old@x.com's state.
	got := SignersToDrift(base, signers)
	if len(got) != 1 || got[0] != "old@x.com" {
		t.Errorf("want [old@x.com], got %v", got)
	}

	// A later live modifiedTime invalidates every currently-signed signer
	// independently — pending/drifted are never returned.
	got = SignersToDrift(base.Add(2*time.Hour), signers)
	if len(got) != 2 {
		t.Errorf("want 2 signers, got %v", got)
	}
	found := map[string]bool{}
	for _, e := range got {
		found[e] = true
	}
	if !found["current@x.com"] || !found["old@x.com"] {
		t.Errorf("want current@x.com and old@x.com, got %v", got)
	}
}
```

- [ ] **Step 4: Run the tests to verify they fail (RED) before touching `drift_check.go`**

Run: `cd packages/addon-backend && go build ./...`
Expected: FAIL to compile — `services/drift_check.go` still calls `SignersToDrift(docChanged, doc.ConfirmedVersion, signers)`, a 3-argument call that no longer matches the new 2-argument signature.

- [ ] **Step 5: Rewrite `services/drift_check.go`**

Replace the entire file with:
```go
package services

import (
	"context"
	"log"
	"time"
)

// CheckDocDrift is the lazy per-signer staleness check run on sidebar open (and after
// any sign/status action). It fetches Drive's live modifiedTime once (fetchable with
// ANY user's drive.file token — no Revisions API, which silently returns nothing for
// non-owners) and flips any "signed" signer whose own SignedModifiedTime predates it to
// "drifted" in Firestore and in the returned map — independently of every other signer.
//
// The returned docChanged bool is unrelated to signer state: it's purely the document
// owner's "your last confirmed diff may be stale" nudge (DocChanged against
// doc.ConfirmedModifiedTime), used only to suggest — never require — re-confirming.
// Nothing here blocks anyone's ability to sign; that's enforced (or not) in
// completeSign, which only gates on whether the document owner has signed at least once.
//
// Fetch failures fail open for display (docChanged=false, log only, signers untouched):
// the sign route (completeSign) re-fetches modifiedTime itself and fails closed there.
func CheckDocDrift(ctx context.Context, store *Store, userToken, docID string, doc *DocRecord, signers map[string]SignerRecord) (bool, map[string]SignerRecord) {
	modifiedTime, err := FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("drift-check: FileModifiedTime %s: %v (skipping)", docID, err)
		return false, signers
	}

	docChanged := DocChanged(modifiedTime, doc.ConfirmedModifiedTime)
	now := time.Now()
	for _, email := range SignersToDrift(modifiedTime, signers) {
		if err := store.UpdateSignerStatus(ctx, docID, email, "drifted", map[string]interface{}{
			"driftDetectedAt": now,
		}); err != nil {
			log.Printf("drift-check: UpdateSignerStatus %s: %v", email, err)
			continue
		}
		_ = store.AddHistory(ctx, docID, HistoryRecord{
			Action:     "drifted",
			ActorEmail: email,
			Timestamp:  now,
		})
		rec := signers[email]
		rec.Status = "drifted"
		rec.DriftDetectedAt = now
		signers[email] = rec
	}
	return docChanged, signers
}
```

- [ ] **Step 6: Run the tests to verify they pass (GREEN)**

Run: `cd packages/addon-backend && go build ./... && go vet ./...`
Expected: both succeed with no errors.

Run: `go test ./services/... -run "TestDocChanged|TestSignersToDrift" -v`
Expected: both tests PASS.

Run: `go test ./... 2>&1`
Expected: `routes` and `cards` packages will FAIL to compile at this point — Step 7 confirms and explains why; that's expected mid-task, not a regression to chase down yet.

- [ ] **Step 7: Confirm the expected downstream compile failure**

Run: `cd packages/addon-backend && go build ./... 2>&1`
Expected: FAILS specifically in `routes/mark_revised.go`, at the line `if rec.SignedVersion >= newVersion` — a real Go struct-field reference to the now-removed `SignerRecord.SignedVersion`. Note that `routes/sign_common.go` does **not** fail to compile at this point: its `"signedVersion": doc.ConfirmedVersion` is a Firestore update map with a string key, not a Go struct field access, so it's untouched by the field removal (Task 2 will still update it to write `signedModifiedTime` instead, since that key is now semantically stale, but that's not a compiler error). The `cards` package and its tests are entirely unaffected at this point — Task 3's scope hasn't started yet. Do not attempt to fix `routes/mark_revised.go` in this task — that's Task 2's job.

- [ ] **Step 8: Commit**

```bash
cd /Users/daniel/git_repos/doc-align
git add packages/addon-backend/services/firestore.go packages/addon-backend/services/version.go \
  packages/addon-backend/services/version_test.go packages/addon-backend/services/drift_check.go
git commit -m "$(cat <<'EOF'
feat(addon-backend): replace shared confirmedVersion drift check with per-signer staleness

SignerRecord now tracks SignedModifiedTime (the Drive modifiedTime at
sign time) instead of SignedVersion. SignersToDrift compares each
signer independently against the live modifiedTime, replacing the
old shared docChanged/confirmedVersion pair. This is a building block
for removing the owner-confirm bottleneck — routes and cards catch up
in the next two commits.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Route layer — remove the gate, add the one real one, delete the obsolete nudge feature

**Files:**
- Modify: `routes/sign_common.go`, `routes/mark_revised.go`, `routes/status_card.go`, `routes/save_signers.go`, `routes/remove_signer.go`, `main.go`, `services/email.go`
- Delete: `routes/notify_owner.go`
- Test: `routes/sign_test.go` (new)

**Interfaces:**
- Consumes: `services.SignersToDrift`, `services.CheckDocDrift`, `SignerRecord.SignedModifiedTime` (Task 1, done).
- Produces: `cards.StatusOwner(docTitle string, signers []cards.SignerStatus, docID string, docChanged bool, ownerEmail string, hasChangeSummary bool) cards.Card` — **signature changes**, adds a trailing `hasChangeSummary bool`. `cards.StatusSigner(docTitle, ownerName string, signers []cards.SignerStatus, currentUserEmail string, docID string, ownerHasSignedOnce bool, summary *cards.ChangeSummaryView) cards.Card` — **signature changes**, the `docChanged bool` parameter is replaced by `ownerHasSignedOnce bool` (same position). Task 3 implements both new card signatures; this task's route code already calls them with the new signatures, so Task 3 must match exactly.

- [ ] **Step 1: Write the failing test**

Create `routes/sign_test.go`:
```go
// E2E test for the owner-first-sign-off gate, run against the Firestore emulator.
//
// Run:
//
//	FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestSign -v
package routes_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/routes"
	"github.com/doc-align/addon-backend/services"
)

func buildSignTestMux(store *services.Store) *http.ServeMux {
	mux := http.NewServeMux()
	protected := func(h http.HandlerFunc) http.Handler { return middleware.VerifyOIDC(h) }
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store)))
	mux.Handle("POST /addon/save-signers", protected(routes.SaveSigners(store, "")))
	mux.Handle("POST /addon/sign", protected(routes.Sign(store, "")))
	return mux
}

func TestSign_SignerCannotSignBeforeOwnerSignsOnce(t *testing.T) {
	t.Setenv("OIDC_BYPASS", "true")
	store := newEmulatorStore(t)
	srv := httptest.NewServer(buildSignTestMux(store))
	t.Cleanup(srv.Close)

	docID := "sign-doc-owner-gate"
	first := do(t, srv, "POST", "/addon/create-baseline", createBaselineEvent(docID, "My Doc"), "owner@example.com")
	assertStatus(t, first, http.StatusOK)
	readJSON(t, first) // drain

	saveSignersEv := map[string]any{
		"docs": map[string]any{"id": docID, "title": "My Doc"},
		"authorizationEventObject": map[string]any{
			"userOAuthToken": "bogus-token-cannot-reach-drive",
		},
		"commonEventObject": map[string]any{
			"parameters": map[string]string{"docId": docID},
			"formInputs": map[string]any{
				"signerEmails": map[string]any{"stringInputs": map[string]any{"value": []string{"signer@example.com"}}},
			},
		},
	}
	saved := do(t, srv, "POST", "/addon/save-signers", saveSignersEv, "owner@example.com")
	assertStatus(t, saved, http.StatusOK)
	readJSON(t, saved) // drain

	signEv := map[string]any{
		"docs": map[string]any{"id": docID, "title": "My Doc"},
		"authorizationEventObject": map[string]any{
			"userOAuthToken": "bogus-token-cannot-reach-drive",
		},
		"commonEventObject": map[string]any{
			"parameters": map[string]string{"docId": docID},
		},
	}
	resp := do(t, srv, "POST", "/addon/sign", signEv, "signer@example.com")
	assertStatus(t, resp, http.StatusOK)
	readJSON(t, resp) // drain — an error card; signing is blocked, but the HTTP call itself succeeds

	signer, err := store.GetSigner(context.Background(), docID, "signer@example.com")
	if err != nil {
		t.Fatalf("GetSigner: %v", err)
	}
	if signer.Status != "pending" {
		t.Errorf("signer should still be pending — the owner hasn't signed yet — got status %q", signer.Status)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails to compile for the expected reason**

Run: `cd packages/addon-backend && go build ./...`
Expected: FAIL — inherited from the end of Task 1: `routes/mark_revised.go` still has `if rec.SignedVersion >= newVersion`, a real reference to the now-removed `SignerRecord.SignedVersion` field, so the whole `routes` package (including the test file you just added) fails to build. This is not about `sign_common.go` — its own `"signedVersion": doc.ConfirmedVersion` is a Firestore map key string, not a struct field, so it doesn't itself cause a compile error (Step 3 updates it anyway, since that key name is now stale). The actual fix for this specific compile failure is Step 4 (rewriting `mark_revised.go`) — Step 3 alone will not turn this green.

- [ ] **Step 3: Rewrite `routes/sign_common.go`**

Replace the entire file with:
```go
package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// completeSign is the body of Sign. The only gate on signing at all is whether the
// document owner has completed their own first sign-off — once that's happened, every
// signer (the owner included, on later re-signs) can sign or re-sign at any time
// against the current document state, with no further single-person bottleneck. It
// records the live modifiedTime at the moment of signing (used later to detect when
// this specific signature goes stale — see services.SignersToDrift) and re-renders the
// signer's own card.
func completeSign(w http.ResponseWriter, r *http.Request, store *services.Store, resendKey string, ev AddonEvent, commitMsg string) {
	ctx := r.Context()
	userEmail := middleware.EmailFromContext(ctx)

	docID := ev.resolveDocID()
	userToken := ev.AuthorizationEventObject.UserOAuthToken

	doc, err := store.GetDoc(ctx, docID)
	if err != nil {
		writeActionErr(w, "Document not found.")
		return
	}

	isOwner := userEmail == doc.OwnerID

	if !isOwner {
		ownerRec, err := store.GetSigner(ctx, docID, doc.OwnerID)
		if err != nil || ownerRec.Status == "pending" {
			writeActionErr(w, "The document owner needs to sign off first before anyone else can sign.")
			return
		}
	}

	modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("sign: FileModifiedTime: %v", err)
		writeActionErr(w, "Couldn't verify the document is unchanged. Please try again.")
		return
	}

	now := time.Now()
	if err := store.UpdateSignerStatus(ctx, docID, userEmail, "signed", map[string]interface{}{
		"signedAt":           now,
		"signedModifiedTime": modifiedTime,
		"commitMessage":      commitMsg,
	}); err != nil {
		log.Printf("sign: UpdateSignerStatus: %v", err)
		writeActionErr(w, "Something went wrong. Please try again.")
		return
	}

	_ = store.AddHistory(ctx, docID, services.HistoryRecord{
		Action:        "signed",
		ActorEmail:    userEmail,
		CommitMessage: commitMsg,
		Timestamp:     now,
	})

	// Don't email the owner that they signed their own document.
	if !isOwner {
		go func() {
			if err := services.SendSignedNotification(resendKey, doc.OwnerID, userEmail, doc.Title, docID); err != nil {
				log.Printf("sign: SendSignedNotification: %v", err)
			}
		}()
	}

	signerMap, _ := store.ListSigners(ctx, docID)
	if isOwner {
		writeJSON(w, cards.Push(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, false, doc.OwnerID, doc.ChangeSummary != nil)))
		return
	}
	ownerName := services.DisplayName(doc.OwnerID)
	writeJSON(w, cards.Push(cards.StatusSigner(doc.Title, ownerName, toSignerStatusList(signerMap), userEmail, docID, true, summaryToView(doc.ChangeSummary))))
}

// summaryToView converts the stored summary to the cards-layer type (cards cannot
// import services).
func summaryToView(s *services.ChangeSummary) *cards.ChangeSummaryView {
	if s == nil {
		return nil
	}
	sections := make([]cards.DiffSection, 0, len(s.Sections))
	for _, sec := range s.Sections {
		sections = append(sections, cards.DiffSection{Title: sec.Title, Added: sec.Added, Removed: sec.Removed})
	}
	return &cards.ChangeSummaryView{
		Note:           s.Note,
		Sections:       sections,
		TotalAdded:     s.TotalAdded,
		TotalRemoved:   s.TotalRemoved,
		FromRevisionID: s.FromRevisionID,
		ToRevisionID:   s.ToRevisionID,
	}
}
```

Note: `ownerHasSignedOnce` is hardcoded to `true` in the non-owner `StatusSigner` render above — this is correct, not a shortcut: the gate a few lines up already proved the owner isn't `pending` before this point runs.

- [ ] **Step 4: Rewrite `routes/mark_revised.go`**

Replace the entire file with:
```go
package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// MarkRevised (route /addon/mark-revised, surfaced as "Confirm new version") is an
// optional owner action, not a gate: it diffs the pinned baseline against the current
// text, stores the section-level summary (headings + counts + note, never text), bumps
// confirmedVersion, pins a new baseline, and notifies anyone currently drifted that a
// fresh note/diff is available. Nobody's ability to sign depends on this ever running —
// that's driven entirely by the live per-signer check in services.CheckDocDrift.
func MarkRevised(store *services.Store, resendKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		userToken := ev.AuthorizationEventObject.UserOAuthToken
		note := ev.formString("confirmNote")

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}
		if doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can confirm a new version.")
			return
		}

		modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
		if err != nil {
			log.Printf("mark-revised: FileModifiedTime: %v", err)
			writeActionErr(w, "Couldn't reach Google Drive. Try again.")
			return
		}

		currentText, _, err := services.FetchDocText(ctx, userToken, docID)
		if err != nil {
			log.Printf("mark-revised: FetchDocText: %v", err)
			writeActionErr(w, "Couldn't reach Google Drive. Try again.")
			return
		}

		// Diff against the pinned baseline. An empty/broken baseline (pre-schema doc,
		// or Drive pruned it) degrades to a summary without section detail.
		var result services.DriftResult
		if doc.BaselineRevisionID != "" {
			if baselineText, err := services.ExportRevisionText(ctx, userToken, docID, doc.BaselineRevisionID); err != nil {
				log.Printf("mark-revised: ExportRevisionText %s: %v (summary without sections)", doc.BaselineRevisionID, err)
			} else {
				result = services.DetectDrift(currentText, baselineText)
			}
		}

		newRevID, err := services.LatestRevisionID(ctx, userToken, docID)
		if err != nil {
			log.Printf("mark-revised: LatestRevisionID: %v (non-fatal)", err)
			newRevID = ""
		}
		if newRevID != "" {
			if err := services.KeepRevisionForever(ctx, userToken, docID, newRevID); err != nil {
				log.Printf("mark-revised: KeepRevisionForever: %v (non-fatal)", err)
			}
		}

		summary := services.BuildChangeSummary(result, note, doc.BaselineRevisionID, newRevID)
		newVersion := doc.ConfirmedVersion + 1
		if err := store.ConfirmNewVersion(ctx, docID, newVersion, summary, newRevID, modifiedTime); err != nil {
			log.Printf("mark-revised: ConfirmNewVersion: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		now := time.Now()
		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:        "version_confirmed",
			ActorEmail:    userEmail,
			CommitMessage: note,
			RevisionID:    newRevID,
			Timestamp:     now,
		})

		// Notify signers who are currently drifted that a fresh note/diff is
		// available. Purely informational — it doesn't change anyone's ability to sign.
		signerMap, err := store.ListSigners(ctx, docID)
		if err != nil {
			log.Printf("mark-revised: ListSigners: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		for email, rec := range signerMap {
			if rec.Status != "drifted" || email == doc.OwnerID {
				continue
			}
			if err := services.SendDriftNotification(resendKey, email, userEmail, doc.Title, docID, summary); err != nil {
				log.Printf("mark-revised: SendDriftNotification %s: %v", email, err)
				continue
			}
			if err := store.UpdateSignerStatus(ctx, docID, email, rec.Status, map[string]interface{}{
				"notifiedAt": now,
			}); err != nil {
				log.Printf("mark-revised: UpdateSignerStatus notifiedAt %s: %v", email, err)
			}
		}

		writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, false, doc.OwnerID, true)))
	}
}
```

- [ ] **Step 5: Update `routes/status_card.go`**

Replace the entire file with:
```go
package routes

import (
	"context"
	"log"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/services"
)

// resolveStatusCard determines which card to show for the current user on this
// document: ConnectDocument (drive.file not yet granted), EmptyState (no baseline, or
// not a signer), StatusOwner, or StatusSigner. This is the single source of truth for
// "what does this user see right now" — shared by the homepage trigger, the
// onFileScopeGrantedTrigger, and the back-to-status action route, so all three agree.
// Returns a bare Card; callers wrap in cards.Push themselves if they're an action
// callback rather than a trigger.
func resolveStatusCard(ctx context.Context, store *services.Store, userEmail, userToken, docID string) cards.Card {
	if docID == "" {
		return cards.ConnectDocument()
	}

	doc, err := store.GetDoc(ctx, docID)
	if err != nil {
		if isNotFound(err) {
			return cards.EmptyState(true, docID)
		}
		log.Printf("resolveStatusCard: GetDoc %s: %v", docID, err)
		return errorCard("Something went wrong. Please try again.")
	}

	isOwner := doc.OwnerID == userEmail

	signerMap, err := store.ListSigners(ctx, docID)
	if err != nil {
		log.Printf("resolveStatusCard: ListSigners: %v", err)
		return errorCard("Something went wrong. Please try again.")
	}

	docChanged, signerMap := services.CheckDocDrift(ctx, store, userToken, docID, doc, signerMap)

	if isOwner {
		return cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, docChanged, doc.OwnerID, doc.ChangeSummary != nil)
	}

	if _, isSigner := signerMap[userEmail]; !isSigner {
		return cards.EmptyState(false, docID)
	}

	ownerRec := signerMap[doc.OwnerID]
	ownerHasSignedOnce := ownerRec.Status != "" && ownerRec.Status != "pending"
	ownerName := services.DisplayName(doc.OwnerID)
	return cards.StatusSigner(doc.Title, ownerName, toSignerStatusList(signerMap), userEmail, docID, ownerHasSignedOnce, summaryToView(doc.ChangeSummary))
}
```

- [ ] **Step 6: Update the `cards.StatusOwner` call in `routes/save_signers.go`**

Change:
```go
writeJSON(w, cards.Push(cards.StatusOwner(doc.Title, signerStatuses, docID, docChanged, doc.OwnerID)))
```
to:
```go
writeJSON(w, cards.Push(cards.StatusOwner(doc.Title, signerStatuses, docID, docChanged, doc.OwnerID, doc.ChangeSummary != nil)))
```

- [ ] **Step 7: Update the `cards.StatusOwner` call in `routes/remove_signer.go`**

Change:
```go
writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, signerStatuses, docID, docChanged, doc.OwnerID)))
```
to:
```go
writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, signerStatuses, docID, docChanged, doc.OwnerID, doc.ChangeSummary != nil)))
```

- [ ] **Step 8: Delete the obsolete owner-nudge feature**

```bash
cd packages/addon-backend
rm routes/notify_owner.go
```

In `services/email.go`, delete the entire `SendOwnerNudge` function (its doc comment `// SendOwnerNudge tells the owner a signer is waiting on them to confirm the latest changes.` through the end of that function body — the whole block, including its HTML/plaintext email templates).

In `main.go`, delete this line:
```go
mux.Handle("POST /addon/notify-owner", protected(routes.NotifyOwner(store, resendKey)))
```

- [ ] **Step 9: Run the test to verify it passes and everything builds**

Run: `cd packages/addon-backend && go build ./... 2>&1`
Expected: still FAILS, but now in package **`routes`** — the route files this task just rewrote call `cards.StatusOwner` with 6 arguments and `cards.StatusSigner` with the new `ownerHasSignedOnce`-shaped call, while `cards/status_owner.go`/`cards/status_signer.go` still have their old 5-argument signatures (Task 3 hasn't run yet). Confirm the failure output names something like `too many arguments in call to cards.StatusOwner` in files under `routes/` — not anything under `cards/` or `services/`. `cards` and `services` each still compile fine in isolation at this point (verify with `go build ./cards/... ./services/...`); only `routes` (and anything that imports it) fails. That confirms the remaining work is correctly scoped to Task 3 — do not attempt to fix `cards/status_owner.go`/`cards/status_signer.go` in this task.

Run: `go vet ./services/... 2>&1` (skip `./routes/...` and `./cards/...` — `routes` won't build until Task 3, and `cards`'s vet is fine but not the point of this check)
Expected: no vet issues in `services`.

- [ ] **Step 10: Commit**

```bash
cd /Users/daniel/git_repos/doc-align
git add packages/addon-backend/routes/sign_common.go packages/addon-backend/routes/mark_revised.go \
  packages/addon-backend/routes/status_card.go packages/addon-backend/routes/save_signers.go \
  packages/addon-backend/routes/remove_signer.go packages/addon-backend/routes/sign_test.go \
  packages/addon-backend/main.go packages/addon-backend/services/email.go
git rm packages/addon-backend/routes/notify_owner.go
git commit -m "$(cat <<'EOF'
feat(addon-backend): remove the owner-confirm signing bottleneck

completeSign's only gate is now whether the document owner has
completed their own first sign-off — no confirm step blocks anyone
after that. MarkRevised becomes optional enrichment (rich diff +
note), not a requirement. Deletes the now-obsolete notify-owner
nudge feature, whose entire premise (nudge the owner to unblock
signing) no longer applies.

This leaves the cards package non-compiling until the next commit,
which updates StatusOwner/StatusSigner for the new signatures.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Card layer — remove the lock UI, add Refresh/What-changed, fix stale-time source

**Files:**
- Modify: `cards/status_owner.go`, `cards/status_signer.go`, `cards/status_owner_test.go`, `CLAUDE.md`
- Test: `cards/status_signer_test.go` (new)

**Interfaces:**
- Consumes: `cards.SignerStatus` (unchanged shape — `Status`, `StatusAt`, `DriftDetectedAt`, etc. all already exist).
- Produces: `cards.StatusOwner(docTitle string, signers []SignerStatus, docID string, docChanged bool, ownerEmail string, hasChangeSummary bool) Card` and `cards.StatusSigner(docTitle, ownerName string, signers []SignerStatus, currentUserEmail string, docID string, ownerHasSignedOnce bool, summary *ChangeSummaryView) Card` — both already called with these exact signatures by Task 2's route code.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `cards/status_owner_test.go` with:
```go
package cards

import "testing"

func hasButtonText(card Card, text string) bool {
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.ButtonList == nil {
				continue
			}
			for _, b := range w.ButtonList.Buttons {
				if b.Text == text {
					return true
				}
			}
		}
	}
	return false
}

func TestStatusOwner_OwnerAppearsInListWithoutRemoveButton(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "pending"},
		{Email: "signer@example.com", Status: "pending"},
	}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	var signerSection *Section
	for i := range card.Sections {
		if card.Sections[i].Header == "Signers" {
			signerSection = &card.Sections[i]
		}
	}
	if signerSection == nil {
		t.Fatal("expected a Signers section")
	}
	if len(signerSection.Widgets) != 2 {
		t.Fatalf("expected 2 signer rows, got %d", len(signerSection.Widgets))
	}

	var ownerRow, otherRow *DecoratedText
	for i := range signerSection.Widgets {
		dt := signerSection.Widgets[i].DecoratedText
		if dt == nil {
			continue
		}
		if dt.Text == "owner@example.com (you)" {
			ownerRow = dt
		}
		if dt.Text == "signer@example.com" {
			otherRow = dt
		}
	}
	if ownerRow == nil {
		t.Fatal("expected to find the owner's own row labeled '(you)'")
	}
	if ownerRow.Button != nil {
		t.Error("owner's own row should not have a remove-signer button")
	}
	if otherRow == nil {
		t.Fatal("expected to find the invited signer's row")
	}
	if otherRow.Button == nil {
		t.Error("invited signer's row should still have a remove-signer button")
	}
}

func TestStatusOwner_ShowsSignButtonWhenOwnerPending(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "pending"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if !hasButtonText(card, "Sign this document") {
		t.Error("expected a 'Sign this document' button when the owner hasn't signed yet")
	}
}

func TestStatusOwner_ShowsResignButtonWhenOwnerDrifted(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "drifted"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if !hasButtonText(card, "Re-sign") {
		t.Error("expected a 'Re-sign' button when the owner's signature has drifted")
	}
}

func TestStatusOwner_OwnerCanSignEvenWhenDocChanged(t *testing.T) {
	// docChanged is now purely an informational nudge, never a gate — the owner's
	// own sign button must stay available regardless of it. (This replaces the old
	// TestStatusOwner_HidesSignButtonWhenDocChanged, whose asserted behavior is now
	// wrong under the new design.)
	signers := []SignerStatus{{Email: "owner@example.com", Status: "pending"}}
	card := StatusOwner("My Doc", signers, "doc-1", true, "owner@example.com", false)

	if !hasButtonText(card, "Sign this document") {
		t.Error("owner's sign button must not be hidden by docChanged — signing is never gated on doc drift")
	}
}

func TestStatusOwner_NoSignButtonWhenOwnerAlreadySigned(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if hasButtonText(card, "Sign this document") || hasButtonText(card, "Re-sign") {
		t.Error("should not prompt to sign again once already signed")
	}
}

func TestStatusOwner_ShowsWhatChangedButtonWhenSummaryExists(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}

	withSummary := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", true)
	if !hasButtonText(withSummary, "What changed") {
		t.Error("expected a 'What changed' button when a change summary exists")
	}

	withoutSummary := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)
	if hasButtonText(withoutSummary, "What changed") {
		t.Error("should not show 'What changed' when there's no change summary yet")
	}
}

func TestStatusOwner_ShowsRefreshButton(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "pending"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if !hasButtonText(card, "Refresh") {
		t.Error("expected a 'Refresh' button")
	}
}
```

Create `cards/status_signer_test.go`:
```go
package cards

import "testing"

func TestStatusSigner_WaitingForOwnerWhenOwnerHasNotSignedYet(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "pending"},
		{Email: "signer@example.com", Status: "pending"},
	}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", false, nil)

	if hasButtonText(card, "Sign this document") {
		t.Error("signer should not be able to sign before the owner has signed off at least once")
	}

	found := false
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.DecoratedText != nil && w.DecoratedText.Text == "Waiting for The Owner to sign off first" {
				found = true
			}
		}
	}
	if !found {
		t.Error("expected a 'waiting for owner' message when the owner hasn't signed yet")
	}
}

func TestStatusSigner_CanSignImmediatelyOnceOwnerHasSignedOnce(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "signed"},
		{Email: "signer@example.com", Status: "pending"},
	}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", true, nil)

	if !hasButtonText(card, "Sign this document") {
		t.Error("signer should be able to sign as soon as the owner has signed off once")
	}
}

func TestStatusSigner_DriftedSignerCanReSignImmediately(t *testing.T) {
	// No confirm-gate: a drifted signer's Re-sign button must be available
	// regardless of whether the owner has confirmed anything.
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "signed"},
		{Email: "signer@example.com", Status: "drifted"},
	}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", true, nil)

	if !hasButtonText(card, "Re-sign") {
		t.Error("drifted signer must be able to re-sign immediately, with no owner confirm required")
	}
}

func TestStatusSigner_ShowsRefreshButton(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", true, nil)

	if !hasButtonText(card, "Refresh") {
		t.Error("expected a 'Refresh' button")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `cd packages/addon-backend && go build ./...`
Expected: FAIL — `StatusOwner`/`StatusSigner` still have their old 5-argument signatures; the new tests (and Task 2's already-updated route code) call them with 6 arguments / the new `ownerHasSignedOnce` parameter.

- [ ] **Step 3: Rewrite `cards/status_owner.go`**

Replace the entire file with:
```go
package cards

import (
	"fmt"
	"time"
)

type SignerStatus struct {
	Email           string
	DisplayName     string
	Status          string // pending | signed | drifted
	StatusAt        time.Time
	CommitMessage   string
	DriftDetectedAt time.Time
	NotifiedAt      time.Time
}

func StatusOwner(docTitle string, signers []SignerStatus, docID string, docChanged bool, ownerEmail string, hasChangeSummary bool) Card {
	signed := 0
	drifted := 0
	pending := 0
	var ownerStatus *SignerStatus
	for i, s := range signers {
		switch s.Status {
		case "signed":
			signed++
		case "drifted":
			drifted++
		default:
			pending++
		}
		if s.Email == ownerEmail {
			ownerStatus = &signers[i]
		}
	}

	// Sort: drifted first, then pending, then signed.
	sorted := make([]SignerStatus, 0, len(signers))
	for _, s := range signers {
		if s.Status == "drifted" {
			sorted = append(sorted, s)
		}
	}
	for _, s := range signers {
		if s.Status == "pending" {
			sorted = append(sorted, s)
		}
	}
	for _, s := range signers {
		if s.Status == "signed" {
			sorted = append(sorted, s)
		}
	}

	signerWidgets := make([]Widget, 0, len(sorted)*2)
	for _, s := range sorted {
		icon := statusIconWidget(s.Status)
		label := s.DisplayName
		if label == "" {
			label = s.Email
		}
		if s.Email == ownerEmail {
			label += " (you)"
		}
		bottom := s.Status
		if rt := relativeTime(staleTimestamp(s)); rt != "" {
			bottom += " · " + rt
		}
		dt := &DecoratedText{
			StartIcon:   icon,
			Text:        label,
			BottomLabel: bottom,
			WrapText:    true,
		}
		// Removing yourself as owner doesn't make sense — only show the button on
		// rows for signers you invited.
		if s.Email != ownerEmail {
			dt.Button = &Button{
				Icon: &Icon{MaterialIcon: &MaterialIcon{Name: "person_remove"}, AltText: "Remove signer"},
				Type: "BORDERLESS",
				OnClick: &OnClick{
					Action: &FormAction{
						Function: BaseURL + "/addon/remove-signer",
						Parameters: []Parameter{
							{Key: "signerEmail", Value: s.Email},
							{Key: "docId", Value: docID},
						},
					},
				},
			}
		}
		signerWidgets = append(signerWidgets, Widget{DecoratedText: dt})
	}

	if len(signerWidgets) == 0 {
		signerWidgets = []Widget{
			{DecoratedText: &DecoratedText{
				StartIcon:   matIcon("group"),
				Text:        "No signers yet",
				BottomLabel: "Add signers to get started.",
				WrapText:    true,
			}},
		}
	}

	subtitle := fmt.Sprintf("%d signed · %d drifted · %d pending", signed, drifted, pending)

	bottomButtons := []Button{
		filledActionButton("Add more signers", "/addon/add-signers",
			Parameter{Key: "docId", Value: docID}),
		outlinedActionButton("History", "/addon/history",
			Parameter{Key: "docId", Value: docID}),
		outlinedActionButton("Refresh", "/addon/back-to-status",
			Parameter{Key: "docId", Value: docID}),
	}
	if hasChangeSummary {
		bottomButtons = append(bottomButtons, outlinedActionButton("What changed", "/addon/diff",
			Parameter{Key: "docId", Value: docID}))
	}
	// Owners can sign their own doc too, any time — never gated on docChanged. Doc
	// drift is a per-signer staleness signal, not a lock on anyone's ability to sign.
	if ownerStatus != nil {
		switch ownerStatus.Status {
		case "pending":
			bottomButtons = append([]Button{filledActionButton("Sign this document", "/addon/sign-form",
				Parameter{Key: "docId", Value: docID})}, bottomButtons...)
		case "drifted":
			bottomButtons = append([]Button{filledActionButton("Re-sign", "/addon/sign-form",
				Parameter{Key: "docId", Value: docID})}, bottomButtons...)
		}
	}
	sections := []Section{
		{
			Header:  "Signers",
			Widgets: signerWidgets,
		},
	}
	if docChanged {
		sections = append(sections, Section{
			Header: "Document changed",
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: "The document has changed since your last confirmed version. This doesn't block anyone from signing — stale signatures already show as drifted above. Confirming here is optional: it lets you leave a note and refreshes the detailed diff signers can see."}},
				{TextInput: &TextInput{
					Name:     "confirmNote",
					Label:    "Note for signers (optional)",
					HintText: "What changed and why",
					Type:     "MULTIPLE_LINE",
				}},
				{ButtonList: &ButtonList{Buttons: []Button{
					filledActionButton("Confirm new version & notify signers",
						"/addon/mark-revised", Parameter{Key: "docId", Value: docID}),
				}}},
			},
		})
	}
	sections = append(sections, Section{
		Widgets: []Widget{
			{ButtonList: &ButtonList{Buttons: bottomButtons}},
		},
	})

	return Card{
		Name:     "status_owner",
		Header:   &Header{Title: docTitle, Subtitle: subtitle},
		Sections: sections,
	}
}

// staleTimestamp picks the timestamp that best answers "how stale is this row": for a
// drifted signature, that's when the drift was detected, not when they originally
// signed.
func staleTimestamp(s SignerStatus) time.Time {
	if s.Status == "drifted" && !s.DriftDetectedAt.IsZero() {
		return s.DriftDetectedAt
	}
	return s.StatusAt
}

func statusIconWidget(status string) *Icon {
	switch status {
	case "signed":
		return matIcon("check_circle")
	case "drifted":
		return matIcon("warning")
	default:
		return matIcon("pending")
	}
}

func relativeTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}
```

- [ ] **Step 4: Rewrite `cards/status_signer.go`**

Replace the entire file with:
```go
package cards

import "fmt"

func StatusSigner(docTitle, ownerName string, signers []SignerStatus, currentUserEmail string, docID string, ownerHasSignedOnce bool, summary *ChangeSummaryView) Card {
	sorted := make([]SignerStatus, 0, len(signers))
	for _, s := range signers {
		if s.Status == "drifted" {
			sorted = append(sorted, s)
		}
	}
	for _, s := range signers {
		if s.Status == "pending" {
			sorted = append(sorted, s)
		}
	}
	for _, s := range signers {
		if s.Status == "signed" {
			sorted = append(sorted, s)
		}
	}

	signerWidgets := make([]Widget, 0, len(sorted))
	for _, s := range sorted {
		icon := statusIconWidget(s.Status)
		label := s.Email
		if s.DisplayName != "" {
			label = s.DisplayName
		}
		bottom := s.Status
		if rt := relativeTime(staleTimestamp(s)); rt != "" {
			bottom += " · " + rt
		}
		signerWidgets = append(signerWidgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   icon,
				Text:        label,
				BottomLabel: bottom,
				WrapText:    true,
			},
		})
	}

	var current SignerStatus
	for _, s := range signers {
		if s.Email == currentUserEmail {
			current = s
			break
		}
	}

	sections := []Section{
		{
			Header:  "Sign-offs",
			Widgets: signerWidgets,
		},
	}

	switch {
	case current.Status == "pending" && !ownerHasSignedOnce:
		sections = append(sections, Section{
			Widgets: []Widget{
				{DecoratedText: &DecoratedText{
					StartIcon:   matIcon("hourglass_empty"),
					Text:        fmt.Sprintf("Waiting for %s to sign off first", ownerName),
					BottomLabel: "You'll be able to sign once they do.",
					WrapText:    true,
				}},
			},
		})
	case current.Status == "pending":
		sections = append(sections, Section{
			Widgets: []Widget{
				{ButtonList: &ButtonList{Buttons: []Button{
					filledActionButton("Sign this document", "/addon/sign-form",
						Parameter{Key: "docId", Value: docID}),
				}}},
			},
		})
	case current.Status == "drifted":
		widgets := []Widget{
			{TextParagraph: &TextParagraph{Text: "The document changed since you signed. Review the changes and re-sign — no need to wait for anyone."}},
		}
		if summary != nil {
			widgets = append(widgets, changeSummaryWidgets(*summary)...)
			widgets = append(widgets, Widget{ButtonList: &ButtonList{Buttons: []Button{
				linkButton("View in Google Docs", VersionHistoryURL(docID, summary.FromRevisionID, summary.ToRevisionID)),
			}}})
		}
		widgets = append(widgets, Widget{ButtonList: &ButtonList{Buttons: []Button{
			filledActionButton("Re-sign", "/addon/sign-form",
				Parameter{Key: "docId", Value: docID}),
		}}})
		sections = append(sections, Section{Header: "What changed", Widgets: widgets})
	}

	sections = append(sections, Section{
		Widgets: []Widget{
			{ButtonList: &ButtonList{Buttons: []Button{
				outlinedActionButton("Refresh", "/addon/back-to-status", Parameter{Key: "docId", Value: docID}),
			}}},
		},
	})

	return Card{
		Name:     "status_signer",
		Header:   &Header{Title: docTitle, Subtitle: fmt.Sprintf("Requested by %s", ownerName)},
		Sections: sections,
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/addon-backend && go build ./... && go vet ./...`
Expected: both succeed with no errors.

Run: `go test ./cards/... -v`
Expected: all tests in the `cards` package PASS, including every `TestStatusOwner_*` and `TestStatusSigner_*` test.

Run: `go test ./... 2>&1`
Expected: all packages build and pass (E2E tests needing `FIRESTORE_EMULATOR_HOST` SKIP, not FAIL).

- [ ] **Step 6: Update `CLAUDE.md`**

1. Replace the **Drift + re-review** line. Change:
   > **Drift + re-review:** Owner reopens sidebar → lazy doc-level drift check runs (compares current `modifiedTime` against the doc's `confirmedModifiedTime`) → if changed, **everyone is locked** — no one can sign until the owner acts. Owner sees "Confirm new version", optionally adds a note, and confirms → server diffs the pinned baseline against current text using the owner's live token, stores the section-level `changeSummary` (headings + counts + note, never document text), bumps `confirmedVersion`, pins a new baseline, and emails drifted signers. Signers whose `signedVersion` is behind `confirmedVersion` see the drift summary and must re-sign; they can also nudge the owner via "Notify owner" if they spot drift before the owner does.

   to:
   > **Drift + re-review:** Signing has exactly one bottleneck: nobody but the owner can sign until the owner has completed their own first sign-off. After that, every signer (owner included, on later re-signs) can sign or re-sign at any time — there is no confirm-gate blocking anyone. Each signature's staleness is tracked independently: on sidebar open (or a manual "Refresh" click — Card Service add-ons have no client-side JS or server-push, so a one-click refresh is the closest this architecture allows to auto-detection), the lazy per-signer check compares the doc's live `modifiedTime` against that signer's own `signedModifiedTime` (captured when they signed) and flips `signed` → `drifted` independently per signer. A drifted signer sees "Re-sign" immediately, no waiting on anyone. "Confirm new version" is optional, not required: the owner can click it any time to leave a note and compute a fresh, rich `changeSummary` diff for signers (and now the owner too, via a "What changed" button on their own status card) to review — but nothing about anyone's ability to sign depends on this ever running.

2. In the Firestore schema's `documents/{docId}/signers/{email}` line, change:
   ```
   status (pending | signed | drifted), signedAt, signedVersion, commitMessage, notifiedAt
   ```
   to:
   ```
   status (pending | signed | drifted), signedAt, signedModifiedTime, commitMessage, driftDetectedAt, notifiedAt
   ```

3. In the "What's left to build" section, change:
   > - **Drift detection wiring** — done: doc-level `modifiedTime` check runs on homepage open, owner confirm via `/addon/mark-revised`, signer nudge via `/addon/notify-owner`

   to:
   > - **Drift detection wiring** — done: per-signer `modifiedTime` staleness check runs on homepage open (and on manual "Refresh"), owner confirm via `/addon/mark-revised` is optional enrichment only, never a signing gate

- [ ] **Step 7: Commit**

```bash
cd /Users/daniel/git_repos/doc-align
git add packages/addon-backend/cards/status_owner.go packages/addon-backend/cards/status_signer.go \
  packages/addon-backend/cards/status_owner_test.go packages/addon-backend/cards/status_signer_test.go \
  CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(addon-backend): non-blocking drift UI, owner diff view, refresh button

StatusOwner and StatusSigner no longer show a hard "signing is
paused" lock when the document changes — drift is a per-signer
staleness badge now, never a block. Owners get a "What changed"
button (previously only signers could see the diff at all), both
cards get a one-click "Refresh" (Card Service has no push/polling —
this is the closest thing to auto-detection this architecture
allows), and drifted rows now show time-since-drift-detected instead
of time-since-originally-signed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full verification

**Files:** none modified — this task only runs commands and checks the running local stack.

**Interfaces:**
- Consumes: everything built in Tasks 1–3.
- Produces: nothing new; this is the plan's final gate.

- [ ] **Step 1: Full build, vet, and test sweep**

```bash
cd /Users/daniel/git_repos/doc-align/packages/addon-backend
go build ./...
go vet ./...
go test ./...
```
Expected: build succeeds, vet is clean, every package's tests PASS or SKIP (no FAIL).

- [ ] **Step 2: Confirm no dangling references to removed code**

```bash
cd /Users/daniel/git_repos/doc-align/packages/addon-backend
grep -rn "SignedVersion\|SendOwnerNudge\|NotifyOwner\|notify-owner" . || echo "clean"
```
Expected: `clean` (no matches). If anything matches, it's a leftover reference that must be removed before proceeding.

- [ ] **Step 3: Manually verify the full flow live**

This closes the gap the automated tests can't reach: `completeSign` needs a real Drive `modifiedTime` call to succeed, which the e2e harness's bogus-OAuth-token pattern can't provide (see Global Constraints). Real tokens are available through the actual browser session.

Rebuild and restart the local Go server (ngrok and the deployment pointer stay as-is — use the project's `/local-addon-reload` command, or manually):
```bash
lsof -ti:8080 | xargs kill 2>/dev/null
cd /Users/daniel/git_repos/doc-align/packages/addon-backend && source .env && go run .
```
If ngrok/the deployment pointer aren't already running from an earlier session, use `/local-addon-test` instead to bring up the whole stack.

Then, in a fresh Google Doc (never had create-baseline called) with the doc-align sidebar open:

1. Click "Create baseline". Confirm the owner appears in the signer list immediately with a "Sign this document" button.
2. Add a signer (a second account, or verify via the "owner hasn't signed" gate below if only one account is available).
3. **Owner-gate check:** before the owner signs, confirm an invited signer's `StatusSigner` view shows "Waiting for `<owner>` to sign off first" with no Sign button.
4. Click "Sign this document" as the owner. Confirm it succeeds and the owner's own row shows "signed".
5. Now confirm the invited signer's view shows a working "Sign this document" button (owner has signed once — gate lifted).
6. Edit the document (add a sentence) after signing.
7. Click "Refresh" on the status card (do **not** close and reopen the sidebar) — confirm the signature that should now be stale shows "drifted" with a "· Nm ago" reflecting when the drift was detected, not the original sign time.
8. Confirm "Re-sign" is available immediately on the drifted signature — with **no** "Confirm new version" step required first.
9. Click "Confirm new version" as the owner (optional step) — add a note — confirm it succeeds and a "What changed" button now appears on `StatusOwner` showing the diff.
10. Confirm `StatusOwner`'s "Document changed" section (if still shown) does not block re-signing — it should read as informational, not blocking.

Report what you observe at each step — if any step doesn't match, that's a real finding, not something to paper over.

- [ ] **Step 4: Clean up the local test stack**

Once verified, run `/local-addon-stop` to point the shared deployment back at Cloud Run and stop the local ngrok/Go processes.
