package cards

import (
	"testing"
)

// findTextInput returns the TextInput widget with the given Name, or nil.
func findTextInput(card Card, name string) *TextInput {
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.TextInput != nil && w.TextInput.Name == name {
				return w.TextInput
			}
		}
	}
	return nil
}

func TestPRDCoaching_BothFound(t *testing.T) {
	coaching := PRDCoachingView{
		PressReleasePresent: true, PressReleaseText: "We're building X.",
		DoDPresent: true, DoDText: "Demo to 5 customers.",
	}
	card := PRDCoaching("My PRD", "doc-1", coaching, false)

	if card.Name != "prd_coaching" {
		t.Errorf("Name: got %q, want prd_coaching", card.Name)
	}
	if findTextInput(card, "pressReleaseManual") != nil {
		t.Error("expected no manual input for a found press release")
	}
	if findTextInput(card, "dodManual") != nil {
		t.Error("expected no manual input for a found DoD")
	}
}

func TestPRDCoaching_OneMissing(t *testing.T) {
	coaching := PRDCoachingView{
		PressReleasePresent: true, PressReleaseText: "We're building X.",
		DoDPresent: false,
	}
	card := PRDCoaching("My PRD", "doc-1", coaching, false)

	if findTextInput(card, "pressReleaseManual") != nil {
		t.Error("expected no manual input for a found press release")
	}
	dodInput := findTextInput(card, "dodManual")
	if dodInput == nil {
		t.Fatal("expected a manual input for the missing DoD")
	}
	if dodInput.Type != "MULTIPLE_LINE" {
		t.Errorf("dodManual should be MULTIPLE_LINE, got %q", dodInput.Type)
	}
}

func TestPRDCoaching_CheckFailed_BothManual(t *testing.T) {
	card := PRDCoaching("My PRD", "doc-1", PRDCoachingView{}, true)

	if findTextInput(card, "pressReleaseManual") == nil {
		t.Error("expected a manual input for press release when the check failed")
	}
	if findTextInput(card, "dodManual") == nil {
		t.Error("expected a manual input for DoD when the check failed")
	}
}

func TestPRDCoaching_ContinueButtonPostsWithDocID(t *testing.T) {
	card := PRDCoaching("My PRD", "doc-1", PRDCoachingView{}, true)

	var found bool
	for _, sec := range card.Sections {
		for _, w := range sec.Widgets {
			if w.ButtonList == nil {
				continue
			}
			for _, b := range w.ButtonList.Buttons {
				if b.OnClick == nil || b.OnClick.Action == nil {
					continue
				}
				for _, p := range b.OnClick.Action.Parameters {
					if p.Key == "docId" && p.Value == "doc-1" {
						found = true
					}
				}
			}
		}
	}
	if !found {
		t.Error("expected a button posting with docId=doc-1 parameter")
	}
}
