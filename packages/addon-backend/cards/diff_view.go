package cards

import "fmt"

type DiffSection struct {
	Title   string
	Added   int
	Removed int
}

func DiffView(docID string, added, removed int, sections []DiffSection) Card {
	summary := fmt.Sprintf("+%d added · -%d removed", added, removed)

	sectionWidgets := make([]Widget, 0, len(sections))
	for _, sec := range sections {
		sectionWidgets = append(sectionWidgets, Widget{
			DecoratedText: &DecoratedText{
				Text:        sec.Title,
				BottomLabel: fmt.Sprintf("+%d added · -%d removed", sec.Added, sec.Removed),
				WrapText:    true,
			},
		})
	}

	cardSections := []Section{
		{
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: summary}},
			},
		},
	}
	if len(sectionWidgets) > 0 {
		cardSections = append(cardSections, Section{
			Header:  "Changed sections",
			Widgets: sectionWidgets,
		})
	}

	docURL := "https://docs.google.com/document/d/" + docID + "/edit"
	cardSections = append(cardSections, Section{
		Widgets: []Widget{
			{TextParagraph: &TextParagraph{Text: "For the full line-by-line diff, open the document and check File > Version history."}},
			{ButtonList: &ButtonList{Buttons: []Button{
				linkButton("Open document", docURL),
			}}},
			{ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Re-sign", "/addon/sign-form", Parameter{Key: "docId", Value: docID}),
				actionButton("Back", "/addon/homepage"),
			}}},
		},
	})

	return Card{
		Name:     "diff_view",
		Header:   &Header{Title: "What changed"},
		Sections: cardSections,
	}
}
