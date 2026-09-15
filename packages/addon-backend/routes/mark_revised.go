package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// MarkRevised (route /addon/mark-revised, surfaced as "Confirm new version") is an
// optional owner action, not a gate: it diffs the pinned baseline against the current
// text, stores the section-level summary (headings + counts + note, never text), bumps
// confirmedVersion, pins a new baseline, and notifies anyone currently drifted that a
// fresh note/diff is available. Nobody's ability to sign depends on this ever running —
// that's driven entirely by the live per-signer check in services.CheckDocDrift.
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
		note := ev.formString("confirmNote")

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			writeActionErr(w, "Document not found.")
			return
		}
		if doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can confirm a new version.")
			return
		}

		modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
		if err != nil {
			log.Printf("mark-revised: FileModifiedTime: %v", err)
			writeActionErr(w, "Couldn't reach Google Drive. Try again.")
			return
		}

		currentText, _, err := services.FetchDocText(ctx, userToken, docID)
		if err != nil {
			log.Printf("mark-revised: FetchDocText: %v", err)
			writeActionErr(w, "Couldn't reach Google Drive. Try again.")
			return
		}

		// Diff against the pinned baseline. An empty/broken baseline (pre-schema doc,
		// or Drive pruned it) degrades to a summary without section detail.
		var result services.DriftResult
		if doc.BaselineRevisionID != "" {
			if baselineText, err := services.ExportRevisionText(ctx, userToken, docID, doc.BaselineRevisionID); err != nil {
				log.Printf("mark-revised: ExportRevisionText %s: %v (summary without sections)", doc.BaselineRevisionID, err)
			} else {
				result = services.DetectDrift(currentText, baselineText)
			}
		}

		newRevID, err := services.LatestRevisionID(ctx, userToken, docID)
		if err != nil {
			log.Printf("mark-revised: LatestRevisionID: %v (non-fatal)", err)
			newRevID = ""
		}
		if newRevID != "" {
			if err := services.KeepRevisionForever(ctx, userToken, docID, newRevID); err != nil {
				log.Printf("mark-revised: KeepRevisionForever: %v (non-fatal)", err)
			}
		}

		summary := services.BuildChangeSummary(result, note, doc.BaselineRevisionID, newRevID)
		newVersion := doc.ConfirmedVersion + 1
		if err := store.ConfirmNewVersion(ctx, docID, newVersion, summary, newRevID, modifiedTime); err != nil {
			log.Printf("mark-revised: ConfirmNewVersion: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		now := time.Now()
		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:        "version_confirmed",
			ActorEmail:    userEmail,
			CommitMessage: note,
			RevisionID:    newRevID,
			Timestamp:     now,
		})

		// Notify signers who are currently drifted that a fresh note/diff is
		// available. Purely informational — it doesn't change anyone's ability to sign.
		signerMap, err := store.ListSigners(ctx, docID)
		if err != nil {
			log.Printf("mark-revised: ListSigners: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		for email, rec := range signerMap {
			if rec.Status != "drifted" || email == doc.OwnerID {
				continue
			}
			if err := services.SendDriftNotification(resendKey, email, userEmail, doc.Title, docID, summary); err != nil {
				log.Printf("mark-revised: SendDriftNotification %s: %v", email, err)
				continue
			}
			if err := store.UpdateSignerStatus(ctx, docID, email, rec.Status, map[string]interface{}{
				"notifiedAt": now,
			}); err != nil {
				log.Printf("mark-revised: UpdateSignerStatus notifiedAt %s: %v", email, err)
			}
		}

		writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, false, doc.OwnerID, true)))
	}
}
