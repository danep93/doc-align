import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { TierRequest } from '../middleware/tier';
import { tierMiddleware } from '../middleware/tier';
import { CreateSignOffSchema, canSignOff } from '@doc-align/shared';
import { createSignOff, getMySignOffs, getMyDocReferences, getCoSigners } from '../services/signoffService';
import { getOrCreateUser, incrementSignOffCount } from '../services/userService';

const router: RouterType = Router();

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const signOffs = await getMySignOffs(req.userId!);
    res.json(signOffs);
  } catch {
    res.status(500).json({ error: 'Failed to get sign-offs' });
  }
});

router.get('/documents', async (req: AuthenticatedRequest, res) => {
  try {
    const docs = await getMyDocReferences(req.userId!);
    res.json(docs);
  } catch {
    res.status(500).json({ error: 'Failed to get documents' });
  }
});

router.get('/co-signers/:documentId/:revisionId', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await getCoSigners(req.params.documentId!, req.params.revisionId!);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to get co-signers' });
  }
});

router.post('/', tierMiddleware, async (req: TierRequest, res) => {
  const parsed = CreateSignOffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid sign-off data', details: parsed.error.issues });
    return;
  }

  const user = await getOrCreateUser(req.userId!, req.userEmail!);
  if (!canSignOff(user.tier, user.signOffCount)) {
    res.status(403).json({ error: 'Monthly sign-off limit reached. Upgrade to Pro for unlimited sign-offs.' });
    return;
  }

  try {
    const signOff = await createSignOff(req.userId!, parsed.data);
    await incrementSignOffCount(req.userId!);
    res.status(201).json(signOff);
  } catch {
    res.status(500).json({ error: 'Failed to create sign-off' });
  }
});

export default router;
