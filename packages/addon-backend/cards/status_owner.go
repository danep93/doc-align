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

	signerWidgets := make([]Widget, 0, len(sorted)*2)
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
					outlinedActionButton("Notify & re-review", "/addon/diff",
						Parameter{Key: "signerEmail", Value: s.Email},
						Parameter{Key: "docId", Value: docID}),
				}},
			})
		}
	}

	if len(signerWidgets) == 0 {
		signerWidgets = []Widget{
			{DecoratedText: &DecoratedText{
				StartIcon:   matIcon("group"),
				Text:        "No signers yet",
				BottomLabel: "Add signers to get started.",
				WrapText:    true,
			}},
		}
	}

	subtitle := fmt.Sprintf("%d of %d signed", signed, len(signers))

	return Card{
		Name:   "status_owner",
		Header: &Header{Title: docTitle, Subtitle: subtitle},
		Sections: []Section{
			{
				Header:       "Signers",
				Widgets:      signerWidgets,
			},
			{
				Widgets: []Widget{
					{ButtonList: &ButtonList{Buttons: []Button{
						filledActionButton("Add more signers", "/addon/add-signers",
							Parameter{Key: "docId", Value: docID}),
						outlinedActionButton("History", "/addon/history",
							Parameter{Key: "docId", Value: docID}),
					}}},
				},
			},
		},
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
