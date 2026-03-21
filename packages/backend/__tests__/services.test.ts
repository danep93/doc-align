import { describe, it, expect } from 'vitest';
import { shouldResetSignOffCount } from '../src/services/userService';

describe('shouldResetSignOffCount', () => {
  it('returns true when reset date is in the past', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    expect(shouldResetSignOffCount(pastDate)).toBe(true);
  });

  it('returns false when reset date is in the future', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    expect(shouldResetSignOffCount(futureDate)).toBe(false);
  });
});
