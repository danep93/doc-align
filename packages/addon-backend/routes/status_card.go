package routes

import (
	"context"
	"log"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/services"
)

// resolveStatusCard determines which card to show for the current user on this
// document: ConnectDocument (drive.file not yet granted), EmptyState (no baseline, or
// not a signer), StatusOwner, or StatusSigner. This is the single source of truth for
// "what does this user see right now" — shared by the homepage trigger, the
// onFileScopeGrantedTrigger, and the back-to-status action route, so all three agree.
// Returns a bare Card; callers wrap in cards.Push themselves if they're an action
// callback rather than a trigger.
func resolveStatusCard(ctx context.Context, store *services.Store, userEmail, userToken, docID string) cards.Card {
	if docID == "" {
		return cards.ConnectDocument()
	}

	doc, err := store.GetDoc(ctx, docID)
	if err != nil {
		if isNotFound(err) {
			return cards.EmptyState(true, docID)
		}
		log.Printf("resolveStatusCard: GetDoc %s: %v", docID, err)
		return errorCard("Something went wrong. Please try again.")
	}

	isOwner := doc.OwnerID == userEmail

	signerMap, err := store.ListSigners(ctx, docID)
	if err != nil {
		log.Printf("resolveStatusCard: ListSigners: %v", err)
		return errorCard("Something went wrong. Please try again.")
	}

	docChanged, signerMap := services.CheckDocDrift(ctx, store, userToken, docID, doc, signerMap)

	if isOwner {
		return cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID, docChanged, doc.OwnerID)
	}

	if _, isSigner := signerMap[userEmail]; !isSigner {
		return cards.EmptyState(false, docID)
	}

	ownerName := services.DisplayName(doc.OwnerID)
	return cards.StatusSigner(doc.Title, ownerName, toSignerStatusList(signerMap), userEmail, docID, docChanged, summaryToView(doc.ChangeSummary))
}
