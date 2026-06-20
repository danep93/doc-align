package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func QuickSign(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		userToken := ev.AuthorizationEventObject.UserOAuthToken
		message := ev.param("message")

		revID, err := services.LatestRevisionID(ctx, userToken, docID)
		if err != nil {
			log.Printf("quick-sign: LatestRevisionID: %v (non-fatal)", err)
		}

		now := time.Now()
		if err := store.UpdateSignerStatus(ctx, docID, userEmail, "signed", map[string]interface{}{
			"signedAt":         now,
			"signedRevisionId": revID,
			"commitMessage":    message,
		}); err != nil {
			log.Printf("quick-sign: UpdateSignerStatus: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:        "signed",
			ActorEmail:    userEmail,
			CommitMessage: message,
			RevisionID:    revID,
			Timestamp:     now,
		})

		doc, _ := store.GetDoc(ctx, docID)
		signerMap, _ := store.ListSigners(ctx, docID)
		rec := signerMap[userEmail]
		ss := recordToStatus(userEmail, rec)
		writeJSON(w, cards.Push(cards.StatusSigner(doc.Title, ss, "", docID)))
	}
}
