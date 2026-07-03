package cards

import "fmt"

func StatusSigner(docTitle, ownerName string, signers []SignerStatus, currentUserEmail string, docID string) Card {
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
		viewChangesButton := outlinedActionButton("View changes", "/addon/diff",
			Parameter{Key: "signerEmail", Value: currentUserEmail},
			Parameter{Key: "docId", Value: docID})

		if current.DriftConfirmed() {
			sections = append(sections, Section{
				Widgets: []Widget{
					{TextParagraph: &TextParagraph{Text: "Document has changed since you signed."}},
					{ButtonList: &ButtonList{Buttons: []Button{
						viewChangesButton,
						filledActionButton("Re-sign", "/addon/sign-form",
							Parameter{Key: "docId", Value: docID}),
					}}},
				},
			})
		} else {
			sections = append(sections, Section{
				Widgets: []Widget{
					{TextParagraph: &TextParagraph{Text: fmt.Sprintf(
						"This document has changed since you signed. %s is reviewing the changes — you'll be notified when it's ready for re-review.",
						ownerName)}},
					{ButtonList: &ButtonList{Buttons: []Button{viewChangesButton}}},
				},
			})
		}
	}

	return Card{
		Name:     "status_signer",
		Header:   &Header{Title: docTitle, Subtitle: fmt.Sprintf("Requested by %s", ownerName)},
		Sections: sections,
	}
}
