package services

import (
	"golang.org/x/oauth2"
)

// staticTokenSource wraps a bearer token string into an oauth2.TokenSource.
type staticTS struct {
	token string
}

func staticTokenSource(token string) oauth2.TokenSource {
	return oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
}
