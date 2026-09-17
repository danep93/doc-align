// E2E tests for signer removal, run against the Firestore emulator.
//
// Run:
//
//	FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestRemoveSigner -v
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

func buildRemoveSignerTestMux(store *services.Store) *http.ServeMux {
	mux := http.NewServeMux()
	protected := func(h http.HandlerFunc) http.Handler { return middleware.VerifyOIDC(h) }
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store)))
	mux.Handle("POST /addon/remove-signer", protected(routes.RemoveSigner(store)))
	return mux
}

func TestRemoveSigner_CannotRemoveTheOwner(t *testing.T) {
	t.Setenv("OIDC_BYPASS", "true")
	store := newEmulatorStore(t)
	srv := httptest.NewServer(buildRemoveSignerTestMux(store))
	t.Cleanup(srv.Close)

	docID := "remove-signer-doc-owner"
	first := do(t, srv, "POST", "/addon/create-baseline", createBaselineEvent(docID, "My Doc"), "owner@example.com")
	assertStatus(t, first, http.StatusOK)
	readJSON(t, first) // drain

	removeEv := map[string]any{
		"commonEventObject": map[string]any{
			"parameters": map[string]string{"docId": docID, "signerEmail": "owner@example.com"},
		},
	}
	resp := do(t, srv, "POST", "/addon/remove-signer", removeEv, "owner@example.com")
	assertStatus(t, resp, http.StatusOK)
	readJSON(t, resp) // drain (an error card, but still 200 — action callbacks don't use HTTP status for app errors)

	signer, err := store.GetSigner(context.Background(), docID, "owner@example.com")
	if err != nil {
		t.Fatalf("owner's signer record should still exist after a rejected removal, GetSigner: %v", err)
	}
	if signer.Status != "pending" {
		t.Errorf("owner's signer record should be untouched, got status %q", signer.Status)
	}
}
