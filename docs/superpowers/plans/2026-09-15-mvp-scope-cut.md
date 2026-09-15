# MVP Scope Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the PRD completeness coaching feature entirely and collapse the sign form to a single action, so the add-on's only flow is: invite signers → sign → see who's signed → see what changed since your last signature.

**Architecture:** No new components. This is subtractive: remove files, remove one branch in an HTTP handler, remove one Firestore schema field, and trim one card's widget list. Everything else in the current card map (`EmptyState`, `AddSigners`, `StatusOwner`, `StatusSigner`, `History`, `DiffView`, `ConnectDocument`) is untouched.

**Tech Stack:** Go 1.22+, `cloud.google.com/go/firestore`, Google Card Service JSON (this repo's `cards` package), Firestore emulator for e2e tests.

**Spec:** `docs/superpowers/specs/2026-09-15-mvp-scope-cut-design.md`

## Global Constraints

- Delete, don't disable — no feature flags, no commented-out code (per spec's Decision section).
- `History`, `DiffView`, remove-signer, `AddSigners`, `EmptyState`, `ConnectDocument`, `StatusOwner`, `StatusSigner` get no content or layout changes (per spec's Out of scope list).
- The existing PRD-coaching design spec (`docs/superpowers/specs/2026-09-01-prd-completeness-coaching-design.md`) is not deleted or edited — specs are historical record.
- `go build ./...` and `go test ./...` must pass after every task.
- E2E tests in `routes_test` require `FIRESTORE_EMULATOR_HOST` to be set — without it they call `t.Skip` (existing pattern in `routes/e2e_test.go`'s `newEmulatorStore`). Don't treat a skip as a failure; it's expected in an environment with no emulator running.

---

### Task 1: Remove PRD completeness coaching entirely

**Files:**
- Delete: `cards/coaching.go`, `cards/coaching_test.go`, `services/anthropic.go`, `services/anthropic_test.go`, `services/prd_coaching.go`, `services/prd_coaching_test.go`, `routes/coach_resolve.go`, `routes/coaching_e2e_test.go`
- Modify: `routes/create_baseline.go`, `services/firestore.go`, `main.go`, `CLAUDE.md`, `packages/addon-backend/.env.example`
- Test: `routes/create_baseline_test.go` (new)

**Interfaces:**
- Consumes: `services.Store` (`GetDoc`, `CreateDoc`, `AddHistory`, all pre-existing, unchanged), `cards.AddSigners(collaborators []cards.Collaborator, docID string) cards.Card` (pre-existing, unchanged), `cards.Push(cards.Card) cards.RenderActions` (pre-existing, unchanged)
- Produces: `routes.CreateBaseline(store *services.Store) http.HandlerFunc` — **signature changes** from `CreateBaseline(store *services.Store, anthropicClient *services.AnthropicClient)`. Task 2 and the verification task both call the new one-argument form.

- [ ] **Step 1: Write the failing test**

Create `routes/create_baseline_test.go`:

```go
// E2E tests for the baseline-creation flow, run against the Firestore emulator.
//
// Run:
//
//	FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestCreateBaseline -v
package routes_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/routes"
	"github.com/doc-align/addon-backend/services"
)

func buildCreateBaselineTestMux(store *services.Store) *http.ServeMux {
	mux := http.NewServeMux()
	protected := func(h http.HandlerFunc) http.Handler { return middleware.VerifyOIDC(h) }
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store)))
	return mux
}

// createBaselineEvent builds a minimal Card-Service AddonEvent JSON body. Uses a
// bogus OAuth token, which cannot reach live Drive APIs — deliberate, so this
// deterministically exercises the "Drive unreachable, non-fatal" path that
// create-baseline already tolerates (revision pinning and collaborator lookup
// both degrade gracefully).
func createBaselineEvent(docID, docTitle string) map[string]any {
	return map[string]any{
		"docs": map[string]any{"id": docID, "title": docTitle},
		"authorizationEventObject": map[string]any{
			"userOAuthToken": "bogus-token-cannot-reach-drive",
		},
	}
}

func pushedCardName(t *testing.T, resp map[string]any) string {
	t.Helper()
	action, _ := resp["action"].(map[string]any)
	navs, _ := action["navigations"].([]any)
	if len(navs) == 0 {
		t.Fatalf("no navigations in response: %+v", resp)
	}
	nav, _ := navs[0].(map[string]any)
	card, _ := nav["pushCard"].(map[string]any)
	if card == nil {
		t.Fatalf("no pushCard in response: %+v", resp)
	}
	name, _ := card["name"].(string)
	return name
}

func TestCreateBaseline_FirstTimeGoesStraightToAddSigners(t *testing.T) {
	t.Setenv("OIDC_BYPASS", "true")
	store := newEmulatorStore(t)
	srv := httptest.NewServer(buildCreateBaselineTestMux(store))
	t.Cleanup(srv.Close)

	docID := "create-baseline-doc-1"
	resp := do(t, srv, "POST", "/addon/create-baseline", createBaselineEvent(docID, "My Doc"), "owner@example.com")
	assertStatus(t, resp, http.StatusOK)
	body := readJSON(t, resp)

	if name := pushedCardName(t, body); name != "add_signers" {
		t.Fatalf("expected add_signers immediately on first baseline creation (no coaching step), got %q", name)
	}
}

func TestCreateBaseline_RerunAlsoGoesStraightToAddSigners(t *testing.T) {
	t.Setenv("OIDC_BYPASS", "true")
	store := newEmulatorStore(t)
	srv := httptest.NewServer(buildCreateBaselineTestMux(store))
	t.Cleanup(srv.Close)

	docID := "create-baseline-doc-2"
	ev := createBaselineEvent(docID, "My Doc")

	first := do(t, srv, "POST", "/addon/create-baseline", ev, "owner@example.com")
	assertStatus(t, first, http.StatusOK)
	readJSON(t, first) // drain

	second := do(t, srv, "POST", "/addon/create-baseline", ev, "owner@example.com")
	assertStatus(t, second, http.StatusOK)
	body := readJSON(t, second)

	if name := pushedCardName(t, body); name != "add_signers" {
		t.Fatalf("re-running create-baseline should still go straight to add_signers, got %q", name)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/addon-backend && go build ./...`
Expected: FAIL to compile — `routes.CreateBaseline` still requires two arguments (`store`, `anthropicClient`), but the new test calls it with one. This compile error is the "red" state; `routes/create_baseline.go` hasn't been rewritten yet.

- [ ] **Step 3: Delete the coaching-only files**

```bash
cd packages/addon-backend
rm cards/coaching.go cards/coaching_test.go
rm services/anthropic.go services/anthropic_test.go
rm services/prd_coaching.go services/prd_coaching_test.go
rm routes/coach_resolve.go routes/coaching_e2e_test.go
```

- [ ] **Step 4: Rewrite `routes/create_baseline.go`**

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

func CreateBaseline(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		docTitle := ev.Docs.Title
		userToken := ev.AuthorizationEventObject.UserOAuthToken

		if docID == "" {
			writeActionErr(w, "Could not determine document ID. Please reopen the add-on.")
			return
		}

		// Get or create the doc record.
		doc, err := store.GetDoc(ctx, docID)
		if err != nil && !isNotFound(err) {
			log.Printf("create-baseline: GetDoc: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		// Only the owner (first to create baseline) can create it.
		if doc != nil && doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can create a baseline.")
			return
		}

		// Mark the current revision as keepForever.
		revID, err := services.LatestRevisionID(ctx, userToken, docID)
		if err != nil {
			log.Printf("create-baseline: LatestRevisionID: %v", err)
			// Don't block baseline creation if Drive API fails — store empty revID.
			revID = ""
		}
		if revID != "" {
			if err := services.KeepRevisionForever(ctx, userToken, docID, revID); err != nil {
				log.Printf("create-baseline: KeepRevisionForever: %v (non-fatal)", err)
			}
		}

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
		if err := store.CreateDoc(ctx, docID, rec); err != nil {
			log.Printf("create-baseline: CreateDoc: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:     "baseline_created",
			ActorEmail: userEmail,
			RevisionID: revID,
			Timestamp:  time.Now(),
		})

		// Fetch collaborators from Drive permissions, excluding the owner.
		var collaborators []cards.Collaborator
		if userToken != "" {
			if perms, err := services.ListFilePermissions(ctx, userToken, docID); err == nil {
				for _, p := range perms {
					if p.EmailAddress != "" && p.EmailAddress != userEmail {
						collaborators = append(collaborators, cards.Collaborator{
							Email:       p.EmailAddress,
							DisplayName: p.DisplayName,
						})
					}
				}
			} else {
				log.Printf("create-baseline: ListFilePermissions %s: %v", docID, err)
			}
		}

		writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
	}
}
```

- [ ] **Step 5: Remove `CoachingResult` from the Firestore schema**

In `services/firestore.go`:

1. In the `DocRecord` struct, delete the line:
   ```go
   	CoachingResult        *PRDCoachingResult  `firestore:"coachingResult"`
   ```
2. Delete the entire `PRDCoachingResult` type block (the comment above it plus the struct):
   ```go
   // PRDCoachingResult is the durable, one-time record of the pre-signer PRD
   // completeness check (Press Release + Definition of Done), captured right after
   // baseline creation and before any signers are invited. A later phase (doc ->
   // Linear project conversion, not built yet) reads this as baseline data — see
   // docs/superpowers/specs/2026-09-01-prd-completeness-coaching-design.md.
   type PRDCoachingResult struct {
   	PressReleasePresent bool      `firestore:"pressReleasePresent"`
   	PressReleaseText    string    `firestore:"pressReleaseText"`
   	PressReleaseSource  string    `firestore:"pressReleaseSource"` // "llm" | "manual" | "skipped"
   	DoDPresent          bool      `firestore:"dodPresent"`
   	DoDText             string    `firestore:"dodText"`
   	DoDSource           string    `firestore:"dodSource"` // "llm" | "manual" | "skipped"
   	ResolvedAt          time.Time `firestore:"resolvedAt"`
   	ResolvedBy          string    `firestore:"resolvedBy"`
   }
   ```

- [ ] **Step 6: Remove the Anthropic client and coach-resolve route from `main.go`**

Delete this block (currently right after the `RESEND_API_KEY` block, before `store := services.NewStore(fsClient)`):

```go
	// ANTHROPIC_API_KEY: env var takes precedence; fall back to Firestore config/secrets.
	anthropicKey := os.Getenv("ANTHROPIC_API_KEY")
	if anthropicKey == "" {
		snap, err := fsClient.Collection("config").Doc("secrets").Get(ctx)
		if err == nil {
			if v, ok := snap.Data()["anthropicApiKey"].(string); ok {
				anthropicKey = v
			}
		}
	}
	if anthropicKey == "" {
		log.Println("ANTHROPIC_API_KEY not found in env or Firestore config — PRD completeness coaching will fall back to manual entry")
	}
	anthropicClient := services.NewAnthropicClient(anthropicKey)
```

Change:
```go
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store, anthropicClient)))
```
to:
```go
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store)))
```

Delete this line:
```go
	mux.Handle("POST /addon/coach-resolve", protected(routes.CoachResolve(store)))
```

- [ ] **Step 7: Remove the `ANTHROPIC_API_KEY` example from `.env.example`**

In `packages/addon-backend/.env.example`, delete:
```
# Optional: overrides Firestore config/secrets.anthropicApiKey
# ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 8: Update `CLAUDE.md`**

Make these edits (all in the root `CLAUDE.md`):

1. Replace the "Note on 'privacy-first'" paragraph's stale example. Change:
   > ...**extracted/derived content will need to be stored going forward** — e.g. the PRD-completeness coaching fields (Press Release, Definition of Done text), and later, whatever baseline fields...

   to:
   > ...**extracted/derived content will need to be stored going forward** — e.g. the section-level `changeSummary` already stores headings and counts, and later, whatever baseline fields...

2. In the "Key files" list, delete these three lines:
   ```
     services/anthropic.go        — Anthropic API client (PRD completeness classification)
     services/prd_coaching.go     — coaching decision logic (EvaluateCoaching)
     routes/coach_resolve.go      — handles the PRDCoaching card's "Continue" submission
   ```

3. Replace the **Owner flow** line. Change:
   > **Owner flow:** Opens sidebar → EmptyState → clicks "Create baseline" (pins current Drive revision) → a one-time PRD completeness check runs (Claude classifies whether the doc states a Press Release and a Definition of Done) → if anything's missing, `PRDCoaching` card lets the owner fill it in inline or leave it blank and continue; if both are already found, this step is invisible → AddSigners card (enters emails) → StatusOwner card showing `N signed · N drifted · N pending`.

   to:
   > **Owner flow:** Opens sidebar → EmptyState → clicks "Create baseline" (pins current Drive revision) → AddSigners card (enters emails) → StatusOwner card showing `N signed · N drifted · N pending`.

4. Delete the entire **PRD completeness coaching** paragraph:
   > **PRD completeness coaching:** runs exactly once, right after "Create baseline," before any signer is invited — see `docs/superpowers/specs/2026-09-01-prd-completeness-coaching-design.md` for the full design. Never blocks: any failure (missing `ANTHROPIC_API_KEY`, network error, bad response) falls back to manual text entry. Re-running "Create baseline" on a doc that already has a baseline skips the check entirely and never overwrites an already-resolved `coachingResult`.

5. In the Card map table, delete the `PRDCoaching` row and simplify the `AddSigners` row. Change:
   ```
   | `PRDCoaching` | After "Create baseline" clicked, only if the Press Release and/or Definition of Done check needs the owner's input — skipped entirely if both are already found in the doc |
   | `AddSigners` | After "Create baseline" clicked (coaching auto-passed), or after `PRDCoaching`'s "Continue" |
   ```
   to:
   ```
   | `AddSigners` | After "Create baseline" clicked |
   ```

6. In the Firestore schema's `config/secrets` block, delete:
   ```
     anthropicApiKey — Anthropic API key (read by server at startup; env var ANTHROPIC_API_KEY overrides)
   ```

7. In the Firestore schema's `documents/{docId}` field list, remove `, coachingResult {pressReleasePresent, pressReleaseText, pressReleaseSource, dodPresent, dodText, dodSource, resolvedAt, resolvedBy}` from the line (keep everything else in that line as-is).

8. Replace the "Document content is not persisted in full" paragraph. Change:
   > Document content is not persisted in full. Firestore stores metadata plus a small set of intentionally-extracted fields: the section-level `changeSummary` (headings + counts + note), and the PRD-completeness `coachingResult` (Press Release / Definition of Done text, each roughly a paragraph). See the privacy-first note above.

   to:
   > Document content is not persisted in full. Firestore stores metadata plus a small set of intentionally-extracted fields: the section-level `changeSummary` (headings + counts + note). See the privacy-first note above.

- [ ] **Step 9: Run the test to verify it passes (and the whole module builds)**

Run: `cd packages/addon-backend && go build ./...`
Expected: succeeds with no errors.

Run: `go vet ./...`
Expected: no issues.

Run: `go test ./...`
Expected: all packages pass. `TestCreateBaseline_FirstTimeGoesStraightToAddSigners` and `TestCreateBaseline_RerunAlsoGoesStraightToAddSigners` either PASS (if `FIRESTORE_EMULATOR_HOST` is set) or SKIP (if it isn't) — both are acceptable; a FAIL is not.

If you have the Firestore emulator available, run the new tests explicitly to confirm PASS rather than SKIP:
```bash
firebase emulators:start --only firestore &
FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestCreateBaseline -v
```

- [ ] **Step 10: Commit**

```bash
cd /Users/daniel/git_repos/doc-align
git add packages/addon-backend/cards/coaching.go packages/addon-backend/cards/coaching_test.go \
  packages/addon-backend/services/anthropic.go packages/addon-backend/services/anthropic_test.go \
  packages/addon-backend/services/prd_coaching.go packages/addon-backend/services/prd_coaching_test.go \
  packages/addon-backend/routes/coach_resolve.go packages/addon-backend/routes/coaching_e2e_test.go \
  packages/addon-backend/routes/create_baseline.go packages/addon-backend/routes/create_baseline_test.go \
  packages/addon-backend/services/firestore.go packages/addon-backend/main.go \
  packages/addon-backend/.env.example CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(addon-backend): remove PRD completeness coaching

Cuts the coaching card, its Anthropic client, decision logic, resolve
route, and Firestore schema field entirely. create-baseline now goes
straight from doc creation to AddSigners, same as the existing
re-run path already did.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Simplify the sign form to a single action

**Files:**
- Delete: `routes/quick_sign.go`
- Modify: `cards/sign_form.go`, `main.go`, `CLAUDE.md`
- Test: `cards/sign_form_test.go` (new)

**Interfaces:**
- Consumes: `filledActionButton`, `outlinedActionButton`, `Parameter` (all pre-existing in `cards/types.go`, unchanged)
- Produces: `cards.SignForm(docTitle, ownerName, docID string) cards.Card` — same signature as before, only its returned `Card`'s widget content changes. No other file calls `SignForm` besides `routes/sign_form.go` (unaffected) — verified by grep before this plan was written.

- [ ] **Step 1: Write the failing test**

Create `cards/sign_form_test.go`:

```go
package cards

import "testing"

func TestSignForm_HasOnlyNoteFieldAndSignCancelButtons(t *testing.T) {
	card := SignForm("My Doc", "owner@example.com", "doc-1")

	if len(card.Sections) != 1 {
		t.Fatalf("expected 1 section, got %d", len(card.Sections))
	}
	widgets := card.Sections[0].Widgets
	if len(widgets) != 2 {
		t.Fatalf("expected 2 widgets (note field + button list), got %d: %+v", len(widgets), widgets)
	}
	if widgets[0].TextInput == nil || widgets[0].TextInput.Name != "commitMessage" {
		t.Fatalf("expected first widget to be the commitMessage text input, got %+v", widgets[0])
	}
	if widgets[1].ButtonList == nil {
		t.Fatalf("expected second widget to be a button list, got %+v", widgets[1])
	}

	buttons := widgets[1].ButtonList.Buttons
	if len(buttons) != 2 {
		t.Fatalf("expected exactly 2 buttons (Sign, Cancel), got %d: %+v", len(buttons), buttons)
	}
	if buttons[0].Text != "Sign" {
		t.Errorf("expected first button text %q, got %q", "Sign", buttons[0].Text)
	}
	if buttons[1].Text != "Cancel" {
		t.Errorf("expected second button text %q, got %q", "Cancel", buttons[1].Text)
	}
	for _, b := range buttons {
		switch b.Text {
		case "LGTM", "Approved", "Looks good", "Signed off":
			t.Fatalf("quick-sign chip %q should have been removed", b.Text)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/addon-backend && go test ./cards/ -run TestSignForm_HasOnlyNoteFieldAndSignCancelButtons -v`
Expected: FAIL — the current `SignForm` returns 3 widgets (quick-sign chip row, note field, Sign/Cancel row), not 2, and the first widget is a `ButtonList`, not the expected `TextInput`.

- [ ] **Step 3: Rewrite `cards/sign_form.go`**

Replace the entire file with:

```go
package cards

import "fmt"

func SignForm(docTitle, ownerName string, docID string) Card {
	widgets := []Widget{
		{
			TextInput: &TextInput{
				Name:  "commitMessage",
				Label: "Sign-off note (optional)",
				Type:  "MULTIPLE_LINE",
			},
		},
		{
			ButtonList: &ButtonList{Buttons: []Button{
				filledActionButton("Sign", "/addon/sign", Parameter{Key: "docId", Value: docID}),
				outlinedActionButton("Cancel", "/addon/homepage"),
			}},
		},
	}

	return Card{
		Name:   "sign_form",
		Header: &Header{Title: docTitle, Subtitle: fmt.Sprintf("Sign-off requested by %s", ownerName)},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/addon-backend && go test ./cards/ -run TestSignForm_HasOnlyNoteFieldAndSignCancelButtons -v`
Expected: PASS

- [ ] **Step 5: Delete the now-dead quick-sign route**

```bash
cd packages/addon-backend
rm routes/quick_sign.go
```

- [ ] **Step 6: Remove the quick-sign route registration from `main.go`**

Delete this line:
```go
	mux.Handle("POST /addon/quick-sign", protected(routes.QuickSign(store, resendKey)))
```

- [ ] **Step 7: Update the signer flow line in `CLAUDE.md`**

Change:
> **Signer flow:** Gets email with doc link → opens sidebar → StatusSigner card → clicks "Sign this doc" → SignForm (optional commit message or quick-sign chip) → signs → status = `signed`.

to:
> **Signer flow:** Gets email with doc link → opens sidebar → StatusSigner card → clicks "Sign this doc" → SignForm (optional commit message) → signs → status = `signed`.

- [ ] **Step 8: Run the full build and test suite**

Run: `cd packages/addon-backend && go build ./...`
Expected: succeeds with no errors (confirms nothing else referenced `routes.QuickSign`).

Run: `go test ./...`
Expected: all packages pass or skip (no FAIL).

- [ ] **Step 9: Commit**

```bash
cd /Users/daniel/git_repos/doc-align
git add packages/addon-backend/cards/sign_form.go packages/addon-backend/cards/sign_form_test.go \
  packages/addon-backend/routes/quick_sign.go packages/addon-backend/main.go CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(addon-backend): collapse sign form to a single Sign action

Removes the four quick-sign chip buttons (LGTM/Approved/Looks
good/Signed off) and the now-unused /addon/quick-sign route, which
shared all its logic with the regular Sign route anyway. One note
field, one Sign button.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Full verification

**Files:** none modified — this task only runs commands and checks the running local stack.

**Interfaces:**
- Consumes: everything built in Tasks 1–2.
- Produces: nothing new; this is the plan's final gate.

- [ ] **Step 1: Full build and test sweep**

```bash
cd /Users/daniel/git_repos/doc-align/packages/addon-backend
go build ./...
go vet ./...
go test ./...
```
Expected: build succeeds, vet is clean, all tests PASS or SKIP (no FAIL). If the Firestore emulator is available, additionally run:
```bash
FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./... -v
```
Expected: every test, including the two new `TestCreateBaseline_*` tests and `TestSignForm_HasOnlyNoteFieldAndSignCancelButtons`, PASSes.

- [ ] **Step 2: Confirm no dangling references to removed code**

```bash
cd /Users/daniel/git_repos/doc-align/packages/addon-backend
grep -rn "anthropicClient\|AnthropicClient\|PRDCoaching\|CoachResolve\|coachingResult\|CoachingResult\|QuickSign\|quick-sign" . || echo "clean"
```
Expected: `clean` (no matches). If anything matches, it's a leftover reference that must be removed before proceeding.

- [ ] **Step 3: Manually re-verify on the local test stack**

If the local ngrok/Cloud Run test stack from earlier in this session is still running, restart the Go server so it picks up the code changes (background processes don't hot-reload):

```bash
pkill -f "go run ./packages/addon-backend" 2>/dev/null
cd /Users/daniel/git_repos/doc-align/packages/addon-backend && source .env && go run .
```

If the stack isn't running, use the project's `/local-addon-test` command to bring it up fully (starts ngrok + the Go server, points the shared deployment at the tunnel, opens the test doc in Chrome).

Then, in the already-open test doc's doc-align sidebar:
1. Click "Create baseline" (or reload and reopen the sidebar if a baseline already exists from earlier testing — use a fresh doc if needed to see the first-time path).
2. Confirm it goes straight to the `AddSigners` card — no `PRDCoaching` card appears at any point.
3. Add a signer, then (as that signer, or by simulating the sign action) open `SignForm`.
4. Confirm `SignForm` shows only the optional note field and a single "Sign" button (plus "Cancel") — no "LGTM" / "Approved" / "Looks good" / "Signed off" chips.

- [ ] **Step 4: Clean up the local test stack**

Once verified, run `/local-addon-stop` to point the shared deployment back at Cloud Run and stop the local ngrok/Go processes.
