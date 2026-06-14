package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/services"
)

// GmailTrigger handles unconditional contextual trigger events from Gmail.
// It checks the email sender; if not from doc-align, returns an empty card.
func GmailTrigger(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Phase 2: parse X-DocAlign-DocId header, look up Firestore, return review or drift card.
		// For now, return empty JSON so Gmail shows nothing (correct behaviour for non-doc-align emails).
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}
}
