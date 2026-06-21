package cards

import "fmt"

func StatusSigner(docTitle string, signer SignerStatus, diffSummary string, docID string) Card {
	icon := statusIconWidget(signer.Status)
	label := "You"
	bottom := signer.Status
	if !signer.StatusAt.IsZero() {
		bottom += " · " + relativeTime(signer.StatusAt)
	}

	widgets := []Widget{
		{
			DecoratedText: &DecoratedText{
				StartIcon:   icon,
				Text:        label,
				BottomLabel: bottom,
				WrapText:    true,
			},
		},
	}

	switch signer.Status {
	case "drifted":
		if diffSummary != "" {
			widgets = append(widgets, Widget{
				TextParagraph: &TextParagraph{Text: diffSummary},
			})
		}
		widgets = append(widgets, Widget{
			ButtonList: &ButtonList{Buttons: []Button{
				outlinedActionButton("View version history", "/addon/diff",
					Parameter{Key: "signerEmail", Value: signer.Email},
					Parameter{Key: "docId", Value: docID}),
				filledActionButton("Re-sign", "/addon/sign-form",
					Parameter{Key: "docId", Value: docID}),
			}},
		})

	case "pending":
		widgets = append(widgets, Widget{
			ButtonList: &ButtonList{Buttons: []Button{
				filledActionButton("Sign this document", "/addon/sign-form",
					Parameter{Key: "docId", Value: docID}),
			}},
		})

	case "signed":
		msg := fmt.Sprintf("You signed off on %s.", signer.StatusAt.Format("Jan 2"))
		if signer.CommitMessage != "" {
			msg += " " + signer.CommitMessage
		}
		widgets = append(widgets, Widget{
			TextParagraph: &TextParagraph{Text: msg},
		})
		widgets = append(widgets, Widget{
			ButtonList: &ButtonList{Buttons: []Button{
				outlinedActionButton("View version history", "/addon/diff",
					Parameter{Key: "signerEmail", Value: signer.Email},
					Parameter{Key: "docId", Value: docID}),
			}},
		})
	}

	return Card{
		Name:   "status_signer",
		Header: &Header{Title: docTitle, Subtitle: "Your sign-off status"},
		Sections: []Section{
			{
				Widgets:      widgets,
			},
		},
	}
}
