package services

import (
	"context"
	"time"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

// FileModifiedTime returns the Drive modifiedTime of the file. Unlike the Revisions
// API, files.get works with any user's drive.file grant — owner or signer.
func FileModifiedTime(ctx context.Context, accessToken, docID string) (time.Time, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(accessToken)))
	if err != nil {
		return time.Time{}, err
	}
	f, err := svc.Files.Get(docID).Fields("modifiedTime").Context(ctx).Do()
	if err != nil {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339, f.ModifiedTime)
}
