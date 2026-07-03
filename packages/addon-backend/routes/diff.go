package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func Diff(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		signerEmail := ev.param("signerEmail")
		if signerEmail == "" {
			signerEmail = userEmail
		}
		userToken := ev.AuthorizationEventObject.UserOAuthToken

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}

		signer, err := store.GetSigner(ctx, docID, signerEmail)
		if err != nil {
			writeActionErr(w, "Signer record not found.")
			return
		}

		currentText, _, err := services.FetchDocText(ctx, userToken, docID)
		if err != nil {
			log.Printf("diff: FetchDocText: %v", err)
			writeActionErr(w, "Couldn't reach Google Drive. Try reopening the sidebar.")
			return
		}

		signedText, err := services.ExportRevisionText(ctx, userToken, docID, signer.SignedRevisionID)
		if err != nil {
			log.Printf("diff: ExportRevisionText %s: %v", signer.SignedRevisionID, err)
			writeActionErr(w, "The baseline revision is no longer available. The owner may need to recreate the baseline.")
			return
		}

		result := services.DetectDrift(currentText, signedText)
		_ = doc // title available if needed for header
		writeJSON(w, cards.Push(cards.DiffView(docID, result.Added, result.Removed, result.Sections)))
	}
}
