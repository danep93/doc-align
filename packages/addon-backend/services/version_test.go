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
	signers := map[string]SignerRecord{
		"pending@x.com":    {Status: "pending"},
		"current@x.com":    {Status: "signed", SignedVersion: 2},
		"old@x.com":        {Status: "signed", SignedVersion: 1},
		"drifted@x.com":    {Status: "drifted", SignedVersion: 1},
	}

	// No doc change: only stale signedVersion flips (signer missed the confirm).
	got := SignersToDrift(false, 2, signers)
	if len(got) != 1 || got[0] != "old@x.com" {
		t.Errorf("no-change case: want [old@x.com], got %v", got)
	}

	// Doc changed: every currently-signed signer flips; drifted/pending untouched.
	got = SignersToDrift(true, 2, signers)
	if len(got) != 2 {
		t.Errorf("changed case: want 2 signers, got %v", got)
	}
	found := map[string]bool{}
	for _, e := range got {
		found[e] = true
	}
	if !found["current@x.com"] || !found["old@x.com"] {
		t.Errorf("changed case: want current@x.com and old@x.com, got %v", got)
	}
}
