package services

import "time"

// DocChanged reports whether the file was modified after the owner's last confirmed
// version. Both times come from Drive's modifiedTime (captured at confirm), so no
// server-clock comparison is involved. A zero confirmedModifiedTime (pre-schema doc)
// always reads as changed, forcing one owner confirm to heal the record.
func DocChanged(modifiedTime, confirmedModifiedTime time.Time) bool {
	return modifiedTime.After(confirmedModifiedTime)
}

// SignersToDrift returns the emails of signers whose "signed" status is no longer
// valid: either the doc has unconfirmed changes (docChanged — everyone signed flips),
// or they signed an older confirmedVersion (they missed a confirm while offline).
// Pending and already-drifted signers are never returned.
func SignersToDrift(docChanged bool, confirmedVersion int, signers map[string]SignerRecord) []string {
	var out []string
	for email, rec := range signers {
		if rec.Status != "signed" {
			continue
		}
		if docChanged || rec.SignedVersion < confirmedVersion {
			out = append(out, email)
		}
	}
	return out
}
