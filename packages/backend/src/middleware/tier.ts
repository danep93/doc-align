import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';
import { db } from '../config/firebase';
import type { Tier } from '@doc-align/shared';

export interface TierRequest extends AuthenticatedRequest {
  userTier?: Tier;
}

export async function tierMiddleware(
  req: TierRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    if (!userDoc.exists) {
      req.userTier = 'free';
    } else {
      req.userTier = (userDoc.data()?.tier as Tier) || 'free';
    }
    next();
  } catch {
    res.status(500).json({ error: 'Failed to check subscription tier' });
  }
}
