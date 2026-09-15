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

func TestStatusOwner_OwnerAppearsInListWithoutRemoveButton(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "pending"},
		{Email: "signer@example.com", Status: "pending"},
	}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com")

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
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com")

	if !hasButtonText(card, "Sign this document") {
		t.Error("expected a 'Sign this document' button when the owner hasn't signed yet")
	}
}

func TestStatusOwner_ShowsResignButtonWhenOwnerDrifted(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "drifted"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com")

	if !hasButtonText(card, "Re-sign") {
		t.Error("expected a 'Re-sign' button when the owner's signature has drifted")
	}
}

func TestStatusOwner_HidesSignButtonWhenDocChanged(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "pending"}}
	card := StatusOwner("My Doc", signers, "doc-1", true, "owner@example.com")

	if hasButtonText(card, "Sign this document") {
		t.Error("should not offer to sign while there's unconfirmed drift")
	}
}

func TestStatusOwner_NoSignButtonWhenOwnerAlreadySigned(t *testing.T) {
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}
	card := StatusOwner("My Doc", signers, "doc-1", false, "owner@example.com")

	if hasButtonText(card, "Sign this document") || hasButtonText(card, "Re-sign") {
		t.Error("should not prompt to sign again once already signed")
	}
}
