import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';
import * as inviteService from '../services/inviteService';

const router: RouterType = Router();

router.get('/me', async (req: AuthenticatedRequest, res) => {
  try {
    const user = await getOrCreateUser(req.userId!, req.userEmail!);
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// GET /me/invites — list pending invites for current user
router.get('/me/invites', async (req: AuthenticatedRequest, res) => {
  try {
    const invites = await inviteService.getPendingInvitesForUser(req.userEmail!);
    res.json(invites);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /me/invites/:inviteId/accept — accept an invite
router.post('/me/invites/:inviteId/accept', async (req: AuthenticatedRequest, res) => {
  try {
    await inviteService.acceptInvite(req.params.inviteId!, req.userEmail!);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /me/invites/:inviteId/decline — decline an invite
router.post('/me/invites/:inviteId/decline', async (req: AuthenticatedRequest, res) => {
  try {
    await inviteService.declineInvite(req.params.inviteId!, req.userEmail!);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
