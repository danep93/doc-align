package routes

import (
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func CreateBaseline(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.Docs.ID
		docTitle := ev.Docs.Title
		userToken := ev.AuthorizationEventObject.UserOAuthToken

		// Get or create the doc record.
		doc, err := store.GetDoc(ctx, docID)
		if err != nil && !isNotFound(err) {
			log.Printf("create-baseline: GetDoc: %v", err)
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		// Only the owner (first to create baseline) can create it.
		if doc != nil && doc.OwnerID != userEmail {
			writeErr(w, "Only the document owner can create a baseline.")
			return
		}

		// Mark the current revision as keepForever.
		revID, err := services.LatestRevisionID(ctx, userToken, docID)
		if err != nil {
			log.Printf("create-baseline: LatestRevisionID: %v", err)
			// Don't block baseline creation if Drive API fails — store empty revID.
			revID = ""
		}
		if revID != "" {
			if err := services.KeepRevisionForever(ctx, userToken, docID, revID); err != nil {
				log.Printf("create-baseline: KeepRevisionForever: %v (non-fatal)", err)
			}
		}

		rec := services.DocRecord{
			Title:              docTitle,
			OwnerID:            userEmail,
			BaselineRevisionID: revID,
			CreatedAt:          time.Now(),
		}
		if err := store.CreateDoc(ctx, docID, rec); err != nil {
			log.Printf("create-baseline: CreateDoc: %v", err)
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:     "baseline_created",
			ActorEmail: userEmail,
			RevisionID: revID,
			Timestamp:  time.Now(),
		})

		// Fetch collaborators to pre-populate the signer picker.
		// For MVP, return empty list; Drive collaborator fetch is Phase 2.
		var collaborators []cards.Collaborator
		writeJSON(w, cards.AddSigners(collaborators))
	}
}
