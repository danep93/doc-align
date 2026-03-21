import { describe, it, expect } from 'vitest';
import { computeImageHash } from '../src/lib/signature-renderer';

describe('computeImageHash', () => {
  it('produces a hex string from a data URL', async () => {
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const hash = await computeImageHash(fakeDataUrl);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces same hash for same input', async () => {
    const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const hash1 = await computeImageHash(data);
    const hash2 = await computeImageHash(data);
    expect(hash1).toBe(hash2);
  });
});
