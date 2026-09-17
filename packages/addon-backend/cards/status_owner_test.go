package cards

import "testing"

func hasButtonText(card Card, text string) bool {
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.ButtonList == nil {
				continue
			}
			for _, b := range w.ButtonList.Buttons {
				if b.Text == text {
					return true
				}
			}
		}
	}
	return false
}

func hasCardAction(card Card, label string) bool {
	for _, a := range card.CardActions {
		if a.ActionLabel == label {
			return true
		}
	}
	return false
}

func TestStatusOwner_OwnerAppearsInListWithoutRemoveButton(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "pending"},
		{Email: "signer@example.com", Status: "pending"},
	}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	var signerSection *Section
	for i := range card.Sections {
		if card.Sections[i].Header == "Signers" {
			signerSection = &card.Sections[i]
		}
	}
	if signerSection == nil {
		t.Fatal("expected a Signers section")
	}
	if len(signerSection.Widgets) != 2 {
		t.Fatalf("expected 2 signer rows, got %d", len(signerSection.Widgets))
	}

	var ownerRow, otherRow *DecoratedText
	for i := range signerSection.Widgets {
		dt := signerSection.Widgets[i].DecoratedText
		if dt == nil {
			continue
		}
		if dt.Text == "owner@example.com (you)" {
			ownerRow = dt
		}
		if dt.Text == "signer@example.com" {
			otherRow = dt
		}
	}
	if ownerRow == nil {
		t.Fatal("expected to find the owner's own row labeled '(you)'")
	}
	if ownerRow.Button != nil {
		t.Error("owner's own row should not have a remove-signer button")
	}
	if otherRow == nil {
		t.Fatal("expected to find the invited signer's row")
	}
	if otherRow.Button == nil {
		t.Error("invited signer's row should still have a remove-signer button")
	}
}

func TestStatusOwner_ShowsSignButtonWhenOwnerPending(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "pending"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if !hasButtonText(card, "Sign this document") {
		t.Error("expected a 'Sign this document' button when the owner hasn't signed yet")
	}
}

func TestStatusOwner_ShowsResignButtonWhenOwnerDrifted(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "drifted"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if !hasButtonText(card, "Re-sign") {
		t.Error("expected a 'Re-sign' button when the owner's signature has drifted")
	}
}

func TestStatusOwner_OwnerCanSignEvenWhenDocChanged(t *testing.T) {
	// docChanged is now purely an informational nudge, never a gate — the owner's
	// own sign button must stay available regardless of it. (This replaces the old
	// TestStatusOwner_HidesSignButtonWhenDocChanged, whose asserted behavior is now
	// wrong under the new design.)
	signers := []SignerStatus{{Email: "owner@example.com", Status: "pending"}}
	card := StatusOwner("My Doc", signers, "doc-1", true, "owner@example.com", false)

	if !hasButtonText(card, "Sign this document") {
		t.Error("owner's sign button must not be hidden by docChanged — signing is never gated on doc drift")
	}
}

func TestStatusOwner_NoSignButtonWhenOwnerAlreadySigned(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if hasButtonText(card, "Sign this document") || hasButtonText(card, "Re-sign") {
		t.Error("should not prompt to sign again once already signed")
	}
}

func TestStatusOwner_ShowsWhatChangedButtonWhenSummaryExists(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}

	withSummary := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", true)
	if !hasButtonText(withSummary, "What changed") {
		t.Error("expected a 'What changed' button when a change summary exists")
	}

	withoutSummary := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)
	if hasButtonText(withoutSummary, "What changed") {
		t.Error("should not show 'What changed' when there's no change summary yet")
	}
}

func TestStatusOwner_ShowsRefreshButton(t *testing.T) {
	// Refresh lives in the 3-dot menu (CardActions), not the card body — Card Service
	// has no client-side JS or server-push, so this is the closest this architecture
	// gets to auto-detecting changes, and it doesn't need to be a prominent body button.
	signers := []SignerStatus{{Email: "owner@example.com", Status: "pending"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	if !hasCardAction(card, "Refresh") {
		t.Error("expected a 'Refresh' entry in the 3-dot menu")
	}
}

func TestStatusOwner_ConfirmNewVersionMenuActionOnlyWhenDocChanged(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}

	changed := StatusOwner("My Doc", signers, "doc-1", true, "owner@example.com", false)
	if !hasCardAction(changed, "Confirm new version") {
		t.Error("expected a 'Confirm new version' menu entry when the doc has changed")
	}

	unchanged := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)
	if hasCardAction(unchanged, "Confirm new version") {
		t.Error("should not offer 'Confirm new version' when nothing has changed")
	}
}

func TestStatusOwner_NoDocumentChangedDisclaimerSection(t *testing.T) {
	// Staleness is conveyed per-row (icon + "drifted" + count) — no separate banner.
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}
	card := StatusOwner("My Doc", signers, "doc-1", true, "owner@example.com", false)

	for _, sec := range card.Sections {
		if sec.Header == "Document changed" {
			t.Error("the 'Document changed' disclaimer section should no longer exist")
		}
	}
}

func TestStatusOwner_RowShowsSignCount(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed", SignCount: 3}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com", false)

	var row *DecoratedText
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.DecoratedText != nil {
				row = w.DecoratedText
			}
		}
	}
	if row == nil || row.BottomLabel != "signed (×3)" {
		t.Errorf("expected bottom label %q, got %+v", "signed (×3)", row)
	}
}
