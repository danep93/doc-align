// E2E tests for the baseline-creation flow, run against the Firestore emulator.
//
// Run:
//
//	FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestCreateBaseline -v
package routes_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

func TestCreateBaseline_AddsOwnerAsPendingSigner(t *testing.T) {
	t.Setenv("OIDC_BYPASS", "true")
	store := newEmulatorStore(t)
	srv := httptest.NewServer(buildCreateBaselineTestMux(store))
	t.Cleanup(srv.Close)

	docID := "create-baseline-doc-owner-signer"
	resp := do(t, srv, "POST", "/addon/create-baseline", createBaselineEvent(docID, "My Doc"), "owner@example.com")
	assertStatus(t, resp, http.StatusOK)
	readJSON(t, resp) // drain

	signer, err := store.GetSigner(context.Background(), docID, "owner@example.com")
	if err != nil {
		t.Fatalf("expected the owner to have a signer record after create-baseline, GetSigner: %v", err)
	}
	if signer.Status != "pending" {
		t.Errorf("expected owner's signer status to be %q, got %q", "pending", signer.Status)
	}
}

func TestCreateBaseline_RerunDoesNotResetOwnerAlreadySigned(t *testing.T) {
	t.Setenv("OIDC_BYPASS", "true")
	store := newEmulatorStore(t)
	srv := httptest.NewServer(buildCreateBaselineTestMux(store))
	t.Cleanup(srv.Close)

	docID := "create-baseline-doc-owner-rerun"
	ev := createBaselineEvent(docID, "My Doc")

	first := do(t, srv, "POST", "/addon/create-baseline", ev, "owner@example.com")
	assertStatus(t, first, http.StatusOK)
	readJSON(t, first) // drain

	// Simulate the owner having already signed before the baseline is re-created.
	if err := store.UpdateSignerStatus(context.Background(), docID, "owner@example.com", "signed", map[string]interface{}{
		"signedAt": time.Now(),
	}); err != nil {
		t.Fatalf("UpdateSignerStatus: %v", err)
	}

	second := do(t, srv, "POST", "/addon/create-baseline", ev, "owner@example.com")
	assertStatus(t, second, http.StatusOK)
	readJSON(t, second) // drain

	signer, err := store.GetSigner(context.Background(), docID, "owner@example.com")
	if err != nil {
		t.Fatalf("GetSigner: %v", err)
	}
	if signer.Status != "signed" {
		t.Errorf("re-running create-baseline must not reset an already-signed owner back to pending, got status %q", signer.Status)
	}
}
