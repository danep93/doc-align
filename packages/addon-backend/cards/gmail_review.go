package cards

import "fmt"

func GmailReview(docID, docTitle, requesterEmail, requesterMessage string) Card {
	docURL := fmt.Sprintf("https://docs.google.com/document/d/%s", docID)

	widgets := []Widget{
		{TextParagraph: &TextParagraph{
			Text: requesterEmail + " has asked you to review: <b>" + docTitle + "</b>",
		}},
	}
	if requesterMessage != "" {
		widgets = append(widgets, Widget{
			TextParagraph: &TextParagraph{Text: requesterMessage},
		})
	}
	widgets = append(widgets, Widget{
		ButtonList: &ButtonList{Buttons: []Button{
			linkButton("Open document", docURL),
		}},
	})

	return Card{
		Name:   "gmail_review",
		Header: &Header{Title: "Review requested"},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}
