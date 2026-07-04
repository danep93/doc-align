package services

import (
	"context"
	"log"
	"time"
)

// CheckDocDrift is the lazy document-level drift check run on sidebar open. It compares
// Drive's modifiedTime (fetchable with ANY user's drive.file token — no Revisions API,
// which silently returns nothing for non-owners) against the modifiedTime captured at
// the owner's last confirm. Signers invalidated by the change are flipped to "drifted"
// in Firestore and in the returned map.
//
// Returns docChanged: true means the doc has edits the owner has not yet confirmed, and
// callers must lock all signing until the owner confirms. Fetch failures fail open for
// display (docChanged=false, log only) — the sign routes re-check at sign time and fail
// closed there.
func CheckDocDrift(ctx context.Context, store *Store, userToken, docID string, doc *DocRecord, signers map[string]SignerRecord) (bool, map[string]SignerRecord) {
	modifiedTime, err := FileModifiedTime(ctx, userToken, docID)
	if err != nil {
		log.Printf("drift-check: FileModifiedTime %s: %v (skipping)", docID, err)
		return false, signers
	}

	docChanged := DocChanged(modifiedTime, doc.ConfirmedModifiedTime)
	now := time.Now()
	for _, email := range SignersToDrift(docChanged, doc.ConfirmedVersion, signers) {
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
