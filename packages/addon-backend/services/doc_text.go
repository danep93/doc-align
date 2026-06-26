package services

import (
	"context"
	"io"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type DocSection struct {
	Title string
	Text  string
}

// FetchDocText exports the document as plain text using the Drive files.export API.
// Requires drive.file scope (covers the active document in an Editor add-on).
func FetchDocText(ctx context.Context, userToken, docID string) (string, []DocSection, error) {
	svc, err := drive.NewService(ctx, option.WithTokenSource(staticTokenSource(userToken)))
	if err != nil {
		return "", nil, err
	}

	resp, err := svc.Files.Export(docID, "text/plain").Context(ctx).Download()
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, err
	}

	return string(b), nil, nil
}
