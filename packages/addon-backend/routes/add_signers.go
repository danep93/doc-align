package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func AddSigners(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.resolveDocID()
		if docID == "" {
			writeActionErr(w, "Could not determine document. Please reload.")
			return
		}

		// Fetch collaborators who have access to the document, excluding the owner.
		var collaborators []cards.Collaborator

		token := ev.AuthorizationEventObject.UserOAuthToken
		if token != "" {
			if perms, ferr := services.ListFilePermissions(ctx, token, docID); ferr == nil {
				for _, p := range perms {
					if p.EmailAddress != "" && p.EmailAddress != userEmail {
						collaborators = append(collaborators, cards.Collaborator{
							Email:       p.EmailAddress,
							DisplayName: p.DisplayName,
						})
					}
				}
			} else {
				log.Printf("add-signers: ListFilePermissions %s: %v", docID, ferr)
			}
		}

		writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
	}
}
