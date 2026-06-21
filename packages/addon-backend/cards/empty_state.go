package cards

// EmptyStateRequestScope is shown on first open of a doc before drive.file scope is granted.
// It looks identical to the owner EmptyState but the CTA triggers REQUEST_FILE_SCOPE so the
// user never sees a separate permission gate — one click from the normal UI grants access.
func EmptyStateRequestScope() Card {
	return Card{
		Name:        "empty_state",
		CardActions: []CardAction{attachDocAction()},
		Header: &Header{
			Title:    "doc-align",
			Subtitle: "Document alignment for Google Docs",
		},
		Sections: []Section{
			{
				Widgets: []Widget{
					{DecoratedText: &DecoratedText{
						StartIcon:   matIcon("history_edu"),
						Text:        "Snapshot your doc",
						BottomLabel: "Capture this version for sign-offs",
						WrapText:    true,
					}},
					{DecoratedText: &DecoratedText{
						StartIcon:   matIcon("group_add"),
						Text:        "Invite signers",
						BottomLabel: "Request sign-offs from your team",
						WrapText:    true,
					}},
					{DecoratedText: &DecoratedText{
						StartIcon:   matIcon("notifications_active"),
						Text:        "Track alignment",
						BottomLabel: "Get notified if the doc changes after sign-off",
						WrapText:    true,
					}},
				},
			},
			{
				Widgets: []Widget{
					{ButtonList: &ButtonList{Buttons: []Button{
						{
							Text: "Get started",
							Type: "FILLED",
							OnClick: &OnClick{Action: &FormAction{
								Function:    BaseURL + "/addon/on-file-scope-granted",
								Interaction: 2, // REQUEST_FILE_SCOPE
							}},
						},
					}}},
				},
			},
		},
	}
}

func EmptyState(isOwner bool, docID string) Card {
	if isOwner {
		return Card{
			Name:        "empty_state",
			CardActions: []CardAction{attachDocAction()},
			Header: &Header{
				Title:    "doc-align",
				Subtitle: "Document alignment for Google Docs",
			},
			Sections: []Section{
				{
					Widgets: []Widget{
						{DecoratedText: &DecoratedText{
							StartIcon:   matIcon("history_edu"),
							Text:        "Snapshot your doc",
							BottomLabel: "Capture this version for sign-offs",
							WrapText:    true,
						}},
						{DecoratedText: &DecoratedText{
							StartIcon:   matIcon("group_add"),
							Text:        "Invite signers",
							BottomLabel: "Request sign-offs from your team",
							WrapText:    true,
						}},
						{DecoratedText: &DecoratedText{
							StartIcon:   matIcon("notifications_active"),
							Text:        "Track alignment",
							BottomLabel: "Get notified if the doc changes after sign-off",
							WrapText:    true,
						}},
					},
				},
				{
					Widgets: []Widget{
						{ButtonList: &ButtonList{Buttons: []Button{
							filledActionButton("Create baseline", "/addon/create-baseline",
								Parameter{Key: "docId", Value: docID}),
						}}},
					},
				},
			},
		}
	}
	return Card{
		Name:        "empty_state_signer",
		CardActions: []CardAction{attachDocAction()},
		Header:      &Header{Title: "doc-align"},
		Sections: []Section{
			{
				Widgets: []Widget{
					{DecoratedText: &DecoratedText{
						StartIcon:   matIcon("pending"),
						Text:        "Waiting for baseline",
						BottomLabel: "The document owner hasn't created a baseline yet. Check back soon.",
						WrapText:    true,
					}},
				},
			},
		},
	}
}
