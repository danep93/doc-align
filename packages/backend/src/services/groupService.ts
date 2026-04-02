import { db } from '../config/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import type { Group, GroupMember, GroupResponse } from '@doc-align/shared';

const GROUPS = 'groups';
const GROUP_MEMBERS = 'groupMembers';
const USERS = 'users';

async function getUserDisplayName(userId: string): Promise<string | undefined> {
  const userDoc = await db.collection(USERS).doc(userId).get();
  if (!userDoc.exists) return undefined;
  const data = userDoc.data();
  return data?.displayName ?? data?.email ?? undefined;
}

async function enrichGroup(group: Group): Promise<GroupResponse> {
  const [directorName, managerName, memberCountSnap] = await Promise.all([
    group.directorId ? getUserDisplayName(group.directorId) : Promise.resolve(undefined),
    group.managerId ? getUserDisplayName(group.managerId) : Promise.resolve(undefined),
    db.collection(GROUP_MEMBERS).where('groupId', '==', group.id).get(),
  ]);

  return {
    id: group.id,
    name: group.name,
    directorName,
    managerName,
    memberCount: memberCountSnap.size,
    createdAt: group.createdAt,
  };
}

export async function createGroup(
  orgId: string,
  name: string,
  createdById: string,
  directorId?: string,
  managerId?: string,
): Promise<Group> {
  const ref = db.collection(GROUPS).doc();
  const now = new Date().toISOString();

  const group: Group = {
    id: ref.id,
    organizationId: orgId,
    name,
    createdById,
    createdAt: now,
    ...(directorId !== undefined && { directorId }),
    ...(managerId !== undefined && { managerId }),
  };

  await ref.set(group);
  return group;
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const doc = await db.collection(GROUPS).doc(groupId).get();
  if (!doc.exists) return null;
  return doc.data() as Group;
}

export async function getOrgGroups(orgId: string): Promise<GroupResponse[]> {
  const snapshot = await db
    .collection(GROUPS)
    .where('organizationId', '==', orgId)
    .get();

  const results: GroupResponse[] = [];
  for (const doc of snapshot.docs) {
    const group = doc.data() as Group;
    results.push(await enrichGroup(group));
  }
  return results;
}

export async function getGroupsForUser(orgId: string, userId: string): Promise<GroupResponse[]> {
  const memberSnap = await db
    .collection(GROUP_MEMBERS)
    .where('userId', '==', userId)
    .get();

  const results: GroupResponse[] = [];
  for (const memberDoc of memberSnap.docs) {
    const member = memberDoc.data() as GroupMember;
    const groupDoc = await db.collection(GROUPS).doc(member.groupId).get();
    if (!groupDoc.exists) continue;
    const group = groupDoc.data() as Group;
    if (group.organizationId !== orgId) continue;
    results.push(await enrichGroup(group));
  }
  return results;
}

export async function updateGroup(
  groupId: string,
  data: { name?: string; directorId?: string | null; managerId?: string | null },
): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) {
    updateData.name = data.name;
  }

  if (data.directorId === null) {
    updateData.directorId = FieldValue.delete();
  } else if (data.directorId !== undefined) {
    updateData.directorId = data.directorId;
  }

  if (data.managerId === null) {
    updateData.managerId = FieldValue.delete();
  } else if (data.managerId !== undefined) {
    updateData.managerId = data.managerId;
  }

  if (Object.keys(updateData).length > 0) {
    await db.collection(GROUPS).doc(groupId).update(updateData);
  }
}

export async function deleteGroup(groupId: string): Promise<void> {
  const batch = db.batch();

  const membersSnap = await db
    .collection(GROUP_MEMBERS)
    .where('groupId', '==', groupId)
    .get();

  for (const memberDoc of membersSnap.docs) {
    batch.delete(memberDoc.ref);
  }

  batch.delete(db.collection(GROUPS).doc(groupId));
  await batch.commit();
}

export async function addGroupMember(
  groupId: string,
  userId: string,
): Promise<GroupMember> {
  const existing = await db
    .collection(GROUP_MEMBERS)
    .where('groupId', '==', groupId)
    .where('userId', '==', userId)
    .get();

  if (!existing.empty) {
    return existing.docs[0]!.data() as GroupMember;
  }

  const ref = db.collection(GROUP_MEMBERS).doc();
  const member: GroupMember = {
    id: ref.id,
    groupId,
    userId,
    createdAt: new Date().toISOString(),
  };
  await ref.set(member);
  return member;
}

export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  const snapshot = await db
    .collection(GROUP_MEMBERS)
    .where('groupId', '==', groupId)
    .where('userId', '==', userId)
    .get();

  for (const doc of snapshot.docs) {
    await doc.ref.delete();
  }
}

export async function getGroupMembers(
  groupId: string,
): Promise<{ userId: string; email: string; displayName: string; createdAt: string }[]> {
  const snapshot = await db
    .collection(GROUP_MEMBERS)
    .where('groupId', '==', groupId)
    .get();

  const results: { userId: string; email: string; displayName: string; createdAt: string }[] = [];

  for (const memberDoc of snapshot.docs) {
    const member = memberDoc.data() as GroupMember;
    const userDoc = await db.collection(USERS).doc(member.userId).get();
    const userData = userDoc.data();
    const email = userData?.email ?? '';
    const displayName = userData?.displayName ?? email;

    results.push({
      userId: member.userId,
      email,
      displayName,
      createdAt: member.createdAt,
    });
  }

  return results;
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  await removeGroupMember(groupId, userId);
}
