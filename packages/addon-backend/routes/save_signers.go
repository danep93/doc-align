package routes

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func SaveSigners(store *services.Store, resendKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found. Please create a baseline first.")
			return
		}
		if doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can add signers.")
			return
		}

		selectedEmails := ev.formStrings("signerEmails")
		customEmail := strings.TrimSpace(ev.formString("customEmail"))
		if customEmail != "" {
			selectedEmails = append(selectedEmails, customEmail)
		}

		for _, email := range selectedEmails {
			email = strings.TrimSpace(email)
			if email == "" {
				continue
			}
			if err := store.SetSigner(ctx, docID, email, services.SignerRecord{
				Status: "pending",
			}); err != nil {
				log.Printf("save-signers: SetSigner %s: %v", email, err)
			}
		}

		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:     "review_requested",
			ActorEmail: userEmail,
			Timestamp:  time.Now(),
		})

		// Send sign-off request emails; non-fatal if Resend is unavailable.
		go func() {
			if err := services.SendSignoffRequest(resendKey, userEmail, doc.Title, docID, selectedEmails); err != nil {
				log.Printf("save-signers: send signoff email: %v", err)
			}
		}()

		// Return owner status card.
		signerMap, _ := store.ListSigners(ctx, docID)
		userToken := ev.AuthorizationEventObject.UserOAuthToken
		docChanged, signerMap := services.CheckDocDrift(ctx, store, userToken, docID, doc, signerMap)
		signerStatuses := toSignerStatusList(signerMap)
		writeJSON(w, cards.Push(cards.StatusOwner(doc.Title, signerStatuses, docID, docChanged, doc.OwnerID)))
	}
}
