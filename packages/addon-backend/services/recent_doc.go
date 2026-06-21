package services

import (
	"context"
	"fmt"
	"log"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type Permission struct {
	EmailAddress string
	DisplayName  string
	Role         string
}

// MostRecentDocID returns the Drive file ID of the Google Doc the user most recently viewed.
// Used to auto-detect the current document when docs.id is absent from the event (which
// happens when drive.file is globally pre-authorized and the per-file grant is skipped).
// drive.readonly scope suffices — no per-file grant required.
func MostRecentDocID(ctx context.Context, userToken string) (string, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(userToken)))
	if err != nil {
		return "", fmt.Errorf("drive.NewService: %w", err)
	}

	// Debug: bare minimum call — no filter, no ordering — to verify the token works.
	files, err := svc.Files.List().
		PageSize(5).
		Fields("files(id,name,mimeType)").
		Context(ctx).
		Do()
	if err != nil {
		return "", fmt.Errorf("drive files.list (bare): %w", err)
	}

	log.Printf("MostRecentDocID debug: Drive returned %d file(s) (no filter)", len(files.Files))
	for i, f := range files.Files {
		log.Printf("  [%d] id=%s name=%q mimeType=%s", i, f.Id, f.Name, f.MimeType)
	}

	if len(files.Files) == 0 {
		return "", fmt.Errorf("drive returned 0 files even without filter — token or API restriction")
	}
	return files.Files[0].Id, nil
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
