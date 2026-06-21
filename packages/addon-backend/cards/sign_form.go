package cards

func SignForm(userEmail string, suggestedCommitMessage string, docID string) Card {
	widgets := []Widget{
		{TextParagraph: &TextParagraph{Text: "Quick sign:"}},
		{
			ButtonList: &ButtonList{Buttons: []Button{
				outlinedActionButton("LGTM", "/addon/quick-sign", Parameter{Key: "message", Value: "LGTM"}, Parameter{Key: "docId", Value: docID}),
				outlinedActionButton("Approved", "/addon/quick-sign", Parameter{Key: "message", Value: "Approved"}, Parameter{Key: "docId", Value: docID}),
				outlinedActionButton("Looks good", "/addon/quick-sign", Parameter{Key: "message", Value: "Looks good"}, Parameter{Key: "docId", Value: docID}),
				outlinedActionButton("Signed off", "/addon/quick-sign", Parameter{Key: "message", Value: "Signed off"}, Parameter{Key: "docId", Value: docID}),
			}},
		},
		{
			TextInput: &TextInput{
				Name:      "commitMessage",
				Label:     "Sign-off note (optional)",
				Multiline: true,
				Value:     suggestedCommitMessage,
			},
		},
		{
			ButtonList: &ButtonList{Buttons: []Button{
				filledActionButton("Sign", "/addon/sign", Parameter{Key: "docId", Value: docID}),
				outlinedActionButton("Cancel", "/addon/homepage"),
			}},
		},
	}

	return Card{
		Name:   "sign_form",
		Header: &Header{Title: "Sign off"},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}
