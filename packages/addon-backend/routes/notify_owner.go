package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// NotifyOwner lets a locked-out signer nudge the owner to confirm pending changes.
// Fire-and-forget email; re-renders via PopToRoot so the homepage re-runs the drift check.
func NotifyOwner(store *services.Store, resendKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

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

		if _, err := store.GetSigner(ctx, docID, userEmail); err != nil {
			writeActionErr(w, "Only signers on this document can notify the owner.")
			return
		}

		if err := services.SendOwnerNudge(resendKey, doc.OwnerID, userEmail, doc.Title, docID); err != nil {
			log.Printf("notify-owner: SendOwnerNudge: %v", err)
			writeActionErr(w, "Couldn't send the notification. Please try again.")
			return
		}

		writeJSON(w, cards.PopRoot())
	}
}
