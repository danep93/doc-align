package services

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

// LatestRevisionID returns the most recent revision ID for the document.
func LatestRevisionID(ctx context.Context, accessToken, docID string) (string, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(accessToken)))
	if err != nil {
		return "", err
	}
	list, err := svc.Revisions.List(docID).Fields("revisions(id)").Context(ctx).Do()
	if err != nil {
		return "", err
	}
	if len(list.Revisions) == 0 {
		return "", nil
	}
	return list.Revisions[len(list.Revisions)-1].Id, nil
}

// KeepRevisionForever marks a revision so Google does not auto-prune it.
func KeepRevisionForever(ctx context.Context, accessToken, docID, revisionID string) error {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(accessToken)))
	if err != nil {
		return err
	}
	_, err = svc.Revisions.Update(docID, revisionID, &drive.Revision{
		KeepForever: true,
	}).Context(ctx).Do()
	return err
}

// ExportRevisionText fetches a revision's export link and downloads it as plain text.
// Drive v3 does not expose a revision.export() call — instead we read exportLinks from
// revisions.get and make an authenticated HTTP request to the text/plain export URL.
func ExportRevisionText(ctx context.Context, accessToken, docID, revisionID string) (string, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(accessToken)))
	if err != nil {
		return "", err
	}
	rev, err := svc.Revisions.Get(docID, revisionID).Fields("exportLinks").Context(ctx).Do()
	if err != nil {
		return "", err
	}
	exportURL, ok := rev.ExportLinks["text/plain"]
	if !ok {
		// Fall back to text/html if plain text not available.
		exportURL, ok = rev.ExportLinks["text/html"]
		if !ok {
			return "", fmt.Errorf("no text export link for revision %s", revisionID)
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, exportURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var sb strings.Builder
	if _, err := io.Copy(&sb, resp.Body); err != nil {
		return "", err
	}
	return sb.String(), nil
}
