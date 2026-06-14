package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
)

func SignForm() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userEmail := middleware.EmailFromContext(r.Context())
		// Commit message suggestion (Claude Haiku) is Phase 2.
		writeJSON(w, cards.SignForm(userEmail, ""))
	}
}
