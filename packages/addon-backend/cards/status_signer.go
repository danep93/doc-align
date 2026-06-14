package cards

import "fmt"

func StatusSigner(docTitle string, signer SignerStatus, diffSummary string) Response {
	icon := statusIcon(signer.Status)
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
				StartIcon:   knownIcon(icon),
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
					Parameter{Key: "signerEmail", Value: signer.Email}),
				actionButton("Sign this doc", "/addon/sign-form"),
			}},
		})

	case "pending":
		widgets = append(widgets, Widget{
			ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Sign this doc", "/addon/sign-form"),
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

	return Push(Card{
		Name:   "status_signer",
		Header: &Header{Title: docTitle, Subtitle: "Your sign-off status"},
		Sections: []Section{
			{Widgets: widgets},
		},
	})
}
