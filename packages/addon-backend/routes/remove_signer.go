package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func RemoveSigner(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.param("docId")
		signerEmail := ev.param("signerEmail")

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}
		if doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can remove signers.")
			return
		}
		if signerEmail == doc.OwnerID {
			writeActionErr(w, "The document owner can't be removed as a signer.")
			return
		}

		if err := store.DeleteSigner(ctx, docID, signerEmail); err != nil {
			log.Printf("remove-signer: DeleteSigner %s: %v", signerEmail, err)
			writeActionErr(w, "Failed to remove signer. Please try again.")
			return
		}

		signerMap, _ := store.ListSigners(ctx, docID)
		userToken := ev.AuthorizationEventObject.UserOAuthToken
		docChanged, signerMap := services.CheckDocDrift(ctx, store, userToken, docID, doc, signerMap)
		signerStatuses := toSignerStatusList(signerMap)
		writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, signerStatuses, docID, docChanged, doc.OwnerID, doc.ChangeSummary != nil)))
	}
}
