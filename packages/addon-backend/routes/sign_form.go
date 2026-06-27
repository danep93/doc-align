package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/services"
)

func SignForm(store *services.Store) http.HandlerFunc {
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

		ownerName := services.DisplayName(doc.OwnerID)
		writeJSON(w, cards.Push(cards.SignForm(doc.Title, ownerName, docID)))
	}
}
