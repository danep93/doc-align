package routes

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/doc-align/addon-backend/cards"
)

// AddonEvent is the JSON body Google sends to every HTTPS add-on endpoint.
type AddonEvent struct {
	Docs struct {
		ID                          string `json:"id"`
		Title                       string `json:"title"`
		AddonHasFileScopePermission bool   `json:"addonHasFileScopePermission"`
	} `json:"docs"`
	Gmail struct {
		MessageID string `json:"messageId"`
	} `json:"gmail"`
	AuthorizationEventObject struct {
		UserOAuthToken   string   `json:"userOAuthToken"`
		AuthorizedScopes []string `json:"authorizedScopes"`
	} `json:"authorizationEventObject"`
	FormInput struct {
		SignerEmails  []string `json:"signerEmails"`
		CustomEmail   string   `json:"customEmail"`
		CommitMessage string   `json:"commitMessage"`
	} `json:"formInput"`
	CommonEventObject struct {
		FormInputs map[string]struct {
			StringInputs struct {
				Value []string `json:"value"`
			} `json:"stringInputs"`
		} `json:"formInputs"`
		Parameters map[string]string `json:"parameters"`
	} `json:"commonEventObject"`
}

// decodeEvent decodes the request body into an AddonEvent and logs the raw JSON for debugging.
func decodeEvent(r *http.Request) (AddonEvent, error) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return AddonEvent{}, err
	}
	log.Printf("RAW EVENT [%s]: %s", r.URL.Path, raw)
	var ev AddonEvent
	err = json.NewDecoder(bytes.NewReader(raw)).Decode(&ev)
	return ev, err
}

// formString reads a named text-input value from the Card Service form submission.
func (ev AddonEvent) formString(name string) string {
	if fi, ok := ev.CommonEventObject.FormInputs[name]; ok {
		if len(fi.StringInputs.Value) > 0 {
			return fi.StringInputs.Value[0]
		}
	}
	return ""
}

// formStrings reads a multi-select value from the Card Service form submission.
func (ev AddonEvent) formStrings(name string) []string {
	if fi, ok := ev.CommonEventObject.FormInputs[name]; ok {
		return fi.StringInputs.Value
	}
	return nil
}

// param reads an action parameter passed via FormAction.Parameters.
func (ev AddonEvent) param(key string) string {
	return ev.CommonEventObject.Parameters[key]
}

// writeJSON serialises v and writes it as an application/json response.
func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// errorCard builds a bare error Card. Callers decide whether it needs cards.Push
// wrapping (action callbacks) or not (homepage-style triggers).
func errorCard(msg string) cards.Card {
	return cards.Card{
		Name: "error",
		Sections: []cards.Section{
			{Widgets: []cards.Widget{
				{TextParagraph: &cards.TextParagraph{Text: msg}},
			}},
		},
	}
}

// writeErr writes a bare Card error. Use only for homepage triggers.
func writeErr(w http.ResponseWriter, msg string) {
	writeJSON(w, errorCard(msg))
}

// writeRESTErr writes a JSON error response for plain REST endpoints.
func writeRESTErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// writeActionErr writes an error card wrapped in RenderActions, required for action callbacks.
func writeActionErr(w http.ResponseWriter, msg string) {
	writeJSON(w, cards.Push(errorCard(msg)))
}

// hasScope reports whether scope is present in the event's authorizedScopes list.
func (ev AddonEvent) hasScope(scope string) bool {
	for _, s := range ev.AuthorizationEventObject.AuthorizedScopes {
		if s == scope {
			return true
		}
	}
	return false
}

// resolveDocID returns the document ID from the action parameter (embedded by card builders)
// or falls back to the docs field in the event (populated in action callbacks, not homepage triggers).
func (ev AddonEvent) resolveDocID() string {
	if id := ev.param("docId"); id != "" {
		return id
	}
	return ev.Docs.ID
}
