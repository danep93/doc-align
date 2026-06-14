package cards

// Top-level response Google expects from every add-on endpoint.
type Response struct {
	RenderActions RenderActions `json:"renderActions"`
}

type RenderActions struct {
	Action Action `json:"action"`
}

type Action struct {
	Navigation Navigation `json:"navigation"`
}

type Navigation struct {
	PushCard   *Card `json:"pushCard,omitempty"`
	UpdateCard *Card `json:"updateCard,omitempty"`
}

// Card is the root card object.
type Card struct {
	Name     string    `json:"name"`
	Header   *Header   `json:"header,omitempty"`
	Sections []Section `json:"sections"`
}

type Header struct {
	Title    string `json:"title"`
	Subtitle string `json:"subtitle,omitempty"`
	ImageUrl string `json:"imageUrl,omitempty"`
}

type Section struct {
	Header                    string   `json:"header,omitempty"`
	HasSeparator              bool     `json:"hasSeparator,omitempty"`
	Widgets                   []Widget `json:"widgets"`
	CollapsibleWidgetsCount   int      `json:"collapsibleWidgetsCount,omitempty"`
	CollapsibleWidgetsExpanded bool    `json:"collapsibleWidgetsExpanded,omitempty"`
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
	KnownIcon  string `json:"knownIcon,omitempty"`
	IconUrl    string `json:"iconUrl,omitempty"`
	AltText    string `json:"altText,omitempty"`
}

type ButtonList struct {
	Buttons []Button `json:"buttons"`
}

type Button struct {
	Text     string  `json:"text"`
	OnClick  OnClick `json:"onClick"`
	Disabled bool    `json:"disabled,omitempty"`
	Color    *Color  `json:"color,omitempty"`
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
	Function   string      `json:"function"`
	Parameters []Parameter `json:"parameters,omitempty"`
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

// Helper: build a push-card response.
func Push(card Card) Response {
	return Response{
		RenderActions: RenderActions{
			Action: Action{
				Navigation: Navigation{
					PushCard: &card,
				},
			},
		},
	}
}

// Helper: build an update-card response (replaces current card in stack).
func Update(card Card) Response {
	return Response{
		RenderActions: RenderActions{
			Action: Action{
				Navigation: Navigation{
					UpdateCard: &card,
				},
			},
		},
	}
}

func actionButton(text, function string, params ...Parameter) Button {
	return Button{
		Text: text,
		OnClick: OnClick{
			Action: &FormAction{
				Function:   function,
				Parameters: params,
			},
		},
	}
}

func linkButton(text, url string) Button {
	return Button{
		Text:    text,
		OnClick: OnClick{OpenLink: &OpenLink{Url: url}},
	}
}

func knownIcon(name string) *Icon {
	return &Icon{KnownIcon: name}
}
