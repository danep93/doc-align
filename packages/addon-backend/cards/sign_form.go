package cards

func SignForm(userEmail string, suggestedCommitMessage string) Response {
	widgets := []Widget{
		{TextParagraph: &TextParagraph{Text: "Signing as " + userEmail}},
		{
			TextInput: &TextInput{
				Name:      "commitMessage",
				Label:     "Commit message (optional)",
				Multiline: true,
				Value:     suggestedCommitMessage,
			},
		},
		{
			ButtonList: &ButtonList{Buttons: []Button{
				actionButton("LGTM", "/addon/quick-sign", Parameter{Key: "message", Value: "LGTM"}),
				actionButton("Approved", "/addon/quick-sign", Parameter{Key: "message", Value: "Approved"}),
				actionButton("Looks good", "/addon/quick-sign", Parameter{Key: "message", Value: "Looks good"}),
				actionButton("Signed off", "/addon/quick-sign", Parameter{Key: "message", Value: "Signed off"}),
			}},
		},
		{
			ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Sign", "/addon/sign"),
				actionButton("Cancel", "/addon/homepage"),
			}},
		},
	}

	return Push(Card{
		Name:   "sign_form",
		Header: &Header{Title: "Sign off"},
		Sections: []Section{
			{Widgets: widgets},
		},
	})
}
