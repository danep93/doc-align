package cards

import "testing"

func TestStatusSigner_WaitingForOwnerWhenOwnerHasNotSignedYet(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "pending"},
		{Email: "signer@example.com", Status: "pending"},
	}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", false, nil)

	if hasButtonText(card, "Sign this document") {
		t.Error("signer should not be able to sign before the owner has signed off at least once")
	}

	found := false
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.DecoratedText != nil && w.DecoratedText.Text == "Waiting for The Owner to sign off first" {
				found = true
			}
		}
	}
	if !found {
		t.Error("expected a 'waiting for owner' message when the owner hasn't signed yet")
	}
}

func TestStatusSigner_CanSignImmediatelyOnceOwnerHasSignedOnce(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "signed"},
		{Email: "signer@example.com", Status: "pending"},
	}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", true, nil)

	if !hasButtonText(card, "Sign this document") {
		t.Error("signer should be able to sign as soon as the owner has signed off once")
	}
}

func TestStatusSigner_DriftedSignerCanReSignImmediately(t *testing.T) {
	// No confirm-gate: a drifted signer's Re-sign button must be available
	// regardless of whether the owner has confirmed anything.
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "signed"},
		{Email: "signer@example.com", Status: "drifted"},
	}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", true, nil)

	if !hasButtonText(card, "Re-sign") {
		t.Error("drifted signer must be able to re-sign immediately, with no owner confirm required")
	}
}

func TestStatusSigner_ShowsRefreshButton(t *testing.T) {
	// Refresh lives in the 3-dot menu (CardActions), not the card body.
	signers := []SignerStatus{{Email: "owner@example.com", Status: "signed"}}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", true, nil)

	if !hasCardAction(card, "Refresh") {
		t.Error("expected a 'Refresh' entry in the 3-dot menu")
	}
}

func TestStatusSigner_RowShowsSignCount(t *testing.T) {
	signers := []SignerStatus{
		{Email: "owner@example.com", Status: "drifted", SignCount: 5},
	}
	card := StatusSigner("My Doc", "The Owner", signers, "signer@example.com", "doc-1", true, nil)

	var row *DecoratedText
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.DecoratedText != nil && w.DecoratedText.Text == "owner@example.com" {
				row = w.DecoratedText
			}
		}
	}
	if row == nil {
		t.Fatal("expected to find the owner's row in the sign-offs list")
	}
	if row.BottomLabel != "drifted (×5)" {
		t.Errorf("expected bottom label %q, got %q", "drifted (×5)", row.BottomLabel)
	}
}
