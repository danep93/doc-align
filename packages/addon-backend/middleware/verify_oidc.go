package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserEmailKey contextKey = "userEmail"

// VerifyOIDC validates the Google OIDC JWT from the Authorization header.
// When OIDC_BYPASS=true (local dev), it reads X-Debug-Email instead.
func VerifyOIDC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("OIDC_BYPASS") == "true" {
			email := r.Header.Get("X-Debug-Email")
			if email == "" {
				email = os.Getenv("DEBUG_EMAIL")
			}
			if email == "" {
				http.Error(w, "OIDC_BYPASS=true but no X-Debug-Email or DEBUG_EMAIL set", http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), UserEmailKey, email)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "missing Bearer token", http.StatusUnauthorized)
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		if _, err := verifyGoogleJWT(r.Context(), tokenStr); err != nil {
			http.Error(w, fmt.Sprintf("invalid OIDC token: %v", err), http.StatusUnauthorized)
			return
		}

		// The OIDC token above authenticates the request as coming from Google's
		// add-on infrastructure (service account), not the end user. Extract the
		// actual user email from the OAuth token embedded in the event payload.
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read body", http.StatusInternalServerError)
			return
		}

		var evPartial struct {
			Auth struct {
				UserOAuthToken string `json:"userOAuthToken"`
			} `json:"authorizationEventObject"`
		}
		json.Unmarshal(body, &evPartial)

		email, err := fetchEmailFromOAuthToken(r.Context(), evPartial.Auth.UserOAuthToken)
		if err != nil {
			http.Error(w, fmt.Sprintf("could not identify user: %v", err), http.StatusUnauthorized)
			return
		}

		r.Body = io.NopCloser(bytes.NewReader(body))
		ctx := context.WithValue(r.Context(), UserEmailKey, email)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// EmailFromContext extracts the verified user email from a request context.
func EmailFromContext(ctx context.Context) string {
	v, _ := ctx.Value(UserEmailKey).(string)
	return v
}

func fetchEmailFromOAuthToken(ctx context.Context, token string) (string, error) {
	if token == "" {
		return "", fmt.Errorf("empty OAuth token in event payload")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.googleapis.com/oauth2/v3/userinfo", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var info struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", err
	}
	if info.Email == "" {
		return "", fmt.Errorf("no email in userinfo response")
	}
	return info.Email, nil
}

// jwks caches Google's public keys. A real implementation would refresh on 403.
var jwksCache struct {
	keys    map[string]interface{}
	fetched time.Time
}

func verifyGoogleJWT(ctx context.Context, tokenStr string) (string, error) {
	keys, err := fetchGoogleJWKS(ctx)
	if err != nil {
		return "", fmt.Errorf("fetch JWKS: %w", err)
	}

	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		kid, _ := token.Header["kid"].(string)
		key, ok := keys[kid]
		if !ok {
			return nil, fmt.Errorf("unknown kid: %s", kid)
		}
		return key, nil
	},
		jwt.WithIssuer("https://accounts.google.com"),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return "", err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", fmt.Errorf("invalid claims")
	}

	email, _ := claims["email"].(string)
	if email == "" {
		// Fall back to sub claim (which contains email for workspace add-ons)
		email, _ = claims["sub"].(string)
	}
	if email == "" {
		return "", fmt.Errorf("no email in token claims")
	}
	return email, nil
}

func fetchGoogleJWKS(ctx context.Context) (map[string]interface{}, error) {
	if time.Since(jwksCache.fetched) < 60*time.Minute && jwksCache.keys != nil {
		return jwksCache.keys, nil
	}

	resp, err := http.Get("https://www.googleapis.com/oauth2/v3/certs")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var raw struct {
		Keys []json.RawMessage `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	keys := make(map[string]interface{})
	for _, k := range raw.Keys {
		var header struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		}
		if err := json.Unmarshal(k, &header); err != nil {
			continue
		}
		rsaKey, err := parseRSAPublicKey(header.N, header.E)
		if err != nil {
			continue
		}
		keys[header.Kid] = rsaKey
	}

	jwksCache.keys = keys
	jwksCache.fetched = time.Now()
	return keys, nil
}
