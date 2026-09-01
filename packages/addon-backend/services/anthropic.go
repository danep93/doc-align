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
