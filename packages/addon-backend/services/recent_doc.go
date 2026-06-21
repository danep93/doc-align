package services

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type Permission struct {
	EmailAddress string
	DisplayName  string
	Role         string
}

// ListFilePermissions returns the permission list for a Drive file using the given user token.
func ListFilePermissions(ctx context.Context, userToken, fileID string) ([]Permission, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(userToken)))
	if err != nil {
		return nil, fmt.Errorf("drive.NewService: %w", err)
	}

	resp, err := svc.Permissions.List(fileID).
		Fields("permissions(emailAddress,displayName,role)").
		Context(ctx).
		Do()
	if err != nil {
		return nil, fmt.Errorf("drive permissions.list: %w", err)
	}

	out := make([]Permission, 0, len(resp.Permissions))
	for _, p := range resp.Permissions {
		out = append(out, Permission{
			EmailAddress: p.EmailAddress,
			DisplayName:  p.DisplayName,
			Role:         p.Role,
		})
	}
	return out, nil
}

// DocIDByTitle searches Drive for a Google Doc with the given title and returns its ID.
// When multiple matches exist, it returns the most recently modified one.
func DocIDByTitle(ctx context.Context, userToken, title string) (string, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(userToken)))
	if err != nil {
		return "", fmt.Errorf("drive.NewService: %w", err)
	}

	escaped := strings.ReplaceAll(title, "'", "\\'")
	q := fmt.Sprintf("name='%s' and mimeType='application/vnd.google-apps.document' and trashed=false", escaped)

	files, err := svc.Files.List().
		Q(q).
		OrderBy("modifiedByMeTime desc").
		PageSize(5).
		Fields("files(id,name)").
		Context(ctx).
		Do()
	if err != nil {
		return "", fmt.Errorf("drive files.list by title: %w", err)
	}
	if len(files.Files) == 0 {
		return "", fmt.Errorf("no doc found with title %q", title)
	}
	return files.Files[0].Id, nil
}

// MostRecentDocID returns the Drive file ID of the most recently viewed Google Doc
// for the given user token. Used as a fallback when docs.id is not available in
// the event (e.g. when drive.file scope was already globally authorized and the
// per-file dialog was skipped by Google's runtime).
func MostRecentDocID(ctx context.Context, userToken string) (string, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(userToken)))
	if err != nil {
		return "", fmt.Errorf("drive.NewService: %w", err)
	}

	files, err := svc.Files.List().
		Q("mimeType='application/vnd.google-apps.document' and trashed=false").
		OrderBy("viewedByMeTime desc").
		PageSize(1).
		Fields("files(id)").
		Context(ctx).
		Do()
	if err != nil {
		return "", fmt.Errorf("drive files.list: %w", err)
	}

	if len(files.Files) == 0 {
		return "", fmt.Errorf("no recent docs found")
	}
	return files.Files[0].Id, nil
}
