# Deployment Guide

## Prerequisites

- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install): `gcloud`
- Authenticated: `gcloud auth login` and `firebase login`

## Environments

| Environment | Firebase Project | Cloud Run Service | API URL |
|---|---|---|---|
| Local | doc-align | N/A | http://localhost:8080/api |
| Staging | doc-align-staging | doc-align-api | https://doc-align-api-HASH.run.app/api |
| Production | doc-align | doc-align-api | https://doc-align-api-HASH.run.app/api |

## First-Time Setup

1. Create staging Firebase project:
   ```bash
   firebase projects:create doc-align-staging
   ```

2. Set environment variables on Cloud Run (both environments):
   ```bash
   # Staging
   gcloud run services update doc-align-api \
     --project doc-align-staging \
     --region us-central1 \
     --set-env-vars "STRIPE_SECRET_KEY=sk_test_...,STRIPE_WEBHOOK_SECRET=whsec_...,STRIPE_PRO_PRICE_ID=price_...,STRIPE_ENTERPRISE_PRICE_ID=price_...,FRONTEND_URL=https://your-staging-url"
   ```

## Deploy Workflow

### Backend

```bash
# Deploy to staging
pnpm run deploy:staging

# Run integration tests against staging
pnpm run test:integration

# Deploy to production
pnpm run deploy:prod
```

### Firestore Indexes

```bash
pnpm run deploy:indexes:staging
pnpm run deploy:indexes:prod
```

### Chrome Extension

```bash
# Build for staging (load unpacked in Chrome)
pnpm run build:extension:staging

# Build for production (upload to Chrome Web Store)
pnpm run build:extension:prod
```

## Local Development

```bash
# Start backend
cd packages/backend && pnpm run dev

# Watch extension
cd packages/extension && pnpm run watch
```
