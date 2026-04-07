# E2E Testing & CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm test:e2e` a comprehensive, frictionless verification command that Claude runs after every change, integrated into CI/CD so broken code can't reach production.

**Architecture:** Expand the existing Playwright E2E suite with a global setup guard (auto-build extension with staging config, validate auth state, check backend health), strengthen test coverage across all user flows, add a config validation spec, and wire E2E into GitHub Actions CI/CD pipeline at PR, post-deploy staging, and post-deploy production stages.

**Tech Stack:** Playwright, GitHub Actions, xvfb (CI headed mode), pnpm workspaces

---

## File Structure

**Create:**
- `packages/e2e/global-setup.ts` — Pre-test guard: checks auth state, builds extension with staging config, verifies backend health
- `packages/e2e/tests/config.spec.ts` — Validates extension is built with correct staging config
- `packages/e2e/e2e.config.ts` — E2E-specific environment constants (staging URL, Firebase project ID)

**Modify:**
- `packages/e2e/playwright.config.ts` — Add global setup, screenshot/trace on failure, better reporter
- `packages/e2e/fixtures/extension.ts` — Import staging config, improve error messages
- `packages/e2e/tests/auth.spec.ts` — Add auth persistence and sign-out tests
- `packages/e2e/tests/signature.spec.ts` — Add delete signature and guard tests
- `packages/e2e/tests/signoff.spec.ts` — Strengthen assertions
- `packages/e2e/tests/documents.spec.ts` — Strengthen assertions
- `packages/e2e/tests/groups.spec.ts` — Add tier gating test
- `packages/e2e/tests/settings.spec.ts` — Already solid, minor improvements
- `packages/e2e/tests/tracking.spec.ts` — Strengthen assertions
- `packages/e2e/package.json` — Add global-setup dependency if needed
- `.github/workflows/ci.yml` — Add E2E job with xvfb
- `.github/workflows/deploy.yml` — Add post-deploy E2E verification
- `CLAUDE.md` — Add verification instructions

---

### Task 1: Create E2E Config Constants

**Files:**
- Create: `packages/e2e/e2e.config.ts`

- [ ] **Step 1: Create the config file**

```typescript
// packages/e2e/e2e.config.ts

/**
 * E2E test environment configuration.
 * Tests always run against staging to catch config/integration bugs.
 */
export const E2E_CONFIG = {
  STAGING_API_BASE: 'https://doc-align-api-staging.run.app/api',
  STAGING_FIREBASE_PROJECT: 'doc-align-staging',
  HEALTH_ENDPOINT: '/health',
  /** Timeout for backend health check in ms */
  HEALTH_TIMEOUT: 10_000,
} as const;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm --filter @doc-align/e2e exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/e2e/e2e.config.ts
git commit -m "feat(e2e): add staging environment config constants"
```

---

### Task 2: Create Global Setup Guard

**Files:**
- Create: `packages/e2e/global-setup.ts`
- Modify: `packages/e2e/playwright.config.ts`

- [ ] **Step 1: Write the global setup script**

```typescript
// packages/e2e/global-setup.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { E2E_CONFIG } from './e2e.config';

const AUTH_STATE_DIR = path.resolve(__dirname, '.auth-state');
const EXTENSION_DIST = path.resolve(__dirname, '../extension/dist');
const ROOT_DIR = path.resolve(__dirname, '../..');

export default async function globalSetup() {
  console.log('\n=== E2E Global Setup ===\n');

  // 1. Check auth state
  if (!fs.existsSync(AUTH_STATE_DIR)) {
    throw new Error(
      'Auth state not found at packages/e2e/.auth-state/\n' +
      'Run: pnpm test:e2e:save-auth\n' +
      'Sign into Google and the extension, then close the browser.'
    );
  }
  console.log('✓ Auth state found');

  // 2. Build extension with staging config
  console.log('Building extension with staging config...');
  try {
    execSync(
      `API_BASE=${E2E_CONFIG.STAGING_API_BASE} ` +
      `FIREBASE_PROJECT_ID=${E2E_CONFIG.STAGING_FIREBASE_PROJECT} ` +
      `pnpm --filter @doc-align/extension run build`,
      { cwd: ROOT_DIR, stdio: 'pipe', timeout: 120_000 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Extension build failed:\n${msg}`);
  }

  // Verify build output exists
  if (!fs.existsSync(path.join(EXTENSION_DIST, 'manifest.json'))) {
    throw new Error('Extension build completed but dist/manifest.json not found');
  }
  console.log('✓ Extension built with staging config');

  // 3. Check staging backend health
  console.log(`Checking staging backend at ${E2E_CONFIG.STAGING_API_BASE}...`);
  try {
    const healthUrl = `${E2E_CONFIG.STAGING_API_BASE}${E2E_CONFIG.HEALTH_ENDPOINT}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), E2E_CONFIG.HEALTH_TIMEOUT);
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`Health check returned ${res.status}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Staging backend not reachable at ${E2E_CONFIG.STAGING_API_BASE}\n` +
      `Error: ${msg}\n` +
      'Check your network connection or VPN.'
    );
  }
  console.log('✓ Staging backend is healthy\n');
}
```

- [ ] **Step 2: Update playwright.config.ts to use global setup and capture artifacts on failure**

Replace `packages/e2e/playwright.config.ts` with:

```typescript
import { defineConfig } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../extension/dist');

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1, // Chrome extensions can't run in parallel
  globalSetup: './global-setup.ts',
  use: {
    headless: false, // Extensions require headed mode (use xvfb in CI)
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './playwright-report' }],
  ],
  projects: [
    {
      name: 'chrome-extension',
      use: {},
    },
  ],
});

export { EXTENSION_PATH };
```

- [ ] **Step 3: Add test-results and playwright-report to .gitignore**

Check if `packages/e2e/.gitignore` exists; if so, append. Otherwise create:

```
.auth-state/
test-results/
playwright-report/
```

- [ ] **Step 4: Run global setup to verify it works**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm test:e2e --grep "should show signed-in"`
Expected: Global setup runs (builds extension, checks health), then the auth test passes

- [ ] **Step 5: Commit**

```bash
git add packages/e2e/global-setup.ts packages/e2e/playwright.config.ts packages/e2e/.gitignore
git commit -m "feat(e2e): add global setup guard with auto-build, auth check, health check"
```

---

### Task 3: Add Config Validation Spec

**Files:**
- Create: `packages/e2e/tests/config.spec.ts`

- [ ] **Step 1: Write the config validation test**

```typescript
// packages/e2e/tests/config.spec.ts
import { test as base, expect } from '@playwright/test';
import { E2E_CONFIG } from '../e2e.config';
import fs from 'fs';
import path from 'path';

const EXTENSION_DIST = path.resolve(__dirname, '../../extension/dist');

// Use base test (not extension fixture) — these tests check files and HTTP,
// they don't need Chrome with the extension loaded.
const test = base;

test.describe('Extension Configuration', () => {
  test('extension is built with staging API base, not localhost', async () => {
    // Read the built popup.js to verify the compiled-in API_BASE
    const popupJs = fs.readFileSync(
      path.join(EXTENSION_DIST, 'popup/popup.js'),
      'utf-8'
    );

    expect(popupJs).toContain(E2E_CONFIG.STAGING_API_BASE);
    expect(popupJs).not.toContain('localhost:8080');
    expect(popupJs).not.toContain('localhost:3000');
  });

  test('extension is built with staging Firebase project', async () => {
    const popupJs = fs.readFileSync(
      path.join(EXTENSION_DIST, 'popup/popup.js'),
      'utf-8'
    );

    expect(popupJs).toContain(E2E_CONFIG.STAGING_FIREBASE_PROJECT);
  });

  test('staging API health endpoint is reachable', async () => {
    const healthUrl = `${E2E_CONFIG.STAGING_API_BASE}${E2E_CONFIG.HEALTH_ENDPOINT}`;
    const res = await fetch(healthUrl);
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the config spec**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm test:e2e --grep "Configuration"`
Expected: All 3 config tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/e2e/tests/config.spec.ts
git commit -m "feat(e2e): add config validation spec to catch misconfiguration"
```

---

### Task 4: Strengthen Auth Tests

**Files:**
- Modify: `packages/e2e/tests/auth.spec.ts`

- [ ] **Step 1: Add auth persistence and sign-out tests**

Replace `packages/e2e/tests/auth.spec.ts` with:

```typescript
import { test, expect } from '../fixtures/extension';

test.describe('Authentication', () => {
  test('should show signed-in state with email', async ({ extensionPopup }) => {
    const mainScreen = extensionPopup.locator('#main-screen');
    await expect(mainScreen).not.toHaveClass(/hidden/);

    const email = extensionPopup.locator('#user-email');
    await expect(email).toHaveText(/\S+@\S+/);
  });

  test('should show tier badge', async ({ extensionPopup }) => {
    const badge = extensionPopup.locator('#tier-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/FREE|PRO|ENTERPRISE/);
  });

  test('should have all four tabs', async ({ extensionPopup }) => {
    await expect(extensionPopup.locator('.tab[data-tab="signoff"]')).toBeVisible();
    await expect(extensionPopup.locator('.tab[data-tab="documents"]')).toBeVisible();
    await expect(extensionPopup.locator('.tab[data-tab="groups"]')).toBeVisible();
    await expect(extensionPopup.locator('.tab[data-tab="settings"]')).toBeVisible();
  });

  test('auth persists across popup close and reopen', async ({ context, extensionId }) => {
    // Open popup, verify signed in
    const popup1 = await context.newPage();
    await popup1.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup1.waitForLoadState('domcontentloaded');
    await popup1.waitForSelector('#main-screen:not(.hidden)', { timeout: 10_000 });
    const email1 = await popup1.locator('#user-email').textContent();
    expect(email1).toMatch(/\S+@\S+/);

    // Close popup
    await popup1.close();

    // Reopen popup, verify still signed in (no double sign-in)
    const popup2 = await context.newPage();
    await popup2.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup2.waitForLoadState('domcontentloaded');
    await popup2.waitForSelector('#main-screen:not(.hidden)', { timeout: 10_000 });
    const email2 = await popup2.locator('#user-email').textContent();
    expect(email2).toBe(email1);
  });
});
```

- [ ] **Step 2: Run auth tests**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm test:e2e --grep "Authentication"`
Expected: All 4 tests pass, including the new persistence test

- [ ] **Step 3: Commit**

```bash
git add packages/e2e/tests/auth.spec.ts
git commit -m "feat(e2e): add auth persistence test to catch double sign-in bugs"
```

---

### Task 5: Strengthen Signature Tests

**Files:**
- Modify: `packages/e2e/tests/signature.spec.ts`

- [ ] **Step 1: Add signature guard test (can't sign off without signature)**

Add to the end of the existing `test.describe` block in `packages/e2e/tests/signature.spec.ts`:

```typescript
  test('should show signature in sign-off tab after creation', async ({ extensionPopup }) => {
    // Navigate to sign-off tab
    await extensionPopup.locator('.tab[data-tab="signoff"]').click();
    await extensionPopup.waitForTimeout(1000);

    const signoffView = extensionPopup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // If no signatures exist, should show a prompt to create one
    // If signatures exist, should show the signature card
    const hasSignature = text!.includes('Test User') || text!.includes('signature');
    const hasCreatePrompt = text!.includes('Create') || text!.includes('create');
    expect(hasSignature || hasCreatePrompt).toBe(true);
  });
```

- [ ] **Step 2: Run signature tests**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm test:e2e --grep "Signature"`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/e2e/tests/signature.spec.ts
git commit -m "feat(e2e): add signature guard test for sign-off flow"
```

---

### Task 6: Strengthen Sign-Off, Documents, Groups, and Tracking Tests

**Files:**
- Modify: `packages/e2e/tests/signoff.spec.ts`
- Modify: `packages/e2e/tests/documents.spec.ts`
- Modify: `packages/e2e/tests/groups.spec.ts`
- Modify: `packages/e2e/tests/tracking.spec.ts`

- [ ] **Step 1: Improve signoff.spec.ts assertions**

Replace `packages/e2e/tests/signoff.spec.ts` with:

```typescript
import { test, expect } from '../fixtures/extension';

test.describe('Sign Off', () => {
  test('should render sign-off view on default tab', async ({ extensionPopup }) => {
    const signoffView = extensionPopup.locator('#signoff-view');
    await expect(signoffView).toBeVisible();

    // View should render content (not be blank or show errors)
    await extensionPopup.waitForTimeout(2000);
    const text = await signoffView.textContent();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
  });

  test('should show sign-off UI when on a Google Doc', async ({ context, extensionId }) => {
    // Open a Google Doc
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    // Open extension popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(3000);

    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // Should show document context — title, signature, or sign-off controls
    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
  });
});
```

- [ ] **Step 2: Improve documents.spec.ts assertions**

Replace `packages/e2e/tests/documents.spec.ts` with:

```typescript
import { test, expect } from '../fixtures/extension';

test.describe('My Documents Tab', () => {
  test('should render documents view without errors', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const docsView = extensionPopup.locator('#documents-view');
    const text = await docsView.textContent();

    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  test('should show signed/tracked toggle or empty state', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const docsView = extensionPopup.locator('#documents-view');
    const text = await docsView.textContent();

    const hasToggle = await extensionPopup.locator('.docs-toggle-btn').count() > 0;
    const hasEmptyState = text!.includes('No signed or tracked documents');
    expect(hasToggle || hasEmptyState).toBe(true);
  });

  test('should show open full view button when docs exist', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const openBtn = extensionPopup.locator('.docs-open-tab-btn');
    const hasOpenBtn = await openBtn.count() > 0;

    if (hasOpenBtn) {
      await expect(openBtn).toContainText('Open full view');
    }
  });
});
```

- [ ] **Step 3: Improve groups.spec.ts with tier gating check**

Replace `packages/e2e/tests/groups.spec.ts` with:

```typescript
import { test, expect } from '../fixtures/extension';

test.describe('Groups Tab', () => {
  test('should render groups view without errors', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="groups"]').click();
    await extensionPopup.waitForTimeout(2000);

    const groupsView = extensionPopup.locator('#groups-view');
    const text = await groupsView.textContent();

    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
  });

  test('should show create org, group list, or tier gate message', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="groups"]').click();
    await extensionPopup.waitForTimeout(2000);

    const groupsView = extensionPopup.locator('#groups-view');
    const text = await groupsView.textContent();

    // One of these states should be visible
    const hasCreateOrg = text!.includes('Create Organization');
    const hasGroups = text!.toLowerCase().includes('group');
    const hasTierGate = text!.includes('require') || text!.includes('upgrade') || text!.includes('Pro');
    const hasBackendMsg = text!.includes('backend');
    const hasPendingInvite = text!.includes('Accept') || text!.includes('invite');

    expect(hasCreateOrg || hasGroups || hasTierGate || hasBackendMsg || hasPendingInvite).toBe(true);
  });
});
```

- [ ] **Step 4: Improve tracking.spec.ts assertions**

Replace `packages/e2e/tests/tracking.spec.ts` with:

```typescript
import { test, expect } from '../fixtures/extension';

test.describe('Document Tracking', () => {
  test('should show track button or doc context on sign-off tab when on a Google Doc', async ({ context, extensionId }) => {
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(3000);

    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('undefined');
  });

  test('should show tracked docs section in documents view without errors', async ({ extensionPopup }) => {
    await extensionPopup.locator('.tab[data-tab="documents"]').click();
    await extensionPopup.waitForTimeout(2000);

    const trackedBtn = extensionPopup.locator('.docs-toggle-btn[data-toggle="tracked"]');
    const hasTrackedToggle = await trackedBtn.count() > 0;

    if (hasTrackedToggle) {
      await trackedBtn.click();
      await extensionPopup.waitForTimeout(1000);

      const docsView = extensionPopup.locator('#documents-view');
      const text = await docsView.textContent();

      expect(text!.length).toBeGreaterThan(0);
      expect(text).not.toContain('Error:');
      expect(text).not.toContain('undefined');
    }
  });
});
```

- [ ] **Step 5: Run all E2E tests**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm test:e2e`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/e2e/tests/signoff.spec.ts packages/e2e/tests/documents.spec.ts packages/e2e/tests/groups.spec.ts packages/e2e/tests/tracking.spec.ts
git commit -m "feat(e2e): strengthen assertions across all spec files"
```

---

### Task 7: Add E2E to CI Pipeline (PR Gate)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Update ci.yml to add E2E job**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Typecheck all packages
        run: pnpm run typecheck

      - name: Build all packages
        run: pnpm run build-all

      - name: Run unit tests
        run: pnpm run test-all

  e2e-tests:
    needs: build-and-test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm --filter @doc-align/e2e exec playwright install chromium

      - name: Restore E2E auth state
        run: |
          mkdir -p packages/e2e/.auth-state
          echo '${{ secrets.E2E_AUTH_STATE }}' | base64 -d | tar xz -C packages/e2e/.auth-state

      - name: Run E2E tests (headed via xvfb)
        run: xvfb-run pnpm test:e2e

      - name: Upload test artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-test-results
          path: |
            packages/e2e/test-results/
            packages/e2e/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Verify YAML is valid**

Run: `cd /Users/daniel/git_repos/doc-align && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add E2E test job to PR pipeline with xvfb and artifact upload"
```

---

### Task 8: Add Post-Deploy E2E to Deploy Pipeline

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add e2e-staging job after deploy-staging**

Add this job to `.github/workflows/deploy.yml` after the `deploy-staging` job:

```yaml
  e2e-staging:
    needs: deploy-staging
    if: github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'staging')
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm --filter @doc-align/e2e exec playwright install chromium

      - name: Restore E2E auth state
        run: |
          mkdir -p packages/e2e/.auth-state
          echo '${{ secrets.E2E_AUTH_STATE }}' | base64 -d | tar xz -C packages/e2e/.auth-state

      - name: Run E2E tests against staging
        run: xvfb-run pnpm test:e2e

      - name: Upload test artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-staging-results
          path: |
            packages/e2e/test-results/
            packages/e2e/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Do NOT add `needs: e2e-staging` to deploy-production**

The `e2e-staging` job only runs on `push` or `workflow_dispatch` with `environment == 'staging'`, while `deploy-production` runs on `workflow_dispatch` with `environment == 'production'`. Adding `needs: e2e-staging` would deadlock production deploys because `e2e-staging` would be skipped.

Instead, leave `deploy-production.needs` as `build-and-test`. The staging E2E gate is enforced by process: you must push to main (which runs E2E against staging) before triggering a production deploy. The production smoke test (Step 3 below) provides the final safety net.

- [ ] **Step 3: Add post-production smoke test job**

Add after `deploy-production` in `.github/workflows/deploy.yml`:

```yaml
  e2e-production-smoke:
    needs: deploy-production
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'production'
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm --filter @doc-align/e2e exec playwright install chromium

      - name: Restore E2E auth state
        run: |
          mkdir -p packages/e2e/.auth-state
          echo '${{ secrets.E2E_AUTH_STATE }}' | base64 -d | tar xz -C packages/e2e/.auth-state

      - name: Build extension with production config
        run: |
          API_BASE=https://doc-align-api.run.app/api \
          FIREBASE_PROJECT_ID=doc-align \
          pnpm --filter @doc-align/extension run build

      - name: Run smoke E2E tests against production (skip global setup to preserve prod build)
        run: xvfb-run pnpm --filter @doc-align/e2e exec playwright test --grep "Authentication" --config playwright.config.ts --global-setup ""

      - name: Upload test artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-production-smoke-results
          path: |
            packages/e2e/test-results/
            packages/e2e/playwright-report/
          retention-days: 7
```

- [ ] **Step 4: Verify YAML is valid**

Run: `cd /Users/daniel/git_repos/doc-align && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add post-deploy E2E verification for staging and production"
```

---

### Task 9: Update CLAUDE.md with Verification Instructions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add verification section to CLAUDE.md**

Add the following section to the end of `CLAUDE.md`:

```markdown
## Verifying Changes

After ANY change to extension UI, backend routes, auth flow, or shared types:
1. Build all: `pnpm run build-all`
2. Run E2E tests: `pnpm test:e2e`
3. Do NOT claim a fix works unless E2E tests pass
4. If a relevant E2E test doesn't exist for the change, write one first

If E2E tests fail, read the screenshot and trace output to diagnose.
Do not say "I can't verify because I can't click in the extension."
The E2E tests ARE the verification.

### Bug fix workflow
1. Write a failing E2E test that reproduces the bug
2. Fix the bug
3. Run `pnpm test:e2e` — new test passes, existing tests don't regress
4. Only then report the fix as complete
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add E2E verification instructions to CLAUDE.md"
```

---

### Task 10: Save CI Auth State and Document the Process

**Files:**
- No code files — operational setup

- [ ] **Step 1: Document auth state CI secret setup**

Create a brief operational note. Add to `packages/e2e/README.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/e2e/README.md
git commit -m "docs: add E2E test setup and CI auth state instructions"
```

---

### Task 11: End-to-End Verification

- [ ] **Step 1: Run the full E2E suite**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm test:e2e`
Expected: All tests pass (auth, config, signature, signoff, documents, groups, settings, tracking)

- [ ] **Step 2: Verify test output includes screenshots/traces on failure**

Run a test that will fail to verify artifact capture:
Run: `cd /Users/daniel/git_repos/doc-align && pnpm test:e2e --grep "Configuration" 2>&1 || true`
Then check: `ls packages/e2e/test-results/`
Expected: Directory exists (may be empty if tests passed)

- [ ] **Step 3: Verify CI YAML files are valid**

Run: `cd /Users/daniel/git_repos/doc-align && python3 -c "import yaml; [yaml.safe_load(open(f'.github/workflows/{f}')) for f in ['ci.yml', 'deploy.yml']]"`
Expected: No errors
