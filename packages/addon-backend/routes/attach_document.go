package routes

import (
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/services"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var docIDRegexp = regexp.MustCompile(`/document/d/([a-zA-Z0-9_-]+)`)

func ShowAttachDocument() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, cards.Push(cards.AttachDocument()))
	}
}

func SubmitAttachDocument(store *services.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userEmail := middleware.EmailFromContext(ctx)

		ev, err := decodeEvent(r)
		if err != nil {
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		raw := strings.TrimSpace(ev.formString("docUrl"))
		docID := ""
		if m := docIDRegexp.FindStringSubmatch(raw); len(m) > 1 {
			docID = m[1]
		} else if !strings.Contains(raw, "/") && !strings.Contains(raw, " ") && len(raw) > 10 {
			// User pasted just the doc ID.
			docID = raw
		}

		if docID == "" {
			writeActionErr(w, "Could not find a document ID. Paste the full Google Doc URL.")
			return
		}

		log.Printf("attach-document-submit: docID=%q user=%s", docID, userEmail)

		doc, err := store.GetDoc(ctx, docID)
		if err != nil {
			if status.Code(err) == codes.NotFound {
				writeJSON(w, cards.Update(cards.EmptyState(true, docID)))
				return
			}
			log.Printf("attach-document-submit: GetDoc %s: %v", docID, err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		isOwner := doc.OwnerID == userEmail
		signerMap, err := store.ListSigners(ctx, docID)
		if err != nil {
			log.Printf("attach-document-submit: ListSigners: %v", err)
			writeActionErr(w, "Something went wrong. Please try again.")
			return
		}

		if isOwner {
			writeJSON(w, cards.Update(cards.StatusOwner(doc.Title, toSignerStatusList(signerMap), docID)))
			return
		}

		signerRec, exists := signerMap[userEmail]
		if !exists {
			writeJSON(w, cards.Update(cards.EmptyState(false, docID)))
			return
		}

		ss := recordToStatus(userEmail, signerRec)
		writeJSON(w, cards.Update(cards.StatusSigner(doc.Title, ss, "", docID)))
	}
}
