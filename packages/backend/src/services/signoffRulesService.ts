import { db } from '../config/firebase';
import type { SignoffRuleset, SignoffRule, OrgDocument, RuleStatus, RuleStatusEntry } from '@doc-align/shared';

const SIGNOFF_RULESETS = 'signoffRulesets';
const ORG_DOCUMENTS = 'orgDocuments';
const SIGNOFFS = 'signoffs';
const GROUP_MEMBERS = 'groupMembers';
const GROUPS = 'groups';
const USERS = 'users';

// --- Org default rules ---

export async function getOrgDefaultRules(orgId: string): Promise<SignoffRuleset | null> {
  const snapshot = await db
    .collection(SIGNOFF_RULESETS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', null)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0]!.data() as SignoffRuleset;
}

export async function setOrgDefaultRules(
  orgId: string,
  rules: SignoffRule[],
  userId: string,
): Promise<SignoffRuleset> {
  const existing = await getOrgDefaultRules(orgId);
  const now = new Date().toISOString();

  if (existing) {
    const updated: Partial<SignoffRuleset> = {
      rules,
      updatedAt: now,
    };
    await db.collection(SIGNOFF_RULESETS).doc(existing.id).update(updated);
    return { ...existing, ...updated } as SignoffRuleset;
  }

  const ref = db.collection(SIGNOFF_RULESETS).doc();
  const ruleset: SignoffRuleset = {
    id: ref.id,
    organizationId: orgId,
    documentId: null,
    rules,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(ruleset);
  return ruleset;
}

// --- Per-document rules ---

export async function getDocRules(orgId: string, documentId: string): Promise<SignoffRuleset | null> {
  const snapshot = await db
    .collection(SIGNOFF_RULESETS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', documentId)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0]!.data() as SignoffRuleset;
}

export async function getEffectiveRules(orgId: string, documentId: string): Promise<SignoffRuleset | null> {
  const docRules = await getDocRules(orgId, documentId);
  if (docRules) return docRules;
  return getOrgDefaultRules(orgId);
}

export async function setDocRules(
  orgId: string,
  documentId: string,
  rules: SignoffRule[],
  userId: string,
): Promise<SignoffRuleset> {
  const existing = await getDocRules(orgId, documentId);
  const now = new Date().toISOString();

  if (existing) {
    const updated: Partial<SignoffRuleset> = {
      rules,
      updatedAt: now,
    };
    await db.collection(SIGNOFF_RULESETS).doc(existing.id).update(updated);
    return { ...existing, ...updated } as SignoffRuleset;
  }

  const ref = db.collection(SIGNOFF_RULESETS).doc();
  const ruleset: SignoffRuleset = {
    id: ref.id,
    organizationId: orgId,
    documentId,
    rules,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(ruleset);
  return ruleset;
}

export async function resetDocRules(orgId: string, documentId: string): Promise<void> {
  const existing = await getDocRules(orgId, documentId);
  if (existing) {
    await db.collection(SIGNOFF_RULESETS).doc(existing.id).delete();
  }
}

// --- Org documents ---

export async function addOrgDocument(
  orgId: string,
  documentId: string,
  title: string,
  userId: string,
): Promise<OrgDocument> {
  const ref = db.collection(ORG_DOCUMENTS).doc();
  const now = new Date().toISOString();

  const orgDoc: OrgDocument = {
    id: ref.id,
    organizationId: orgId,
    documentId,
    title,
    addedById: userId,
    addedAt: now,
  };
  await ref.set(orgDoc);

  // Copy org defaults to doc-specific rules
  const defaults = await getOrgDefaultRules(orgId);
  if (defaults) {
    await setDocRules(orgId, documentId, defaults.rules, userId);
  }

  return orgDoc;
}

export async function getOrgDocuments(orgId: string): Promise<OrgDocument[]> {
  const snapshot = await db
    .collection(ORG_DOCUMENTS)
    .where('organizationId', '==', orgId)
    .get();

  return snapshot.docs.map((doc) => doc.data() as OrgDocument);
}

export async function removeOrgDocument(orgId: string, documentId: string): Promise<void> {
  const batch = db.batch();

  // Delete org document record(s)
  const orgDocSnap = await db
    .collection(ORG_DOCUMENTS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', documentId)
    .get();

  for (const doc of orgDocSnap.docs) {
    batch.delete(doc.ref);
  }

  // Delete doc-specific rules
  const rulesSnap = await db
    .collection(SIGNOFF_RULESETS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', documentId)
    .get();

  for (const doc of rulesSnap.docs) {
    batch.delete(doc.ref);
  }

  await batch.commit();
}

// --- Rule status ---

async function getUserDisplayName(userId: string): Promise<string> {
  const userDoc = await db.collection(USERS).doc(userId).get();
  if (!userDoc.exists) return userId;
  const data = userDoc.data();
  return data?.displayName ?? data?.email ?? userId;
}

export async function getRuleStatus(orgId: string, documentId: string): Promise<RuleStatus> {
  const ruleset = await getEffectiveRules(orgId, documentId);
  if (!ruleset) {
    return { rules: [], allFulfilled: true };
  }

  // Get all signoffs for the document
  const signoffsSnap = await db
    .collection(SIGNOFFS)
    .where('documentId', '==', documentId)
    .get();

  const signoffs = signoffsSnap.docs.map((doc) => doc.data());

  const ruleEntries: RuleStatusEntry[] = [];

  for (const rule of ruleset.rules) {
    // Get group members
    const membersSnap = await db
      .collection(GROUP_MEMBERS)
      .where('groupId', '==', rule.groupId)
      .get();

    const memberUserIds = new Set(membersSnap.docs.map((doc) => doc.data().userId as string));

    // Get group leader
    const groupDoc = await db.collection(GROUPS).doc(rule.groupId).get();
    const leaderId = groupDoc.exists ? (groupDoc.data()?.leaderId as string | undefined) : undefined;

    // Match signoffs to group members
    const memberSignoffs: RuleStatusEntry['memberSignoffs'] = [];
    for (const signoff of signoffs) {
      if (memberUserIds.has(signoff.userId as string)) {
        const name = await getUserDisplayName(signoff.userId as string);
        memberSignoffs.push({
          userId: signoff.userId as string,
          name,
          signedAt: signoff.createdAt as string,
        });
      }
    }

    // Deduplicate by userId (keep latest signoff)
    const byUser = new Map<string, RuleStatusEntry['memberSignoffs'][number]>();
    for (const ms of memberSignoffs) {
      const existing = byUser.get(ms.userId);
      if (!existing || ms.signedAt > existing.signedAt) {
        byUser.set(ms.userId, ms);
      }
    }
    const uniqueMemberSignoffs = Array.from(byUser.values());

    const leaderSignedOff = leaderId
      ? signoffs.some((s) => s.userId === leaderId)
      : false;

    const memberCountMet = uniqueMemberSignoffs.length >= rule.minMembers;
    const leaderMet = !rule.requireLeader || leaderSignedOff;
    const fulfilled = memberCountMet && leaderMet;

    ruleEntries.push({
      groupId: rule.groupId,
      groupName: rule.groupName,
      minMembers: rule.minMembers,
      requireLeader: rule.requireLeader,
      memberSignoffs: uniqueMemberSignoffs,
      leaderSignedOff,
      fulfilled,
    });
  }

  return {
    rules: ruleEntries,
    allFulfilled: ruleEntries.every((r) => r.fulfilled),
  };
}
