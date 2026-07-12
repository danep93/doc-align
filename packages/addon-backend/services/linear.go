package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// linearAPIURL is the Linear GraphQL endpoint. Overridable for testing.
var linearAPIURL = "https://api.linear.app/graphql"

// SetLinearAPIURLForTest overrides the Linear API endpoint and returns a restore func.
// Only call from test code; not safe for parallel tests.
func SetLinearAPIURLForTest(url string) func() {
	original := linearAPIURL
	linearAPIURL = url
	return func() { linearAPIURL = original }
}

type LinearClient struct {
	apiKey     string
	httpClient *http.Client
}

func NewLinearClient(apiKey string) *LinearClient {
	return &LinearClient{apiKey: apiKey, httpClient: http.DefaultClient}
}

type gqlRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables,omitempty"`
}

type gqlResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

func (c *LinearClient) graphql(ctx context.Context, query string, variables map[string]any, dest any) error {
	body, err := json.Marshal(gqlRequest{Query: query, Variables: variables})
	if err != nil {
		return fmt.Errorf("linear: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, linearAPIURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("linear: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("linear: http: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("linear: read body: %w", err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("linear: invalid API key (401)")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("linear: HTTP %d: %s", resp.StatusCode, string(raw))
	}

	var gqlResp gqlResponse
	if err := json.Unmarshal(raw, &gqlResp); err != nil {
		return fmt.Errorf("linear: unmarshal response: %w", err)
	}
	if len(gqlResp.Errors) > 0 {
		return fmt.Errorf("linear: %s", gqlResp.Errors[0].Message)
	}
	if dest != nil {
		return json.Unmarshal(gqlResp.Data, dest)
	}
	return nil
}

func (c *LinearClient) GetViewer(ctx context.Context) (string, error) {
	const q = `{ viewer { email } }`
	var data struct {
		Viewer struct {
			Email string `json:"email"`
		} `json:"viewer"`
	}
	if err := c.graphql(ctx, q, nil, &data); err != nil {
		return "", err
	}
	return data.Viewer.Email, nil
}

func (c *LinearClient) ListTeams(ctx context.Context) ([]Team, error) {
	const q = `{ teams { nodes { id name } } }`
	var data struct {
		Teams struct {
			Nodes []Team `json:"nodes"`
		} `json:"teams"`
	}
	if err := c.graphql(ctx, q, nil, &data); err != nil {
		return nil, err
	}
	return data.Teams.Nodes, nil
}

func (c *LinearClient) CreateIssue(ctx context.Context, teamID, title, desc string) (*Issue, error) {
	const q = `
		mutation CreateIssue($input: IssueCreateInput!) {
			issueCreate(input: $input) {
				success
				issue { id title description url }
			}
		}`
	vars := map[string]any{
		"input": map[string]any{
			"teamId":      teamID,
			"title":       title,
			"description": desc,
		},
	}
	var data struct {
		IssueCreate struct {
			Success bool  `json:"success"`
			Issue   Issue `json:"issue"`
		} `json:"issueCreate"`
	}
	if err := c.graphql(ctx, q, vars, &data); err != nil {
		return nil, err
	}
	if !data.IssueCreate.Success {
		return nil, fmt.Errorf("linear: issueCreate returned success=false")
	}
	return &data.IssueCreate.Issue, nil
}

func (c *LinearClient) GetIssue(ctx context.Context, id string) (*Issue, error) {
	const q = `
		query GetIssue($id: String!) {
			issue(id: $id) { id title description url }
		}`
	var data struct {
		Issue Issue `json:"issue"`
	}
	if err := c.graphql(ctx, q, map[string]any{"id": id}, &data); err != nil {
		return nil, err
	}
	return &data.Issue, nil
}

func (c *LinearClient) UpdateIssue(ctx context.Context, id, title, desc string) (*Issue, error) {
	const q = `
		mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
			issueUpdate(id: $id, input: $input) {
				success
				issue { id title description url }
			}
		}`
	input := map[string]any{}
	if title != "" {
		input["title"] = title
	}
	if desc != "" {
		input["description"] = desc
	}
	var data struct {
		IssueUpdate struct {
			Success bool  `json:"success"`
			Issue   Issue `json:"issue"`
		} `json:"issueUpdate"`
	}
	if err := c.graphql(ctx, q, map[string]any{"id": id, "input": input}, &data); err != nil {
		return nil, err
	}
	if !data.IssueUpdate.Success {
		return nil, fmt.Errorf("linear: issueUpdate returned success=false")
	}
	return &data.IssueUpdate.Issue, nil
}

// ArchiveIssue soft-deletes a Linear issue. Note: Linear's archive mutation uses
// the argument name "issueId" (not "id"), unlike issueUpdate.
func (c *LinearClient) ArchiveIssue(ctx context.Context, id string) error {
	const q = `
		mutation ArchiveIssue($id: String!) {
			issueArchive(issueId: $id) { success }
		}`
	var data struct {
		IssueArchive struct {
			Success bool `json:"success"`
		} `json:"issueArchive"`
	}
	if err := c.graphql(ctx, q, map[string]any{"id": id}, &data); err != nil {
		return err
	}
	if !data.IssueArchive.Success {
		return fmt.Errorf("linear: issueArchive returned success=false")
	}
	return nil
}
