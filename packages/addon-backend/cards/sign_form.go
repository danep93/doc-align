package cards

import "fmt"

func SignForm(docTitle, ownerName string, docID string) Card {
	widgets := []Widget{
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
				outlinedActionButton("Cancel", "/addon/back-to-status", Parameter{Key: "docId", Value: docID}),
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
