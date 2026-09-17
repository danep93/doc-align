package services

import "time"

// DocChanged reports whether the file was modified after the owner's last confirmed
// version. Both times come from Drive's modifiedTime (captured at confirm), so no
// server-clock comparison is involved. A zero confirmedModifiedTime (pre-schema doc)
// always reads as changed, forcing one owner confirm to heal the record.
//
// This is purely an owner-facing "your last confirmed diff may be stale" nudge — it
// never gates anyone's ability to sign. Per-signer staleness (SignersToDrift) is a
// separate, independent check.
func DocChanged(modifiedTime, confirmedModifiedTime time.Time) bool {
	return modifiedTime.After(confirmedModifiedTime)
}

// SignersToDrift returns the emails of "signed" signers whose signature is now stale:
// the document's live modifiedTime is newer than their own SignedModifiedTime. This is
// independent per signer — there is no shared "everyone is drifted" flag, since nothing
// gates signing on the document owner confirming a new version (see mark_revised.go and
// sign_common.go). Pending and already-drifted signers are never returned.
func SignersToDrift(modifiedTime time.Time, signers map[string]SignerRecord) []string {
	var out []string
	for email, rec := range signers {
		if rec.Status != "signed" {
			continue
		}
		if modifiedTime.After(rec.SignedModifiedTime) {
			out = append(out, email)
		}
	}
	return out
}
