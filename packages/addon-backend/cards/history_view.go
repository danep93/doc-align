package cards

import "time"

type HistoryEntry struct {
	Action        string // baseline_created | signed | drifted | review_requested
	ActorEmail    string
	ActorName     string
	CommitMessage string
	Timestamp     time.Time
}

func HistoryView(entries []HistoryEntry) Response {
	widgets := make([]Widget, 0, len(entries))

	for _, e := range entries {
		icon := historyIcon(e.Action)
		actor := e.ActorName
		if actor == "" {
			actor = e.ActorEmail
		}
		top := actor + " " + humanAction(e.Action)
		bottom := relativeTime(e.Timestamp)
		if e.CommitMessage != "" {
			bottom += " · " + e.CommitMessage
		}
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   knownIcon(icon),
				Text:        top,
				BottomLabel: bottom,
				WrapText:    true,
			},
		})
	}

	widgets = append(widgets, Widget{
		ButtonList: &ButtonList{Buttons: []Button{
			actionButton("Back", "/addon/homepage"),
		}},
	})

	return Push(Card{
		Name:   "history",
		Header: &Header{Title: "History"},
		Sections: []Section{
			{Widgets: widgets},
		},
	})
}

func historyIcon(action string) string {
	switch action {
	case "baseline_created":
		return "STAR"
	case "signed":
		return "CHECK_CIRCLE"
	case "drifted":
		return "WARNING"
	case "review_requested":
		return "PERSON"
	default:
		return "DESCRIPTION"
	}
}

func humanAction(action string) string {
	switch action {
	case "baseline_created":
		return "created baseline"
	case "signed":
		return "signed off"
	case "drifted":
		return "drift detected"
	case "review_requested":
		return "requested review"
	default:
		return action
	}
}
