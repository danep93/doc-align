package services

import (
	"context"
	"fmt"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

// MostRecentDocID returns the ID and title of the Google Doc the user most recently viewed.
// Used as a fallback when docs.id is missing from the homepage trigger event.
func MostRecentDocID(ctx context.Context, userToken string) (id, title string, err error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(userToken)))
	if err != nil {
		return "", "", err
	}

	list, err := svc.Files.List().
		Q("mimeType='application/vnd.google-apps.document' and trashed=false").
		OrderBy("viewedByMeTime desc").
		PageSize(1).
		Fields("files(id,name)").
		Context(ctx).
		Do()
	if err != nil {
		return "", "", err
	}
	if len(list.Files) == 0 {
		return "", "", fmt.Errorf("no Google Docs found in Drive")
	}
	return list.Files[0].Id, list.Files[0].Name, nil
}
