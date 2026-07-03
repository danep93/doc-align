package cards

import (
	"strings"
	"time"
)

type HistoryEntry struct {
	Action        string // baseline_created | signed | drifted | review_requested
	ActorEmail    string
	ActorName     string
	CommitMessage string
	Timestamp     time.Time
}

func emailLocalPart(email string) string {
	if i := strings.Index(email, "@"); i > 0 {
		return email[:i]
	}
	return email
}

func HistoryView(entries []HistoryEntry) Card {
	widgets := make([]Widget, 0, len(entries))

	for _, e := range entries {
		icon := historyIconWidget(e.Action)
		actor := e.ActorName
		if actor == "" {
			actor = emailLocalPart(e.ActorEmail)
		}
		top := actor + " " + humanAction(e.Action)
		bottom := relativeTime(e.Timestamp)
		if e.CommitMessage != "" {
			bottom += " · " + e.CommitMessage
		}
		widgets = append(widgets, Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   icon,
				Text:        top,
				BottomLabel: bottom,
				WrapText:    true,
			},
		})
	}

	return Card{
		Name:   "history",
		Header: &Header{Title: "History"},
		Sections: []Section{
			{Widgets: widgets},
		},
	}
}

func historyIconWidget(action string) *Icon {
	switch action {
	case "baseline_created":
		return matIcon("flag")
	case "signed":
		return matIcon("check_circle")
	case "drifted":
		return matIcon("warning")
	case "revised_notified":
		return matIcon("mark_email_read")
	case "review_requested":
		return matIcon("person")
	default:
		return matIcon("description")
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
	case "revised_notified":
		return "confirmed changes are ready for re-review"
	case "review_requested":
		return "requested review"
	default:
		return action
	}
}
