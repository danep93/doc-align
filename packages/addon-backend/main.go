package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"cloud.google.com/go/firestore"
	"github.com/doc-align/addon-backend/cards"
	"github.com/doc-align/addon-backend/middleware"
	"github.com/doc-align/addon-backend/routes"
	"github.com/doc-align/addon-backend/services"
)

func main() {
	ctx := context.Background()

	cards.BaseURL = os.Getenv("BASE_URL")
	if cards.BaseURL == "" {
		log.Fatal("BASE_URL must be set (e.g. https://xxxx.ngrok-free.dev)")
	}

	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	if projectID == "" {
		projectID = os.Getenv("GOOGLE_CLOUD_PROJECT")
	}
	if projectID == "" {
		log.Fatal("FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set")
	}

	fsClient, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		log.Fatalf("firestore.NewClient: %v", err)
	}
	defer fsClient.Close()

	// RESEND_API_KEY lives in Firestore config/secrets.resendApiKey.
	var resendKey string
	if snap, err := fsClient.Collection("config").Doc("secrets").Get(ctx); err == nil {
		if v, ok := snap.Data()["resendApiKey"].(string); ok {
			resendKey = v
		}
	}
	if resendKey == "" {
		log.Println("resendApiKey not found in Firestore config/secrets — emails will not be sent")
	}

	store := services.NewStore(fsClient)

	mux := http.NewServeMux()

	// All add-on endpoints are wrapped with OIDC verification.
	protected := func(h http.HandlerFunc) http.Handler {
		return middleware.VerifyOIDC(h)
	}

	mux.Handle("POST /addon/homepage", protected(routes.Homepage(store)))
	mux.Handle("POST /addon/request-file-scope", protected(routes.RequestFileScope()))
	mux.Handle("POST /addon/on-file-scope-granted", protected(routes.OnFileScopeGranted(store)))
	mux.Handle("POST /addon/create-baseline", protected(routes.CreateBaseline(store)))
	mux.Handle("POST /addon/add-signers", protected(routes.AddSigners(store)))
	mux.Handle("POST /addon/save-signers", protected(routes.SaveSigners(store, resendKey)))
	mux.Handle("POST /addon/sign-form", protected(routes.SignForm(store)))
	mux.Handle("POST /addon/sign", protected(routes.Sign(store, resendKey)))
	mux.Handle("POST /addon/quick-sign", protected(routes.QuickSign(store, resendKey)))
	mux.Handle("POST /addon/diff", protected(routes.Diff(store)))
	mux.Handle("POST /addon/history", protected(routes.History(store)))

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("doc-align addon backend listening on :%s (OIDC_BYPASS=%s)", port, os.Getenv("OIDC_BYPASS"))
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
