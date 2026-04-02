import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { TierRequest } from '../middleware/tier';
import { tierMiddleware } from '../middleware/tier';
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  CreateInviteSchema,
  ChangeRoleSchema,
  canCreateOrganization,
} from '@doc-align/shared';
import * as orgService from '../services/organizationService';
import * as inviteService from '../services/inviteService';
import { checkPermission, getOrgRole } from '../lib/permissions';

const router: RouterType = Router();

// GET /me — list orgs for current user (MUST be before /:orgId)
router.get('/me', async (req: AuthenticatedRequest, res) => {
  try {
    const orgs = await orgService.getOrgsForUser(req.userId!);
    res.json(orgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST / — create org
router.post('/', tierMiddleware, async (req: TierRequest, res) => {
  const parsed = CreateOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
    return;
  }

  if (!canCreateOrganization(req.userTier!)) {
    res.status(403).json({ error: 'Your plan does not support creating organizations. Upgrade to Pro.' });
    return;
  }

  try {
    const org = await orgService.createOrganization(req.userId!, parsed.data.name);
    res.status(201).json(org);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /:orgId — get org details
router.get('/:orgId', async (req: AuthenticatedRequest, res) => {
  try {
    const role = await getOrgRole(req.userId!, req.params.orgId!);
    if (!role) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const org = await orgService.getOrganization(req.params.orgId!);
    if (!org) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(org);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /:orgId — update org
router.patch('/:orgId', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = UpdateOrganizationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    await orgService.updateOrganization(req.params.orgId!, parsed.data);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /:orgId/members — list members
router.get('/:orgId/members', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:view_members',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const members = await orgService.getOrgMembers(req.params.orgId!);
    res.json(members);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /:orgId/members/search — search members
router.get('/:orgId/members/search', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:search_members',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const email = req.query.email as string;
    const members = await orgService.searchOrgMembers(req.params.orgId!, email);
    res.json(members);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /:orgId/members/me/leave — leave org
router.post('/:orgId/members/me/leave', async (req: AuthenticatedRequest, res) => {
  try {
    const org = await orgService.getOrganization(req.params.orgId!);
    if (!org) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await orgService.leaveOrganization(req.params.orgId!, req.userId!, org.ownerId);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /:orgId/members/:userId — change role
router.patch('/:orgId/members/:userId', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = ChangeRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    const org = await orgService.getOrganization(req.params.orgId!);
    if (!org) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (req.params.userId === org.ownerId && parsed.data.role !== 'admin') {
      res.status(403).json({ error: 'Cannot demote organization owner' });
      return;
    }

    await orgService.changeOrgMemberRole(req.params.orgId!, req.params.userId!, parsed.data.role);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /:orgId/members/:userId — remove member
router.delete('/:orgId/members/:userId', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:remove_member',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const org = await orgService.getOrganization(req.params.orgId!);
    if (!org) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await orgService.removeOrgMember(req.params.orgId!, req.params.userId!, org.ownerId);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /:orgId/invites — create invite
router.post('/:orgId/invites', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:invite',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = CreateInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    const invite = await inviteService.createInvite(
      req.params.orgId!,
      req.userId!,
      parsed.data.email,
      parsed.data.role,
      parsed.data.groupId,
    );
    res.status(201).json(invite);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /:orgId/invites — list invites
router.get('/:orgId/invites', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:invite',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const invites = await inviteService.getOrgInvites(req.params.orgId!);
    res.json(invites);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /:orgId/invites/:inviteId — revoke invite
router.delete('/:orgId/invites/:inviteId', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:invite',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    await inviteService.revokeInvite(req.params.inviteId!);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
