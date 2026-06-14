package routes

import (
	"encoding/json"
	"net/http"
)

// AddonEvent is the JSON body Google sends to every HTTPS add-on endpoint.
type AddonEvent struct {
	Docs struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	} `json:"docs"`
	Gmail struct {
		MessageID string `json:"messageId"`
	} `json:"gmail"`
	AuthorizationEventObject struct {
		UserOAuthToken string `json:"userOAuthToken"`
	} `json:"authorizationEventObject"`
	FormInput struct {
		// Card form field values are nested under formInput.
		SignerEmails   []string `json:"signerEmails"`
		CustomEmail    string   `json:"customEmail"`
		CommitMessage  string   `json:"commitMessage"`
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

// decodeEvent decodes the request body into an AddonEvent.
func decodeEvent(r *http.Request) (AddonEvent, error) {
	var ev AddonEvent
	err := json.NewDecoder(r.Body).Decode(&ev)
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

// writeErr writes a minimal error card response.
func writeErr(w http.ResponseWriter, msg string) {
	type errCard struct {
		RenderActions struct {
			Action struct {
				Navigation struct {
					PushCard struct {
						Name     string `json:"name"`
						Sections []struct {
							Widgets []struct {
								TextParagraph struct {
									Text string `json:"text"`
								} `json:"textParagraph"`
							} `json:"widgets"`
						} `json:"sections"`
					} `json:"pushCard"`
				} `json:"navigation"`
			} `json:"action"`
		} `json:"renderActions"`
	}
	var resp errCard
	resp.RenderActions.Action.Navigation.PushCard.Name = "error"
	resp.RenderActions.Action.Navigation.PushCard.Sections = []struct {
		Widgets []struct {
			TextParagraph struct {
				Text string `json:"text"`
			} `json:"textParagraph"`
		} `json:"widgets"`
	}{
		{
			Widgets: []struct {
				TextParagraph struct {
					Text string `json:"text"`
				} `json:"textParagraph"`
			}{
				{TextParagraph: struct {
					Text string `json:"text"`
				}{Text: msg}},
			},
		},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
