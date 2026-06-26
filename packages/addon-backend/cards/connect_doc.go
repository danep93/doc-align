package cards

// ConnectDocument is shown when docs.id is absent on the homepage trigger.
// The button calls /addon/request-file-scope which returns the
// requestFileScopeForActiveDocument editor action — the correct mechanism for
// Editor add-ons (Docs/Sheets/Slides) to trigger Google's per-file consent dialog.
// After the user grants, onFileScopeGrantedTrigger fires with docs.id populated.
func ConnectDocument() Card {
	return Card{
		Name:   "connect_document",
		Header: &Header{Title: "doc-align"},
		Sections: []Section{{
			Widgets: []Widget{
				{DecoratedText: &DecoratedText{
					StartIcon:   matIcon("lock_open"),
					Text:        "Identify this document",
					BottomLabel: "doc-align needs one-time access to load this document.",
					WrapText:    true,
				}},
				{ButtonList: &ButtonList{Buttons: []Button{{
					Text:    "Connect this document",
					Type:    "FILLED",
					OnClick: &OnClick{Action: &FormAction{Function: BaseURL + "/addon/request-file-scope"}},
				}}}},
			},
		}},
	}
}
