package cards

import "fmt"

func GmailDrift(docID, docTitle string, added, removed int, sections []DiffSection) Response {
	docURL := fmt.Sprintf("https://docs.google.com/document/d/%s", docID)

	cardSections := []Section{
		{
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{
					Text: "This document has changed since you signed off.",
				}},
				{TextParagraph: &TextParagraph{
					Text: fmt.Sprintf("+%d added · -%d removed", added, removed),
				}},
			},
		},
	}

	for _, sec := range sections {
		cardSections = append(cardSections, Section{
			Header: sec.Title,
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{
					Text: fmt.Sprintf("%d added, %d removed", sec.Added, sec.Removed),
				}},
			},
		})
	}

	cardSections = append(cardSections, Section{
		Widgets: []Widget{
			{ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Re-sign", "/addon/sign-form"),
				linkButton("View in document", docURL),
			}}},
		},
	})

	return Push(Card{
		Name:     "gmail_drift",
		Header:   &Header{Title: docTitle, Subtitle: "Document changed"},
		Sections: cardSections,
	})
}
