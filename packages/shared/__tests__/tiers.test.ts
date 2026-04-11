import { describe, it, expect } from 'vitest';
import { TIER_LIMITS, canSignOff, canTrackDocument, canUseDiffViewer } from '../src/tiers';

describe('TIER_LIMITS', () => {
  it('defines limits for all three tiers', () => {
    expect(TIER_LIMITS.free).toBeDefined();
    expect(TIER_LIMITS.pro).toBeDefined();
    expect(TIER_LIMITS.enterprise).toBeDefined();
  });

  it('free tier has 10 sign-offs and 5 docs', () => {
    expect(TIER_LIMITS.free.maxSignOffsPerMonth).toBe(10);
    expect(TIER_LIMITS.free.maxTrackedDocuments).toBe(5);
  });

  it('pro tier has unlimited sign-offs and 500 tracked docs', () => {
    expect(TIER_LIMITS.pro.maxSignOffsPerMonth).toBe(Infinity);
    expect(TIER_LIMITS.pro.maxTrackedDocuments).toBe(500);
  });
});

describe('canSignOff', () => {
  it('allows free tier under limit', () => {
    expect(canSignOff('free', 5)).toBe(true);
  });

  it('blocks free tier at limit', () => {
    expect(canSignOff('free', 10)).toBe(false);
  });

  it('always allows pro tier', () => {
    expect(canSignOff('pro', 9999)).toBe(true);
  });
});

describe('canTrackDocument', () => {
  it('allows free tier under limit', () => {
    expect(canTrackDocument('free', 3)).toBe(true);
  });

  it('blocks free tier at limit', () => {
    expect(canTrackDocument('free', 5)).toBe(false);
  });
});

describe('canUseDiffViewer', () => {
  it('returns false for free tier', () => {
    expect(canUseDiffViewer('free')).toBe(false);
  });

  it('returns true for pro tier', () => {
    expect(canUseDiffViewer('pro')).toBe(true);
  });

  it('returns true for enterprise tier', () => {
    expect(canUseDiffViewer('enterprise')).toBe(true);
  });
});
