package routes

import (
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
)

func History(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		_ = middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		docID := ev.Docs.ID
		recs, err := store.ListHistory(ctx, docID)
		if err != nil {
			log.Printf("history: ListHistory: %v", err)
			writeErr(w, "Something went wrong. Please try again.")
			return
		}

		entries := make([]cards.HistoryEntry, len(recs))
		for i, rec := range recs {
			entries[i] = cards.HistoryEntry{
				Action:        rec.Action,
				ActorEmail:    rec.ActorEmail,
				ActorName:     rec.ActorName,
				CommitMessage: rec.CommitMessage,
				Timestamp:     rec.Timestamp,
			}
		}
		writeJSON(w, cards.HistoryView(entries))
	}
}
