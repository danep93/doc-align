package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// OnFileScopeGranted handles the onFileScopeGrantedTrigger, which fires after the user
// grants drive.file access for the current document. Shares resolveStatusCard with
// Homepage — the only difference is this fires from an action-style trigger, so the
// result needs cards.Push wrapping.
func OnFileScopeGranted(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		userToken := ev.AuthorizationEventObject.UserOAuthToken
		log.Printf("on-file-scope-granted: docs.id=%q user=%s", docID, userEmail)

		writeJSON(w, cards.Push(resolveStatusCard(ctx, store, userEmail, userToken, docID)))
	}
}
