package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/services"
)

// Diff renders the stored change summary. No Drive calls: the summary was computed at
// owner-confirm time, so this works for every signer, including viewers.
func Diff(store *services.Store) http.HandlerFunc {
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
		if doc.ChangeSummary == nil {
			writeActionErr(w, "No confirmed changes to show yet.")
			return
		}

		writeJSON(w, cards.Push(cards.DiffView(docID, *summaryToView(doc.ChangeSummary))))
	}
}
