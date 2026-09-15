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
	DriftDetectedAt time.Time
	NotifiedAt      time.Time
}

func StatusOwner(docTitle string, signers []SignerStatus, docID string, docChanged bool, ownerEmail string, hasChangeSummary bool) Card {
	signed := 0
	drifted := 0
	pending := 0
	var ownerStatus *SignerStatus
	for i, s := range signers {
		switch s.Status {
		case "signed":
			signed++
		case "drifted":
			drifted++
		default:
			pending++
		}
		if s.Email == ownerEmail {
			ownerStatus = &signers[i]
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
		if s.Email == ownerEmail {
			label += " (you)"
		}
		bottom := s.Status
		if rt := relativeTime(staleTimestamp(s)); rt != "" {
			bottom += " · " + rt
		}
		dt := &DecoratedText{
			StartIcon:   icon,
			Text:        label,
			BottomLabel: bottom,
			WrapText:    true,
		}
		// Removing yourself as owner doesn't make sense — only show the button on
		// rows for signers you invited.
		if s.Email != ownerEmail {
			dt.Button = &Button{
				Icon: &Icon{MaterialIcon: &MaterialIcon{Name: "person_remove"}, AltText: "Remove signer"},
				Type: "BORDERLESS",
				OnClick: &OnClick{
					Action: &FormAction{
						Function: BaseURL + "/addon/remove-signer",
						Parameters: []Parameter{
							{Key: "signerEmail", Value: s.Email},
							{Key: "docId", Value: docID},
						},
					},
				},
			}
		}
		signerWidgets = append(signerWidgets, Widget{DecoratedText: dt})
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

	subtitle := fmt.Sprintf("%d signed · %d drifted · %d pending", signed, drifted, pending)

	bottomButtons := []Button{
		filledActionButton("Add more signers", "/addon/add-signers",
			Parameter{Key: "docId", Value: docID}),
		outlinedActionButton("History", "/addon/history",
			Parameter{Key: "docId", Value: docID}),
		outlinedActionButton("Refresh", "/addon/back-to-status",
			Parameter{Key: "docId", Value: docID}),
	}
	if hasChangeSummary {
		bottomButtons = append(bottomButtons, outlinedActionButton("What changed", "/addon/diff",
			Parameter{Key: "docId", Value: docID}))
	}
	// Owners can sign their own doc too, any time — never gated on docChanged. Doc
	// drift is a per-signer staleness signal, not a lock on anyone's ability to sign.
	if ownerStatus != nil {
		switch ownerStatus.Status {
		case "pending":
			bottomButtons = append([]Button{filledActionButton("Sign this document", "/addon/sign-form",
				Parameter{Key: "docId", Value: docID})}, bottomButtons...)
		case "drifted":
			bottomButtons = append([]Button{filledActionButton("Re-sign", "/addon/sign-form",
				Parameter{Key: "docId", Value: docID})}, bottomButtons...)
		}
	}
	sections := []Section{
		{
			Header:  "Signers",
			Widgets: signerWidgets,
		},
	}
	if docChanged {
		sections = append(sections, Section{
			Header: "Document changed",
			Widgets: []Widget{
				{TextParagraph: &TextParagraph{Text: "The document has changed since your last confirmed version. This doesn't block anyone from signing — stale signatures already show as drifted above. Confirming here is optional: it lets you leave a note and refreshes the detailed diff signers can see."}},
				{TextInput: &TextInput{
					Name:     "confirmNote",
					Label:    "Note for signers (optional)",
					HintText: "What changed and why",
					Type:     "MULTIPLE_LINE",
				}},
				{ButtonList: &ButtonList{Buttons: []Button{
					filledActionButton("Confirm new version & notify signers",
						"/addon/mark-revised", Parameter{Key: "docId", Value: docID}),
				}}},
			},
		})
	}
	sections = append(sections, Section{
		Widgets: []Widget{
			{ButtonList: &ButtonList{Buttons: bottomButtons}},
		},
	})

	return Card{
		Name:     "status_owner",
		Header:   &Header{Title: docTitle, Subtitle: subtitle},
		Sections: sections,
	}
}

// staleTimestamp picks the timestamp that best answers "how stale is this row": for a
// drifted signature, that's when the drift was detected, not when they originally
// signed.
func staleTimestamp(s SignerStatus) time.Time {
	if s.Status == "drifted" && !s.DriftDetectedAt.IsZero() {
		return s.DriftDetectedAt
	}
	return s.StatusAt
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
