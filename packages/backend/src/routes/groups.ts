import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  AddGroupMemberSchema,
} from '@doc-align/shared';
import * as groupService from '../services/groupService';
import { checkPermission, getOrgRole } from '../lib/permissions';

const router: RouterType = Router({ mergeParams: true });

// POST / — create group
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'group:create',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = CreateGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    const group = await groupService.createGroup(
      orgId,
      parsed.data.name,
      req.userId!,
      parsed.data.leaderId,
    );
    res.status(201).json(group);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET / — list groups
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const role = await getOrgRole(req.userId!, orgId);
    if (!role) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    let groups;
    if (role === 'admin' || role === 'director') {
      groups = await groupService.getOrgGroups(orgId);
    } else {
      groups = await groupService.getGroupsForUser(orgId, req.userId!);
    }

    res.json(groups);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /:groupId — get group
router.get('/:groupId', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const groupId = req.params.groupId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'group:view_members',
      groupId,
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const group = await groupService.getGroup(groupId);
    if (!group) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(group);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PATCH /:groupId — update group
router.patch('/:groupId', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const groupId = req.params.groupId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'group:edit',
      groupId,
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = UpdateGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    await groupService.updateGroup(groupId, parsed.data);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /:groupId — delete group
router.delete('/:groupId', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const groupId = req.params.groupId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'group:delete',
      groupId,
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    await groupService.deleteGroup(groupId);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /:groupId/members — add member
router.post('/:groupId/members', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const groupId = req.params.groupId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'group:add_member',
      groupId,
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = AddGroupMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    // Verify the user is an org member
    const targetRole = await getOrgRole(parsed.data.userId, orgId);
    if (!targetRole) {
      res.status(400).json({ error: 'User is not a member of this organization' });
      return;
    }

    const member = await groupService.addGroupMember(groupId, parsed.data.userId);
    res.status(201).json(member);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /:groupId/members/:userId — remove member
router.delete('/:groupId/members/:userId', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const groupId = req.params.groupId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'group:remove_member',
      groupId,
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    await groupService.removeGroupMember(groupId, req.params.userId!);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /:groupId/members/me/leave — leave group
router.post('/:groupId/members/me/leave', async (req: AuthenticatedRequest, res) => {
  try {
    const groupId = req.params.groupId!;
    await groupService.leaveGroup(groupId, req.userId!);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /:groupId/members — list members
router.get('/:groupId/members', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const groupId = req.params.groupId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'group:view_members',
      groupId,
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const members = await groupService.getGroupMembers(groupId);
    res.json(members);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
