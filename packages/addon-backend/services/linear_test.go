package services_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/doc-align/addon-backend/services"
)

// mockLinearServer spins up a test HTTP server whose response is determined by
// calling handler(query, variables). handler returns the value for the "data" key.
func mockLinearServer(t *testing.T, handler func(query string, vars map[string]any) any) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"data": handler(req.Query, req.Variables)})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestLinearClient_GetViewer(t *testing.T) {
	t.Run("returns email from viewer claim", func(t *testing.T) {
		srv := mockLinearServer(t, func(_ string, _ map[string]any) any {
			return map[string]any{"viewer": map[string]any{"email": "dev@example.com"}}
		})
		defer services.SetLinearAPIURLForTest(srv.URL)()

		email, err := services.NewLinearClient("test-key").GetViewer(context.Background())
		if err != nil {
			t.Fatalf("GetViewer: %v", err)
		}
		if email != "dev@example.com" {
			t.Errorf("got %q, want dev@example.com", email)
		}
	})

	t.Run("errors on 401 unauthorized", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		t.Cleanup(srv.Close)
		defer services.SetLinearAPIURLForTest(srv.URL)()

		_, err := services.NewLinearClient("bad-key").GetViewer(context.Background())
		if err == nil {
			t.Fatal("expected error for 401 response")
		}
		if !strings.Contains(err.Error(), "401") {
			t.Errorf("error should mention 401, got: %v", err)
		}
	})

	t.Run("propagates graphql error message", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"errors": []map[string]any{{"message": "not authorized"}},
			})
		}))
		t.Cleanup(srv.Close)
		defer services.SetLinearAPIURLForTest(srv.URL)()

		_, err := services.NewLinearClient("test-key").GetViewer(context.Background())
		if err == nil {
			t.Fatal("expected error for graphql errors response")
		}
		if !strings.Contains(err.Error(), "not authorized") {
			t.Errorf("error should contain 'not authorized', got: %v", err)
		}
	})
}

func TestLinearClient_ListTeams_ReturnsAllTeams(t *testing.T) {
	srv := mockLinearServer(t, func(_ string, _ map[string]any) any {
		return map[string]any{
			"teams": map[string]any{
				"nodes": []map[string]any{
					{"id": "team-1", "name": "Engineering"},
					{"id": "team-2", "name": "Design"},
				},
			},
		}
	})
	defer services.SetLinearAPIURLForTest(srv.URL)()

	teams, err := services.NewLinearClient("test-key").ListTeams(context.Background())
	if err != nil {
		t.Fatalf("ListTeams: %v", err)
	}
	if len(teams) != 2 {
		t.Fatalf("got %d teams, want 2", len(teams))
	}
	if teams[0].ID != "team-1" || teams[0].Name != "Engineering" {
		t.Errorf("team[0]: got %+v", teams[0])
	}
	if teams[1].ID != "team-2" || teams[1].Name != "Design" {
		t.Errorf("team[1]: got %+v", teams[1])
	}
}

func TestLinearClient_CreateIssue(t *testing.T) {
	t.Run("returns created issue with echoed title and url", func(t *testing.T) {
		srv := mockLinearServer(t, func(_ string, vars map[string]any) any {
			input, _ := vars["input"].(map[string]any)
			return map[string]any{
				"issueCreate": map[string]any{
					"success": true,
					"issue": map[string]any{
						"id":          "issue-abc",
						"title":       input["title"],
						"description": input["description"],
						"url":         "https://linear.app/eng/issue/ENG-1",
					},
				},
			}
		})
		defer services.SetLinearAPIURLForTest(srv.URL)()

		issue, err := services.NewLinearClient("test-key").CreateIssue(
			context.Background(), "team-1", "Sign-off required", "Please review",
		)
		if err != nil {
			t.Fatalf("CreateIssue: %v", err)
		}
		if issue.ID != "issue-abc" {
			t.Errorf("ID: got %q, want issue-abc", issue.ID)
		}
		if issue.Title != "Sign-off required" {
			t.Errorf("Title: got %q", issue.Title)
		}
		if issue.URL != "https://linear.app/eng/issue/ENG-1" {
			t.Errorf("URL: got %q", issue.URL)
		}
	})

	t.Run("errors when success is false", func(t *testing.T) {
		srv := mockLinearServer(t, func(_ string, _ map[string]any) any {
			return map[string]any{
				"issueCreate": map[string]any{"success": false, "issue": nil},
			}
		})
		defer services.SetLinearAPIURLForTest(srv.URL)()

		_, err := services.NewLinearClient("test-key").CreateIssue(context.Background(), "team-1", "title", "")
		if err == nil {
			t.Fatal("expected error when success=false")
		}
	})
}

func TestLinearClient_GetIssue_ReturnsIssueByID(t *testing.T) {
	srv := mockLinearServer(t, func(_ string, _ map[string]any) any {
		return map[string]any{
			"issue": map[string]any{
				"id":          "issue-abc",
				"title":       "Sign-off required",
				"description": "Please review",
				"url":         "https://linear.app/eng/issue/ENG-1",
			},
		}
	})
	defer services.SetLinearAPIURLForTest(srv.URL)()

	issue, err := services.NewLinearClient("test-key").GetIssue(context.Background(), "issue-abc")
	if err != nil {
		t.Fatalf("GetIssue: %v", err)
	}
	if issue.ID != "issue-abc" {
		t.Errorf("ID: got %q, want issue-abc", issue.ID)
	}
}

func TestLinearClient_UpdateIssue_ReturnsUpdatedFields(t *testing.T) {
	srv := mockLinearServer(t, func(_ string, _ map[string]any) any {
		return map[string]any{
			"issueUpdate": map[string]any{
				"success": true,
				"issue": map[string]any{
					"id":          "issue-abc",
					"title":       "Updated title",
					"description": "",
					"url":         "https://linear.app/eng/issue/ENG-1",
				},
			},
		}
	})
	defer services.SetLinearAPIURLForTest(srv.URL)()

	issue, err := services.NewLinearClient("test-key").UpdateIssue(context.Background(), "issue-abc", "Updated title", "")
	if err != nil {
		t.Fatalf("UpdateIssue: %v", err)
	}
	if issue.Title != "Updated title" {
		t.Errorf("Title: got %q, want 'Updated title'", issue.Title)
	}
}

func TestLinearClient_ArchiveIssue(t *testing.T) {
	t.Run("succeeds for valid issue id", func(t *testing.T) {
		srv := mockLinearServer(t, func(_ string, _ map[string]any) any {
			return map[string]any{"issueArchive": map[string]any{"success": true}}
		})
		defer services.SetLinearAPIURLForTest(srv.URL)()

		if err := services.NewLinearClient("test-key").ArchiveIssue(context.Background(), "issue-abc"); err != nil {
			t.Fatalf("ArchiveIssue: %v", err)
		}
	})

	t.Run("errors when success is false", func(t *testing.T) {
		srv := mockLinearServer(t, func(_ string, _ map[string]any) any {
			return map[string]any{"issueArchive": map[string]any{"success": false}}
		})
		defer services.SetLinearAPIURLForTest(srv.URL)()

		if err := services.NewLinearClient("test-key").ArchiveIssue(context.Background(), "issue-abc"); err == nil {
			t.Fatal("expected error when success=false")
		}
	})
}
