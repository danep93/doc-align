import { db } from '../config/firebase';
import type { Invite, OrganizationMember, GroupMember, OrgRole } from '@doc-align/shared';

const INVITES = 'invites';
const USERS = 'users';
const ORG_MEMBERS = 'orgMembers';
const GROUP_MEMBERS = 'groupMembers';

const INVITE_EXPIRY_DAYS = 30;

export async function createInvite(
  orgId: string,
  inviterUserId: string,
  inviteeEmail: string,
  role: OrgRole,
  groupId?: string,
): Promise<Invite> {
  // Verify user exists
  const userSnapshot = await db
    .collection(USERS)
    .where('email', '==', inviteeEmail)
    .get();

  if (userSnapshot.empty) {
    throw new Error('User not found. They must have doc-align installed first.');
  }

  // Check for existing pending invite
  const existingSnapshot = await db
    .collection(INVITES)
    .where('organizationId', '==', orgId)
    .where('inviteeEmail', '==', inviteeEmail)
    .where('status', '==', 'pending')
    .get();

  if (!existingSnapshot.empty) {
    throw new Error('An invite is already pending for this user.');
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86400000).toISOString();
  const ref = db.collection(INVITES).doc();

  const invite: Invite = {
    id: ref.id,
    organizationId: orgId,
    inviterUserId,
    inviteeEmail,
    role,
    ...(groupId ? { groupId } : {}),
    status: 'pending',
    createdAt: now,
    expiresAt,
  };

  await ref.set(invite);
  return invite;
}

export async function getPendingInvitesForUser(userEmail: string): Promise<Invite[]> {
  const snapshot = await db
    .collection(INVITES)
    .where('inviteeEmail', '==', userEmail)
    .where('status', '==', 'pending')
    .get();

  const now = new Date().toISOString();
  return snapshot.docs
    .map((doc) => doc.data() as Invite)
    .filter((invite) => invite.expiresAt > now);
}

export async function getOrgInvites(orgId: string): Promise<Invite[]> {
  const snapshot = await db
    .collection(INVITES)
    .where('organizationId', '==', orgId)
    .where('status', '==', 'pending')
    .get();

  return snapshot.docs.map((doc) => doc.data() as Invite);
}

export async function acceptInvite(inviteId: string, acceptingUserEmail: string): Promise<void> {
  const inviteDoc = await db.collection(INVITES).doc(inviteId).get();
  if (!inviteDoc.exists) {
    throw new Error('Invite not found');
  }

  const invite = inviteDoc.data() as Invite;

  if (invite.inviteeEmail.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
    throw new Error('This invite is not for you');
  }

  if (invite.status !== 'pending') {
    throw new Error('Invite is no longer pending');
  }

  const now = new Date().toISOString();
  if (invite.expiresAt <= now) {
    throw new Error('Invite has expired');
  }

  // Look up userId by email
  const userSnapshot = await db
    .collection(USERS)
    .where('email', '==', acceptingUserEmail)
    .get();

  if (userSnapshot.empty) {
    throw new Error('User not found');
  }

  const userId = userSnapshot.docs[0]!.id;

  const batch = db.batch();

  // Update invite status
  batch.update(inviteDoc.ref, { status: 'accepted' });

  // Create orgMember
  const memberRef = db.collection(ORG_MEMBERS).doc();
  const orgMember: OrganizationMember = {
    id: memberRef.id,
    organizationId: invite.organizationId,
    userId,
    role: invite.role,
    createdAt: now,
  };
  batch.set(memberRef, orgMember);

  // Create groupMember if groupId is present
  if (invite.groupId) {
    const gmRef = db.collection(GROUP_MEMBERS).doc();
    const groupMember: GroupMember = {
      id: gmRef.id,
      groupId: invite.groupId,
      userId,
      createdAt: now,
    };
    batch.set(gmRef, groupMember);
  }

  await batch.commit();
}

export async function declineInvite(inviteId: string, userEmail: string): Promise<void> {
  const inviteDoc = await db.collection(INVITES).doc(inviteId).get();
  if (!inviteDoc.exists) {
    throw new Error('Invite not found');
  }

  const invite = inviteDoc.data() as Invite;

  if (invite.inviteeEmail.toLowerCase() !== userEmail.toLowerCase()) {
    throw new Error('This invite is not for you');
  }

  await inviteDoc.ref.update({ status: 'declined' });
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const inviteDoc = await db.collection(INVITES).doc(inviteId).get();
  if (!inviteDoc.exists) {
    throw new Error('Invite not found');
  }

  const invite = inviteDoc.data() as Invite;

  if (invite.status !== 'pending') {
    throw new Error('Invite is no longer pending');
  }

  await inviteDoc.ref.update({ status: 'revoked' });
}
