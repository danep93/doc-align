package routes

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// IntegrationConnect validates the API key against the provider and saves the config.
// POST /integrations/{provider}/connect
// Body: {"apiKey": "..."}
func IntegrationConnect(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)
		provider := r.PathValue("provider")

		if !services.IsValidProvider(provider) {
			writeRESTErr(w, "unknown provider: "+provider, http.StatusBadRequest)
			return
		}

		var req struct {
			APIKey string `json:"apiKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.APIKey == "" {
			writeRESTErr(w, "apiKey is required", http.StatusBadRequest)
			return
		}

		p, err := services.NewProvider(provider, req.APIKey)
		if err != nil {
			writeRESTErr(w, err.Error(), http.StatusBadRequest)
			return
		}

		viewerEmail, err := p.GetViewer(ctx)
		if err != nil {
			log.Printf("integration-connect [%s]: GetViewer: %v", provider, err)
			writeRESTErr(w, "invalid API key or provider unreachable", http.StatusBadRequest)
			return
		}

		rec := services.IntegrationConfigRecord{
			APIKey:      req.APIKey,
			ViewerEmail: viewerEmail,
			ConnectedAt: time.Now(),
		}
		if err := store.SetIntegrationConfig(ctx, userEmail, provider, rec); err != nil {
			log.Printf("integration-connect [%s]: SetIntegrationConfig: %v", provider, err)
			writeRESTErr(w, "failed to save config", http.StatusInternalServerError)
			return
		}

		writeJSON(w, map[string]any{
			"provider":    provider,
			"viewerEmail": viewerEmail,
			"connectedAt": rec.ConnectedAt,
		})
	}
}

// IntegrationGetConfig returns the stored connection status and live teams list.
// The raw API key is never returned to the client.
// GET /integrations/{provider}/config
func IntegrationGetConfig(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)
		provider := r.PathValue("provider")

		if !services.IsValidProvider(provider) {
			writeRESTErr(w, "unknown provider: "+provider, http.StatusBadRequest)
			return
		}

		cfg, err := store.GetIntegrationConfig(ctx, userEmail, provider)
		if err != nil {
			if isNotFound(err) {
				writeJSON(w, map[string]any{"connected": false, "provider": provider})
				return
			}
			log.Printf("integration-get-config [%s]: GetIntegrationConfig: %v", provider, err)
			writeRESTErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		p, err := services.NewProvider(provider, cfg.APIKey)
		if err != nil {
			writeRESTErr(w, err.Error(), http.StatusInternalServerError)
			return
		}

		teams, err := p.ListTeams(ctx)
		if err != nil {
			log.Printf("integration-get-config [%s]: ListTeams: %v", provider, err)
			writeJSON(w, map[string]any{
				"connected":   true,
				"provider":    provider,
				"viewerEmail": cfg.ViewerEmail,
				"connectedAt": cfg.ConnectedAt,
				"teams":       []any{},
				"teamsError":  "could not fetch teams from provider",
			})
			return
		}

		writeJSON(w, map[string]any{
			"connected":   true,
			"provider":    provider,
			"viewerEmail": cfg.ViewerEmail,
			"connectedAt": cfg.ConnectedAt,
			"teams":       teams,
		})
	}
}

// IntegrationDisconnect removes the stored API key for a provider.
// Existing ticket records are kept as an audit trail.
// DELETE /integrations/{provider}/config
func IntegrationDisconnect(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)
		provider := r.PathValue("provider")

		if !services.IsValidProvider(provider) {
			writeRESTErr(w, "unknown provider: "+provider, http.StatusBadRequest)
			return
		}

		if err := store.DeleteIntegrationConfig(ctx, userEmail, provider); err != nil && !isNotFound(err) {
			log.Printf("integration-disconnect [%s]: DeleteIntegrationConfig: %v", provider, err)
			writeRESTErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
