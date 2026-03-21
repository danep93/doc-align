import { describe, it, expect } from 'vitest';
import { computeTextDiff, type DiffLine } from '../src/lib/diff-engine';

describe('computeTextDiff', () => {
  it('returns empty diff for identical text', () => {
    const result = computeTextDiff('hello world', 'hello world');
    const changes = result.filter((l) => l.type !== 'context');
    expect(changes).toHaveLength(0);
  });

  it('detects additions', () => {
    const result = computeTextDiff('line one', 'line one\nline two');
    const adds = result.filter((l) => l.type === 'add');
    expect(adds.length).toBeGreaterThan(0);
  });

  it('detects removals', () => {
    const result = computeTextDiff('line one\nline two', 'line one');
    const removes = result.filter((l) => l.type === 'remove');
    expect(removes.length).toBeGreaterThan(0);
  });

  it('detects modifications', () => {
    const result = computeTextDiff('the quick brown fox', 'the slow brown fox');
    const changes = result.filter((l) => l.type !== 'context');
    expect(changes.length).toBeGreaterThan(0);
  });

  it('handles empty old text', () => {
    const result = computeTextDiff('', 'new content');
    const adds = result.filter((l) => l.type === 'add');
    expect(adds.length).toBeGreaterThan(0);
  });
});
