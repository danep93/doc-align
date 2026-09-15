package services

import (
	"testing"
	"time"
)

func TestDocChanged(t *testing.T) {
	confirmed := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	if DocChanged(confirmed, confirmed) {
		t.Error("same modifiedTime should not count as changed")
	}
	if DocChanged(confirmed.Add(-time.Minute), confirmed) {
		t.Error("older modifiedTime should not count as changed")
	}
	if !DocChanged(confirmed.Add(time.Minute), confirmed) {
		t.Error("newer modifiedTime must count as changed")
	}
	// Doc records created before this schema have zero confirmedModifiedTime:
	// any real modifiedTime must read as changed so the owner is pushed to confirm once.
	if !DocChanged(confirmed, time.Time{}) {
		t.Error("zero confirmed time must count as changed")
	}
}

func TestSignersToDrift(t *testing.T) {
	base := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	signers := map[string]SignerRecord{
		"pending@x.com": {Status: "pending"},
		"current@x.com": {Status: "signed", SignedModifiedTime: base.Add(time.Hour)},
		"old@x.com":     {Status: "signed", SignedModifiedTime: base.Add(-time.Hour)},
		"drifted@x.com": {Status: "drifted", SignedModifiedTime: base.Add(-time.Hour)},
	}

	// Live modifiedTime sits between old@x.com's and current@x.com's own signed
	// times: only old@x.com (signed before this edit) should flip. current@x.com
	// signed after this edit, so their signature is still fresh — independent of
	// old@x.com's state.
	got := SignersToDrift(base, signers)
	if len(got) != 1 || got[0] != "old@x.com" {
		t.Errorf("want [old@x.com], got %v", got)
	}

	// A later live modifiedTime invalidates every currently-signed signer
	// independently — pending/drifted are never returned.
	got = SignersToDrift(base.Add(2*time.Hour), signers)
	if len(got) != 2 {
		t.Errorf("want 2 signers, got %v", got)
	}
	found := map[string]bool{}
	for _, e := range got {
		found[e] = true
	}
	if !found["current@x.com"] || !found["old@x.com"] {
		t.Errorf("want current@x.com and old@x.com, got %v", got)
	}
}
