package cards

import "fmt"

type Collaborator struct {
	Email       string
	DisplayName string
}

func AddSigners(collaborators []Collaborator, docID string) Card {
	widgets := []Widget{
		{TextParagraph: &TextParagraph{
			Text: "Select people with access to this document. They'll receive an email to review and sign.",
		}},
	}

	if len(collaborators) > 0 {
		items := make([]SelectionItem, len(collaborators))
		for i, c := range collaborators {
			label := c.DisplayName
			if label == "" {
				label = c.Email
			} else {
				label = fmt.Sprintf("%s <%s>", c.DisplayName, c.Email)
			}
			items[i] = SelectionItem{Text: label, Value: c.Email}
		}
		widgets = append(widgets, Widget{
			SelectionInput: &SelectionInput{
				Name:  "signerEmails",
				Label: "Choose collaborators",
				Type:  "MULTI_SELECT",
				Items: items,
			},
		})
		widgets = append(widgets, Widget{
			ButtonList: &ButtonList{Buttons: []Button{
				filledActionButton("Send review requests", "/addon/save-signers",
					Parameter{Key: "docId", Value: docID}),
			}},
		})
	} else {
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   matIcon("info"),
				Text:        "No collaborators found",
				BottomLabel: "Share this document with people first, then come back to invite signers.",
				WrapText:    true,
			},
		})
		b := filledActionButton("Send review requests", "/addon/save-signers",
			Parameter{Key: "docId", Value: docID})
		b.Disabled = true
		widgets = append(widgets, Widget{
			ButtonList: &ButtonList{Buttons: []Button{b}},
		})
	}

	return Card{
		Name:   "add_signers",
		Header: &Header{Title: "Add signers"},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}
