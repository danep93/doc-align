package services

import (
	"context"
	"log"
	"time"
)

// CheckDocDrift is the lazy per-signer staleness check run on sidebar open (and after
// any sign/status action). It fetches Drive's live modifiedTime once (fetchable with
// ANY user's drive.file token — no Revisions API, which silently returns nothing for
// non-owners) and flips any "signed" signer whose own SignedModifiedTime predates it to
// "drifted" in Firestore and in the returned map — independently of every other signer.
//
// The returned docChanged bool is unrelated to signer state: it's purely the document
// owner's "your last confirmed diff may be stale" nudge (DocChanged against
// doc.ConfirmedModifiedTime), used only to suggest — never require — re-confirming.
// Nothing here blocks anyone's ability to sign; that's enforced (or not) in
// completeSign, which only gates on whether the document owner has signed at least once.
//
// Fetch failures fail open for display (docChanged=false, log only, signers untouched):
// the sign route (completeSign) re-fetches modifiedTime itself and fails closed there.
func CheckDocDrift(ctx context.Context, store *Store, userToken, docID string, doc *DocRecord, signers map[string]SignerRecord) (bool, map[string]SignerRecord) {
	modifiedTime, err := FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("drift-check: FileModifiedTime %s: %v (skipping)", docID, err)
		return false, signers
	}

	docChanged := DocChanged(modifiedTime, doc.ConfirmedModifiedTime)
	now := time.Now()
	for _, email := range SignersToDrift(modifiedTime, signers) {
		if err := store.UpdateSignerStatus(ctx, docID, email, "drifted", map[string]interface{}{
			"driftDetectedAt": now,
		}); err != nil {
			log.Printf("drift-check: UpdateSignerStatus %s: %v", email, err)
			continue
		}
		_ = store.AddHistory(ctx, docID, HistoryRecord{
			Action:     "drifted",
			ActorEmail: email,
			Timestamp:  now,
		})
		rec := signers[email]
		rec.Status = "drifted"
		rec.DriftDetectedAt = now
		signers[email] = rec
	}
	return docChanged, signers
}
