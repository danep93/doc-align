package routes

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

// CoachResolve handles the PRDCoaching card's "Continue" submission: it merges
// any manually-typed field with whatever the classifier already found, persists
// the final result, and proceeds to AddSigners exactly as CreateBaseline would
// have if coaching hadn't been needed. It never blocks — a blank manual field
// is recorded as an explicit skip, not an error.
func CoachResolve(store *services.Store) http.HandlerFunc {
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
			if isNotFound(err) {
				writeActionErr(w, "Document not found.")
			} else {
				log.Printf("coach-resolve: GetDoc: %v", err)
				writeActionErr(w, "Something went wrong. Please try again.")
			}
			return
		}
		if doc.OwnerID != userEmail {
			writeActionErr(w, "Only the document owner can resolve this.")
			return
		}

		final := services.PRDCoachingResult{ResolvedAt: time.Now(), ResolvedBy: userEmail}

		if doc.CoachingResult != nil && doc.CoachingResult.PressReleasePresent {
			final.PressReleasePresent = true
			final.PressReleaseText = doc.CoachingResult.PressReleaseText
			final.PressReleaseSource = "llm"
		} else if manual := strings.TrimSpace(ev.formString("pressReleaseManual")); manual != "" {
			final.PressReleasePresent = true
			final.PressReleaseText = manual
			final.PressReleaseSource = "manual"
		} else {
			final.PressReleaseSource = "skipped"
		}

		if doc.CoachingResult != nil && doc.CoachingResult.DoDPresent {
			final.DoDPresent = true
			final.DoDText = doc.CoachingResult.DoDText
			final.DoDSource = "llm"
		} else if manual := strings.TrimSpace(ev.formString("dodManual")); manual != "" {
			final.DoDPresent = true
			final.DoDText = manual
			final.DoDSource = "manual"
		} else {
			final.DoDSource = "skipped"
		}

		if err := store.UpdateDocFields(ctx, docID, map[string]any{"coachingResult": final}); err != nil {
			log.Printf("coach-resolve: UpdateDocFields: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}
		_ = store.AddHistory(ctx, docID, services.HistoryRecord{
			Action:        "coaching_resolved",
			ActorEmail:    userEmail,
			CommitMessage: fmt.Sprintf("pressRelease:%s dod:%s", final.PressReleaseSource, final.DoDSource),
			Timestamp:     time.Now(),
		})

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
				log.Printf("coach-resolve: ListFilePermissions %s: %v", docID, err)
			}
		}

		writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
	}
}
