package cards

type Collaborator struct {
	Email       string
	DisplayName string
}

func AddSigners(collaborators []Collaborator) Response {
	items := make([]SelectionItem, len(collaborators))
	for i, c := range collaborators {
		label := c.DisplayName
		if label == "" {
			label = c.Email
		}
		items[i] = SelectionItem{Text: label, Value: c.Email}
	}

	widgets := []Widget{
		{
			SelectionInput: &SelectionInput{
				Name:  "signerEmails",
				Label: "Select signers",
				Type:  "MULTI_SELECT",
				Items: items,
			},
		},
		{
			TextInput: &TextInput{
				Name:     "customEmail",
				Label:    "Add by email",
				HintText: "name@example.com",
			},
		},
		{
			ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Done", "/addon/save-signers"),
			}},
		},
	}

	return Push(Card{
		Name:   "add_signers",
		Header: &Header{Title: "Add signers"},
		Sections: []Section{
			{Widgets: widgets},
		},
	})
}
