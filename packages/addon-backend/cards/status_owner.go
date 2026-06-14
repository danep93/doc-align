package cards

import (
	"fmt"
	"time"
)

type SignerStatus struct {
	Email           string
	DisplayName     string
	Status          string // pending | signed | drifted
	StatusAt        time.Time
	CommitMessage   string
}

func StatusOwner(docTitle string, signers []SignerStatus) Response {
	signed := 0
	drifted := 0
	pending := 0
	for _, s := range signers {
		switch s.Status {
		case "signed":
			signed++
		case "drifted":
			drifted++
		default:
			pending++
		}
	}

	summary := fmt.Sprintf("%d signed · %d drifted · %d pending", signed, drifted, pending)

	// Sort: drifted first, then pending, then signed.
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
		icon := statusIcon(s.Status)
		label := s.DisplayName
		if label == "" {
			label = s.Email
		}
		bottom := fmt.Sprintf("%s · %s", s.Status, relativeTime(s.StatusAt))
		w := Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   knownIcon(icon),
				Text:        label,
				BottomLabel: bottom,
				WrapText:    true,
			},
		}
		signerWidgets = append(signerWidgets, w)

		if s.Status == "drifted" {
			signerWidgets = append(signerWidgets, Widget{
				ButtonList: &ButtonList{Buttons: []Button{
					actionButton("View changes", "/addon/diff",
						Parameter{Key: "signerEmail", Value: s.Email}),
				}},
			})
		}
	}

	footerWidgets := []Widget{
		{ButtonList: &ButtonList{Buttons: []Button{
			actionButton("History", "/addon/history"),
		}}},
	}

	sections := []Section{
		{
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: summary}},
			},
		},
		{
			Header:   "Signers",
			Widgets:  signerWidgets,
		},
		{
			Widgets: footerWidgets,
		},
	}

	return Push(Card{
		Name:     "status_owner",
		Header:   &Header{Title: docTitle, Subtitle: "Owner view"},
		Sections: sections,
	})
}

func statusIcon(status string) string {
	switch status {
	case "signed":
		return "CHECK_CIRCLE"
	case "drifted":
		return "WARNING"
	default:
		return "HOURGLASS"
	}
}

func relativeTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}
