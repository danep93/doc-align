package cards

import "fmt"

func StatusSigner(docTitle, ownerName string, signers []SignerStatus, currentUserEmail string, docID string, docChanged bool, summary *ChangeSummaryView) Card {
	sorted := make([]SignerStatus, 0, len(signers))
	for _, s := range signers {
		if s.Status == "drifted" {
			sorted = append(sorted, s)
		}
	}
	for _, s := range signers {
		if s.Status == "pending" {
			sorted = append(sorted, s)
		}
	}
	for _, s := range signers {
		if s.Status == "signed" {
			sorted = append(sorted, s)
		}
	}

	signerWidgets := make([]Widget, 0, len(sorted))
	for _, s := range sorted {
		icon := statusIconWidget(s.Status)
		label := s.Email
		if s.DisplayName != "" {
			label = s.DisplayName
		}
		bottom := s.Status
		if !s.StatusAt.IsZero() {
			bottom += " · " + relativeTime(s.StatusAt)
		}
		signerWidgets = append(signerWidgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   icon,
				Text:        label,
				BottomLabel: bottom,
				WrapText:    true,
			},
		})
	}

	var current SignerStatus
	for _, s := range signers {
		if s.Email == currentUserEmail {
			current = s
			break
		}
	}

	sections := []Section{
		{
			Header:  "Sign-offs",
			Widgets: signerWidgets,
		},
	}

	if docChanged {
		// Unconfirmed changes lock EVERYONE — pending and drifted alike. Nobody signs
		// off on a version the owner hasn't confirmed.
		sections = append(sections, Section{
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: fmt.Sprintf(
					"This document has changed since the last confirmed version. Signing is paused until %s confirms the changes.",
					ownerName)}},
				{ButtonList: &ButtonList{Buttons: []Button{
					outlinedActionButton("Remind owner", "/addon/notify-owner",
						Parameter{Key: "docId", Value: docID}),
				}}},
			},
		})
	} else {
		switch current.Status {
		case "pending":
			sections = append(sections, Section{
				Widgets: []Widget{
					{ButtonList: &ButtonList{Buttons: []Button{
						filledActionButton("Sign this document", "/addon/sign-form",
							Parameter{Key: "docId", Value: docID}),
					}}},
				},
			})
		case "drifted":
			widgets := []Widget{
				{TextParagraph: &TextParagraph{Text: "The document changed since you signed. Review the changes and re-sign."}},
			}
			if summary != nil {
				widgets = append(widgets, changeSummaryWidgets(*summary)...)
				widgets = append(widgets, Widget{ButtonList: &ButtonList{Buttons: []Button{
					linkButton("View in Google Docs", VersionHistoryURL(docID, summary.FromRevisionID, summary.ToRevisionID)),
				}}})
			}
			widgets = append(widgets, Widget{ButtonList: &ButtonList{Buttons: []Button{
				filledActionButton("Re-sign", "/addon/sign-form",
					Parameter{Key: "docId", Value: docID}),
			}}})
			sections = append(sections, Section{Header: "What changed", Widgets: widgets})
		}
	}

	return Card{
		Name:     "status_signer",
		Header:   &Header{Title: docTitle, Subtitle: fmt.Sprintf("Requested by %s", ownerName)},
		Sections: sections,
	}
}
