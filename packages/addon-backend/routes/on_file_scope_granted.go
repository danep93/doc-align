package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// OnFileScopeGranted handles the onFileScopeGrantedTrigger, which fires after the user
// grants drive.file access for the current document. At this point docs.id is populated.
func OnFileScopeGranted(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.Docs.ID
		if docID == "" {
			writeErr(w, "Could not determine document ID.")
			return
		}

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			if status.Code(err) == codes.NotFound {
				writeJSON(w, cards.Push(cards.EmptyState(true, docID)))
				return
			}
			log.Printf("on-file-scope-granted: GetDoc %s: %v", docID, err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		isOwner := doc.OwnerID == userEmail

		signerMap, err := store.ListSigners(ctx, docID)
		if err != nil {
			log.Printf("on-file-scope-granted: ListSigners: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		if isOwner {
			writeJSON(w, cards.Push(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID)))
			return
		}

		signerRec, exists := signerMap[userEmail]
		if !exists {
			writeJSON(w, cards.Push(cards.EmptyState(false, docID)))
			return
		}

		ss := recordToStatus(userEmail, signerRec)
		writeJSON(w, cards.Push(cards.StatusSigner(doc.Title, ss, "", docID)))
	}
}
