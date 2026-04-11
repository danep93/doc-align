import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { TierRequest } from '../middleware/tier';
import { tierMiddleware } from '../middleware/tier';
import { CreateSignatureSchema, canUseFullSignature } from '@doc-align/shared';
import { createSignature, getSignatures, retireSignature } from '../services/signatureService';

const router: RouterType = Router();

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const signatures = await getSignatures(req.userId!);
    res.json(signatures);
  } catch {
    res.status(500).json({ error: 'Failed to get signatures' });
  }
});

router.post('/', tierMiddleware, async (req: TierRequest, res) => {
  const parsed = CreateSignatureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid signature data', details: parsed.error.issues });
    return;
  }

  if (parsed.data.format === 'full' && !canUseFullSignature(req.userTier!)) {
    res.status(403).json({ error: 'Full signature format requires Pro or Enterprise tier' });
    return;
  }

  try {
    const signature = await createSignature(req.userId!, parsed.data);
    res.status(201).json(signature);
  } catch (err) {
    console.error('Failed to create signature:', err);
    res.status(500).json({ error: 'Failed to create signature' });
  }
});

router.post('/:id/retire', async (req: AuthenticatedRequest, res) => {
  try {
    await retireSignature(req.userId!, req.params.id!);
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Signature not found' });
  }
});

export default router;
