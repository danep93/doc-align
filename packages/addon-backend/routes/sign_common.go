package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// completeSign is the body of Sign. The only gate on signing at all is whether the
// document owner has completed their own first sign-off — once that's happened, every
// signer (the owner included, on later re-signs) can sign or re-sign at any time
// against the current document state, with no further single-person bottleneck. It
// records the live modifiedTime at the moment of signing (used later to detect when
// this specific signature goes stale — see services.SignersToDrift) and re-renders the
// signer's own card.
func completeSign(w http.ResponseWriter, r *http.Request, store *services.Store, resendKey string, ev AddonEvent, commitMsg string) {
	ctx := r.Context()
	userEmail := middleware.EmailFromContext(ctx)

	docID := ev.resolveDocID()
	userToken := ev.AuthorizationEventObject.UserOAuthToken

	doc, err := store.GetDoc(ctx, docID)
	if err != nil {
		writeActionErr(w, "Document not found.")
		return
	}

	isOwner := userEmail == doc.OwnerID

	if !isOwner {
		ownerRec, err := store.GetSigner(ctx, docID, doc.OwnerID)
		if err != nil || ownerRec.Status == "pending" {
			writeActionErr(w, "The document owner needs to sign off first before anyone else can sign.")
			return
		}
	}

	modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("sign: FileModifiedTime: %v", err)
		writeActionErr(w, "Couldn't verify the document is unchanged. Please try again.")
		return
	}

	now := time.Now()
	if err := store.UpdateSignerStatus(ctx, docID, userEmail, "signed", map[string]interface{}{
		"signedAt":           now,
		"signedModifiedTime": modifiedTime,
		"commitMessage":      commitMsg,
	}); err != nil {
		log.Printf("sign: UpdateSignerStatus: %v", err)
		writeActionErr(w, "Something went wrong. Please try again.")
		return
	}

	_ = store.AddHistory(ctx, docID, services.HistoryRecord{
		Action:        "signed",
		ActorEmail:    userEmail,
		CommitMessage: commitMsg,
		Timestamp:     now,
	})

	// Don't email the owner that they signed their own document.
	if !isOwner {
		go func() {
			if err := services.SendSignedNotification(resendKey, doc.OwnerID, userEmail, doc.Title, docID); err != nil {
				log.Printf("sign: SendSignedNotification: %v", err)
			}
		}()
	}

	signerMap, _ := store.ListSigners(ctx, docID)
	if isOwner {
		writeJSON(w, cards.Push(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, false, doc.OwnerID, doc.ChangeSummary != nil)))
		return
	}
	ownerName := services.DisplayName(doc.OwnerID)
	writeJSON(w, cards.Push(cards.StatusSigner(doc.Title, ownerName, toSignerStatusList(signerMap), userEmail, docID, true, summaryToView(doc.ChangeSummary))))
}

// summaryToView converts the stored summary to the cards-layer type (cards cannot
// import services).
func summaryToView(s *services.ChangeSummary) *cards.ChangeSummaryView {
	if s == nil {
		return nil
	}
	sections := make([]cards.DiffSection, 0, len(s.Sections))
	for _, sec := range s.Sections {
		sections = append(sections, cards.DiffSection{Title: sec.Title, Added: sec.Added, Removed: sec.Removed})
	}
	return &cards.ChangeSummaryView{
		Note:           s.Note,
		Sections:       sections,
		TotalAdded:     s.TotalAdded,
		TotalRemoved:   s.TotalRemoved,
		FromRevisionID: s.FromRevisionID,
		ToRevisionID:   s.ToRevisionID,
	}
}
