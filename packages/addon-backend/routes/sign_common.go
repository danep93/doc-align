package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// completeSign is the shared body of Sign and QuickSign. It gates on unconfirmed doc
// changes (fail closed: a Drive error here blocks signing), records the sign against
// the doc's confirmedVersion — never a revision ID, which the Revisions API silently
// withholds from non-owners — and re-renders the signer card.
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

	modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("sign: FileModifiedTime: %v", err)
		writeActionErr(w, "Couldn't verify the document is unchanged. Please try again.")
		return
	}
	if services.DocChanged(modifiedTime, doc.ConfirmedModifiedTime) {
		writeActionErr(w, "The document has changed since the last confirmed version. The owner needs to confirm the changes before sign-offs can continue.")
		return
	}

	now := time.Now()
	if err := store.UpdateSignerStatus(ctx, docID, userEmail, "signed", map[string]interface{}{
		"signedAt":      now,
		"signedVersion": doc.ConfirmedVersion,
		"commitMessage": commitMsg,
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

	go func() {
		if err := services.SendSignedNotification(resendKey, doc.OwnerID, userEmail, doc.Title, docID); err != nil {
			log.Printf("sign: SendSignedNotification: %v", err)
		}
	}()

	signerMap, _ := store.ListSigners(ctx, docID)
	ownerName := services.DisplayName(doc.OwnerID)
	writeJSON(w, cards.Push(cards.StatusSigner(doc.Title, ownerName, toSignerStatusList(signerMap), userEmail, docID, false, summaryToView(doc.ChangeSummary))))
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
