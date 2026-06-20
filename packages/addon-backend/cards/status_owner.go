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

func StatusOwner(docTitle string, signers []SignerStatus, docID string) Card {
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
		icon := statusIconWidget(s.Status)
		label := s.DisplayName
		if label == "" {
			label = s.Email
		}
		bottom := s.Status
		if rt := relativeTime(s.StatusAt); rt != "" {
			bottom += " · " + rt
		}
		w := Widget{
			DecoratedText: &DecoratedText{
				StartIcon:   icon,
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
						Parameter{Key: "signerEmail", Value: s.Email},
						Parameter{Key: "docId", Value: docID}),
				}},
			})
		}
	}

	footerWidgets := []Widget{
		{ButtonList: &ButtonList{Buttons: []Button{
			actionButton("Invite signers", "/addon/save-signers",
				Parameter{Key: "docId", Value: docID}),
			actionButton("History", "/addon/history",
				Parameter{Key: "docId", Value: docID}),
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

	subtitle := fmt.Sprintf("%d of %d signed", signed, len(signers))

	return Card{
		Name:     "status_owner",
		Header:   &Header{Title: docTitle, Subtitle: subtitle},
		Sections: sections,
	}
}

func statusIconWidget(status string) *Icon {
	switch status {
	case "signed":
		return matIcon("check_circle")
	case "drifted":
		return matIcon("warning")
	default:
		return matIcon("pending")
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
