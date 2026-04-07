// packages/e2e/global-setup.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { E2E_CONFIG } from './e2e.config';

const AUTH_STATE_DIR = path.resolve(__dirname, '.auth-state');
const EXTENSION_DIST = path.resolve(__dirname, '../extension/dist');
const ROOT_DIR = path.resolve(__dirname, '../..');

export default async function globalSetup() {
  if (process.env.SKIP_GLOBAL_SETUP) {
    console.log('Skipping global setup (SKIP_GLOBAL_SETUP=1)');
    return;
  }

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
