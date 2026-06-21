package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func Homepage(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.Docs.ID
		log.Printf("homepage: docs.id=%q title=%q scope=%v authorizedScopes=%v user=%s",
			docID, ev.Docs.Title, ev.Docs.AddonHasFileScopePermission,
			ev.AuthorizationEventObject.AuthorizedScopes, userEmail)

		if docID == "" {
			// docs.id is absent — show a card with REQUEST_FILE_SCOPE button.
			// When the user clicks, Google requests per-file drive.file access for the
			// currently open document and fires onFileScopeGrantedTrigger with docs.id.
			log.Printf("homepage: docs.id absent — showing connect card")
			writeJSON(w, cards.ConnectDocument())
			return
		}

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			if isNotFound(err) {
				writeJSON(w, cards.EmptyState(true, docID))
				return
			}
			log.Printf("homepage: GetDoc %s: %v", docID, err)
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		isOwner := doc.OwnerID == userEmail

		signerMap, err := store.ListSigners(ctx, docID)
		if err != nil {
			log.Printf("homepage: ListSigners: %v", err)
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		if isOwner {
			signerStatuses := toSignerStatusList(signerMap)
			writeJSON(w, cards.StatusOwner(doc.Title, signerStatuses, docID))
			return
		}

		// Signer view
		signerRec, exists := signerMap[userEmail]
		if !exists {
			writeJSON(w, cards.EmptyState(false, docID))
			return
		}

		ss := recordToStatus(userEmail, signerRec)
		writeJSON(w, cards.StatusSigner(doc.Title, ss, "", docID))
	}
}

func isNotFound(err error) bool {
	return status.Code(err) == codes.NotFound
}

func toSignerStatusList(m map[string]services.SignerRecord) []cards.SignerStatus {
	result := make([]cards.SignerStatus, 0, len(m))
	for email, rec := range m {
		result = append(result, recordToStatus(email, rec))
	}
	return result
}

func recordToStatus(email string, rec services.SignerRecord) cards.SignerStatus {
	return cards.SignerStatus{
		Email:         email,
		Status:        rec.Status,
		StatusAt:      rec.SignedAt,
		CommitMessage: rec.CommitMessage,
	}
}
