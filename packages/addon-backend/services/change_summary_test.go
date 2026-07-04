package services

import (
	"testing"

	"github.com/doc-align/addon-backend/cards"
)

func TestBuildChangeSummary(t *testing.T) {
	result := DriftResult{
		Drifted: true,
		Added:   10,
		Removed: 3,
		Sections: []cards.DiffSection{
			{Title: "Termination Clause", Added: 8, Removed: 3},
			{Title: "New Appendix", Added: 2},
		},
	}

	got := BuildChangeSummary(result, "tightened termination terms", "rev-1", "rev-9")

	if got.Note != "tightened termination terms" {
		t.Errorf("note: got %q", got.Note)
	}
	if got.TotalAdded != 10 || got.TotalRemoved != 3 {
		t.Errorf("totals: got +%d -%d", got.TotalAdded, got.TotalRemoved)
	}
	if got.FromRevisionID != "rev-1" || got.ToRevisionID != "rev-9" {
		t.Errorf("revisions: got %q → %q", got.FromRevisionID, got.ToRevisionID)
	}
	if len(got.Sections) != 2 {
		t.Fatalf("sections: got %d, want 2", len(got.Sections))
	}
	if got.Sections[0] != (ChangeSection{Title: "Termination Clause", Added: 8, Removed: 3}) {
		t.Errorf("section 0: got %+v", got.Sections[0])
	}
}
