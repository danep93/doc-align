package cards

import "fmt"

type DiffSection struct {
	Title   string
	Added   int
	Removed int
}

// ChangeSummaryView is the card-layer copy of services.ChangeSummary (cards cannot
// import services — services already imports cards).
type ChangeSummaryView struct {
	Note           string
	Sections       []DiffSection
	TotalAdded     int
	TotalRemoved   int
	FromRevisionID string
	ToRevisionID   string
}

// VersionHistoryURL builds Google's compare-revisions deep link when both revision IDs
// are known, falling back to the plain document URL. The showrevision endpoint is
// undocumented (verified working 2026-07-04 in a signed-in browser); version history is
// only visible to users with edit access, so this is best-effort on top of the stored
// summary, never the primary oversight mechanism.
func VersionHistoryURL(docID, fromRev, toRev string) string {
	if fromRev != "" && toRev != "" {
		return fmt.Sprintf("https://docs.google.com/document/showrevision?id=%s&start=%s&end=%s", docID, fromRev, toRev)
	}
	return fmt.Sprintf("https://docs.google.com/document/d/%s/edit", docID)
}

// changeSummaryWidgets renders the stored summary: totals, per-section counts, owner note.
func changeSummaryWidgets(summary ChangeSummaryView) []Widget {
	widgets := []Widget{
		{TextParagraph: &TextParagraph{Text: fmt.Sprintf("+%d added · -%d removed", summary.TotalAdded, summary.TotalRemoved)}},
	}
	for _, sec := range summary.Sections {
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				Text:        sec.Title,
				BottomLabel: fmt.Sprintf("+%d added · -%d removed", sec.Added, sec.Removed),
				WrapText:    true,
			},
		})
	}
	if summary.Note != "" {
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				TopLabel: "Note from the owner",
				Text:     summary.Note,
				WrapText: true,
			},
		})
	}
	return widgets
}

// DiffView renders the stored change summary — no Drive calls, works for every signer
// including viewers who cannot open Google's version history.
func DiffView(docID string, summary ChangeSummaryView) Card {
	cardSections := []Section{
		{Widgets: changeSummaryWidgets(summary)},
	}

	cardSections = append(cardSections, Section{
		Widgets: []Widget{
			{TextParagraph: &TextParagraph{Text: "For the full line-by-line diff, open version history in Google Docs (requires edit access)."}},
			{ButtonList: &ButtonList{Buttons: []Button{
				linkButton("View in Google Docs", VersionHistoryURL(docID, summary.FromRevisionID, summary.ToRevisionID)),
			}}},
			{ButtonList: &ButtonList{Buttons: []Button{
				actionButton("Re-sign", "/addon/sign-form", Parameter{Key: "docId", Value: docID}),
				actionButton("Back", "/addon/back-to-status", Parameter{Key: "docId", Value: docID}),
			}}},
		},
	})

	return Card{
		Name:     "diff_view",
		Header:   &Header{Title: "What changed"},
		Sections: cardSections,
	}
}
