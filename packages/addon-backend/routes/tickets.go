package routes

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// requireProvider loads the stored integration config for providerName and returns
// a ready TicketProvider. Writes an HTTP error and returns nil if the provider is
// unknown, not connected, or the config cannot be loaded.
func requireProvider(w http.ResponseWriter, r *http.Request, store *services.Store, userEmail, providerName string) services.TicketProvider {
	if !services.IsValidProvider(providerName) {
		writeRESTErr(w, "unknown provider: "+providerName, http.StatusBadRequest)
		return nil
	}
	cfg, err := store.GetIntegrationConfig(r.Context(), userEmail, providerName)
	if err != nil {
		if isNotFound(err) {
			writeRESTErr(w, providerName+" not connected", http.StatusBadRequest)
		} else {
			log.Printf("requireProvider [%s]: GetIntegrationConfig: %v", providerName, err)
			writeRESTErr(w, "internal error", http.StatusInternalServerError)
		}
		return nil
	}
	p, err := services.NewProvider(providerName, cfg.APIKey)
	if err != nil {
		writeRESTErr(w, err.Error(), http.StatusInternalServerError)
		return nil
	}
	return p
}

// CreateTicket creates an issue in the provider and stores a reference in Firestore.
// Only the document owner can create tickets.
// POST /docs/{docID}/tickets
// Body: {"provider": "linear", "teamId": "...", "title": "...", "description": "..."}
func CreateTicket(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)
		docID := r.PathValue("docID")

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			if isNotFound(err) {
				writeRESTErr(w, "document not found", http.StatusNotFound)
			} else {
				writeRESTErr(w, "internal error", http.StatusInternalServerError)
			}
			return
		}
		if doc.OwnerID != userEmail {
			writeRESTErr(w, "only the document owner can create tickets", http.StatusForbidden)
			return
		}

		var req struct {
			Provider    string `json:"provider"`
			TeamID      string `json:"teamId"`
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeRESTErr(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Provider == "" || req.TeamID == "" || req.Title == "" {
			writeRESTErr(w, "provider, teamId, and title are required", http.StatusBadRequest)
			return
		}

		p := requireProvider(w, r, store, userEmail, req.Provider)
		if p == nil {
			return
		}

		issue, err := p.CreateIssue(ctx, req.TeamID, req.Title, req.Description)
		if err != nil {
			log.Printf("create-ticket [%s]: CreateIssue: %v", req.Provider, err)
			writeRESTErr(w, "failed to create issue in "+req.Provider, http.StatusBadGateway)
			return
		}

		now := time.Now()
		rec := services.TicketRecord{
			Provider:    req.Provider,
			ExternalID:  issue.ID,
			ExternalURL: issue.URL,
			Title:       issue.Title,
			Description: issue.Description,
			TeamID:      req.TeamID,
			CreatedBy:   userEmail,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		id, err := store.CreateTicket(ctx, docID, rec)
		if err != nil {
			// Issue created in the provider but not persisted in Firestore.
			// Return 201 so the caller isn't left empty-handed; log for reconciliation.
			log.Printf("create-ticket [%s]: CreateTicket (Firestore): %v — issue %s created in provider but not stored", req.Provider, err, issue.ID)
		}
		rec.ID = id

		w.WriteHeader(http.StatusCreated)
		writeJSON(w, rec)
	}
}

// ListTickets returns all tickets for a document, optionally filtered by provider.
// Results come from Firestore cache only (no live sync with the provider).
// GET /docs/{docID}/tickets?provider=linear
func ListTickets(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		docID := r.PathValue("docID")

		tickets, err := store.ListTickets(ctx, docID)
		if err != nil {
			log.Printf("list-tickets: ListTickets: %v", err)
			writeRESTErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		if p := r.URL.Query().Get("provider"); p != "" {
			filtered := tickets[:0]
			for _, t := range tickets {
				if t.Provider == p {
					filtered = append(filtered, t)
				}
			}
			tickets = filtered
		}

		writeJSON(w, map[string]any{"tickets": tickets})
	}
}

// GetTicket returns a single ticket by its Firestore ID.
// GET /docs/{docID}/tickets/{ticketID}
func GetTicket(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		docID := r.PathValue("docID")
		ticketID := r.PathValue("ticketID")

		rec, err := store.GetTicket(ctx, docID, ticketID)
		if err != nil {
			if isNotFound(err) {
				writeRESTErr(w, "ticket not found", http.StatusNotFound)
			} else {
				writeRESTErr(w, "internal error", http.StatusInternalServerError)
			}
			return
		}

		writeJSON(w, rec)
	}
}

// UpdateTicket patches title and/or description on an existing ticket.
// The provider is looked up from the stored record — no provider arg needed from the caller.
// PATCH /docs/{docID}/tickets/{ticketID}
// Body: {"title": "...", "description": "..."}  (both optional)
func UpdateTicket(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)
		docID := r.PathValue("docID")
		ticketID := r.PathValue("ticketID")

		rec, err := store.GetTicket(ctx, docID, ticketID)
		if err != nil {
			if isNotFound(err) {
				writeRESTErr(w, "ticket not found", http.StatusNotFound)
			} else {
				writeRESTErr(w, "internal error", http.StatusInternalServerError)
			}
			return
		}

		var req struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeRESTErr(w, "invalid request body", http.StatusBadRequest)
			return
		}

		p := requireProvider(w, r, store, userEmail, rec.Provider)
		if p == nil {
			return
		}

		updated, err := p.UpdateIssue(ctx, rec.ExternalID, req.Title, req.Description)
		if err != nil {
			log.Printf("update-ticket [%s]: UpdateIssue: %v", rec.Provider, err)
			writeRESTErr(w, "failed to update issue in "+rec.Provider, http.StatusBadGateway)
			return
		}

		fields := map[string]any{"updatedAt": time.Now()}
		if req.Title != "" {
			rec.Title = updated.Title
			fields["title"] = updated.Title
		}
		if req.Description != "" {
			rec.Description = updated.Description
			fields["description"] = updated.Description
		}
		fields["updatedAt"] = time.Now()

		if err := store.UpdateTicketFields(ctx, docID, ticketID, fields); err != nil {
			log.Printf("update-ticket [%s]: UpdateTicketFields: %v", rec.Provider, err)
		}

		writeJSON(w, rec)
	}
}

// DeleteTicket archives the issue in the provider and removes the Firestore record.
// The provider is looked up from the stored record.
// DELETE /docs/{docID}/tickets/{ticketID}
func DeleteTicket(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)
		docID := r.PathValue("docID")
		ticketID := r.PathValue("ticketID")

		rec, err := store.GetTicket(ctx, docID, ticketID)
		if err != nil {
			if isNotFound(err) {
				writeRESTErr(w, "ticket not found", http.StatusNotFound)
			} else {
				writeRESTErr(w, "internal error", http.StatusInternalServerError)
			}
			return
		}

		p := requireProvider(w, r, store, userEmail, rec.Provider)
		if p == nil {
			return
		}

		if err := p.ArchiveIssue(ctx, rec.ExternalID); err != nil {
			log.Printf("delete-ticket [%s]: ArchiveIssue: %v", rec.Provider, err)
			writeRESTErr(w, "failed to archive issue in "+rec.Provider, http.StatusBadGateway)
			return
		}

		if err := store.DeleteTicket(ctx, docID, ticketID); err != nil && !isNotFound(err) {
			// Issue is archived in the provider; Firestore cleanup failure is non-fatal.
			log.Printf("delete-ticket [%s]: DeleteTicket (Firestore): %v", rec.Provider, err)
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
