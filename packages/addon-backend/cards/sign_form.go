package cards

import "fmt"

func SignForm(docTitle, ownerName string, docID string) Card {
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
				Name:  "commitMessage",
				Label: "Sign-off note (optional)",
				Type:  "MULTIPLE_LINE",
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
		Header: &Header{Title: docTitle, Subtitle: fmt.Sprintf("Sign-off requested by %s", ownerName)},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}
