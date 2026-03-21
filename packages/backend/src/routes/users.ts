import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';

const router: RouterType = Router();

router.get('/me', async (req: AuthenticatedRequest, res) => {
  try {
    const user = await getOrCreateUser(req.userId!, req.userEmail!);
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

export default router;
