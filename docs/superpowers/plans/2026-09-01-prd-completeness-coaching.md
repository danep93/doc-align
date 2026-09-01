# PRD Completeness Coaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before a PRD's first signature is collected, check the doc for a Press Release (what/why) and a Definition of Done, coach the owner to fill any gaps inline, and persist the result — without ever blocking on the check itself.

**Architecture:** A new hand-rolled Anthropic HTTP client classifies the two fields from doc text already being fetched today for drift detection. A pure decision function turns that classification (or its absence, on any failure) into a persisted result and a needs-coaching flag. `CreateBaseline` runs this once, on first baseline creation only, and either proceeds straight to `AddSigners` (both found) or pushes a new `PRDCoaching` card whose "Continue" button (`/addon/coach-resolve`) merges manual entries with whatever was found and then proceeds.

**Tech Stack:** Go 1.22, `net/http` (no Anthropic SDK — this repo hand-rolls every external API client), Firestore, Google Card Service JSON.

**Spec:** `docs/superpowers/specs/2026-09-01-prd-completeness-coaching-design.md`

## Global Constraints

- Model: `claude-haiku-4-5` — this is a bounded classification+extraction task, not general reasoning; cheapest capable tier.
- Hand-rolled `net/http` client, not `anthropic-sdk-go` — matches `services/linear.go` and `services/email.go`, the only two existing external-API clients in this repo. Do not add the SDK as a dependency.
- Single shared `ANTHROPIC_API_KEY` (env var, fallback to Firestore `config/secrets.anthropicApiKey`) — no per-org bring-your-own-key/model in this round.
- Full document text is never persisted. Only the two extracted snippets (Press Release / Definition of Done text) are stored.
- The coaching check runs **once**, on genuinely first-time baseline creation only. Re-running "Create baseline" on a doc that already exists must never re-run the check or touch an existing `coachingResult`.
- The owner must always be able to proceed by typing both fields manually — the flow must never require the LLM to be reachable.
- Action-callback routes (anything reached by a button click) must return `RenderActions` via `cards.Push`/`cards.Update`, never a bare `Card` — this is a documented footgun in this codebase.
- Use `matIcon(...)` (material icon), never `knownIcon(...)` — the known-icon enum is broken for several icon names in the current Card Service runtime.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/addon-backend/services/anthropic.go` (new) | Hand-rolled Anthropic Messages API client; classifies doc text into the two fields via forced tool use. |
| `packages/addon-backend/services/anthropic_test.go` (new) | Unit tests for the client against a mock HTTP server. |
| `packages/addon-backend/services/prd_coaching.go` (new) | Pure decision function bridging the client's raw output to what gets persisted/rendered. |
| `packages/addon-backend/services/prd_coaching_test.go` (new) | Unit tests for the decision function (no I/O). |
| `packages/addon-backend/services/firestore.go` (modify) | Add `PRDCoachingResult` struct, `CoachingResult` field on `DocRecord`, generic `UpdateDocFields` helper. |
| `packages/addon-backend/cards/coaching.go` (new) | `PRDCoaching` card builder (status display, inline capture for gaps, override-by-continuing). |
| `packages/addon-backend/cards/coaching_test.go` (new) | Unit tests for the card builder's branching. |
| `packages/addon-backend/routes/create_baseline.go` (modify) | Wire in the once-only coaching check between baseline creation and showing `AddSigners`. |
| `packages/addon-backend/routes/coach_resolve.go` (new) | Handles the coaching card's "Continue" submission. |
| `packages/addon-backend/routes/coaching_e2e_test.go` (new) | Firestore-emulator-backed end-to-end tests for the new route wiring. |
| `packages/addon-backend/main.go` (modify) | Load `ANTHROPIC_API_KEY`, construct the client, register `/addon/coach-resolve`, pass the client into `CreateBaseline`. |
| `packages/addon-backend/.env.example` (modify) | Document the optional `ANTHROPIC_API_KEY` override. |

**Testing scope note:** `services.FetchDocText` and the other Drive-API calls `CreateBaseline` already uses (`LatestRevisionID`, `FileModifiedTime`, `ListFilePermissions`) have no test-mode hook anywhere in this codebase today — the existing test suite never exercises a route that touches live Drive APIs. This plan doesn't add one either (that's a bigger, separate undertaking than this feature). Instead: the classification client (Task 1) and the decision logic (Task 2) are fully unit-tested in isolation with mocks, and the end-to-end test (Task 6) exercises `CreateBaseline`'s wiring using a token that can't reach Drive — which deterministically drives the code down the "check failed, fall back to manual entry" path, the same path production hits on any real Drive/Anthropic outage. That path is exactly the one that matters most to prove out, since it's the one guaranteeing the feature never blocks the owner.

---

### Task 1: Anthropic classification client

**Files:**
- Create: `packages/addon-backend/services/anthropic.go`
- Test: `packages/addon-backend/services/anthropic_test.go`

**Interfaces:**
- Produces: `services.PRDCompletenessResult{PressReleaseFound bool, PressReleaseText string, DefinitionOfDoneFound bool, DefinitionOfDoneText string}`, `services.NewAnthropicClient(apiKey string) *AnthropicClient`, `(*AnthropicClient).ClassifyPRDCompleteness(ctx context.Context, docText string) (*PRDCompletenessResult, error)`, `services.SetAnthropicAPIURLForTest(url string) func()`.

- [ ] **Step 1: Write the failing tests**

Create `packages/addon-backend/services/anthropic_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/addon-backend && go test ./services/ -run TestAnthropicClient -v`
Expected: FAIL to compile — `services.NewAnthropicClient`, `services.PRDCompletenessResult`, `services.SetAnthropicAPIURLForTest` undefined.

- [ ] **Step 3: Write the implementation**

Create `packages/addon-backend/services/anthropic.go`:

```go
package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// anthropicAPIURL is the Anthropic Messages API endpoint. Overridable for testing.
var anthropicAPIURL = "https://api.anthropic.com/v1/messages"

// SetAnthropicAPIURLForTest overrides the Anthropic API endpoint and returns a restore func.
// Only call from test code; not safe for parallel tests.
func SetAnthropicAPIURLForTest(url string) func() {
	original := anthropicAPIURL
	anthropicAPIURL = url
	return func() { anthropicAPIURL = original }
}

const (
	prdCoachModel        = "claude-haiku-4-5"
	prdCoachMaxTokens    = 2048
	prdCoachMaxDocChars  = 120_000
	prdCoachToolName     = "record_prd_completeness"
	prdCoachSystemPrompt = `You are reviewing a product/technical requirements doc (PRD) for two specific things:

1. Press Release: a clear statement of what's being built and why people should care (an Amazon-style "working backwards" framing — what changes for the user or business, not just a feature list).
2. Definition of Done: a demo description and/or success metrics that would prove the work is complete.

For each, report whether it is genuinely present (not just implied) and, if present, extract the relevant text verbatim or as a tight paraphrase. If something is absent, leave its text field empty — never fabricate content that isn't in the document.`
)

// PRDCompletenessResult is Claude's classification of a PRD's two required elements.
type PRDCompletenessResult struct {
	PressReleaseFound     bool
	PressReleaseText      string
	DefinitionOfDoneFound bool
	DefinitionOfDoneText  string
}

type AnthropicClient struct {
	apiKey     string
	httpClient *http.Client
}

func NewAnthropicClient(apiKey string) *AnthropicClient {
	return &AnthropicClient{apiKey: apiKey, httpClient: &http.Client{Timeout: 15 * time.Second}}
}

type anthropicRequest struct {
	Model      string              `json:"model"`
	MaxTokens  int                 `json:"max_tokens"`
	System     string              `json:"system,omitempty"`
	Messages   []anthropicMessage  `json:"messages"`
	Tools      []anthropicTool     `json:"tools"`
	ToolChoice anthropicToolChoice `json:"tool_choice"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema"`
}

type anthropicToolChoice struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

type anthropicResponse struct {
	StopReason string                  `json:"stop_reason"`
	Content    []anthropicContentBlock `json:"content"`
}

type anthropicContentBlock struct {
	Type  string          `json:"type"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

type prdCompletenessToolInput struct {
	PressReleaseFound     bool   `json:"press_release_found"`
	PressReleaseText      string `json:"press_release_text"`
	DefinitionOfDoneFound bool   `json:"definition_of_done_found"`
	DefinitionOfDoneText  string `json:"definition_of_done_text"`
}

// ClassifyPRDCompleteness sends docText to Claude and asks it to classify whether
// the Press Release and Definition of Done elements are present, extracting each
// when found. Any failure (missing key, network error, timeout, bad response,
// refusal, malformed tool input) is returned as an error — callers should treat
// every error identically: fall back to manual entry, never block the caller.
func (c *AnthropicClient) ClassifyPRDCompleteness(ctx context.Context, docText string) (*PRDCompletenessResult, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("anthropic: ANTHROPIC_API_KEY not set")
	}

	if len(docText) > prdCoachMaxDocChars {
		docText = docText[:prdCoachMaxDocChars]
	}

	reqBody := anthropicRequest{
		Model:     prdCoachModel,
		MaxTokens: prdCoachMaxTokens,
		System:    prdCoachSystemPrompt,
		Messages:  []anthropicMessage{{Role: "user", Content: docText}},
		Tools: []anthropicTool{{
			Name:        prdCoachToolName,
			Description: "Record whether the Press Release and Definition of Done are present in the document, and their text if so.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"press_release_found":      map[string]any{"type": "boolean"},
					"press_release_text":       map[string]any{"type": "string"},
					"definition_of_done_found": map[string]any{"type": "boolean"},
					"definition_of_done_text":  map[string]any{"type": "string"},
				},
				"required": []string{"press_release_found", "press_release_text", "definition_of_done_found", "definition_of_done_text"},
			},
		}},
		ToolChoice: anthropicToolChoice{Type: "tool", Name: prdCoachToolName},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("anthropic: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicAPIURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("anthropic: build request: %w", err)
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("anthropic: http: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("anthropic: read body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("anthropic: HTTP %d: %s", resp.StatusCode, string(raw))
	}

	var parsed anthropicResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("anthropic: unmarshal response: %w", err)
	}
	if parsed.StopReason == "refusal" {
		return nil, fmt.Errorf("anthropic: model refused to classify")
	}

	for _, block := range parsed.Content {
		if block.Type != "tool_use" || block.Name != prdCoachToolName {
			continue
		}
		var input prdCompletenessToolInput
		if err := json.Unmarshal(block.Input, &input); err != nil {
			return nil, fmt.Errorf("anthropic: unmarshal tool input: %w", err)
		}
		return &PRDCompletenessResult{
			PressReleaseFound:     input.PressReleaseFound,
			PressReleaseText:      input.PressReleaseText,
			DefinitionOfDoneFound: input.DefinitionOfDoneFound,
			DefinitionOfDoneText:  input.DefinitionOfDoneText,
		}, nil
	}

	return nil, fmt.Errorf("anthropic: no tool_use block found in response")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/addon-backend && go test ./services/ -run TestAnthropicClient -v`
Expected: PASS (all subtests).

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/services/anthropic.go packages/addon-backend/services/anthropic_test.go
git commit -m "feat(addon-backend): add Anthropic client for PRD completeness classification"
```

---

### Task 2: Coaching decision logic + Firestore schema

**Files:**
- Create: `packages/addon-backend/services/prd_coaching.go`
- Test: `packages/addon-backend/services/prd_coaching_test.go`
- Modify: `packages/addon-backend/services/firestore.go`

**Interfaces:**
- Consumes: `services.PRDCompletenessResult` (Task 1).
- Produces: `services.PRDCoachingResult{PressReleasePresent bool, PressReleaseText string, PressReleaseSource string, DoDPresent bool, DoDText string, DoDSource string, ResolvedAt time.Time, ResolvedBy string}`, `services.EvaluateCoaching(result *PRDCompletenessResult, callErr error, resolvedBy string) (coaching PRDCoachingResult, needsCoaching bool)`, `(*Store).UpdateDocFields(ctx context.Context, docID string, fields map[string]any) error`. `DocRecord` gains `CoachingResult *PRDCoachingResult`.

- [ ] **Step 1: Write the failing tests**

Create `packages/addon-backend/services/prd_coaching_test.go`:

```go
package services_test

import (
	"fmt"
	"testing"

	"github.com/doc-align/addon-backend/services"
)

func TestEvaluateCoaching(t *testing.T) {
	t.Run("both found: fully resolved, no coaching needed", func(t *testing.T) {
		result := &services.PRDCompletenessResult{
			PressReleaseFound: true, PressReleaseText: "PR text",
			DefinitionOfDoneFound: true, DefinitionOfDoneText: "DoD text",
		}
		coaching, needsCoaching := services.EvaluateCoaching(result, nil, "owner@example.com")
		if needsCoaching {
			t.Error("expected needsCoaching=false when both fields found")
		}
		if !coaching.PressReleasePresent || coaching.PressReleaseText != "PR text" || coaching.PressReleaseSource != "llm" {
			t.Errorf("press release: got %+v", coaching)
		}
		if !coaching.DoDPresent || coaching.DoDText != "DoD text" || coaching.DoDSource != "llm" {
			t.Errorf("DoD: got %+v", coaching)
		}
		if coaching.ResolvedBy != "owner@example.com" || coaching.ResolvedAt.IsZero() {
			t.Errorf("expected resolution stamped when fully resolved, got %+v", coaching)
		}
	})

	t.Run("one missing: needs coaching, found field marked llm, missing field blank", func(t *testing.T) {
		result := &services.PRDCompletenessResult{
			PressReleaseFound: true, PressReleaseText: "PR text",
			DefinitionOfDoneFound: false, DefinitionOfDoneText: "",
		}
		coaching, needsCoaching := services.EvaluateCoaching(result, nil, "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true when one field missing")
		}
		if !coaching.PressReleasePresent || coaching.PressReleaseSource != "llm" {
			t.Errorf("press release should be marked found via llm, got %+v", coaching)
		}
		if coaching.DoDPresent || coaching.DoDSource != "" || coaching.DoDText != "" {
			t.Errorf("DoD should be blank/unresolved, got %+v", coaching)
		}
		if !coaching.ResolvedAt.IsZero() {
			t.Error("resolution metadata should not be stamped until fully resolved")
		}
	})

	t.Run("both missing: needs coaching", func(t *testing.T) {
		result := &services.PRDCompletenessResult{}
		coaching, needsCoaching := services.EvaluateCoaching(result, nil, "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true when both fields missing")
		}
		if coaching.PressReleasePresent || coaching.DoDPresent {
			t.Errorf("expected both unpresent, got %+v", coaching)
		}
	})

	t.Run("classification error: needs coaching, zero-value result", func(t *testing.T) {
		coaching, needsCoaching := services.EvaluateCoaching(nil, fmt.Errorf("boom"), "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true on classification error")
		}
		if coaching.PressReleasePresent || coaching.DoDPresent || coaching.PressReleaseSource != "" || coaching.DoDSource != "" {
			t.Errorf("expected zero-value coaching result on error, got %+v", coaching)
		}
	})

	t.Run("nil result with no error is treated as failure defensively", func(t *testing.T) {
		_, needsCoaching := services.EvaluateCoaching(nil, nil, "owner@example.com")
		if !needsCoaching {
			t.Error("expected needsCoaching=true when result is nil, regardless of err")
		}
	})
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/addon-backend && go test ./services/ -run TestEvaluateCoaching -v`
Expected: FAIL to compile — `services.EvaluateCoaching`, `services.PRDCoachingResult` undefined.

- [ ] **Step 3: Write the implementation**

Add to `packages/addon-backend/services/firestore.go` — insert the new struct after `ChangeSection` (after line 35) and add the field to `DocRecord`:

```go
// In DocRecord, add this field after ChangeSummary:
	CoachingResult        *PRDCoachingResult `firestore:"coachingResult"`
```

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

Add this method at the end of `packages/addon-backend/services/firestore.go` (after `DeleteTicket`):

```go
// UpdateDocFields patches arbitrary top-level fields on documents/{docID}.
func (s *Store) UpdateDocFields(ctx context.Context, docID string, fields map[string]any) error {
	updates := make([]firestore.Update, 0, len(fields))
	for k, v := range fields {
		updates = append(updates, firestore.Update{Path: k, Value: v})
	}
	_, err := s.client.Collection("documents").Doc(docID).Update(ctx, updates)
	return err
}
```

Create `packages/addon-backend/services/prd_coaching.go`:

```go
package services

import "time"

// EvaluateCoaching turns a PRD completeness classification (or its absence, on
// any failure) into what should be persisted and whether the owner still needs
// to resolve something before proceeding. callErr or a nil result are treated
// identically — both mean "the check failed, fall back to manual entry" — since
// callers must never distinguish "LLM said no" from "LLM was unreachable" when
// deciding whether to let the owner proceed.
func EvaluateCoaching(result *PRDCompletenessResult, callErr error, resolvedBy string) (coaching PRDCoachingResult, needsCoaching bool) {
	if callErr != nil || result == nil {
		return PRDCoachingResult{}, true
	}

	if result.PressReleaseFound {
		coaching.PressReleasePresent = true
		coaching.PressReleaseText = result.PressReleaseText
		coaching.PressReleaseSource = "llm"
	}
	if result.DefinitionOfDoneFound {
		coaching.DoDPresent = true
		coaching.DoDText = result.DefinitionOfDoneText
		coaching.DoDSource = "llm"
	}

	needsCoaching = !result.PressReleaseFound || !result.DefinitionOfDoneFound
	if !needsCoaching {
		coaching.ResolvedAt = time.Now()
		coaching.ResolvedBy = resolvedBy
	}
	return coaching, needsCoaching
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/addon-backend && go test ./services/ -run TestEvaluateCoaching -v`
Expected: PASS. Also run `cd packages/addon-backend && go build ./...` to confirm the `firestore.go` changes compile cleanly with the rest of the package.

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/services/prd_coaching.go packages/addon-backend/services/prd_coaching_test.go packages/addon-backend/services/firestore.go
git commit -m "feat(addon-backend): add PRD coaching decision logic and Firestore schema"
```

---

### Task 3: `PRDCoaching` card

**Files:**
- Create: `packages/addon-backend/cards/coaching.go`
- Test: `packages/addon-backend/cards/coaching_test.go`

**Interfaces:**
- Produces: `cards.PRDCoachingView{PressReleasePresent bool, PressReleaseText string, DoDPresent bool, DoDText string}` (a card-layer copy of the fields of `services.PRDCoachingResult` needed for rendering — **not** `services.PRDCoachingResult` itself: `cards` cannot import `services`, because `services` already imports `cards` for `DiffSection` in `services/drift_detection.go`. This exact problem already has a precedent in this codebase — see `cards/diff_view.go`'s `ChangeSummaryView`, a card-layer copy of `services.ChangeSummary` for the identical reason. `PRDCoachingView` follows that same pattern.), `cards.PRDCoaching(docTitle, docID string, coaching PRDCoachingView, checkFailed bool) Card` — `Card.Name == "prd_coaching"`. Missing fields render a `TextInput` named `pressReleaseManual` / `dodManual`; found fields render read-only, no input. The submit button posts to `/addon/coach-resolve` with a `docId` parameter.
- Task 4 converts `services.PRDCoachingResult` to `cards.PRDCoachingView` inline before calling `cards.PRDCoaching` (routes freely import both packages — only `cards` importing `services` is the problem).

- [ ] **Step 1: Write the failing tests**

Create `packages/addon-backend/cards/coaching_test.go`:

```go
package cards

import (
	"testing"
)

// findTextInput returns the TextInput widget with the given Name, or nil.
func findTextInput(card Card, name string) *TextInput {
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.TextInput != nil && w.TextInput.Name == name {
				return w.TextInput
			}
		}
	}
	return nil
}

func TestPRDCoaching_BothFound(t *testing.T) {
	coaching := PRDCoachingView{
		PressReleasePresent: true, PressReleaseText: "We're building X.",
		DoDPresent: true, DoDText: "Demo to 5 customers.",
	}
	card := PRDCoaching("My PRD", "doc-1", coaching, false)

	if card.Name != "prd_coaching" {
		t.Errorf("Name: got %q, want prd_coaching", card.Name)
	}
	if findTextInput(card, "pressReleaseManual") != nil {
		t.Error("expected no manual input for a found press release")
	}
	if findTextInput(card, "dodManual") != nil {
		t.Error("expected no manual input for a found DoD")
	}
}

func TestPRDCoaching_OneMissing(t *testing.T) {
	coaching := PRDCoachingView{
		PressReleasePresent: true, PressReleaseText: "We're building X.",
		DoDPresent: false,
	}
	card := PRDCoaching("My PRD", "doc-1", coaching, false)

	if findTextInput(card, "pressReleaseManual") != nil {
		t.Error("expected no manual input for a found press release")
	}
	dodInput := findTextInput(card, "dodManual")
	if dodInput == nil {
		t.Fatal("expected a manual input for the missing DoD")
	}
	if dodInput.Type != "MULTIPLE_LINE" {
		t.Errorf("dodManual should be MULTIPLE_LINE, got %q", dodInput.Type)
	}
}

func TestPRDCoaching_CheckFailed_BothManual(t *testing.T) {
	card := PRDCoaching("My PRD", "doc-1", PRDCoachingView{}, true)

	if findTextInput(card, "pressReleaseManual") == nil {
		t.Error("expected a manual input for press release when the check failed")
	}
	if findTextInput(card, "dodManual") == nil {
		t.Error("expected a manual input for DoD when the check failed")
	}
}

func TestPRDCoaching_ContinueButtonPostsWithDocID(t *testing.T) {
	card := PRDCoaching("My PRD", "doc-1", PRDCoachingView{}, true)

	var found bool
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.ButtonList == nil {
				continue
			}
			for _, b := range w.ButtonList.Buttons {
				if b.OnClick == nil || b.OnClick.Action == nil {
					continue
				}
				for _, p := range b.OnClick.Action.Parameters {
					if p.Key == "docId" && p.Value == "doc-1" {
						found = true
					}
				}
			}
		}
	}
	if !found {
		t.Error("expected a button posting with docId=doc-1 parameter")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/addon-backend && go test ./cards/ -run TestPRDCoaching -v`
Expected: FAIL to compile — `PRDCoaching` undefined.

- [ ] **Step 3: Write the implementation**

Create `packages/addon-backend/cards/coaching.go`:

```go
package cards

// PRDCoachingView is the card-layer copy of the services.PRDCoachingResult fields
// needed for rendering (cards cannot import services — services already imports
// cards for DiffSection in services/drift_detection.go; see ChangeSummaryView in
// diff_view.go for the identical existing pattern). Callers convert from
// services.PRDCoachingResult before calling PRDCoaching.
type PRDCoachingView struct {
	PressReleasePresent bool
	PressReleaseText    string
	DoDPresent          bool
	DoDText             string
}

// PRDCoaching shows the result of the pre-signer PRD completeness check. Found
// fields render read-only; missing fields (or every field, if checkFailed) get
// an inline text box so the owner can supply them without leaving the sidebar.
// The owner can also leave a field blank and continue — this is a nudge, not a
// hard gate.
func PRDCoaching(docTitle, docID string, coaching PRDCoachingView, checkFailed bool) Card {
	var widgets []Widget

	if checkFailed {
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   matIcon("info"),
				Text:        "Couldn't automatically check your document",
				BottomLabel: "Add these manually, or continue without them.",
				WrapText:    true,
			},
		})
	}

	widgets = append(widgets, fieldWidgets(
		"Press Release", "pressReleaseManual",
		"What's being built and why people should care",
		coaching.PressReleasePresent && !checkFailed, coaching.PressReleaseText,
	)...)
	widgets = append(widgets, fieldWidgets(
		"Definition of Done", "dodManual",
		"A demo description and/or success metrics proving it's done",
		coaching.DoDPresent && !checkFailed, coaching.DoDText,
	)...)

	widgets = append(widgets,
		Widget{TextParagraph: &TextParagraph{
			Text: "You can leave these blank and continue if you'd rather fill them in later.",
		}},
		Widget{ButtonList: &ButtonList{Buttons: []Button{
			filledActionButton("Continue", "/addon/coach-resolve", Parameter{Key: "docId", Value: docID}),
		}}},
	)

	return Card{
		Name:   "prd_coaching",
		Header: &Header{Title: "Before you invite signers", Subtitle: docTitle},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}

// fieldWidgets renders either a read-only "found" summary or a missing-field
// callout plus an inline manual-entry text box.
func fieldWidgets(label, inputName, hint string, present bool, text string) []Widget {
	if present {
		excerpt := text
		if len(excerpt) > 140 {
			excerpt = excerpt[:140] + "…"
		}
		return []Widget{{
			DecoratedText: &DecoratedText{
				StartIcon:   matIcon("check_circle"),
				TopLabel:    label,
				Text:        "Found in your document",
				BottomLabel: excerpt,
				WrapText:    true,
			},
		}}
	}
	return []Widget{
		{
			DecoratedText: &DecoratedText{
				StartIcon: matIcon("warning"),
				TopLabel:  label,
				Text:      "Not found in the document",
				WrapText:  true,
			},
		},
		{
			TextInput: &TextInput{
				Name:     inputName,
				Label:    "Add a " + label,
				HintText: hint,
				Type:     "MULTIPLE_LINE",
			},
		},
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/addon-backend && go test ./cards/ -v`
Expected: PASS (all cards package tests, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/cards/coaching.go packages/addon-backend/cards/coaching_test.go
git commit -m "feat(addon-backend): add PRDCoaching card"
```

---

### Task 4: Wire coaching into `CreateBaseline`, add `CoachResolve` route

**Files:**
- Modify: `packages/addon-backend/routes/create_baseline.go`
- Create: `packages/addon-backend/routes/coach_resolve.go`

**Interfaces:**
- Consumes: `services.NewAnthropicClient`, `(*services.AnthropicClient).ClassifyPRDCompleteness` (Task 1); `services.EvaluateCoaching`, `services.PRDCoachingResult`, `(*services.Store).UpdateDocFields` (Task 2); `cards.PRDCoaching` (Task 3); existing `services.FetchDocText`, `cards.AddSigners`, `cards.Push`, `cards.Collaborator`, `decodeEvent`, `writeActionErr`, `writeJSON`, `isNotFound`.
- Produces: `routes.CreateBaseline(store *services.Store, anthropicClient *services.AnthropicClient) http.HandlerFunc` (signature change — was `CreateBaseline(store *services.Store)`), `routes.CoachResolve(store *services.Store) http.HandlerFunc`.

- [ ] **Step 1: Modify `CreateBaseline`**

Replace the full contents of `packages/addon-backend/routes/create_baseline.go`:

```go
package routes

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func CreateBaseline(store *services.Store, anthropicClient *services.AnthropicClient) http.HandlerFunc {
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

		// PRD completeness coaching runs only on genuinely first-time baseline
		// creation. If a doc record already exists, an owner re-running "Create
		// baseline" must never re-check or overwrite a coachingResult that may
		// already hold manually-typed content.
		isFirstBaseline := doc == nil

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
		if !isFirstBaseline {
			// CreateDoc below is a full overwrite (Set, not merge) — this call already
			// existed before this feature and re-runs the rest of baseline creation too
			// (out of scope to change here), but it must not silently wipe a coaching
			// result that was already resolved.
			rec.CoachingResult = doc.CoachingResult
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

		if !isFirstBaseline {
			writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
			return
		}

		docText, _, fetchErr := services.FetchDocText(ctx, userToken, docID)
		var classifyErr error
		var result *services.PRDCompletenessResult
		if fetchErr != nil {
			log.Printf("create-baseline: FetchDocText: %v (coaching check unavailable)", fetchErr)
			classifyErr = fetchErr
		} else {
			llmCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			result, classifyErr = anthropicClient.ClassifyPRDCompleteness(llmCtx, docText)
			cancel()
			if classifyErr != nil {
				log.Printf("create-baseline: ClassifyPRDCompleteness: %v (coaching check unavailable)", classifyErr)
			}
		}

		coaching, needsCoaching := services.EvaluateCoaching(result, classifyErr, userEmail)
		if err := store.UpdateDocFields(ctx, docID, map[string]any{"coachingResult": coaching}); err != nil {
			log.Printf("create-baseline: UpdateDocFields (coaching): %v (non-fatal)", err)
		}

		if !needsCoaching {
			_ = store.AddHistory(ctx, docID, services.HistoryRecord{
				Action:     "coaching_auto_passed",
				ActorEmail: userEmail,
				Timestamp:  time.Now(),
			})
			writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
			return
		}

		checkFailed := classifyErr != nil
		view := cards.PRDCoachingView{
			PressReleasePresent: coaching.PressReleasePresent,
			PressReleaseText:    coaching.PressReleaseText,
			DoDPresent:          coaching.DoDPresent,
			DoDText:             coaching.DoDText,
		}
		writeJSON(w, cards.Push(cards.PRDCoaching(docTitle, docID, view, checkFailed)))
	}
}
```

- [ ] **Step 2: Create `CoachResolve`**

Create `packages/addon-backend/routes/coach_resolve.go`:

```go
package routes

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// CoachResolve handles the PRDCoaching card's "Continue" submission: it merges
// any manually-typed field with whatever the classifier already found, persists
// the final result, and proceeds to AddSigners exactly as CreateBaseline would
// have if coaching hadn't been needed. It never blocks — a blank manual field
// is recorded as an explicit skip, not an error.
func CoachResolve(store *services.Store) http.HandlerFunc {
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

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			if isNotFound(err) {
				writeActionErr(w, "Document not found.")
			} else {
				log.Printf("coach-resolve: GetDoc: %v", err)
				writeActionErr(w, "Something went wrong. Please try again.")
			}
			return
		}
		if doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can resolve this.")
			return
		}

		final := services.PRDCoachingResult{ResolvedAt: time.Now(), ResolvedBy: userEmail}

		if doc.CoachingResult != nil && doc.CoachingResult.PressReleasePresent {
			final.PressReleasePresent = true
			final.PressReleaseText = doc.CoachingResult.PressReleaseText
			final.PressReleaseSource = "llm"
		} else if manual := strings.TrimSpace(ev.formString("pressReleaseManual")); manual != "" {
			final.PressReleasePresent = true
			final.PressReleaseText = manual
			final.PressReleaseSource = "manual"
		} else {
			final.PressReleaseSource = "skipped"
		}

		if doc.CoachingResult != nil && doc.CoachingResult.DoDPresent {
			final.DoDPresent = true
			final.DoDText = doc.CoachingResult.DoDText
			final.DoDSource = "llm"
		} else if manual := strings.TrimSpace(ev.formString("dodManual")); manual != "" {
			final.DoDPresent = true
			final.DoDText = manual
			final.DoDSource = "manual"
		} else {
			final.DoDSource = "skipped"
		}

		if err := store.UpdateDocFields(ctx, docID, map[string]any{"coachingResult": final}); err != nil {
			log.Printf("coach-resolve: UpdateDocFields: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:        "coaching_resolved",
			ActorEmail:    userEmail,
			CommitMessage: fmt.Sprintf("pressRelease:%s dod:%s", final.PressReleaseSource, final.DoDSource),
			Timestamp:     time.Now(),
		})

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
				log.Printf("coach-resolve: ListFilePermissions %s: %v", docID, err)
			}
		}

		writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
	}
}
```

- [ ] **Step 3: Build to verify it compiles**

Run: `cd packages/addon-backend && go build ./...`
Expected: fails at this point only because `main.go` still calls `routes.CreateBaseline(store)` with the old one-argument signature — that's fixed in Task 5. Confirm the error is specifically about `main.go`'s call site and not about `create_baseline.go` or `coach_resolve.go` themselves (e.g. run `go vet ./routes/...` to check those two files compile in isolation from `main.go`'s call site — `go vet` type-checks each package's own code including how it calls imported packages, but `main.go` is a separate file in `package main`, so `go build ./routes/...` alone will succeed even before Task 5).

Run: `cd packages/addon-backend && go build ./routes/...`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/addon-backend/routes/create_baseline.go packages/addon-backend/routes/coach_resolve.go
git commit -m "feat(addon-backend): wire PRD coaching into create-baseline, add coach-resolve route"
```

---

### Task 5: `main.go` wiring

**Files:**
- Modify: `packages/addon-backend/main.go`
- Modify: `packages/addon-backend/.env.example`

**Interfaces:**
- Consumes: `services.NewAnthropicClient` (Task 1), `routes.CreateBaseline(store, anthropicClient)` (new signature, Task 4), `routes.CoachResolve(store)` (Task 4).

- [ ] **Step 1: Load the API key and construct the client**

In `packages/addon-backend/main.go`, immediately after the existing `resendKey` loading block (after the `if resendKey == "" { log.Println(...) }` block, before `store := services.NewStore(fsClient)`), add:

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

- [ ] **Step 2: Update route registration**

In `packages/addon-backend/main.go`, change:

```go
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store)))
```

to:

```go
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store, anthropicClient)))
```

and add, directly below the existing `mux.Handle("POST /addon/add-signers", ...)` line:

```go
	mux.Handle("POST /addon/coach-resolve", protected(routes.CoachResolve(store)))
```

- [ ] **Step 3: Document the env var**

In `packages/addon-backend/.env.example`, add after the existing `# RESEND_API_KEY=re_xxx` line:

```
# Optional: overrides Firestore config/secrets.anthropicApiKey
# ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 4: Build the whole module**

Run: `cd packages/addon-backend && go build ./...`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/addon-backend/main.go packages/addon-backend/.env.example
git commit -m "feat(addon-backend): load ANTHROPIC_API_KEY and register coach-resolve route"
```

---

### Task 6: End-to-end tests against the Firestore emulator

**Files:**
- Create: `packages/addon-backend/routes/coaching_e2e_test.go`

**Interfaces:**
- Consumes: `newEmulatorStore` (existing helper in `routes/e2e_test.go`, same `routes_test` package — reused, not redefined), `routes.CreateBaseline`, `routes.CoachResolve` (Task 4), `services.NewAnthropicClient`, `services.PRDCoachingResult` (Tasks 1–2), `middleware.VerifyOIDC`.

- [ ] **Step 1: Write the end-to-end tests**

Create `packages/addon-backend/routes/coaching_e2e_test.go`:

```go
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

func TestCoachingE2E_CoachResolve_NonOwnerRejected(t *testing.T) {
	store := newEmulatorStore(t)
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
```

- [ ] **Step 2: Run the tests to verify they fail first (TDD check), then start the emulator and verify they pass**

Run without the emulator to confirm they skip cleanly (proves `newEmulatorStore`'s skip guard still works): `cd packages/addon-backend && go test ./routes/ -run TestCoachingE2E -v`
Expected: all subtests report `SKIP: FIRESTORE_EMULATOR_HOST not set`.

Start the emulator in a separate terminal: `firebase emulators:start --only firestore`

Run: `cd packages/addon-backend && FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./routes/ -run TestCoachingE2E -v`
Expected: PASS (all 5 tests).

- [ ] **Step 3: Run the full test suite for the package to confirm nothing else broke**

Run: `cd packages/addon-backend && go build ./... && go vet ./... && go test ./... 2>&1 | grep -v "FIRESTORE_EMULATOR_HOST not set"`
Expected: build and vet clean; all non-emulator-gated tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/addon-backend/routes/coaching_e2e_test.go
git commit -m "test(addon-backend): add end-to-end tests for PRD coaching wiring"
```

---

## Final Verification

- [ ] `cd packages/addon-backend && go build ./...` — clean build.
- [ ] `cd packages/addon-backend && go vet ./...` — clean.
- [ ] `cd packages/addon-backend && go test ./...` — all pass (emulator-gated tests skip cleanly without `FIRESTORE_EMULATOR_HOST`).
- [ ] `cd packages/addon-backend && FIRESTORE_EMULATOR_HOST=localhost:8080 go test ./...` (with `firebase emulators:start --only firestore` running) — all pass, including the 5 new coaching E2E tests.
- [ ] Manual smoke test (optional, requires ngrok + a real `@docalign.app` account per `CLAUDE.md`'s Local Dev instructions): open a Google Doc with no Press Release or DoD content, click "Create baseline" in the sidebar, confirm the `PRDCoaching` card appears with both fields flagged missing, type manual text for one, leave the other blank, click Continue, confirm it proceeds to `AddSigners` and Firestore shows `coachingResult` with `pressReleaseSource: "manual"` and `dodSource: "skipped"`.
