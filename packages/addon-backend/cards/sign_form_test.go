package cards

import "testing"

func TestSignForm_HasOnlyNoteFieldAndSignCancelButtons(t *testing.T) {
	card := SignForm("My Doc", "owner@example.com", "doc-1")

	if len(card.Sections) != 1 {
		t.Fatalf("expected 1 section, got %d", len(card.Sections))
	}
	widgets := card.Sections[0].Widgets
	if len(widgets) != 2 {
		t.Fatalf("expected 2 widgets (note field + button list), got %d: %+v", len(widgets), widgets)
	}
	if widgets[0].TextInput == nil || widgets[0].TextInput.Name != "commitMessage" {
		t.Fatalf("expected first widget to be the commitMessage text input, got %+v", widgets[0])
	}
	if widgets[1].ButtonList == nil {
		t.Fatalf("expected second widget to be a button list, got %+v", widgets[1])
	}

	buttons := widgets[1].ButtonList.Buttons
	if len(buttons) != 2 {
		t.Fatalf("expected exactly 2 buttons (Sign, Cancel), got %d: %+v", len(buttons), buttons)
	}
	if buttons[0].Text != "Sign" {
		t.Errorf("expected first button text %q, got %q", "Sign", buttons[0].Text)
	}
	if buttons[1].Text != "Cancel" {
		t.Errorf("expected second button text %q, got %q", "Cancel", buttons[1].Text)
	}
	for _, b := range buttons {
		switch b.Text {
		case "LGTM", "Approved", "Looks good", "Signed off":
			t.Fatalf("quick-sign chip %q should have been removed", b.Text)
		}
	}
}
