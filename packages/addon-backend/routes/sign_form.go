package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
)

func SignForm() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userEmail := middleware.EmailFromContext(r.Context())
		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		docID := ev.resolveDocID()
		writeJSON(w, cards.Push(cards.SignForm(userEmail, "", docID)))
	}
}
