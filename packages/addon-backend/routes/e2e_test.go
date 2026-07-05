// E2E tests for the ticket integration HTTP layer.
//
// Requirements:
//   - Firestore emulator: FIRESTORE_EMULATOR_HOST=localhost:8080 (tests skip if unset)
//   - Firestore emulator can be started with: firebase emulators:start --only firestore
//   - OIDC is bypassed via OIDC_BYPASS=true (set automatically by the test)
//
// Run:
//
//	FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestE2E -v
package routes_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/option"

	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/routes"
	"github.com/doc-align/addon-backend/services"
)

// ---- test infrastructure ----

func newEmulatorStore(t *testing.T) *services.Store {
	t.Helper()
	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		t.Skip("FIRESTORE_EMULATOR_HOST not set — skipping E2E tests (start with: firebase emulators:start --only firestore)")
	}
	client, err := firestore.NewClient(context.Background(), "test-project",
		option.WithoutAuthentication())
	if err != nil {
		t.Fatalf("firestore.NewClient: %v", err)
	}
	t.Cleanup(func() { client.Close() })
	return services.NewStore(client)
}

// mockLinearHandler returns an http.Handler that serves canned Linear GraphQL responses.
// It dispatches on keywords in the query string.
func mockLinearHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		w.Header().Set("Content-Type", "application/json")

		var data any
		switch {
		case strings.Contains(req.Query, "viewer"):
			data = map[string]any{"viewer": map[string]any{"email": "linear-user@example.com"}}
		case strings.Contains(req.Query, "teams"):
			data = map[string]any{"teams": map[string]any{"nodes": []map[string]any{
				{"id": "team-eng", "name": "Engineering"},
			}}}
		case strings.Contains(req.Query, "issueCreate"):
			input, _ := req.Variables["input"].(map[string]any)
			title, _ := input["title"].(string)
			data = map[string]any{"issueCreate": map[string]any{
				"success": true,
				"issue": map[string]any{
					"id":          "issue-e2e-1",
					"title":       title,
					"description": "",
					"url":         "https://linear.app/eng/issue/ENG-1",
				},
			}}
		case strings.Contains(req.Query, "issueUpdate"):
			data = map[string]any{"issueUpdate": map[string]any{
				"success": true,
				"issue": map[string]any{
					"id":          "issue-e2e-1",
					"title":       "Updated title",
					"description": "Updated description",
					"url":         "https://linear.app/eng/issue/ENG-1",
				},
			}}
		case strings.Contains(req.Query, "issueArchive"):
			data = map[string]any{"issueArchive": map[string]any{"success": true}}
		case strings.Contains(req.Query, "issue"):
			data = map[string]any{"issue": map[string]any{
				"id":          "issue-e2e-1",
				"title":       "E2E test issue",
				"description": "",
				"url":         "https://linear.app/eng/issue/ENG-1",
			}}
		}
		json.NewEncoder(w).Encode(map[string]any{"data": data})
	})
}

func buildTestMux(store *services.Store) *http.ServeMux {
	mux := http.NewServeMux()
	protectedREST := func(h http.HandlerFunc) http.Handler { return middleware.VerifyOIDCREST(h) }

	mux.Handle("POST /integrations/{provider}/connect",  protectedREST(routes.IntegrationConnect(store)))
	mux.Handle("GET /integrations/{provider}/config",    protectedREST(routes.IntegrationGetConfig(store)))
	mux.Handle("DELETE /integrations/{provider}/config", protectedREST(routes.IntegrationDisconnect(store)))
	mux.Handle("POST /docs/{docID}/tickets",              protectedREST(routes.CreateTicket(store)))
	mux.Handle("GET /docs/{docID}/tickets",               protectedREST(routes.ListTickets(store)))
	mux.Handle("GET /docs/{docID}/tickets/{ticketID}",    protectedREST(routes.GetTicket(store)))
	mux.Handle("PATCH /docs/{docID}/tickets/{ticketID}",  protectedREST(routes.UpdateTicket(store)))
	mux.Handle("DELETE /docs/{docID}/tickets/{ticketID}", protectedREST(routes.DeleteTicket(store)))
	return mux
}

// do sends an authenticated REST request to the test server.
func do(t *testing.T, srv *httptest.Server, method, path string, body any, userEmail string) *http.Response {
	t.Helper()
	var bodyReader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, srv.URL+path, bodyReader)
	if err != nil {
		t.Fatalf("NewRequest %s %s: %v", method, path, err)
	}
	req.Header.Set("Authorization", "Bearer dummy")
	req.Header.Set("X-Debug-Email", userEmail)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request %s %s: %v", method, path, err)
	}
	return resp
}

func readJSON(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	return result
}

func assertStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("status: got %d, want %d — body: %s", resp.StatusCode, want, body)
	}
}

// ---- tests ----

// TestE2E_FullTicketLifecycle exercises the full integration lifecycle:
// connect → get config → create ticket → list → get → update → delete → disconnect.
func TestE2E_FullTicketLifecycle(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")

	linearSrv := httptest.NewServer(mockLinearHandler())
	t.Cleanup(linearSrv.Close)
	defer services.SetLinearAPIURLForTest(linearSrv.URL)()

	srv := httptest.NewServer(buildTestMux(store))
	t.Cleanup(srv.Close)

	ownerEmail := "owner-e2e@example.com"
	docID := "doc-e2e-happy-" + t.Name()

	// Pre-create a doc record so CreateTicket can verify ownership.
	if err := store.CreateDoc(context.Background(), docID, services.DocRecord{
		Title:   "E2E Test Doc",
		OwnerID: ownerEmail,
	}); err != nil {
		t.Fatalf("setup CreateDoc: %v", err)
	}

	// 1. Connect Linear.
	resp := do(t, srv, "POST", "/integrations/linear/connect",
		map[string]any{"apiKey": "lin_api_test"}, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	body := readJSON(t, resp)
	if body["viewerEmail"] != "linear-user@example.com" {
		t.Errorf("connect: viewerEmail=%v", body["viewerEmail"])
	}
	if body["connected"] != nil {
		t.Errorf("connect response should not include 'connected' field")
	}

	// 2. Get config — should be connected and return teams.
	resp = do(t, srv, "GET", "/integrations/linear/config", nil, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	body = readJSON(t, resp)
	if body["connected"] != true {
		t.Errorf("config: connected=%v, want true", body["connected"])
	}
	teams, _ := body["teams"].([]any)
	if len(teams) != 1 {
		t.Errorf("config: got %d teams, want 1", len(teams))
	}

	// 3. Create ticket — owner creates a Linear issue linked to the doc.
	resp = do(t, srv, "POST", "/docs/"+docID+"/tickets", map[string]any{
		"provider":    "linear",
		"teamId":      "team-eng",
		"title":       "Review sign-off for E2E Test Doc",
		"description": "Please review and sign",
	}, ownerEmail)
	assertStatus(t, resp, http.StatusCreated)
	ticket := readJSON(t, resp)
	ticketID, _ := ticket["id"].(string)
	if ticketID == "" {
		t.Fatal("create: response missing 'id'")
	}
	if ticket["provider"] != "linear" {
		t.Errorf("create: provider=%v, want linear", ticket["provider"])
	}
	if ticket["externalId"] != "issue-e2e-1" {
		t.Errorf("create: externalId=%v, want issue-e2e-1", ticket["externalId"])
	}
	if ticket["externalUrl"] != "https://linear.app/eng/issue/ENG-1" {
		t.Errorf("create: externalUrl=%v", ticket["externalUrl"])
	}

	// 4. List tickets — should include the created ticket.
	resp = do(t, srv, "GET", "/docs/"+docID+"/tickets", nil, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	list := readJSON(t, resp)
	tickets, _ := list["tickets"].([]any)
	if len(tickets) != 1 {
		t.Fatalf("list: got %d tickets, want 1", len(tickets))
	}

	// 5. List tickets filtered by provider.
	resp = do(t, srv, "GET", "/docs/"+docID+"/tickets?provider=linear", nil, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	list = readJSON(t, resp)
	tickets, _ = list["tickets"].([]any)
	if len(tickets) != 1 {
		t.Errorf("list?provider=linear: got %d tickets, want 1", len(tickets))
	}

	// 6. List tickets filtered by unknown provider — should return empty.
	resp = do(t, srv, "GET", "/docs/"+docID+"/tickets?provider=jira", nil, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	list = readJSON(t, resp)
	tickets, _ = list["tickets"].([]any)
	if len(tickets) != 0 {
		t.Errorf("list?provider=jira: got %d tickets, want 0", len(tickets))
	}

	// 7. Get ticket by ID.
	resp = do(t, srv, "GET", "/docs/"+docID+"/tickets/"+ticketID, nil, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	got := readJSON(t, resp)
	if got["id"] != ticketID {
		t.Errorf("get: id=%v, want %s", got["id"], ticketID)
	}

	// 8. Update ticket.
	resp = do(t, srv, "PATCH", "/docs/"+docID+"/tickets/"+ticketID, map[string]any{
		"title":       "Updated title",
		"description": "Updated description",
	}, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	updated := readJSON(t, resp)
	if updated["title"] != "Updated title" {
		t.Errorf("update: title=%v, want 'Updated title'", updated["title"])
	}

	// 9. Delete ticket — archives in Linear and removes from Firestore.
	resp = do(t, srv, "DELETE", "/docs/"+docID+"/tickets/"+ticketID, nil, ownerEmail)
	assertStatus(t, resp, http.StatusNoContent)

	// Verify it's gone from Firestore.
	resp = do(t, srv, "GET", "/docs/"+docID+"/tickets/"+ticketID, nil, ownerEmail)
	assertStatus(t, resp, http.StatusNotFound)

	// 10. Disconnect — removes the integration config.
	resp = do(t, srv, "DELETE", "/integrations/linear/config", nil, ownerEmail)
	assertStatus(t, resp, http.StatusNoContent)

	// Verify disconnected.
	resp = do(t, srv, "GET", "/integrations/linear/config", nil, ownerEmail)
	assertStatus(t, resp, http.StatusOK)
	body = readJSON(t, resp)
	if body["connected"] != false {
		t.Errorf("after disconnect: connected=%v, want false", body["connected"])
	}
}

func TestE2E_CreateTicket_NonOwnerIsForbidden(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")

	linearSrv := httptest.NewServer(mockLinearHandler())
	t.Cleanup(linearSrv.Close)
	defer services.SetLinearAPIURLForTest(linearSrv.URL)()

	srv := httptest.NewServer(buildTestMux(store))
	t.Cleanup(srv.Close)

	ownerEmail := "owner-forbidden@example.com"
	signerEmail := "signer-forbidden@example.com"
	docID := "doc-e2e-forbidden-" + t.Name()

	if err := store.CreateDoc(context.Background(), docID, services.DocRecord{
		Title:   "Forbidden Test Doc",
		OwnerID: ownerEmail,
	}); err != nil {
		t.Fatalf("setup CreateDoc: %v", err)
	}

	// Connect Linear as the signer (so the auth check is not the blocker).
	do(t, srv, "POST", "/integrations/linear/connect",
		map[string]any{"apiKey": "lin_api_test"}, signerEmail)

	resp := do(t, srv, "POST", "/docs/"+docID+"/tickets", map[string]any{
		"provider": "linear",
		"teamId":   "team-eng",
		"title":    "Should be rejected",
	}, signerEmail)
	assertStatus(t, resp, http.StatusForbidden)
}

func TestE2E_Connect_UnknownProviderIsBadRequest(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")

	srv := httptest.NewServer(buildTestMux(store))
	t.Cleanup(srv.Close)

	resp := do(t, srv, "POST", "/integrations/slack/connect",
		map[string]any{"apiKey": "xoxb-test"}, "user@example.com")
	assertStatus(t, resp, http.StatusBadRequest)
	body := readJSON(t, resp)
	if !strings.Contains(body["error"].(string), "unknown provider") {
		t.Errorf("error should mention 'unknown provider', got: %v", body["error"])
	}
}

func TestE2E_GetTicket_MissingIDIsNotFound(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")

	srv := httptest.NewServer(buildTestMux(store))
	t.Cleanup(srv.Close)

	resp := do(t, srv, "GET", "/docs/nonexistent-doc/tickets/nonexistent-ticket", nil, "user@example.com")
	assertStatus(t, resp, http.StatusNotFound)
}

func TestE2E_CreateTicket_DisconnectedProviderIsBadRequest(t *testing.T) {
	store := newEmulatorStore(t)
	t.Setenv("OIDC_BYPASS", "true")

	linearSrv := httptest.NewServer(mockLinearHandler())
	t.Cleanup(linearSrv.Close)
	defer services.SetLinearAPIURLForTest(linearSrv.URL)()

	srv := httptest.NewServer(buildTestMux(store))
	t.Cleanup(srv.Close)

	ownerEmail := "owner-noconfig@example.com"
	docID := "doc-e2e-noconfig-" + t.Name()

	if err := store.CreateDoc(context.Background(), docID, services.DocRecord{
		Title:   "No Config Doc",
		OwnerID: ownerEmail,
	}); err != nil {
		t.Fatalf("setup CreateDoc: %v", err)
	}

	// Do NOT connect Linear — attempt to create a ticket without connecting first.
	resp := do(t, srv, "POST", "/docs/"+docID+"/tickets", map[string]any{
		"provider": "linear",
		"teamId":   "team-eng",
		"title":    "Should fail",
	}, ownerEmail)
	assertStatus(t, resp, http.StatusBadRequest)
	body := readJSON(t, resp)
	if !strings.Contains(body["error"].(string), "not connected") {
		t.Errorf("error should mention 'not connected', got: %v", body["error"])
	}
}
