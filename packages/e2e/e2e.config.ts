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
