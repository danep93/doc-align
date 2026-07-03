package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// MarkRevised is the owner-only action that confirms the current drift episode is ready for
// re-review: it emails every signer who drifted since the owner's last confirmation and unlocks
// their ability to re-sign (see the DriftConfirmed gating check in cards/status_signer.go and
// the server-side guard in routes/sign.go / routes/quick_sign.go).
func MarkRevised(store *services.Store, resendKey string) http.HandlerFunc {
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

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}
		if doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can confirm changes are ready for re-review.")
			return
		}

		signerMap, err := store.ListSigners(ctx, docID)
		if err != nil {
			log.Printf("mark-revised: ListSigners: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		unconfirmed := make(map[string]services.SignerRecord)
		for email, rec := range signerMap {
			if rec.Status == "drifted" && rec.NotifiedAt.Before(rec.DriftDetectedAt) {
				unconfirmed[email] = rec
			}
		}

		if len(unconfirmed) > 0 {
			currentText, _, err := services.FetchDocText(ctx, userToken, docID)
			if err != nil {
				log.Printf("mark-revised: FetchDocText: %v", err)
				writeActionErr(w, "Couldn't reach Google Drive. Try again.")
				return
			}

			now := time.Now()
			for email, rec := range unconfirmed {
				added, removed := 0, 0
				if signedText, err := services.ExportRevisionText(ctx, userToken, docID, rec.SignedRevisionID); err != nil {
					log.Printf("mark-revised: ExportRevisionText %s: %v (sending without counts)", email, err)
				} else {
					result := services.DetectDrift(currentText, signedText)
					added, removed = result.Added, result.Removed
				}

				if err := services.SendDriftNotification(resendKey, email, userEmail, doc.Title, docID, added, removed); err != nil {
					log.Printf("mark-revised: SendDriftNotification %s: %v", email, err)
				}

				if err := store.UpdateSignerStatus(ctx, docID, email, "drifted", map[string]interface{}{
					"notifiedAt": now,
				}); err != nil {
					log.Printf("mark-revised: UpdateSignerStatus %s: %v", email, err)
					continue
				}
				rec.NotifiedAt = now
				signerMap[email] = rec
			}

			_ = store.AddHistory(ctx, docID, services.HistoryRecord{
				Action:     "revised_notified",
				ActorEmail: userEmail,
				Timestamp:  now,
			})
		}

		writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID)))
	}
}
