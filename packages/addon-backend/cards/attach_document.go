package cards

func AttachDocument() Card {
	return Card{
		Name:   "attach_document",
		Header: &Header{Title: "Attach document"},
		Sections: []Section{
			{
				Widgets: []Widget{
					{TextParagraph: &TextParagraph{
						Text: "Paste your Google Doc URL to connect it manually.",
					}},
					{TextInput: &TextInput{
						Name:     "docUrl",
						Label:    "Google Doc URL",
						HintText: "https://docs.google.com/document/d/…",
					}},
					{ButtonList: &ButtonList{Buttons: []Button{
						filledActionButton("Connect", "/addon/attach-document-submit"),
					}}},
				},
			},
		},
	}
}
