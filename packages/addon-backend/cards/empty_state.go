package cards

// ConnectDocument is shown on the homepage when docs.id is not yet available.
// The REQUEST_FILE_SCOPE button triggers Google's per-file drive.file authorization,
// after which onFileScopeGrantedTrigger fires with the actual doc ID.
// ConnectDocument is shown when docs.id is not yet available.
// Google automatically prompts for per-file drive.file access alongside this card,
// then fires onFileScopeGrantedTrigger once the user grants it.
func ConnectDocument() Card {
	return Card{
		Name:   "connect_document",
		Header: &Header{Title: "doc-align"},
		Sections: []Section{
			{
				Widgets: []Widget{
					{TextParagraph: &TextParagraph{Text: "Authorize access to this document using the prompt above, then reopen the add-on."}},
				},
			},
		},
	}
}

func EmptyState(isOwner bool, docID string) Card {
	if isOwner {
		return Card{
			Name: "empty_state",
			Header: &Header{Title: "Get started"},
			Sections: []Section{
				{
					Widgets: []Widget{
						{TextParagraph: &TextParagraph{Text: "Snapshot this document to start tracking sign-offs."}},
						{ButtonList: &ButtonList{Buttons: []Button{
							actionButton("Create baseline", "/addon/create-baseline",
								Parameter{Key: "docId", Value: docID}),
						}}},
					},
				},
			},
		}
	}
	return Card{
		Name: "empty_state_signer",
		Header: &Header{Title: "Waiting for baseline"},
		Sections: []Section{
			{
				Widgets: []Widget{
					{TextParagraph: &TextParagraph{Text: "The document owner hasn't created a baseline yet."}},
				},
			},
		},
	}
}
