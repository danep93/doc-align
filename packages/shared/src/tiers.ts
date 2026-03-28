import type { Tier } from './types';

export interface TierLimits {
  maxSignOffsPerMonth: number;
  maxTrackedDocuments: number;
  maxCheckpointsPerDoc: number;
  signatureFormat: 'basic' | 'full';
  richDiffViewer: boolean;
  auditRetentionDays: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxSignOffsPerMonth: 10,
    maxTrackedDocuments: 5,
    maxCheckpointsPerDoc: 1,
    signatureFormat: 'basic',
    richDiffViewer: false,
    auditRetentionDays: 7,
  },
  pro: {
    maxSignOffsPerMonth: Infinity,
    maxTrackedDocuments: Infinity,
    maxCheckpointsPerDoc: 10,
    signatureFormat: 'full',
    richDiffViewer: true,
    auditRetentionDays: 90,
  },
  enterprise: {
    maxSignOffsPerMonth: Infinity,
    maxTrackedDocuments: Infinity,
    maxCheckpointsPerDoc: 10,
    signatureFormat: 'full',
    richDiffViewer: true,
    auditRetentionDays: 365,
  },
};

export function canSignOff(tier: Tier, currentCount: number): boolean {
  return currentCount < TIER_LIMITS[tier].maxSignOffsPerMonth;
}

export function canTrackDocument(tier: Tier, currentCount: number): boolean {
  return currentCount < TIER_LIMITS[tier].maxTrackedDocuments;
}

export function canUseDiffViewer(tier: Tier): boolean {
  return TIER_LIMITS[tier].richDiffViewer;
}

export function canUseFullSignature(tier: Tier): boolean {
  return TIER_LIMITS[tier].signatureFormat === 'full';
}
