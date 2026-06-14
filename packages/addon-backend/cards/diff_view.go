package cards

import "fmt"

type DiffSection struct {
	Title   string
	Added   int
	Removed int
	Lines   []DiffLine
}

type DiffLine struct {
	Type string // added | removed | context
	Text string
}

func DiffView(added, removed int, sections []DiffSection) Response {
	summary := fmt.Sprintf("+%d added · -%d removed", added, removed)

	cardSections := []Section{
		{
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: summary}},
			},
		},
	}

	for _, sec := range sections {
		var lineText string
		for _, l := range sec.Lines {
			switch l.Type {
			case "added":
				lineText += fmt.Sprintf(`<font color="#1e8e3e">+ %s</font>`+"\n", l.Text)
			case "removed":
				lineText += fmt.Sprintf(`<font color="#d93025">- %s</font>`+"\n", l.Text)
			default:
				lineText += "  " + l.Text + "\n"
			}
		}
		if lineText == "" {
			lineText = fmt.Sprintf("%d added, %d removed", sec.Added, sec.Removed)
		}

		cardSections = append(cardSections, Section{
			Header: sec.Title,
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: lineText}},
			},
		})
	}

	cardSections = append(cardSections, Section{
		Widgets: []Widget{
			{ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Re-sign", "/addon/sign-form"),
				actionButton("Back", "/addon/homepage"),
			}}},
		},
	})

	return Push(Card{
		Name:     "diff_view",
		Header:   &Header{Title: "What changed"},
		Sections: cardSections,
	})
}
