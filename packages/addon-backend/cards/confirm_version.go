package cards

// ConfirmVersion is the note-taking step for the owner's optional "Confirm new
// version" action, reached via the 3-dot menu on StatusOwner rather than a banner in
// the card body — confirming never gates anyone's ability to sign (see StatusOwner),
// so it doesn't need prominent placement, just a way to still leave a note when wanted.
func ConfirmVersion(docTitle, docID string) Card {
	return Card{
		Name:   "confirm_version",
		Header: &Header{Title: docTitle, Subtitle: "Confirm new version"},
		Sections: []Section{
			{
				Widgets: []Widget{
					{TextParagraph: &TextParagraph{Text: "This refreshes the detailed diff signers can see and lets you leave a note about what changed. It's optional — nobody's ability to sign depends on this."}},
					{TextInput: &TextInput{
						Name:     "confirmNote",
						Label:    "Note for signers (optional)",
						HintText: "What changed and why",
						Type:     "MULTIPLE_LINE",
					}},
					{ButtonList: &ButtonList{Buttons: []Button{
						filledActionButton("Confirm & notify signers", "/addon/mark-revised",
							Parameter{Key: "docId", Value: docID}),
						outlinedActionButton("Cancel", "/addon/back-to-status",
							Parameter{Key: "docId", Value: docID}),
					}}},
				},
			},
		},
	}
}
