import { db } from '../config/firebase';
import type {
  Organization,
  OrganizationMember,
  OrgRole,
  OrgMemberResponse,
} from '@doc-align/shared';

const ORGS = 'organizations';
const ORG_MEMBERS = 'orgMembers';
const USERS = 'users';
const GROUPS = 'groups';
const GROUP_MEMBERS = 'groupMembers';

export async function createOrganization(userId: string, name: string): Promise<Organization> {
  const now = new Date().toISOString();
  const orgRef = db.collection(ORGS).doc();
  const memberRef = db.collection(ORG_MEMBERS).doc();

  const org: Organization = {
    id: orgRef.id,
    name,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  };

  const member: OrganizationMember = {
    id: memberRef.id,
    organizationId: orgRef.id,
    userId,
    role: 'admin',
    createdAt: now,
  };

  const batch = db.batch();
  batch.set(orgRef, org);
  batch.set(memberRef, member);
  await batch.commit();

  return org;
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const doc = await db.collection(ORGS).doc(orgId).get();
  if (!doc.exists) return null;
  return doc.data() as Organization;
}

export async function updateOrganization(orgId: string, data: { name?: string }): Promise<void> {
  await db.collection(ORGS).doc(orgId).update({
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

export async function getOrgMembers(orgId: string): Promise<OrgMemberResponse[]> {
  const snapshot = await db
    .collection(ORG_MEMBERS)
    .where('organizationId', '==', orgId)
    .get();

  const results: OrgMemberResponse[] = [];

  for (const memberDoc of snapshot.docs) {
    const member = memberDoc.data() as OrganizationMember;
    const userDoc = await db.collection(USERS).doc(member.userId).get();
    const userData = userDoc.data();
    const email = userData?.email ?? '';
    const displayName = userData?.displayName ?? email;

    results.push({
      userId: member.userId,
      email,
      displayName,
      role: member.role,
      createdAt: member.createdAt,
    });
  }

  return results;
}

export async function searchOrgMembers(orgId: string, emailQuery: string): Promise<OrgMemberResponse[]> {
  const allMembers = await getOrgMembers(orgId);
  const lowerQuery = emailQuery.toLowerCase();
  return allMembers
    .filter((m) => m.email.toLowerCase().startsWith(lowerQuery))
    .slice(0, 10);
}

export async function addOrgMember(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<OrganizationMember> {
  const existing = await db
    .collection(ORG_MEMBERS)
    .where('organizationId', '==', orgId)
    .where('userId', '==', userId)
    .get();

  if (!existing.empty) {
    return existing.docs[0]!.data() as OrganizationMember;
  }

  const ref = db.collection(ORG_MEMBERS).doc();
  const member: OrganizationMember = {
    id: ref.id,
    organizationId: orgId,
    userId,
    role,
    createdAt: new Date().toISOString(),
  };
  await ref.set(member);
  return member;
}

export async function changeOrgMemberRole(
  orgId: string,
  userId: string,
  newRole: OrgRole,
): Promise<void> {
  const org = await getOrganization(orgId);
  if (org && userId === org.ownerId && newRole !== 'admin') {
    throw new Error('Cannot demote organization owner');
  }

  const snapshot = await db
    .collection(ORG_MEMBERS)
    .where('organizationId', '==', orgId)
    .where('userId', '==', userId)
    .get();

  if (snapshot.empty) {
    throw new Error('Member not found');
  }

  await snapshot.docs[0]!.ref.update({ role: newRole });
}

export async function removeOrgMember(
  orgId: string,
  userId: string,
  orgOwnerId: string,
): Promise<void> {
  if (userId === orgOwnerId) {
    throw new Error('Cannot remove organization owner');
  }

  // Check if user is leaderId on any group in this org
  const groupsSnapshot = await db
    .collection(GROUPS)
    .where('organizationId', '==', orgId)
    .get();

  const assignedGroups: string[] = [];
  for (const groupDoc of groupsSnapshot.docs) {
    const group = groupDoc.data();
    if (group.leaderId === userId) {
      assignedGroups.push(group.name);
    }
  }

  if (assignedGroups.length > 0) {
    throw new Error(
      `User is assigned to groups: ${assignedGroups.join(', ')}. Reassign before removing.`,
    );
  }

  const batch = db.batch();

  // Remove all groupMembers for this user in groups belonging to this org
  for (const groupDoc of groupsSnapshot.docs) {
    const gmSnapshot = await db
      .collection(GROUP_MEMBERS)
      .where('groupId', '==', groupDoc.id)
      .where('userId', '==', userId)
      .get();

    for (const gmDoc of gmSnapshot.docs) {
      batch.delete(gmDoc.ref);
    }
  }

  // Remove the orgMember doc
  const memberSnapshot = await db
    .collection(ORG_MEMBERS)
    .where('organizationId', '==', orgId)
    .where('userId', '==', userId)
    .get();

  for (const memberDoc of memberSnapshot.docs) {
    batch.delete(memberDoc.ref);
  }

  await batch.commit();
}

export async function getOrgsForUser(userId: string): Promise<Organization[]> {
  const snapshot = await db
    .collection(ORG_MEMBERS)
    .where('userId', '==', userId)
    .get();

  const orgs: Organization[] = [];
  for (const memberDoc of snapshot.docs) {
    const member = memberDoc.data() as OrganizationMember;
    const orgDoc = await db.collection(ORGS).doc(member.organizationId).get();
    if (orgDoc.exists) {
      orgs.push(orgDoc.data() as Organization);
    }
  }

  return orgs;
}

export async function leaveOrganization(
  orgId: string,
  userId: string,
  orgOwnerId: string,
): Promise<void> {
  if (userId === orgOwnerId) {
    throw new Error('Cannot remove organization owner');
  }
  await removeOrgMember(orgId, userId, orgOwnerId);
}
