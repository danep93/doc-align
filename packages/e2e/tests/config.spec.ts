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
