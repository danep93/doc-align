# Running doc-align Workspace Add-on Locally

This guide covers first-time setup and the daily run loop for the Go add-on backend.

## Prerequisites

### 1. Go

Install Go 1.21 or later: https://go.dev/dl/

```bash
go version   # should print go1.21+
```

### 2. ngrok

ngrok tunnels localhost to a public HTTPS URL so Google can POST events to your machine.

```bash
brew install ngrok/ngrok/ngrok   # macOS
# or: https://ngrok.com/download for other platforms
```

Log in to ngrok and link your account (one-time):

```bash
ngrok config add-authtoken <your-auth-token>
```

Get your auth token at https://dashboard.ngrok.com/get-started/your-authtoken.

The project uses a **static ngrok URL** (`reactor-explore-crumb.ngrok-free.dev`) so the Google
Cloud deployment never needs to be updated when you restart the tunnel.

### 3. Google Cloud SDK

Needed only for redeployment (e.g. after changing OAuth scopes). Not needed for daily dev.

```bash
brew install google-cloud-sdk
gcloud auth login
gcloud config set project docaligntest
```

### 4. Firebase / Firestore

Already provisioned. Project: `docaligntest`. No action needed unless you are setting up a
fresh GCP project — see GCP section below.

---

## Daily run (two terminals)

**Terminal 1 — ngrok tunnel**

```bash
ngrok http --url=reactor-explore-crumb.ngrok-free.dev 8080
```

Keep this running. The static URL means you never need to redeploy after restart.

**Terminal 2 — Go server**

```bash
cd packages/addon-backend

OIDC_BYPASS=true \
DEBUG_EMAIL=rhlrtr44@gmail.com \
FIREBASE_PROJECT_ID=docaligntest \
BASE_URL=https://reactor-explore-crumb.ngrok-free.dev \
PORT=8080 \
go run .
```

`OIDC_BYPASS=true` — skips Google OIDC JWT verification. Required when running behind ngrok.
`BASE_URL` — must be the full HTTPS URL; all Card Service action buttons embed it.

### Build (without running)

```bash
cd packages/addon-backend && go build ./...
```

---

## Opening the add-on in Google Docs

1. Open any Google Doc at https://docs.google.com
2. Look for the **Google "G" multicolor icon** in the right sidebar (below the Tasks checkmark icon)
3. Click it — the doc-align panel opens
4. The panel label shows **"doc-align"** on hover

> The panel closes when you navigate to a different document. Click the G icon again to reopen it.

---

## GCP / deployment reference

| Resource | Value |
|----------|-------|
| GCP project | `docaligntest` (number `841259604072`) |
| Firestore | Native mode, us-east1 |
| OAuth consent | External; test user `rhlrtr44@gmail.com` |
| ngrok static URL | `https://reactor-explore-crumb.ngrok-free.dev` |
| Deployment config | `/tmp/addon-deployment.json` |

### Redeploy after changing the ngrok URL or OAuth scopes

```bash
gcloud workspace-add-ons deployments replace my-addon \
  --deployment-file=/tmp/addon-deployment.json

gcloud workspace-add-ons deployments install my-addon
```

---

## Firestore data model

```
documents/{docId}
  title, ownerId, ownerRefreshToken, baselineRevisionId, lastDriftCheckedAt, createdAt

documents/{docId}/signers/{email}
  status (pending | signed | drifted), signedAt, signedRevisionId, commitMessage

documents/{docId}/history/{id}
  action, actorEmail, commitMessage, revisionId, timestamp
```

No document content is ever written to Firestore.
