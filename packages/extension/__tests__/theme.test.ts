import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/lib/theme';

describe('resolveTheme', () => {
  it('returns dark when preference is dark', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('returns light when preference is light', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('returns system default when preference is system', () => {
    // In test env (no matchMedia), defaults to dark
    expect(resolveTheme('system')).toBe('dark');
  });
});
