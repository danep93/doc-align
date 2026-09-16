package cards

import "fmt"

func StatusSigner(docTitle, ownerName string, signers []SignerStatus, currentUserEmail string, docID string, ownerHasSignedOnce bool, summary *ChangeSummaryView) Card {
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
		signerWidgets = append(signerWidgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   icon,
				Text:        label,
				BottomLabel: signerBottomLabel(s),
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

	switch {
	case current.Status == "pending" && !ownerHasSignedOnce:
		sections = append(sections, Section{
			Widgets: []Widget{
				{DecoratedText: &DecoratedText{
					StartIcon:   matIcon("hourglass_empty"),
					Text:        fmt.Sprintf("Waiting for %s to sign off first", ownerName),
					BottomLabel: "You'll be able to sign once they do.",
					WrapText:    true,
				}},
			},
		})
	case current.Status == "pending":
		sections = append(sections, Section{
			Widgets: []Widget{
				{ButtonList: &ButtonList{Buttons: []Button{
					filledActionButton("Sign this document", "/addon/sign-form",
						Parameter{Key: "docId", Value: docID}),
				}}},
			},
		})
	case current.Status == "drifted":
		widgets := []Widget{
			{TextParagraph: &TextParagraph{Text: "The document changed since you signed. Review the changes and re-sign — no need to wait for anyone."}},
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

	return Card{
		Name:   "status_signer",
		Header: &Header{Title: docTitle, Subtitle: fmt.Sprintf("Requested by %s", ownerName)},
		CardActions: []CardAction{
			cardAction("Refresh", "/addon/back-to-status", Parameter{Key: "docId", Value: docID}),
		},
		Sections: sections,
	}
}
