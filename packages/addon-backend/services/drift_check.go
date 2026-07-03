package services

import (
	"context"
	"log"
	"time"
)

// CheckDrift lazily compares each "signed" signer's committed revision against the document's
// current text, using the requesting user's own live OAuth token (drive.file scope covers full
// access, including revision history, to a file they've been granted access to — no stored
// owner token needed). Signers found to have drifted are flipped to "drifted" in Firestore with
// driftDetectedAt stamped, and the returned map reflects the update immediately so the caller can
// render without a second round-trip.
//
// If onlyEmail is non-empty, only that signer is checked (the signer's own homepage view).
// If empty, every "signed" signer is checked (the owner's homepage view), grouping by
// SignedRevisionID to dedupe Drive API calls when signers share a revision.
//
// All Drive API failures here are non-fatal: they're logged and skipped so a Drive hiccup never
// blocks homepage rendering.
func CheckDrift(ctx context.Context, store *Store, userToken, docID string, signers map[string]SignerRecord, onlyEmail string) map[string]SignerRecord {
	toCheck := make(map[string]SignerRecord)
	if onlyEmail != "" {
		if rec, ok := signers[onlyEmail]; ok && rec.Status == "signed" {
			toCheck[onlyEmail] = rec
		}
	} else {
		for email, rec := range signers {
			if rec.Status == "signed" {
				toCheck[email] = rec
			}
		}
	}
	if len(toCheck) == 0 {
		return signers
	}

	currentText, _, err := FetchDocText(ctx, userToken, docID)
	if err != nil {
		log.Printf("drift-check: FetchDocText %s: %v (skipping)", docID, err)
		return signers
	}

	// Group signers by revision to avoid re-fetching the same signed text repeatedly.
	byRevision := make(map[string][]string) // revisionId -> emails
	for email, rec := range toCheck {
		byRevision[rec.SignedRevisionID] = append(byRevision[rec.SignedRevisionID], email)
	}

	now := time.Now()
	for revisionID, emails := range byRevision {
		if revisionID == "" {
			continue
		}
		signedText, err := ExportRevisionText(ctx, userToken, docID, revisionID)
		if err != nil {
			log.Printf("drift-check: ExportRevisionText %s rev=%s: %v (skipping)", docID, revisionID, err)
			continue
		}

		result := DetectDrift(currentText, signedText)
		if !result.Drifted {
			continue
		}

		for _, email := range emails {
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
	}

	return signers
}
