# Baseline-Centric Drift Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silently-broken per-signer revision tracking with document-level drift detection (Drive `modifiedTime` vs last confirmed version) and an owner-confirmed re-review flow that stores only a change summary — never document content.

**Architecture:** Signers never call Drive's Revisions API (it silently returns nothing for non-owners — the root-cause bug). Drift = "file modified after the owner's last confirmed version," checked with any user's `drive.file` token via `files.get(fields=modifiedTime)`. When drift exists, *all* signing is locked. The owner's "Confirm new version" action (existing `/addon/mark-revised` route, rewritten) uses the owner's **live** token to diff baseline-vs-current with the existing LCS code, stores a section-level summary on the doc record, bumps `confirmedVersion`, re-pins the baseline, and emails drifted signers. Signers re-sign against the stored `confirmedVersion` integer.

**Tech Stack:** Go 1.22+, `net/http` stdlib mux, Firestore (`cloud.google.com/go/firestore`), Drive API v3, Resend email. No test framework beyond `go test`.

**Spec:** `docs/superpowers/specs/2026-07-04-baseline-centric-drift-design.md`

## Global Constraints

- Document content is NEVER stored in Firestore. Stored summary = section headings + line counts + owner note only. No diff hunks, no paragraph text.
- Never call `LatestRevisionID` / `ExportRevisionText` / `KeepRevisionForever` with a non-owner token. Owner routes get the owner's live token from the request event; there is no stored refresh token.
- Homepage-trigger handlers respond with bare `Card` via `writeErr`/`writeJSON(card)`; action handlers respond with `RenderActions` via `writeActionErr`/`writeJSON(cards.Push/Update(...))`. Wrong type = silent failure in the sidebar.
- `FormAction.function` must be a full HTTPS URL — always go through `actionButton`/`filledActionButton`/`outlinedActionButton` helpers which prepend `cards.BaseURL`.
- Card icons: `materialIcon` names only (`matIcon(...)`), never `knownIcon`.
- All commands run from the repo root `/Users/rahulraturi/code/doc-align`. Build: `cd packages/addon-backend && go build ./...`. Tests: `cd packages/addon-backend && go test ./...`.
- The `cards` package must not import `services` (services already imports cards — reverse import = cycle). Route handlers convert `services.ChangeSummary` → `cards.ChangeSummaryView`.
- Clock-skew rule: drift comparisons use Drive's own `modifiedTime` captured at confirm time (`confirmedModifiedTime`), never the server clock.
- Migration note: existing Firestore test documents lack `confirmedVersion`/`confirmedModifiedTime` (decode as `0`/zero time → permanently "changed"). Test data only — the owner re-creating the baseline or confirming once heals it. No migration code.

---

### Task 1: Schema types + pure drift logic

**Files:**
- Modify: `packages/addon-backend/services/firestore.go`
- Create: `packages/addon-backend/services/version.go`
- Test: `packages/addon-backend/services/version_test.go`

**Interfaces:**
- Produces: `services.ChangeSummary{Note string; Sections []ChangeSection; TotalAdded, TotalRemoved int; FromRevisionID, ToRevisionID string}`, `services.ChangeSection{Title string; Added, Removed int}`, `DocRecord.ConfirmedVersion int` / `.ConfirmedModifiedTime time.Time` / `.ChangeSummary *ChangeSummary`, `SignerRecord.SignedVersion int` (replaces `SignedRevisionID`), `services.DocChanged(modifiedTime, confirmedModifiedTime time.Time) bool`, `services.SignersToDrift(docChanged bool, confirmedVersion int, signers map[string]SignerRecord) []string`, `store.ConfirmNewVersion(ctx, docID string, newVersion int, summary ChangeSummary, newBaselineRevID string, modifiedTime time.Time) error`.
- Consumes: existing `SignerRecord`, `Store` from `services/firestore.go`.

- [ ] **Step 1: Write the failing test**

Create `packages/addon-backend/services/version_test.go`:

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
	signers := map[string]SignerRecord{
		"pending@x.com":    {Status: "pending"},
		"current@x.com":    {Status: "signed", SignedVersion: 2},
		"old@x.com":        {Status: "signed", SignedVersion: 1},
		"drifted@x.com":    {Status: "drifted", SignedVersion: 1},
	}

	// No doc change: only stale signedVersion flips (signer missed the confirm).
	got := SignersToDrift(false, 2, signers)
	if len(got) != 1 || got[0] != "old@x.com" {
		t.Errorf("no-change case: want [old@x.com], got %v", got)
	}

	// Doc changed: every currently-signed signer flips; drifted/pending untouched.
	got = SignersToDrift(true, 2, signers)
	if len(got) != 2 {
		t.Errorf("changed case: want 2 signers, got %v", got)
	}
	found := map[string]bool{}
	for _, e := range got {
		found[e] = true
	}
	if !found["current@x.com"] || !found["old@x.com"] {
		t.Errorf("changed case: want current@x.com and old@x.com, got %v", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/addon-backend && go test ./services/ -run 'TestDocChanged|TestSignersToDrift' -v`
Expected: FAIL — `undefined: DocChanged`, `undefined: SignersToDrift`, `unknown field SignedVersion`

- [ ] **Step 3: Update the schema in `services/firestore.go`**

Replace the `DocRecord` and `SignerRecord` definitions (keep `HistoryRecord` as-is):

```go
type DocRecord struct {
	Title                 string         `firestore:"title"`
	OwnerID               string         `firestore:"ownerId"`
	BaselineRevisionID    string         `firestore:"baselineRevisionId"`
	ConfirmedVersion      int            `firestore:"confirmedVersion"`
	ConfirmedModifiedTime time.Time      `firestore:"confirmedModifiedTime"`
	ChangeSummary         *ChangeSummary `firestore:"changeSummary"`
	CreatedAt             time.Time      `firestore:"createdAt"`
}

// ChangeSummary is the only record of what changed between confirmed versions.
// Section headings and line counts only — document content is never stored.
type ChangeSummary struct {
	Note           string          `firestore:"note"`
	Sections       []ChangeSection `firestore:"sections"`
	TotalAdded     int             `firestore:"totalAdded"`
	TotalRemoved   int             `firestore:"totalRemoved"`
	FromRevisionID string          `firestore:"fromRevisionId"`
	ToRevisionID   string          `firestore:"toRevisionId"`
}

type ChangeSection struct {
	Title   string `firestore:"title"`
	Added   int    `firestore:"added"`
	Removed int    `firestore:"removed"`
}

type SignerRecord struct {
	Status          string    `firestore:"status"` // pending | signed | drifted
	SignedAt        time.Time `firestore:"signedAt"`
	SignedVersion   int       `firestore:"signedVersion"`
	CommitMessage   string    `firestore:"commitMessage"`
	DriftDetectedAt time.Time `firestore:"driftDetectedAt"`
	NotifiedAt      time.Time `firestore:"notifiedAt"`
}
```

This deletes `OwnerRefreshToken`, `LastDriftCheckedAt`, and `SignedRevisionID`. Also delete the now-unused `UpdateLastDriftCheck` method, and add `ConfirmNewVersion` next to `UpdateBaselineRevision`:

```go
// ConfirmNewVersion atomically records the owner's confirmation of the current doc state:
// new version number, the Drive modifiedTime captured at confirm, the computed change
// summary, and the freshly pinned baseline revision.
func (s *Store) ConfirmNewVersion(ctx context.Context, docID string, newVersion int, summary ChangeSummary, newBaselineRevID string, modifiedTime time.Time) error {
	_, err := s.client.Collection("documents").Doc(docID).Update(ctx, []firestore.Update{
		{Path: "confirmedVersion", Value: newVersion},
		{Path: "confirmedModifiedTime", Value: modifiedTime},
		{Path: "changeSummary", Value: summary},
		{Path: "baselineRevisionId", Value: newBaselineRevID},
	})
	return err
}
```

NOTE: the package will not compile yet — `drift_check.go`, `sign.go`, `quick_sign.go`, `diff.go`, `mark_revised.go` still reference `SignedRevisionID`. That is expected; Tasks 2–5 fix them. Only run the `services` tests with `-run` filters until Task 5.

- [ ] **Step 4: Create `services/version.go`**

```go
package services

import "time"

// DocChanged reports whether the file was modified after the owner's last confirmed
// version. Both times come from Drive's modifiedTime (captured at confirm), so no
// server-clock comparison is involved. A zero confirmedModifiedTime (pre-schema doc)
// always reads as changed, forcing one owner confirm to heal the record.
func DocChanged(modifiedTime, confirmedModifiedTime time.Time) bool {
	return modifiedTime.After(confirmedModifiedTime)
}

// SignersToDrift returns the emails of signers whose "signed" status is no longer
// valid: either the doc has unconfirmed changes (docChanged — everyone signed flips),
// or they signed an older confirmedVersion (they missed a confirm while offline).
// Pending and already-drifted signers are never returned.
func SignersToDrift(docChanged bool, confirmedVersion int, signers map[string]SignerRecord) []string {
	var out []string
	for email, rec := range signers {
		if rec.Status != "signed" {
			continue
		}
		if docChanged || rec.SignedVersion < confirmedVersion {
			out = append(out, email)
		}
	}
	return out
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/addon-backend && go test ./services/ -run 'TestDocChanged|TestSignersToDrift' -v`
Expected: PASS (compile errors in other files, if any, will surface in the routes package — the services package itself must compile).

- [ ] **Step 6: Commit**

```bash
git add packages/addon-backend/services/firestore.go packages/addon-backend/services/version.go packages/addon-backend/services/version_test.go
git commit -m "feat(addon-backend): version-based schema and pure drift logic"
```

---

### Task 2: Modified-time fetch + doc-level drift check

**Files:**
- Create: `packages/addon-backend/services/doc_modified.go`
- Rewrite: `packages/addon-backend/services/drift_check.go`

**Interfaces:**
- Consumes: `DocChanged`, `SignersToDrift` (Task 1), existing `staticTokenSource` (`services/token_source.go`), `store.UpdateSignerStatus`, `store.AddHistory`.
- Produces: `services.FileModifiedTime(ctx, accessToken, docID string) (time.Time, error)`, `services.CheckDocDrift(ctx context.Context, store *Store, userToken, docID string, doc *DocRecord, signers map[string]SignerRecord) (bool, map[string]SignerRecord)`.

- [ ] **Step 1: Create `services/doc_modified.go`**

```go
package services

import (
	"context"
	"time"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

// FileModifiedTime returns the Drive modifiedTime of the file. Unlike the Revisions
// API, files.get works with any user's drive.file grant — owner or signer.
func FileModifiedTime(ctx context.Context, accessToken, docID string) (time.Time, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(accessToken)))
	if err != nil {
		return time.Time{}, err
	}
	f, err := svc.Files.Get(docID).Fields("modifiedTime").Context(ctx).Do()
	if err != nil {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339, f.ModifiedTime)
}
```

- [ ] **Step 2: Replace the body of `services/drift_check.go` entirely**

```go
package services

import (
	"context"
	"log"
	"time"
)

// CheckDocDrift is the lazy document-level drift check run on sidebar open. It compares
// Drive's modifiedTime (fetchable with ANY user's drive.file token — no Revisions API,
// which silently returns nothing for non-owners) against the modifiedTime captured at
// the owner's last confirm. Signers invalidated by the change are flipped to "drifted"
// in Firestore and in the returned map.
//
// Returns docChanged: true means the doc has edits the owner has not yet confirmed, and
// callers must lock all signing until the owner confirms. Fetch failures fail open for
// display (docChanged=false, log only) — the sign routes re-check at sign time and fail
// closed there.
func CheckDocDrift(ctx context.Context, store *Store, userToken, docID string, doc *DocRecord, signers map[string]SignerRecord) (bool, map[string]SignerRecord) {
	modifiedTime, err := FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("drift-check: FileModifiedTime %s: %v (skipping)", docID, err)
		return false, signers
	}

	docChanged := DocChanged(modifiedTime, doc.ConfirmedModifiedTime)
	now := time.Now()
	for _, email := range SignersToDrift(docChanged, doc.ConfirmedVersion, signers) {
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

The old `CheckDrift` function is deleted (its callers are updated in Task 6).

- [ ] **Step 3: Verify services package compiles and tests still pass**

Run: `cd packages/addon-backend && go build ./services/ && go test ./services/ -v`
Expected: build OK, both Task 1 tests PASS. (`routes` package still broken — expected until Tasks 3–6.)

- [ ] **Step 4: Commit**

```bash
git add packages/addon-backend/services/doc_modified.go packages/addon-backend/services/drift_check.go
git commit -m "feat(addon-backend): doc-level drift check via Drive modifiedTime"
```

---

### Task 3: Change-summary builder

**Files:**
- Create: `packages/addon-backend/services/change_summary.go`
- Test: `packages/addon-backend/services/change_summary_test.go`

**Interfaces:**
- Consumes: `DriftResult` (`services/drift_detection.go` — fields `Drifted bool`, `Added, Removed int`, `Sections []cards.DiffSection`), `ChangeSummary`/`ChangeSection` (Task 1).
- Produces: `services.BuildChangeSummary(result DriftResult, note, fromRevID, toRevID string) ChangeSummary`.

- [ ] **Step 1: Write the failing test**

Create `packages/addon-backend/services/change_summary_test.go`:

```go
package services

import (
	"testing"

	"github.com/doc-align/addon-backend/cards"
)

func TestBuildChangeSummary(t *testing.T) {
	result := DriftResult{
		Drifted: true,
		Added:   10,
		Removed: 3,
		Sections: []cards.DiffSection{
			{Title: "Termination Clause", Added: 8, Removed: 3},
			{Title: "New Appendix", Added: 2},
		},
	}

	got := BuildChangeSummary(result, "tightened termination terms", "rev-1", "rev-9")

	if got.Note != "tightened termination terms" {
		t.Errorf("note: got %q", got.Note)
	}
	if got.TotalAdded != 10 || got.TotalRemoved != 3 {
		t.Errorf("totals: got +%d -%d", got.TotalAdded, got.TotalRemoved)
	}
	if got.FromRevisionID != "rev-1" || got.ToRevisionID != "rev-9" {
		t.Errorf("revisions: got %q → %q", got.FromRevisionID, got.ToRevisionID)
	}
	if len(got.Sections) != 2 {
		t.Fatalf("sections: got %d, want 2", len(got.Sections))
	}
	if got.Sections[0] != (ChangeSection{Title: "Termination Clause", Added: 8, Removed: 3}) {
		t.Errorf("section 0: got %+v", got.Sections[0])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/addon-backend && go test ./services/ -run TestBuildChangeSummary -v`
Expected: FAIL — `undefined: BuildChangeSummary`

- [ ] **Step 3: Create `services/change_summary.go`**

```go
package services

// BuildChangeSummary converts a computed diff into the storable summary. This is the
// only artifact of a confirm that persists: headings and counts, never document text.
func BuildChangeSummary(result DriftResult, note, fromRevID, toRevID string) ChangeSummary {
	sections := make([]ChangeSection, 0, len(result.Sections))
	for _, s := range result.Sections {
		sections = append(sections, ChangeSection{Title: s.Title, Added: s.Added, Removed: s.Removed})
	}
	return ChangeSummary{
		Note:           note,
		Sections:       sections,
		TotalAdded:     result.Added,
		TotalRemoved:   result.Removed,
		FromRevisionID: fromRevID,
		ToRevisionID:   toRevID,
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/addon-backend && go test ./services/ -run TestBuildChangeSummary -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/services/change_summary.go packages/addon-backend/services/change_summary_test.go
git commit -m "feat(addon-backend): change-summary builder from drift result"
```

---

### Task 4: Cards — locked/unlocked signer view, owner confirm form, summary-backed diff view

**Files:**
- Modify: `packages/addon-backend/cards/status_signer.go`
- Modify: `packages/addon-backend/cards/status_owner.go`
- Modify: `packages/addon-backend/cards/diff_view.go`

**Interfaces:**
- Produces (route handlers in Tasks 5–7 call these exact signatures):
  - `cards.ChangeSummaryView{Note string; Sections []DiffSection; TotalAdded, TotalRemoved int; FromRevisionID, ToRevisionID string}` (defined in `diff_view.go`)
  - `cards.StatusSigner(docTitle, ownerName string, signers []SignerStatus, currentUserEmail, docID string, docChanged bool, summary *ChangeSummaryView) Card`
  - `cards.StatusOwner(docTitle string, signers []SignerStatus, docID string, docChanged bool) Card`
  - `cards.DiffView(docID string, summary ChangeSummaryView) Card`
  - `cards.VersionHistoryURL(docID, fromRev, toRev string) string`
- Consumes: existing widget helpers in `cards/types.go` (`filledActionButton`, `outlinedActionButton`, `linkButton`, `matIcon`), `SignerStatus` (unchanged fields; the `DriftConfirmed` method is deleted).

- [ ] **Step 1: Add `ChangeSummaryView` + URL helper, rewrite `DiffView` in `cards/diff_view.go`**

Replace the whole file:

```go
package cards

import "fmt"

type DiffSection struct {
	Title   string
	Added   int
	Removed int
}

// ChangeSummaryView is the card-layer copy of services.ChangeSummary (cards cannot
// import services — services already imports cards).
type ChangeSummaryView struct {
	Note           string
	Sections       []DiffSection
	TotalAdded     int
	TotalRemoved   int
	FromRevisionID string
	ToRevisionID   string
}

// VersionHistoryURL builds Google's compare-revisions deep link when both revision IDs
// are known, falling back to the plain document URL. The showrevision endpoint is
// undocumented (verified working 2026-07-04 in a signed-in browser); version history is
// only visible to users with edit access, so this is best-effort on top of the stored
// summary, never the primary oversight mechanism.
func VersionHistoryURL(docID, fromRev, toRev string) string {
	if fromRev != "" && toRev != "" {
		return fmt.Sprintf("https://docs.google.com/document/showrevision?id=%s&start=%s&end=%s", docID, fromRev, toRev)
	}
	return fmt.Sprintf("https://docs.google.com/document/d/%s/edit", docID)
}

// changeSummaryWidgets renders the stored summary: totals, per-section counts, owner note.
func changeSummaryWidgets(summary ChangeSummaryView) []Widget {
	widgets := []Widget{
		{TextParagraph: &TextParagraph{Text: fmt.Sprintf("+%d added · -%d removed", summary.TotalAdded, summary.TotalRemoved)}},
	}
	for _, sec := range summary.Sections {
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				Text:        sec.Title,
				BottomLabel: fmt.Sprintf("+%d added · -%d removed", sec.Added, sec.Removed),
				WrapText:    true,
			},
		})
	}
	if summary.Note != "" {
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				TopLabel: "Note from the owner",
				Text:     summary.Note,
				WrapText: true,
			},
		})
	}
	return widgets
}

// DiffView renders the stored change summary — no Drive calls, works for every signer
// including viewers who cannot open Google's version history.
func DiffView(docID string, summary ChangeSummaryView) Card {
	cardSections := []Section{
		{Widgets: changeSummaryWidgets(summary)},
	}

	cardSections = append(cardSections, Section{
		Widgets: []Widget{
			{TextParagraph: &TextParagraph{Text: "For the full line-by-line diff, open version history in Google Docs (requires edit access)."}},
			{ButtonList: &ButtonList{Buttons: []Button{
				linkButton("View in Google Docs", VersionHistoryURL(docID, summary.FromRevisionID, summary.ToRevisionID)),
			}}},
			{ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Re-sign", "/addon/sign-form", Parameter{Key: "docId", Value: docID}),
				actionButton("Back", "/addon/homepage"),
			}}},
		},
	})

	return Card{
		Name:     "diff_view",
		Header:   &Header{Title: "What changed"},
		Sections: cardSections,
	}
}
```

- [ ] **Step 2: Rewrite the state machine in `cards/status_signer.go`**

Replace the signature and the `switch current.Status` block. Full replacement for the parts that change — signature becomes:

```go
func StatusSigner(docTitle, ownerName string, signers []SignerStatus, currentUserEmail string, docID string, docChanged bool, summary *ChangeSummaryView) Card {
```

(The sorted-list rendering at the top of the function is unchanged.) Replace everything from `switch current.Status {` to the end of the `sections` construction with:

```go
	if docChanged {
		// Unconfirmed changes lock EVERYONE — pending and drifted alike. Nobody signs
		// off on a version the owner hasn't confirmed.
		sections = append(sections, Section{
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: fmt.Sprintf(
					"This document has changed since the last confirmed version. Signing is paused until %s confirms the changes.",
					ownerName)}},
				{ButtonList: &ButtonList{Buttons: []Button{
					outlinedActionButton("Remind owner", "/addon/notify-owner",
						Parameter{Key: "docId", Value: docID}),
				}}},
			},
		})
	} else {
		switch current.Status {
		case "pending":
			sections = append(sections, Section{
				Widgets: []Widget{
					{ButtonList: &ButtonList{Buttons: []Button{
						filledActionButton("Sign this document", "/addon/sign-form",
							Parameter{Key: "docId", Value: docID}),
					}}},
				},
			})
		case "drifted":
			widgets := []Widget{
				{TextParagraph: &TextParagraph{Text: "The document changed since you signed. Review the changes and re-sign."}},
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
	}
```

- [ ] **Step 3: Update `cards/status_owner.go`**

Three changes:

1. Signature: `func StatusOwner(docTitle string, signers []SignerStatus, docID string, docChanged bool) Card`.
2. Delete the `DriftConfirmed` method on `SignerStatus` (lines 18–22) and the `unconfirmedDrifted` counting loop.
3. Replace the `if unconfirmedDrifted > 0 { ... }` section with a confirm form shown whenever the doc has unconfirmed changes:

```go
	if docChanged {
		sections = append(sections, Section{
			Header: "Unconfirmed changes",
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: "The document has changed since the last confirmed version. Sign-offs are paused until you confirm."}},
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
```

Also remove the per-drifted-signer "View changes" button block inside the signer loop (lines 91–99) — the diff is document-level now, not per-signer. Keep everything else (sorting, remove-signer buttons, subtitle, bottom buttons).

- [ ] **Step 4: Verify the cards package compiles**

Run: `cd packages/addon-backend && go build ./cards/`
Expected: build OK. (`routes` still broken until Tasks 5–6.)

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/cards/
git commit -m "feat(addon-backend): lock-aware cards, stored-summary diff view, confirm form"
```

---

### Task 5: Sign routes — no Revisions API, doc-change gate, shared helper

**Files:**
- Create: `packages/addon-backend/routes/sign_common.go`
- Rewrite: `packages/addon-backend/routes/sign.go`
- Rewrite: `packages/addon-backend/routes/quick_sign.go`
- Modify: `packages/addon-backend/routes/diff.go`

**Interfaces:**
- Consumes: `services.FileModifiedTime`, `services.DocChanged` (Task 2/1), `cards.StatusSigner` / `cards.DiffView` / `cards.ChangeSummaryView` (Task 4), existing `decodeEvent`/`writeActionErr`/`writeJSON`/`toSignerStatusList` (`routes/event.go`, `routes/homepage.go`).
- Produces: `routes.completeSign(w http.ResponseWriter, r *http.Request, store *services.Store, resendKey, commitMsg string)` used by both sign routes; `routes.summaryToView(s *services.ChangeSummary) *cards.ChangeSummaryView` used by diff/homepage.

- [ ] **Step 1: Create `routes/sign_common.go`**

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

// completeSign is the shared body of Sign and QuickSign. It gates on unconfirmed doc
// changes (fail closed: a Drive error here blocks signing), records the sign against
// the doc's confirmedVersion — never a revision ID, which the Revisions API silently
// withholds from non-owners — and re-renders the signer card.
func completeSign(w http.ResponseWriter, r *http.Request, store *services.Store, resendKey, commitMsg string) {
	ctx := r.Context()
	userEmail := middleware.EmailFromContext(ctx)

	ev, err := decodeEvent(r)
	if err != nil {
		writeActionErr(w, "Something went wrong. Please try again.")
		return
	}

	docID := ev.resolveDocID()
	userToken := ev.AuthorizationEventObject.UserOAuthToken

	doc, err := store.GetDoc(ctx, docID)
	if err != nil {
		writeActionErr(w, "Document not found.")
		return
	}

	modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("sign: FileModifiedTime: %v", err)
		writeActionErr(w, "Couldn't verify the document is unchanged. Please try again.")
		return
	}
	if services.DocChanged(modifiedTime, doc.ConfirmedModifiedTime) {
		writeActionErr(w, "The document has changed since the last confirmed version. The owner needs to confirm the changes before sign-offs can continue.")
		return
	}

	now := time.Now()
	if err := store.UpdateSignerStatus(ctx, docID, userEmail, "signed", map[string]interface{}{
		"signedAt":      now,
		"signedVersion": doc.ConfirmedVersion,
		"commitMessage": commitMsg,
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

	go func() {
		if err := services.SendSignedNotification(resendKey, doc.OwnerID, userEmail, doc.Title, docID); err != nil {
			log.Printf("sign: SendSignedNotification: %v", err)
		}
	}()

	signerMap, _ := store.ListSigners(ctx, docID)
	ownerName := services.DisplayName(doc.OwnerID)
	writeJSON(w, cards.Push(cards.StatusSigner(doc.Title, ownerName, toSignerStatusList(signerMap), userEmail, docID, false, summaryToView(doc.ChangeSummary))))
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

- [ ] **Step 2: Rewrite `routes/sign.go` and `routes/quick_sign.go` as thin wrappers**

`routes/sign.go`:

```go
package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/services"
)

func Sign(store *services.Store, resendKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		completeSign(w, r, store, resendKey, ev.formString("commitMessage"))
	}
}
```

`routes/quick_sign.go`:

```go
package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/services"
)

func QuickSign(store *services.Store, resendKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		completeSign(w, r, store, resendKey, ev.param("message"))
	}
}
```

NOTE: `decodeEvent` reads the request body; check `routes/event.go` — if it does not buffer/restore `r.Body`, decoding twice fails. In that case change `completeSign` to accept the already-decoded `ev *AddonEvent` instead of re-decoding: `completeSign(w, r, store, resendKey, ev, commitMsg)`. Prefer that variant if in doubt — decode once in the wrapper, pass it down.

- [ ] **Step 3: Rewrite `routes/diff.go` to serve the stored summary**

```go
package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/services"
)

// Diff renders the stored change summary. No Drive calls: the summary was computed at
// owner-confirm time, so this works for every signer, including viewers.
func Diff(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}
		if doc.ChangeSummary == nil {
			writeActionErr(w, "No confirmed changes to show yet.")
			return
		}

		writeJSON(w, cards.Push(cards.DiffView(docID, *summaryToView(doc.ChangeSummary))))
	}
}
```

- [ ] **Step 4: Verify the routes that changed compile (mark_revised/homepage still pending)**

Run: `cd packages/addon-backend && go build ./... 2>&1 | head -30`
Expected: remaining errors ONLY in `routes/mark_revised.go`, `routes/homepage.go`, `routes/on_file_scope_granted.go` (old `CheckDrift` / old card signatures). No errors in `sign*.go`, `quick_sign.go`, `diff.go`.

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/routes/sign_common.go packages/addon-backend/routes/sign.go packages/addon-backend/routes/quick_sign.go packages/addon-backend/routes/diff.go
git commit -m "feat(addon-backend): version-based signing with doc-change gate, no Revisions API for signers"
```

---

### Task 6: Owner confirm (mark_revised rewrite) + drift email with summary

**Files:**
- Rewrite: `packages/addon-backend/routes/mark_revised.go`
- Modify: `packages/addon-backend/services/email.go` (`SendDriftNotification` signature)
- Modify: `packages/addon-backend/routes/homepage.go`
- Modify: `packages/addon-backend/routes/on_file_scope_granted.go`

**Interfaces:**
- Consumes: `FetchDocText(ctx, token, docID) (string, []DocSection, error)`, `ExportRevisionText`, `LatestRevisionID`, `KeepRevisionForever` (owner token only), `DetectDrift`, `BuildChangeSummary`, `store.ConfirmNewVersion`, `CheckDocDrift`, `cards.StatusOwner`/`StatusSigner` (Task 4 signatures), `summaryToView` (Task 5).
- Produces: `services.SendDriftNotification(apiKey, signerEmail, ownerEmail, docTitle, docID string, summary ChangeSummary) error` (new signature).

- [ ] **Step 1: Update `SendDriftNotification` in `services/email.go`**

Replace the existing function:

```go
func SendDriftNotification(apiKey, signerEmail, ownerEmail, docTitle, docID string, summary ChangeSummary) error {
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}

	ownerName := DisplayName(ownerEmail)
	docURL := "https://docs.google.com/document/d/" + docID + "/edit"

	subject := fmt.Sprintf("%s updated %q — please re-review", ownerName, docTitle)

	var sectionLines strings.Builder
	var sectionHTML strings.Builder
	for _, s := range summary.Sections {
		sectionLines.WriteString(fmt.Sprintf("  • %s (+%d / -%d)\n", s.Title, s.Added, s.Removed))
		sectionHTML.WriteString(fmt.Sprintf("<li>%s <span style=\"color:#6e7781\">(+%d / -%d)</span></li>", s.Title, s.Added, s.Removed))
	}
	noteText := ""
	noteHTML := ""
	if summary.Note != "" {
		noteText = fmt.Sprintf("\nNote from %s: %s\n", ownerName, summary.Note)
		noteHTML = fmt.Sprintf("<p><em>Note from %s:</em> %s</p>", ownerName, summary.Note)
	}

	plainText := fmt.Sprintf(
		"%s confirmed changes to \"%s\" since you signed off (+%d added / -%d removed).\n\nChanged sections:\n%s%s\nOpen the document to re-review and sign off again from the sidebar:\n%s",
		ownerName, docTitle, summary.TotalAdded, summary.TotalRemoved, sectionLines.String(), noteText, docURL,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#1f2328">
  <p><strong>%s</strong> confirmed changes to the following document since you signed off (+%d added / -%d removed):</p>
  <p style="font-size:18px;font-weight:600">%s</p>
  <ul>%s</ul>
  %s
  <p>Open the document to re-review and sign off again from the sidebar.</p>
  <p>
    <a href="%s"
       style="display:inline-block;padding:10px 20px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">
      Open document
    </a>
  </p>
  <hr style="margin-top:40px;border:none;border-top:1px solid #e1e4e8">
  <p style="color:#6e7781;font-size:12px">Sent by DocAlign on behalf of %s.</p>
</body>
</html>`, ownerName, summary.TotalAdded, summary.TotalRemoved, docTitle, sectionHTML.String(), noteHTML, docURL, ownerEmail)

	return resendSend(apiKey, signerEmail, subject, plainText, htmlBody)
}
```

- [ ] **Step 2: Rewrite `routes/mark_revised.go`**

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

// MarkRevised (route /addon/mark-revised, surfaced as "Confirm new version") is the
// owner-only action that ends a drift episode. Using the owner's LIVE token from this
// request — the only place document content is ever read — it diffs the pinned baseline
// against the current text, stores the section-level summary (headings + counts + note,
// never text), bumps confirmedVersion, pins the new baseline, and emails drifted
// signers. This is the sole unlock path for signing.
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

		signerMap, err := store.ListSigners(ctx, docID)
		if err != nil {
			log.Printf("mark-revised: ListSigners: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		for email, rec := range signerMap {
			if rec.Status != "drifted" && rec.Status != "signed" {
				continue
			}
			if rec.SignedVersion >= newVersion {
				continue
			}
			if rec.Status == "signed" {
				// Signed the old version but was never flipped (never reopened the
				// sidebar during the drift window): flip now so state is consistent.
				if err := store.UpdateSignerStatus(ctx, docID, email, "drifted", map[string]interface{}{
					"driftDetectedAt": now,
				}); err != nil {
					log.Printf("mark-revised: UpdateSignerStatus %s: %v", email, err)
					continue
				}
				rec.Status = "drifted"
				rec.DriftDetectedAt = now
			}
			if err := services.SendDriftNotification(resendKey, email, userEmail, doc.Title, docID, summary); err != nil {
				log.Printf("mark-revised: SendDriftNotification %s: %v", email, err)
			}
			if err := store.UpdateSignerStatus(ctx, docID, email, rec.Status, map[string]interface{}{
				"notifiedAt": now,
			}); err != nil {
				log.Printf("mark-revised: UpdateSignerStatus notifiedAt %s: %v", email, err)
			}
			rec.NotifiedAt = now
			signerMap[email] = rec
		}

		writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, false)))
	}
}
```

- [ ] **Step 3: Update `routes/homepage.go`**

Replace the owner and signer branches (lines 55–74) with:

```go
	docChanged, signerMap := services.CheckDocDrift(ctx, store, userToken, docID, doc, signerMap)

	if isOwner {
		log.Printf("homepage: showing StatusOwner to %s for doc %s (docChanged=%v)", userEmail, docID, docChanged)
		writeJSON(w, cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, docChanged))
		return
	}

	// Signer view
	_, isSigner := signerMap[userEmail]
	log.Printf("homepage: user=%s docOwner=%s isSigner=%v docChanged=%v", userEmail, doc.OwnerID, isSigner, docChanged)
	if !isSigner {
		writeJSON(w, cards.EmptyState(false, docID))
		return
	}

	ownerName := services.DisplayName(doc.OwnerID)
	writeJSON(w, cards.StatusSigner(doc.Title, ownerName, toSignerStatusList(signerMap), userEmail, docID, docChanged, summaryToView(doc.ChangeSummary)))
```

(Move the `CheckDocDrift` call above the `isOwner` branch as shown — one call serves both. Delete the now-unused `signerMapKeys` helper if nothing else references it.)

- [ ] **Step 4: Update `routes/on_file_scope_granted.go`**

Mirror the homepage change: replace both `services.CheckDrift(...)` calls (lines 62 and 72) and the subsequent `cards.StatusOwner`/`cards.StatusSigner` constructions with the same `CheckDocDrift` + new-signature pattern from Step 3. The file wraps cards differently (RenderActions vs bare Card) — keep its existing wrapping, change only the drift call and card arguments.

- [ ] **Step 5: Build everything except the not-yet-registered notify-owner route**

Run: `cd packages/addon-backend && go build ./... && go vet ./...`
Expected: clean build. If `cards.StatusSigner` calls in `on_file_scope_granted.go` were missed, this catches them.

- [ ] **Step 6: Run all tests**

Run: `cd packages/addon-backend && go test ./...`
Expected: PASS (3 tests from Tasks 1 and 3).

- [ ] **Step 7: Commit**

```bash
git add packages/addon-backend/routes/ packages/addon-backend/services/email.go
git commit -m "feat(addon-backend): owner confirm flow — stored summary, version bump, drift emails"
```

---

### Task 7: Notify-owner nudge route

**Files:**
- Create: `packages/addon-backend/routes/notify_owner.go`
- Modify: `packages/addon-backend/services/email.go` (add `SendOwnerNudge`)
- Modify: `packages/addon-backend/main.go` (register route)

**Interfaces:**
- Consumes: `decodeEvent`, `writeActionErr`, `store.GetDoc`, `resendSend` (private — new email func lives in the same file), Task 4's "Remind owner" button posting to `/addon/notify-owner` with `docId`.
- Produces: `services.SendOwnerNudge(apiKey, ownerEmail, signerEmail, docTitle, docID string) error`, `routes.NotifyOwner(store *services.Store, resendKey string) http.HandlerFunc`.

- [ ] **Step 1: Add `SendOwnerNudge` to `services/email.go`**

```go
// SendOwnerNudge tells the owner a signer is waiting on them to confirm the latest changes.
func SendOwnerNudge(apiKey, ownerEmail, signerEmail, docTitle, docID string) error {
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}

	signerName := DisplayName(signerEmail)
	docURL := "https://docs.google.com/document/d/" + docID + "/edit"

	subject := fmt.Sprintf("%s is waiting to sign %q", signerName, docTitle)

	plainText := fmt.Sprintf(
		"%s wants to sign off on \"%s\", but the document has unconfirmed changes.\n\nOpen the document and confirm the new version from the sidebar so signing can continue:\n%s",
		signerName, docTitle, docURL,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#1f2328">
  <p><strong>%s</strong> wants to sign off on:</p>
  <p style="font-size:18px;font-weight:600">%s</p>
  <p>The document has unconfirmed changes. Confirm the new version from the sidebar so signing can continue.</p>
  <p>
    <a href="%s"
       style="display:inline-block;padding:10px 20px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;font-weight:600">
      Open document
    </a>
  </p>
  <hr style="margin-top:40px;border:none;border-top:1px solid #e1e4e8">
  <p style="color:#6e7781;font-size:12px">Sent by DocAlign.</p>
</body>
</html>`, signerName, docTitle, docURL)

	return resendSend(apiKey, ownerEmail, subject, plainText, htmlBody)
}
```

- [ ] **Step 2: Create `routes/notify_owner.go`**

```go
package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// NotifyOwner lets a locked-out signer nudge the owner to confirm pending changes.
// Fire-and-forget email; re-renders via PopToRoot so the homepage re-runs the drift check.
func NotifyOwner(store *services.Store, resendKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}

		if _, err := store.GetSigner(ctx, docID, userEmail); err != nil {
			writeActionErr(w, "Only signers on this document can notify the owner.")
			return
		}

		if err := services.SendOwnerNudge(resendKey, doc.OwnerID, userEmail, doc.Title, docID); err != nil {
			log.Printf("notify-owner: SendOwnerNudge: %v", err)
			writeActionErr(w, "Couldn't send the notification. Please try again.")
			return
		}

		writeJSON(w, cards.PopRoot())
	}
}
```

- [ ] **Step 3: Register the route in `main.go`**

After the `mark-revised` registration (line 102):

```go
	mux.Handle("POST /addon/notify-owner", protected(routes.NotifyOwner(store, resendKey)))
```

- [ ] **Step 4: Build and test**

Run: `cd packages/addon-backend && go build ./... && go vet ./... && go test ./...`
Expected: clean build, vet clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/routes/notify_owner.go packages/addon-backend/services/email.go packages/addon-backend/main.go
git commit -m "feat(addon-backend): signer nudge — notify owner of unconfirmed changes"
```

---

### Task 8: Baseline init, dead-code removal, docs

**Files:**
- Modify: `packages/addon-backend/routes/create_baseline.go`
- Delete: `packages/addon-backend/services/owner_token.go` (and `token_source.go`'s `exchangeRefreshToken` if it becomes unused — check with grep)
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-04-baseline-centric-drift-design.md` (if any deviations accumulated)

**Interfaces:**
- Consumes: `FileModifiedTime` (Task 2), `store.CreateDoc` with Task 1's `DocRecord`.
- Produces: baseline records with `ConfirmedVersion: 1` and a real `ConfirmedModifiedTime` — the fields every drift check depends on.

- [ ] **Step 1: Initialize version fields in `routes/create_baseline.go`**

After the `KeepRevisionForever` block, fetch the modified time and include the new fields in the record (replace the existing `rec := services.DocRecord{...}` construction):

```go
	modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("create-baseline: FileModifiedTime: %v (using now)", err)
		modifiedTime = time.Now()
	}

	rec := services.DocRecord{
		Title:                 docTitle,
		OwnerID:               userEmail,
		BaselineRevisionID:    revID,
		ConfirmedVersion:      1,
		ConfirmedModifiedTime: modifiedTime,
		CreatedAt:             time.Now(),
	}
```

- [ ] **Step 2: Remove owner-token dead code**

```bash
cd packages/addon-backend && grep -rn "StoreOwnerRefreshToken\|GetOwnerAccessToken\|exchangeRefreshToken" --include="*.go" .
```

If the only hits are `services/owner_token.go` itself (plus `exchangeRefreshToken`'s definition in `token_source.go`): delete `services/owner_token.go`, and delete `exchangeRefreshToken` from `token_source.go` (keep `staticTokenSource` — it's used everywhere). If there are other callers, leave them and note it in the commit message instead.

- [ ] **Step 3: Update `CLAUDE.md`**

- Firestore schema block: replace the `documents/{docId}` line with `title, ownerId, baselineRevisionId, confirmedVersion, confirmedModifiedTime, changeSummary {note, sections[], totalAdded, totalRemoved, fromRevisionId, toRevisionId}, createdAt` and the signers line's `signedRevisionId` with `signedVersion`. Remove `ownerRefreshToken (encrypted KMS)` and `lastDriftCheckedAt`.
- "Drift + re-review" flow paragraph: rewrite to match the new flow (doc-level `modifiedTime` check on sidebar open → everyone locked → owner "Confirm new version" with note → summary stored → drift emails → signers re-sign).
- "What's left to build": remove "Owner token / OAuth callback" and "Diff view — blocked on ownerRefreshToken"; replace "Drift detection wiring" with done; add "verify signers' Drive access at save-signers time (Permissions API) — open question from spec".
- Critical invariants: add "Signer tokens never call the Revisions API — it silently returns an empty list for non-owners (root cause of the original drift bug). Revision operations are owner-live-token only."

- [ ] **Step 4: Full verification**

Run: `cd packages/addon-backend && gofmt -l . && go build ./... && go vet ./... && go test ./...`
Expected: `gofmt -l` prints nothing, build/vet clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/ CLAUDE.md
git commit -m "feat(addon-backend): baseline version init, drop owner-token dead code, update docs"
```

---

### Task 9: Manual end-to-end verification (ngrok, two accounts)

No code. Run the local stack per CLAUDE.md (ngrok + `go run`, `deployments replace` to your tunnel — coordinate with the team) and walk the flows. Existing Firestore test docs predate the schema — delete them or re-create baselines first.

**Checklist:**

- [ ] Owner: create baseline on a fresh doc → Firestore doc has `confirmedVersion: 1`, real `confirmedModifiedTime`, no `ownerRefreshToken`/`lastDriftCheckedAt` fields.
- [ ] Owner: add a signer (second account) → sign-off email arrives.
- [ ] Signer: open sidebar → StatusSigner, "Sign this document" visible (doc unchanged) → sign → Firestore signer has `signedVersion: 1` and NO `signedRevisionId`. Owner receives signed email.
- [ ] Owner: edit the doc body, wait ~10s, reopen sidebar → "Unconfirmed changes" section with note input + confirm button; signer flipped to `drifted` in Firestore with `driftDetectedAt`.
- [ ] Signer: reopen sidebar → locked view ("Signing is paused…"), "Remind owner" button, NO sign/re-sign button. Click Remind owner → owner receives nudge email.
- [ ] Signer: attempt to sign anyway via a stale SignForm card (open SignForm before the owner edits, submit after) → server rejects with "owner needs to confirm" message. (This proves the sign-time gate, not just the card gate.)
- [ ] Owner: type a note, click "Confirm new version & notify signers" → Firestore: `confirmedVersion: 2`, `changeSummary` populated with sections/counts/note, new `baselineRevisionId`. Signer receives drift email listing sections + note. Verify NO document text anywhere in Firestore.
- [ ] Signer: reopen sidebar → drifted view with "What changed" summary (sections, counts, owner note) + "View in Google Docs" link + Re-sign button. Click the link — record whether `showrevision` works for the signer's access level (open spec question). Re-sign → `signedVersion: 2`, status `signed`.
- [ ] Owner: reopen sidebar → all signers green, no unconfirmed-changes section.
- [ ] Deploy to Cloud Run per CLAUDE.md, `deployments replace` back to the committed `deployment.json`, verify with `curl -X POST .../addon/homepage` → `401 missing Bearer token` (NOT `/healthz`).

---

## Self-review notes

- **Spec coverage:** schema (Task 1), doc-changed check (Task 2), summary (Task 3), cards incl. locked state + notify button + summary render + deep link w/ fallback (Task 4), sign gate + no Revisions API (Task 5), owner confirm + emails (Task 6), nudge route (Task 7), baseline init + refresh-token removal + docs (Task 8), multi-account testing incl. the spec's open permissions question (Task 9, showrevision access recorded during testing). Spec's `confirmedAt` refined to `confirmedModifiedTime` (Drive clock, not server clock) — spec updated in Task 8 if needed.
- **Known judgment calls baked in:** sign-time gate fails closed on Drive errors while homepage display fails open (per spec's error-handling section); `mark-revised` route path kept (deployment.json/Google config unaffected) with only UI copy changed; existing pre-schema Firestore docs read as permanently changed until one confirm — acceptable, test data only.
