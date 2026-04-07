# E2E Tests

## First-time setup

1. Build the extension: `pnpm run build:extension:staging`
2. Save auth state: `pnpm test:e2e:save-auth`
   - Sign into Google with the test account
   - Click the extension icon and sign in
   - Close the browser
3. Run tests: `pnpm test:e2e`

## CI auth state

Tests in CI use a saved auth state stored as a GitHub Actions secret.

To update the CI auth state:

```bash
# After running save-auth locally with the test account:
cd packages/e2e
tar cz .auth-state | base64 > /tmp/auth-state-b64.txt
# Copy contents of /tmp/auth-state-b64.txt to GitHub secret E2E_AUTH_STATE
```

Auth state needs refreshing when Google OAuth tokens expire (typically every few weeks to months). Signs of expiry: E2E tests fail in CI with auth errors (popup stuck on sign-in screen).

## Running tests

```bash
pnpm test:e2e              # headless (default)
pnpm test:e2e:headed       # visible browser
pnpm test:e2e --grep "auth" # run subset
```
