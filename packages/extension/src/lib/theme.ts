export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'doc-align-theme';

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'dark' || preference === 'light') return preference;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export async function loadThemePreference(): Promise<ThemePreference> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve((result[STORAGE_KEY] as ThemePreference) || 'system');
      });
    } else {
      resolve('system');
    }
  });
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [STORAGE_KEY]: preference }, resolve);
    } else {
      resolve();
    }
  });
}

export async function initTheme(): Promise<void> {
  const preference = await loadThemePreference();
  const resolved = resolveTheme(preference);
  applyTheme(resolved);
}
