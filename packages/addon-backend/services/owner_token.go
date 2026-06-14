package services

import (
	"context"

	"cloud.google.com/go/firestore"
)

// StoreOwnerRefreshToken saves the owner's refresh token in plaintext.
// TODO Phase 2: encrypt with Cloud KMS before storing.
func StoreOwnerRefreshToken(ctx context.Context, fs *firestore.Client, docID, refreshToken string) error {
	_, err := fs.Collection("documents").Doc(docID).Update(ctx, []firestore.Update{
		{Path: "ownerRefreshToken", Value: refreshToken},
	})
	return err
}

// GetOwnerAccessToken retrieves the owner's refresh token and exchanges it for an access token.
func GetOwnerAccessToken(ctx context.Context, fs *firestore.Client, docID string) (string, error) {
	snap, err := fs.Collection("documents").Doc(docID).Get(ctx)
	if err != nil {
		return "", err
	}
	refreshToken, ok := snap.Data()["ownerRefreshToken"].(string)
	if !ok || refreshToken == "" {
		return "", nil
	}
	return exchangeRefreshToken(ctx, refreshToken)
}
