package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func Sign(store *services.Store, resendKey string) http.HandlerFunc {
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
		commitMsg := ev.formString("commitMessage")

		revID, err := services.LatestRevisionID(ctx, userToken, docID)
		if err != nil {
			log.Printf("sign: LatestRevisionID: %v (non-fatal)", err)
		}

		now := time.Now()
		if err := store.UpdateSignerStatus(ctx, docID, userEmail, "signed", map[string]interface{}{
			"signedAt":         now,
			"signedRevisionId": revID,
			"commitMessage":    commitMsg,
		}); err != nil {
			log.Printf("sign: UpdateSignerStatus: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:        "signed",
			ActorEmail:    userEmail,
			CommitMessage: commitMsg,
			RevisionID:    revID,
			Timestamp:     now,
		})

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		go func() {
			if err := services.SendSignedNotification(resendKey, doc.OwnerID, userEmail, doc.Title, docID); err != nil {
				log.Printf("sign: SendSignedNotification: %v", err)
			}
		}()

		signerMap, _ := store.ListSigners(ctx, docID)
		ownerName := services.DisplayName(doc.OwnerID)
		allSigners := toSignerStatusList(signerMap)
		writeJSON(w, cards.Push(cards.StatusSigner(doc.Title, ownerName, allSigners, userEmail, docID)))
	}
}
