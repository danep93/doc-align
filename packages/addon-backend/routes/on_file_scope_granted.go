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
// grants drive.file access for the current document.
// In production: docs.id is populated — show the correct card.
// In test mode: Google skips the per-file dialog so docs.id is empty — pop to root so
// the homepage re-fires; the scope is now granted so addonHasFileScopePermission=true there.
func OnFileScopeGranted(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.Docs.ID
		log.Printf("on-file-scope-granted: docs.id=%q user=%s", docID, userEmail)

		if docID == "" {
			// Test mode: drive.file was already globally authorized so Google skipped the
			// per-file dialog and fired this trigger without docs.id. Show the manual
			// attach card so the user can paste the doc URL and break the loop.
			log.Printf("on-file-scope-granted: docs.id empty (test mode), showing attach card")
			writeJSON(w, cards.Push(cards.AttachDocument()))
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
