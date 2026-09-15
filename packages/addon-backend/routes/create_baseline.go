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
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		docTitle := ev.Docs.Title
		userToken := ev.AuthorizationEventObject.UserOAuthToken

		if docID == "" {
			writeActionErr(w, "Could not determine document ID. Please reopen the add-on.")
			return
		}

		// Get or create the doc record.
		doc, err := store.GetDoc(ctx, docID)
		if err != nil && !isNotFound(err) {
			log.Printf("create-baseline: GetDoc: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		// Only the owner (first to create baseline) can create it.
		if doc != nil && doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can create a baseline.")
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

		modifiedTime, err := services.FileModifiedTime(ctx, userToken, docID)
		if err != nil {
			log.Printf("create-baseline: FileModifiedTime: %v (using now)", err)
			modifiedTime = time.Now()
		}

		rec := services.DocRecord{
			Title:                 docTitle,
			OwnerID:               userEmail,
			BaselineRevisionID:    revID,
			ConfirmedVersion:      1,
			ConfirmedModifiedTime: modifiedTime,
			CreatedAt:             time.Now(),
		}
		if err := store.CreateDoc(ctx, docID, rec); err != nil {
			log.Printf("create-baseline: CreateDoc: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:     "baseline_created",
			ActorEmail: userEmail,
			RevisionID: revID,
			Timestamp:  time.Now(),
		})

		// Add the owner as a signer too, so they can sign off on their own doc
		// alongside everyone they invite. Only on first-time creation — a re-run
		// must not reset an owner who has already signed back to "pending".
		if doc == nil {
			if err := store.SetSigner(ctx, docID, userEmail, services.SignerRecord{Status: "pending"}); err != nil {
				log.Printf("create-baseline: SetSigner (owner) %s: %v (non-fatal)", userEmail, err)
			}
		}

		// Fetch collaborators from Drive permissions, excluding the owner.
		var collaborators []cards.Collaborator
		if userToken != "" {
			if perms, err := services.ListFilePermissions(ctx, userToken, docID); err == nil {
				for _, p := range perms {
					if p.EmailAddress != "" && p.EmailAddress != userEmail {
						collaborators = append(collaborators, cards.Collaborator{
							Email:       p.EmailAddress,
							DisplayName: p.DisplayName,
						})
					}
				}
			} else {
				log.Printf("create-baseline: ListFilePermissions %s: %v", docID, err)
			}
		}

		writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
	}
}
