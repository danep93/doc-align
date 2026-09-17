package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/services"
)

// ConfirmVersionForm renders the note-taking step for "Confirm new version", reached
// from StatusOwner's 3-dot menu. The action itself is /addon/mark-revised.
func ConfirmVersionForm(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		docID := ev.resolveDocID()

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}

		writeJSON(w, cards.Push(cards.ConfirmVersion(doc.Title, docID)))
	}
}
