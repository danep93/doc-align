package routes

import (
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// BackToStatus is the action-callback equivalent of the homepage trigger — used by
// "Back"/"Cancel" buttons on cards like SignForm, DiffView, and AddSigners that need to
// return to the current status view. Homepage can't be reused directly for this: it
// reads docs.id (only populated on the real trigger event) and returns a bare Card,
// which action callbacks can't render (see the FormAction/RenderActions invariant in
// CLAUDE.md). This route reads docId from the button's parameter instead, via
// resolveDocID, and wraps the same resolveStatusCard result in cards.Push.
func BackToStatus(store *services.Store) http.HandlerFunc {
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

		writeJSON(w, cards.Push(resolveStatusCard(ctx, store, userEmail, userToken, docID)))
	}
}
