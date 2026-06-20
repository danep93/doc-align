package services

import (
	"context"

	"golang.org/x/oauth2"
)

// staticTokenSource wraps a bearer token string into an oauth2.TokenSource.
type staticTS struct {
	token string
}

func staticTokenSource(token string) oauth2.TokenSource {
	return oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
}

// exchangeRefreshToken exchanges a refresh token for a new access token.
func exchangeRefreshToken(ctx context.Context, refreshToken string) (string, error) {
	cfg := oauth2.Config{
		Endpoint: oauth2.Endpoint{
			TokenURL: "https://oauth2.googleapis.com/token",
		},
	}
	token, err := cfg.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken}).Token()
	if err != nil {
		return "", err
	}
	return token.AccessToken, nil
}
