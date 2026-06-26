package services

import (
	"context"
	"fmt"

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
