package services

import (
	"context"
	"fmt"
)

type Team struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Issue struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
}

// TicketProvider is the contract every issue-tracker integration must satisfy.
type TicketProvider interface {
	GetViewer(ctx context.Context) (email string, err error)
	ListTeams(ctx context.Context) ([]Team, error)
	CreateIssue(ctx context.Context, teamID, title, desc string) (*Issue, error)
	GetIssue(ctx context.Context, id string) (*Issue, error)
	UpdateIssue(ctx context.Context, id, title, desc string) (*Issue, error)
	ArchiveIssue(ctx context.Context, id string) error
}

// providerFactories is the single place to register a new integration.
// Adding a new provider: add one line here + write services/{provider}.go.
var providerFactories = map[string]func(apiKey string) TicketProvider{
	"linear": func(apiKey string) TicketProvider { return NewLinearClient(apiKey) },
	// "jira": func(apiKey string) TicketProvider { return NewJiraClient(apiKey) },
}

// NewProvider returns a TicketProvider for the given name and API key.
func NewProvider(name, apiKey string) (TicketProvider, error) {
	factory, ok := providerFactories[name]
	if !ok {
		return nil, fmt.Errorf("unknown provider: %q", name)
	}
	return factory(apiKey), nil
}

// IsValidProvider reports whether name is a registered provider.
func IsValidProvider(name string) bool {
	_, ok := providerFactories[name]
	return ok
}
