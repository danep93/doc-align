import type { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.userId = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    console.error('Auth verification failed:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
