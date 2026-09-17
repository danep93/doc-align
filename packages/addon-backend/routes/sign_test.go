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
