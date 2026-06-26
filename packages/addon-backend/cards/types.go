package cards

// BaseURL is the public HTTPS base URL of this server (e.g. ngrok URL).
// Must be set at startup. Action button functions are relative paths that get prefixed with this.
var BaseURL string

// RenderActions is the top-level response for action callbacks (button clicks).
// Homepage triggers return a Card directly instead.
type RenderActions struct {
	Action ActionNav `json:"action"`
}

type ActionNav struct {
	Navigations []Navigation `json:"navigations"`
}

type Navigation struct {
	PushCard   *Card `json:"pushCard,omitempty"`
	UpdateCard *Card `json:"updateCard,omitempty"`
	PopToRoot  bool  `json:"popToRoot,omitempty"`
}

// requestingGoogleScopes is the JSON response that triggers Google's granular consent flow.
// The homepage (or any endpoint) returns this instead of a Card to request missing scopes.
// After the user grants, Google re-fires the same trigger with the new scope in authorizedScopes.
type requestingGoogleScopes struct {
	RequestingGoogleScopes struct {
		Scopes []string `json:"scopes"`
	} `json:"requesting_google_scopes"`
}

// RequestingScopes builds the granular-consent response that asks Google for the given scope.
func RequestingScopes(scope string) requestingGoogleScopes {
	var r requestingGoogleScopes
	r.RequestingGoogleScopes.Scopes = []string{scope}
	return r
}

// PopRoot returns a RenderActions that clears the card stack and re-triggers the homepage.
func PopRoot() RenderActions {
	return RenderActions{Action: ActionNav{Navigations: []Navigation{{PopToRoot: true}}}}
}

// Card is the root card object.
type Card struct {
	Name        string       `json:"name"`
	Header      *Header      `json:"header,omitempty"`
	CardActions []CardAction `json:"cardActions,omitempty"`
	Sections    []Section    `json:"sections"`
}

// CardAction appears in the card's 3-dots overflow menu.
type CardAction struct {
	ActionLabel string  `json:"actionLabel"`
	OnClick     OnClick `json:"onClick"`
}

type Header struct {
	Title    string `json:"title"`
	Subtitle string `json:"subtitle,omitempty"`
	ImageUrl string `json:"imageUrl,omitempty"`
}

type Section struct {
	Header                     string   `json:"header,omitempty"`
	Widgets                    []Widget `json:"widgets"`
	CollapsibleWidgetsCount    int      `json:"collapsibleWidgetsCount,omitempty"`
	CollapsibleWidgetsExpanded bool     `json:"collapsibleWidgetsExpanded,omitempty"`
}

type Widget struct {
	TextParagraph   *TextParagraph   `json:"textParagraph,omitempty"`
	DecoratedText   *DecoratedText   `json:"decoratedText,omitempty"`
	ButtonList      *ButtonList      `json:"buttonList,omitempty"`
	TextInput       *TextInput       `json:"textInput,omitempty"`
	SelectionInput  *SelectionInput  `json:"selectionInput,omitempty"`
}

type TextParagraph struct {
	Text string `json:"text"`
}

type DecoratedText struct {
	TopLabel         string   `json:"topLabel,omitempty"`
	Text             string   `json:"text"`
	BottomLabel      string   `json:"bottomLabel,omitempty"`
	StartIcon        *Icon    `json:"startIcon,omitempty"`
	Button           *Button  `json:"button,omitempty"`
	WrapText         bool     `json:"wrapText,omitempty"`
}

type Icon struct {
	KnownIcon    string        `json:"knownIcon,omitempty"`
	IconUrl      string        `json:"iconUrl,omitempty"`
	MaterialIcon *MaterialIcon `json:"materialIcon,omitempty"`
	AltText      string        `json:"altText,omitempty"`
}

type MaterialIcon struct {
	Name string `json:"name"`
}

type ButtonList struct {
	Buttons []Button `json:"buttons"`
}

type Button struct {
	Text     string   `json:"text"`
	OnClick  *OnClick `json:"onClick,omitempty"`
	Disabled bool     `json:"disabled,omitempty"`
	Color    *Color   `json:"color,omitempty"`
	Type     string   `json:"type,omitempty"` // FILLED | OUTLINED | FILLED_TONAL | BORDERLESS
}

type Color struct {
	Red   float64 `json:"red"`
	Green float64 `json:"green"`
	Blue  float64 `json:"blue"`
	Alpha float64 `json:"alpha"`
}

type OnClick struct {
	Action   *FormAction  `json:"action,omitempty"`
	OpenLink *OpenLink    `json:"openLink,omitempty"`
}

type FormAction struct {
	Function    string      `json:"function"`
	Parameters  []Parameter `json:"parameters,omitempty"`
	// Interaction 2 = REQUEST_FILE_SCOPE (proto enum value; string form rejected by current runtime).
	Interaction int         `json:"interaction,omitempty"`
}

type Parameter struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type OpenLink struct {
	Url string `json:"url"`
}

type TextInput struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	HintText    string `json:"hintText,omitempty"`
	Value       string `json:"value,omitempty"`
	Multiline   bool   `json:"multiline,omitempty"`
}

type SelectionInput struct {
	Name          string          `json:"name"`
	Label         string          `json:"label"`
	Type          string          `json:"type"` // MULTI_SELECT, CHECK_BOX, RADIO_BUTTON, SWITCH
	Items         []SelectionItem `json:"items"`
	OnChangeAction *FormAction    `json:"onChangeAction,omitempty"`
}

type SelectionItem struct {
	Text     string `json:"text"`
	Value    string `json:"value"`
	Selected bool   `json:"selected,omitempty"`
}

// editorFileScopeResponse is the response that triggers Google's per-file
// drive.file scope grant dialog for the active document in Editor add-ons
// (Docs/Sheets/Slides). This is the HTTP equivalent of
// CardService.newEditorFileScopeActionResponseBuilder().requestFileScopeForActiveDocument().
// Do NOT use Interaction=REQUEST_FILE_SCOPE — that is for Drive add-ons only.
type editorFileScopeResponse struct {
	RenderActions struct {
		HostAppAction struct {
			EditorAction struct {
				RequestFileScopeForActiveDocument struct{} `json:"requestFileScopeForActiveDocument"`
			} `json:"editorAction"`
		} `json:"hostAppAction"`
	} `json:"renderActions"`
}

// RequestFileScopeForActiveDocument returns the response that shows Google's
// per-file consent dialog for the currently open document.
func RequestFileScopeForActiveDocument() editorFileScopeResponse {
	return editorFileScopeResponse{}
}

// Push returns a RenderActions that pushes card onto the navigation stack.
func Push(card Card) RenderActions {
	return RenderActions{Action: ActionNav{Navigations: []Navigation{{PushCard: &card}}}}
}

// Update returns a RenderActions that replaces the current card in the stack.
func Update(card Card) RenderActions {
	return RenderActions{Action: ActionNav{Navigations: []Navigation{{UpdateCard: &card}}}}
}

func actionButton(text, function string, params ...Parameter) Button {
	fn := function
	if len(fn) > 0 && fn[0] == '/' {
		fn = BaseURL + fn
	}
	return Button{
		Text: text,
		OnClick: &OnClick{
			Action: &FormAction{
				Function:   fn,
				Parameters: params,
			},
		},
	}
}

func filledActionButton(text, function string, params ...Parameter) Button {
	b := actionButton(text, function, params...)
	b.Type = "FILLED"
	return b
}

func outlinedActionButton(text, function string, params ...Parameter) Button {
	b := actionButton(text, function, params...)
	b.Type = "OUTLINED"
	return b
}

func linkButton(text, url string) Button {
	return Button{
		Text:    text,
		OnClick: &OnClick{OpenLink: &OpenLink{Url: url}},
	}
}

func knownIcon(name string) *Icon {
	return &Icon{KnownIcon: name}
}

func matIcon(name string) *Icon {
	return &Icon{MaterialIcon: &MaterialIcon{Name: name}}
}
