package routes

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func CreateBaseline(store *services.Store, anthropicClient *services.AnthropicClient) http.HandlerFunc {
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

		// PRD completeness coaching runs only on genuinely first-time baseline
		// creation. If a doc record already exists, an owner re-running "Create
		// baseline" must never re-check or overwrite a coachingResult that may
		// already hold manually-typed content.
		isFirstBaseline := doc == nil

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
		if !isFirstBaseline {
			// CreateDoc below is a full overwrite (Set, not merge) — this call already
			// existed before this feature and re-runs the rest of baseline creation too
			// (out of scope to change here), but it must not silently wipe a coaching
			// result that was already resolved.
			rec.CoachingResult = doc.CoachingResult
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

		if !isFirstBaseline {
			writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
			return
		}

		docText, _, fetchErr := services.FetchDocText(ctx, userToken, docID)
		var classifyErr error
		var result *services.PRDCompletenessResult
		if fetchErr != nil {
			log.Printf("create-baseline: FetchDocText: %v (coaching check unavailable)", fetchErr)
			classifyErr = fetchErr
		} else {
			llmCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			result, classifyErr = anthropicClient.ClassifyPRDCompleteness(llmCtx, docText)
			cancel()
			if classifyErr != nil {
				log.Printf("create-baseline: ClassifyPRDCompleteness: %v (coaching check unavailable)", classifyErr)
			}
		}

		coaching, needsCoaching := services.EvaluateCoaching(result, classifyErr, userEmail)
		if err := store.UpdateDocFields(ctx, docID, map[string]any{"coachingResult": coaching}); err != nil {
			log.Printf("create-baseline: UpdateDocFields (coaching): %v (non-fatal)", err)
		}

		if !needsCoaching {
			_ = store.AddHistory(ctx, docID, services.HistoryRecord{
				Action:     "coaching_auto_passed",
				ActorEmail: userEmail,
				Timestamp:  time.Now(),
			})
			writeJSON(w, cards.Push(cards.AddSigners(collaborators, docID)))
			return
		}

		checkFailed := classifyErr != nil
		view := cards.PRDCoachingView{
			PressReleasePresent: coaching.PressReleasePresent,
			PressReleaseText:    coaching.PressReleaseText,
			DoDPresent:          coaching.DoDPresent,
			DoDText:             coaching.DoDText,
		}
		writeJSON(w, cards.Push(cards.PRDCoaching(docTitle, docID, view, checkFailed)))
	}
}
