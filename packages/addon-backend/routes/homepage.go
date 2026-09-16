package routes

import (
	"log"
	"net/http"
	"sort"

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
		userToken := ev.AuthorizationEventObject.UserOAuthToken
		log.Printf("homepage: docs.id=%q title=%q user=%s", docID, ev.Docs.Title, userEmail)

		writeJSON(w, resolveStatusCard(ctx, store, userEmail, userToken, docID))
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
	sort.Slice(result, func(i, j int) bool { return result[i].Email < result[j].Email })
	return result
}

func recordToStatus(email string, rec services.SignerRecord) cards.SignerStatus {
	return cards.SignerStatus{
		Email:           email,
		Status:          rec.Status,
		StatusAt:        rec.SignedAt,
		CommitMessage:   rec.CommitMessage,
		DriftDetectedAt: rec.DriftDetectedAt,
		NotifiedAt:      rec.NotifiedAt,
		SignCount:       rec.SignCount,
	}
}
