/**
 * Run this once to save your authenticated Chrome profile for E2E tests.
 *
 * Usage: pnpm run save-auth
 *
 * IMPORTANT: Close ALL Chrome windows before running this.
 *
 * This opens a real Chrome window WITHOUT automation flags,
 * so Google allows sign-in.
 *
 * Steps:
 * 1. Go to accounts.google.com and sign in with your test account
 * 2. Click the doc-align extension icon and sign in there too
 * 3. Close the browser window
 *
 * Your auth state is saved to packages/e2e/.auth-state/
 */

import { chromium } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const AUTH_STATE_DIR = path.resolve(__dirname, '../.auth-state');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function saveAuthState() {
  console.log('');
  console.log('=== doc-align E2E Auth Setup ===');
  console.log('');
  console.log('IMPORTANT: Close ALL Chrome windows first!');
  console.log('');
  console.log('Steps:');
  console.log('  1. Go to accounts.google.com and sign in');
  console.log('  2. Click the doc-align extension icon → Sign in');
  console.log('  3. Close the browser window');
  console.log('');
  console.log(`Saving to: ${AUTH_STATE_DIR}`);
  console.log('');

  const context = await chromium.launchPersistentContext(AUTH_STATE_DIR, {
    headless: false,
    executablePath: CHROME_PATH,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
  });

  const page = await context.newPage();
  await page.goto('https://accounts.google.com');

  await new Promise<void>((resolve) => {
    context.on('close', resolve);
  });

  console.log('');
  console.log('Auth state saved! Run tests with: pnpm run test:e2e');
}

saveAuthState().catch(console.error);
