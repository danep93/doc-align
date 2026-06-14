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

		docID := ev.Docs.ID
		signerEmail := ev.param("signerEmail")
		if signerEmail == "" {
			signerEmail = userEmail
		}
		userToken := ev.AuthorizationEventObject.UserOAuthToken

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeErr(w, "Document not found.")
			return
		}

		signer, err := store.GetSigner(ctx, docID, signerEmail)
		if err != nil {
			writeErr(w, "Signer record not found.")
			return
		}

		// Fetch current doc text using the requesting user's token.
		currentText, _, err := services.FetchDocText(ctx, userToken, docID)
		if err != nil {
			log.Printf("diff: FetchDocText: %v", err)
			writeErr(w, "Couldn't reach Google Drive. Try reopening the sidebar.")
			return
		}

		// Fetch signed-revision text using owner's token.
		ownerToken, err := services.GetOwnerAccessToken(ctx, store.FirestoreClient(), docID)
		if err != nil || ownerToken == "" {
			log.Printf("diff: GetOwnerAccessToken: %v", err)
			writeErr(w, "doc-align lost access to this document. The owner needs to reconnect.")
			return
		}

		signedText, err := services.ExportRevisionText(ctx, ownerToken, docID, signer.SignedRevisionID)
		if err != nil {
			log.Printf("diff: ExportRevisionText %s: %v", signer.SignedRevisionID, err)
			writeErr(w, "The baseline revision is no longer available. The owner may need to recreate the baseline.")
			return
		}

		result := services.DetectDrift(currentText, signedText)
		_ = doc // title available if needed for header
		writeJSON(w, cards.DiffView(result.Added, result.Removed, result.Sections))
	}
}
