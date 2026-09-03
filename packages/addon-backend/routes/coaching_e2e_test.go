// E2E tests for PRD completeness coaching, run against the Firestore emulator.
//
// These use a bogus OAuth token, which cannot reach live Drive APIs — that's
// deliberate. It deterministically exercises the "check failed, fall back to
// manual entry" path (the same path production hits on any real Drive/Anthropic
// outage) without needing new Drive-mocking infrastructure this repo doesn't
// have yet. The classification client and decision logic are already fully
// unit-tested in isolation (see services/anthropic_test.go and
// services/prd_coaching_test.go) — this file's job is proving the HTTP/Firestore
// wiring, not re-testing that logic.
//
// Run:
//
//	FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestCoachingE2E -v
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

func buildCoachingTestMux(store *services.Store) *http.ServeMux {
	mux := http.NewServeMux()
	protected := func(h http.HandlerFunc) http.Handler { return middleware.VerifyOIDC(h) }
	anthropicClient := services.NewAnthropicClient("") // empty key: ClassifyPRDCompleteness always errors immediately

	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store, anthropicClient)))
	mux.Handle("POST /addon/coach-resolve", protected(routes.CoachResolve(store)))
	return mux
}

// addonEvent builds a minimal Card-Service AddonEvent JSON body.
func addonEvent(docID, docTitle string, params map[string]string, formInputs map[string][]string) map[string]any {
	fi := map[string]any{}
	for k, v := range formInputs {
		fi[k] = map[string]any{"stringInputs": map[string]any{"value": v}}
	}
	return map[string]any{
		"docs": map[string]any{"id": docID, "title": docTitle},
		"authorizationEventObject": map[string]any{
			"userOAuthToken": "bogus-token-cannot-reach-drive",
		},
		"commonEventObject": map[string]any{
			"parameters": params,
			"formInputs": fi,
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

func TestCoachingE2E_CreateBaseline_ChecksFailGracefully(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")
	srv := httptest.NewServer(buildCoachingTestMux(store))
	t.Cleanup(srv.Close)

	docID := "coaching-doc-1"
	ev := addonEvent(docID, "My PRD", map[string]string{}, nil)

	resp := do(t, srv, "POST", "/addon/create-baseline", ev, "owner@example.com")
	assertStatus(t, resp, http.StatusOK)
	body := readJSON(t, resp)

	if name := pushedCardName(t, body); name != "prd_coaching" {
		t.Fatalf("expected prd_coaching card when Drive/Anthropic are unreachable, got %q", name)
	}
}

func TestCoachingE2E_CreateBaseline_SkipsCoachingOnRerun(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")
	srv := httptest.NewServer(buildCoachingTestMux(store))
	t.Cleanup(srv.Close)

	docID := "coaching-doc-2"
	ev := addonEvent(docID, "My PRD", map[string]string{}, nil)

	first := do(t, srv, "POST", "/addon/create-baseline", ev, "owner@example.com")
	assertStatus(t, first, http.StatusOK)
	readJSON(t, first) // drain

	// Resolve coaching with real manual text — this is the state a re-run must not wipe.
	resolveEv := addonEvent(docID, "My PRD", map[string]string{"docId": docID}, map[string][]string{
		"pressReleaseManual": {"We're building X because Y."},
		"dodManual":          {"Demo to 5 customers."},
	})
	resolveResp := do(t, srv, "POST", "/addon/coach-resolve", resolveEv, "owner@example.com")
	assertStatus(t, resolveResp, http.StatusOK)
	readJSON(t, resolveResp) // drain

	second := do(t, srv, "POST", "/addon/create-baseline", ev, "owner@example.com")
	assertStatus(t, second, http.StatusOK)
	body := readJSON(t, second)

	if name := pushedCardName(t, body); name != "add_signers" {
		t.Fatalf("re-running create-baseline should skip coaching and go straight to add_signers, got %q", name)
	}

	doc, err := store.GetDoc(context.Background(), docID)
	if err != nil {
		t.Fatalf("GetDoc: %v", err)
	}
	if doc.CoachingResult == nil || doc.CoachingResult.PressReleaseSource != "manual" || doc.CoachingResult.DoDSource != "manual" {
		t.Fatalf("re-running create-baseline must not wipe a resolved coachingResult, got %+v", doc.CoachingResult)
	}
}

func TestCoachingE2E_CoachResolve_ManualEntryBothFields(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")
	srv := httptest.NewServer(buildCoachingTestMux(store))
	t.Cleanup(srv.Close)

	docID := "coaching-doc-3"
	do(t, srv, "POST", "/addon/create-baseline", addonEvent(docID, "My PRD", map[string]string{}, nil), "owner@example.com")

	resolveEv := addonEvent(docID, "My PRD", map[string]string{"docId": docID}, map[string][]string{
		"pressReleaseManual": {"We're building X because Y."},
		"dodManual":          {"Demo to 5 customers."},
	})
	resp := do(t, srv, "POST", "/addon/coach-resolve", resolveEv, "owner@example.com")
	assertStatus(t, resp, http.StatusOK)
	body := readJSON(t, resp)

	if name := pushedCardName(t, body); name != "add_signers" {
		t.Fatalf("expected add_signers after resolving coaching, got %q", name)
	}

	doc, err := store.GetDoc(context.Background(), docID)
	if err != nil {
		t.Fatalf("GetDoc: %v", err)
	}
	if doc.CoachingResult == nil {
		t.Fatal("expected coachingResult to be persisted")
	}
	if !doc.CoachingResult.PressReleasePresent || doc.CoachingResult.PressReleaseSource != "manual" {
		t.Errorf("press release: got %+v", doc.CoachingResult)
	}
	if !doc.CoachingResult.DoDPresent || doc.CoachingResult.DoDSource != "manual" {
		t.Errorf("DoD: got %+v", doc.CoachingResult)
	}
}

func TestCoachingE2E_CoachResolve_BlankFieldIsSkippedNotBlocked(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")
	srv := httptest.NewServer(buildCoachingTestMux(store))
	t.Cleanup(srv.Close)

	docID := "coaching-doc-4"
	do(t, srv, "POST", "/addon/create-baseline", addonEvent(docID, "My PRD", map[string]string{}, nil), "owner@example.com")

	resolveEv := addonEvent(docID, "My PRD", map[string]string{"docId": docID}, map[string][]string{
		"pressReleaseManual": {"We're building X."},
		// dodManual intentionally omitted — this is the override-by-leaving-blank path.
	})
	resp := do(t, srv, "POST", "/addon/coach-resolve", resolveEv, "owner@example.com")
	assertStatus(t, resp, http.StatusOK)
	body := readJSON(t, resp)

	if name := pushedCardName(t, body); name != "add_signers" {
		t.Fatalf("leaving a field blank must not block proceeding, got %q", name)
	}

	doc, err := store.GetDoc(context.Background(), docID)
	if err != nil {
		t.Fatalf("GetDoc: %v", err)
	}
	if doc.CoachingResult.DoDPresent || doc.CoachingResult.DoDSource != "skipped" {
		t.Errorf("expected DoD to be recorded as skipped, got %+v", doc.CoachingResult)
	}
}

func TestCoachingE2E_CoachResolve_SecondSubmissionPreservesManualSource(t *testing.T) {
	t.Setenv("OIDC_BYPASS", "true")
	store := newEmulatorStore(t)
	srv := httptest.NewServer(buildCoachingTestMux(store))
	t.Cleanup(srv.Close)

	docID := "coaching-doc-6"
	// Ensure a clean slate: the Firestore emulator persists data across test
	// runs (there's no per-test reset), and this test's own doc ID must not
	// carry over state from a prior run.
	_, _ = store.FirestoreClient().Collection("documents").Doc(docID).Delete(context.Background())

	do(t, srv, "POST", "/addon/create-baseline", addonEvent(docID, "My PRD", map[string]string{}, nil), "owner@example.com")

	resolveEv := addonEvent(docID, "My PRD", map[string]string{"docId": docID}, map[string][]string{
		"pressReleaseManual": {"We're building X because Y."},
		"dodManual":          {"Demo to 5 customers."},
	})
	first := do(t, srv, "POST", "/addon/coach-resolve", resolveEv, "owner@example.com")
	assertStatus(t, first, http.StatusOK)
	readJSON(t, first) // drain

	// Simulate the owner navigating back to the still-live PRDCoaching card
	// (cards.Push leaves it on the nav stack) and clicking Continue again.
	second := do(t, srv, "POST", "/addon/coach-resolve", resolveEv, "owner@example.com")
	assertStatus(t, second, http.StatusOK)
	readJSON(t, second) // drain

	doc, err := store.GetDoc(context.Background(), docID)
	if err != nil {
		t.Fatalf("GetDoc: %v", err)
	}
	if doc.CoachingResult.PressReleaseSource != "manual" {
		t.Errorf("PressReleaseSource: got %q after second submission, want \"manual\" (must not be silently relabeled \"llm\")", doc.CoachingResult.PressReleaseSource)
	}
	if doc.CoachingResult.DoDSource != "manual" {
		t.Errorf("DoDSource: got %q after second submission, want \"manual\"", doc.CoachingResult.DoDSource)
	}
}

func TestCoachingE2E_CoachResolve_NonOwnerRejected(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")
	srv := httptest.NewServer(buildCoachingTestMux(store))
	t.Cleanup(srv.Close)

	docID := "coaching-doc-5"
	do(t, srv, "POST", "/addon/create-baseline", addonEvent(docID, "My PRD", map[string]string{}, nil), "owner@example.com")

	resolveEv := addonEvent(docID, "My PRD", map[string]string{"docId": docID}, map[string][]string{
		"pressReleaseManual": {"text"}, "dodManual": {"text"},
	})
	resp := do(t, srv, "POST", "/addon/coach-resolve", resolveEv, "not-the-owner@example.com")
	assertStatus(t, resp, http.StatusOK)
	body := readJSON(t, resp)

	if name := pushedCardName(t, body); name != "error" {
		t.Fatalf("expected an error card for a non-owner, got %q", name)
	}
}
