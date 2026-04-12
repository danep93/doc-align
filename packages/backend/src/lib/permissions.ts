import { db } from '../config/firebase';

export type Action =
  | 'org:edit'
  | 'org:invite'
  | 'org:remove_member'
  | 'org:view_members'
  | 'org:search_members'
  | 'group:create'
  | 'group:delete'
  | 'group:edit'
  | 'group:add_member'
  | 'group:remove_member'
  | 'group:view_members';

interface PermissionContext {
  userId: string;
  orgId: string;
  action: Action;
  groupId?: string;
}

export async function checkPermission(ctx: PermissionContext): Promise<boolean> {
  const memberSnap = await db.collection('orgMembers')
    .where('organizationId', '==', ctx.orgId)
    .where('userId', '==', ctx.userId)
    .limit(1)
    .get();

  if (memberSnap.empty) return false;
  const member = memberSnap.docs[0]!.data();
  const role = member.role as string;

  // Admins can do everything
  if (role === 'admin') return true;

  // Director permissions
  if (role === 'director') {
    const directorActions: Action[] = [
      'org:invite', 'org:view_members', 'org:search_members',
      'group:create',
    ];
    if (directorActions.includes(ctx.action)) return true;

    // Group-scoped actions: director must own the group
    if (ctx.groupId) {
      const groupDoc = await db.collection('groups').doc(ctx.groupId).get();
      if (!groupDoc.exists) return false;
      const group = groupDoc.data()!;
      const ownsGroup = group.leaderId === ctx.userId || group.createdById === ctx.userId;
      if (!ownsGroup) return false;

      const groupActions: Action[] = [
        'group:delete', 'group:edit', 'group:add_member',
        'group:remove_member', 'group:view_members',
      ];
      return groupActions.includes(ctx.action);
    }
    return false;
  }

  // Member permissions — check if they're a group leader
  if (role === 'member' && ctx.groupId) {
    const groupDoc = await db.collection('groups').doc(ctx.groupId).get();
    if (!groupDoc.exists) return false;
    const group = groupDoc.data()!;
    if (group.leaderId !== ctx.userId) return false;

    const leaderActions: Action[] = [
      'group:add_member', 'group:remove_member', 'group:view_members',
    ];
    return leaderActions.includes(ctx.action);
  }

  // Search members — group leaders get this
  if (role === 'member' && ctx.action === 'org:search_members') {
    const ledGroups = await db.collection('groups')
      .where('organizationId', '==', ctx.orgId)
      .where('leaderId', '==', ctx.userId)
      .limit(1)
      .get();
    return !ledGroups.empty;
  }

  return false;
}

export async function getOrgRole(userId: string, orgId: string): Promise<string | null> {
  const snap = await db.collection('orgMembers')
    .where('organizationId', '==', orgId)
    .where('userId', '==', userId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0]!.data().role as string;
}
