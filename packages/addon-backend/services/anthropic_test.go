package services_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/doc-align/addon-backend/services"
)

// mockAnthropicServer spins up a server that returns a tool_use content block
// built from calling toolInput(). Requests are captured for shape assertions.
func mockAnthropicServer(t *testing.T, toolInput func(reqBody map[string]any) map[string]any) (*httptest.Server, *map[string]any) {
	t.Helper()
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&captured)
		input := toolInput(captured)
		inputJSON, _ := json.Marshal(input)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"stop_reason": "tool_use",
			"content": []map[string]any{
				{"type": "tool_use", "name": "record_prd_completeness", "input": json.RawMessage(inputJSON)},
			},
		})
	}))
	t.Cleanup(srv.Close)
	return srv, &captured
}

func TestAnthropicClient_ClassifyPRDCompleteness(t *testing.T) {
	t.Run("both fields found", func(t *testing.T) {
		srv, _ := mockAnthropicServer(t, func(_ map[string]any) map[string]any {
			return map[string]any{
				"press_release_found":      true,
				"press_release_text":       "We're building X because Y.",
				"definition_of_done_found": true,
				"definition_of_done_text":  "Demo: 5 customers using X daily.",
			}
		})
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		result, err := services.NewAnthropicClient("test-key").ClassifyPRDCompleteness(context.Background(), "some PRD text")
		if err != nil {
			t.Fatalf("ClassifyPRDCompleteness: %v", err)
		}
		if !result.PressReleaseFound || result.PressReleaseText != "We're building X because Y." {
			t.Errorf("press release: got found=%v text=%q", result.PressReleaseFound, result.PressReleaseText)
		}
		if !result.DefinitionOfDoneFound || result.DefinitionOfDoneText != "Demo: 5 customers using X daily." {
			t.Errorf("DoD: got found=%v text=%q", result.DefinitionOfDoneFound, result.DefinitionOfDoneText)
		}
	})

	t.Run("partial: one field missing", func(t *testing.T) {
		srv, _ := mockAnthropicServer(t, func(_ map[string]any) map[string]any {
			return map[string]any{
				"press_release_found":      true,
				"press_release_text":       "We're building X.",
				"definition_of_done_found": false,
				"definition_of_done_text":  "",
			}
		})
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		result, err := services.NewAnthropicClient("test-key").ClassifyPRDCompleteness(context.Background(), "some PRD text")
		if err != nil {
			t.Fatalf("ClassifyPRDCompleteness: %v", err)
		}
		if result.DefinitionOfDoneFound || result.DefinitionOfDoneText != "" {
			t.Errorf("DoD should be reported missing with no fabricated text, got found=%v text=%q", result.DefinitionOfDoneFound, result.DefinitionOfDoneText)
		}
	})

	t.Run("request carries doc text and forces the tool", func(t *testing.T) {
		srv, captured := mockAnthropicServer(t, func(_ map[string]any) map[string]any {
			return map[string]any{"press_release_found": false, "press_release_text": "", "definition_of_done_found": false, "definition_of_done_text": ""}
		})
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		_, err := services.NewAnthropicClient("test-key").ClassifyPRDCompleteness(context.Background(), "unique-marker-text-12345")
		if err != nil {
			t.Fatalf("ClassifyPRDCompleteness: %v", err)
		}
		req := *captured
		if req["model"] != "claude-haiku-4-5" {
			t.Errorf("model: got %v, want claude-haiku-4-5", req["model"])
		}
		msgs, _ := req["messages"].([]any)
		if len(msgs) != 1 {
			t.Fatalf("expected exactly 1 message, got %d", len(msgs))
		}
		firstMsg, _ := msgs[0].(map[string]any)
		if !strings.Contains(firstMsg["content"].(string), "unique-marker-text-12345") {
			t.Errorf("expected doc text in message content, got %v", firstMsg["content"])
		}
		toolChoice, _ := req["tool_choice"].(map[string]any)
		if toolChoice["type"] != "tool" || toolChoice["name"] != "record_prd_completeness" {
			t.Errorf("expected forced tool_choice for record_prd_completeness, got %v", toolChoice)
		}
	})

	t.Run("errors on non-2xx status", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":{"message":"invalid x-api-key"}}`))
		}))
		t.Cleanup(srv.Close)
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		_, err := services.NewAnthropicClient("bad-key").ClassifyPRDCompleteness(context.Background(), "text")
		if err == nil {
			t.Fatal("expected error for 401 response")
		}
		if !strings.Contains(err.Error(), "401") {
			t.Errorf("error should mention 401, got: %v", err)
		}
	})

	t.Run("errors on refusal stop reason", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"stop_reason": "refusal", "content": []any{}})
		}))
		t.Cleanup(srv.Close)
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		_, err := services.NewAnthropicClient("test-key").ClassifyPRDCompleteness(context.Background(), "text")
		if err == nil {
			t.Fatal("expected error on refusal stop_reason")
		}
	})

	t.Run("errors when no tool_use block present", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"stop_reason": "end_turn",
				"content":     []map[string]any{{"type": "text", "text": "no tool call here"}},
			})
		}))
		t.Cleanup(srv.Close)
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		_, err := services.NewAnthropicClient("test-key").ClassifyPRDCompleteness(context.Background(), "text")
		if err == nil {
			t.Fatal("expected error when response has no tool_use block")
		}
	})

	t.Run("empty API key errors immediately without an HTTP call", func(t *testing.T) {
		called := false
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			called = true
			w.WriteHeader(http.StatusOK)
		}))
		t.Cleanup(srv.Close)
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		_, err := services.NewAnthropicClient("").ClassifyPRDCompleteness(context.Background(), "text")
		if err == nil {
			t.Fatal("expected error for empty API key")
		}
		if called {
			t.Error("expected no HTTP call to be made with an empty API key")
		}
	})

	t.Run("honors caller context deadline", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(200 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
		}))
		t.Cleanup(srv.Close)
		defer services.SetAnthropicAPIURLForTest(srv.URL)()

		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()
		start := time.Now()
		_, err := services.NewAnthropicClient("test-key").ClassifyPRDCompleteness(ctx, "text")
		if err == nil {
			t.Fatal("expected context deadline error")
		}
		if time.Since(start) > 150*time.Millisecond {
			t.Errorf("call should have returned promptly on context deadline, took %v", time.Since(start))
		}
	})
}
