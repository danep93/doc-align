package cards

// PRDCoachingView is the card-layer copy of the services.PRDCoachingResult fields
// needed for rendering (cards cannot import services — services already imports
// cards for DiffSection in services/drift_detection.go; see ChangeSummaryView in
// diff_view.go for the identical existing pattern). Callers convert from
// services.PRDCoachingResult before calling PRDCoaching.
type PRDCoachingView struct {
	PressReleasePresent bool
	PressReleaseText    string
	DoDPresent          bool
	DoDText             string
}

// PRDCoaching shows the result of the pre-signer PRD completeness check. Found
// fields render read-only; missing fields (or every field, if checkFailed) get
// an inline text box so the owner can supply them without leaving the sidebar.
// The owner can also leave a field blank and continue — this is a nudge, not a
// hard gate.
func PRDCoaching(docTitle, docID string, coaching PRDCoachingView, checkFailed bool) Card {
	var widgets []Widget

	if checkFailed {
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   matIcon("info"),
				Text:        "Couldn't automatically check your document",
				BottomLabel: "Add these manually, or continue without them.",
				WrapText:    true,
			},
		})
	}

	widgets = append(widgets, fieldWidgets(
		"Press Release", "pressReleaseManual",
		"What's being built and why people should care",
		coaching.PressReleasePresent && !checkFailed, coaching.PressReleaseText,
	)...)
	widgets = append(widgets, fieldWidgets(
		"Definition of Done", "dodManual",
		"A demo description and/or success metrics proving it's done",
		coaching.DoDPresent && !checkFailed, coaching.DoDText,
	)...)

	widgets = append(widgets,
		Widget{TextParagraph: &TextParagraph{
			Text: "You can leave these blank and continue if you'd rather fill them in later.",
		}},
		Widget{ButtonList: &ButtonList{Buttons: []Button{
			filledActionButton("Continue", "/addon/coach-resolve", Parameter{Key: "docId", Value: docID}),
		}}},
	)

	return Card{
		Name:   "prd_coaching",
		Header: &Header{Title: "Before you invite signers", Subtitle: docTitle},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}

// fieldWidgets renders either a read-only "found" summary or a missing-field
// callout plus an inline manual-entry text box.
func fieldWidgets(label, inputName, hint string, present bool, text string) []Widget {
	if present {
		excerpt := text
		if len(excerpt) > 140 {
			excerpt = excerpt[:140] + "…"
		}
		return []Widget{{
			DecoratedText: &DecoratedText{
				StartIcon:   matIcon("check_circle"),
				TopLabel:    label,
				Text:        "Found in your document",
				BottomLabel: excerpt,
				WrapText:    true,
			},
		}}
	}
	return []Widget{
		{
			DecoratedText: &DecoratedText{
				StartIcon: matIcon("warning"),
				TopLabel:  label,
				Text:      "Not found in the document",
				WrapText:  true,
			},
		},
		{
			TextInput: &TextInput{
				Name:     inputName,
				Label:    "Add a " + label,
				HintText: hint,
				Type:     "MULTIPLE_LINE",
			},
		},
	}
}
