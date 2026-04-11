// E2E mode: uses real Firebase auth + real backend API, but stubs Google Drive/Docs APIs
// (since chrome.identity OAuth isn't available in Playwright's Chromium).
// Set via E2E_MODE=true environment variable at build time.
declare const __E2E_MODE__: boolean;
export const E2E_MODE = typeof __E2E_MODE__ !== 'undefined' ? __E2E_MODE__ : false;
