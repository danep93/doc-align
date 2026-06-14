package cards

func EmptyState(isOwner bool) Response {
	if isOwner {
		return Push(Card{
			Name: "empty_state",
			Header: &Header{Title: "doc-align", Subtitle: "Sign-off tracking"},
			Sections: []Section{
				{
					Widgets: []Widget{
						{TextParagraph: &TextParagraph{Text: "No baseline yet. Create one to start collecting sign-offs."}},
						{ButtonList: &ButtonList{Buttons: []Button{
							actionButton("Create baseline", "/addon/create-baseline"),
						}}},
					},
				},
			},
		})
	}
	return Push(Card{
		Name: "empty_state_signer",
		Header: &Header{Title: "doc-align"},
		Sections: []Section{
			{
				Widgets: []Widget{
					{TextParagraph: &TextParagraph{Text: "The document owner hasn't created a baseline yet."}},
				},
			},
		},
	})
}
