package cards

import "fmt"

func StatusSigner(docTitle string, signer SignerStatus, diffSummary string, docID string) Card {
	icon := statusIconWidget(signer.Status)
	label := signer.DisplayName
	if label == "" {
		label = signer.Email
	}
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
				actionButton("View changes", "/addon/diff",
					Parameter{Key: "signerEmail", Value: signer.Email},
					Parameter{Key: "docId", Value: docID}),
				actionButton("Sign this doc", "/addon/sign-form",
					Parameter{Key: "docId", Value: docID}),
			}},
		})

	case "pending":
		widgets = append(widgets, Widget{
			ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Sign this doc", "/addon/sign-form",
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
	}

	return Card{
		Name:   "status_signer",
		Header: &Header{Title: docTitle, Subtitle: "Your sign-off status"},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}
