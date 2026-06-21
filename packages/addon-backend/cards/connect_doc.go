package cards

// ConnectDocument is shown when docs.id is absent on the homepage trigger.
// The button uses REQUEST_FILE_SCOPE (Interaction=2) so Google requests per-file
// drive.file access for the currently open document and fires onFileScopeGrantedTrigger
// with docs.id populated — no doc ID or user input required.
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
					Text: "Connect this document",
					Type: "FILLED",
					OnClick: &OnClick{Action: &FormAction{
						Function:    BaseURL + "/addon/on-file-scope-granted",
						Interaction: 2, // REQUEST_FILE_SCOPE
					}},
				}}}},
			},
		}},
	}
}
