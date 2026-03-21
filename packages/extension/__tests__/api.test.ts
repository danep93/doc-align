import { describe, it, expect } from 'vitest';
import { buildUrl } from '../src/lib/api';

describe('buildUrl', () => {
  it('constructs URL with base and path', () => {
    expect(buildUrl('https://api.example.com', '/users/me')).toBe(
      'https://api.example.com/users/me',
    );
  });

  it('handles trailing slash on base', () => {
    expect(buildUrl('https://api.example.com/', '/users/me')).toBe(
      'https://api.example.com/users/me',
    );
  });
});
