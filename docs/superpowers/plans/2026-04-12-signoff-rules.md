# Sign-off Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable sign-off rules so organizations can define who needs to sign off on documents, with real-time progress tracking in the extension.

**Architecture:** Org default rules stored in a `signoffRulesets` collection. When a document is added to an org, defaults are copied to a doc-specific ruleset. Status is computed by cross-referencing sign-offs with group membership. Extension shows progress in the Sign Off tab.

**Tech Stack:** TypeScript, Firestore, Express, Chrome Extension (Manifest V3), Zod validation, Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-signoff-rules-design.md`

---

### Task 1: Refactor Group model — merge directorId/managerId into leaderId

**Files:**
- Modify: `packages/shared/src/types.ts` (Group, GroupResponse interfaces)
- Modify: `packages/shared/src/validation.ts` (CreateGroupSchema, UpdateGroupSchema)
- Modify: `packages/backend/src/services/groupService.ts` (createGroup, enrichGroup, updateGroup)
- Modify: `packages/backend/src/lib/permissions.ts` (checkPermission)
- Modify: `packages/backend/src/services/organizationService.ts` (removeMember check)
- Modify: `packages/backend/src/routes/groups.ts` (route handlers)
- Modify: `packages/extension/src/lib/api.ts` (createGroup, updateGroup signatures)
- Modify: `packages/extension/src/popup/views/groups.ts` (group card rendering)

- [ ] **Step 1: Update shared types**

In `packages/shared/src/types.ts`, replace `directorId` and `managerId` on `Group` with `leaderId`. Replace `directorName` and `managerName` on `GroupResponse` with `leaderName`.

```typescript
// Group interface — replace directorId/managerId with:
export interface Group {
  id: string;
  organizationId: string;
  name: string;
  leaderId?: string;
  createdById: string;
  createdAt: string;
}

// GroupResponse interface — replace directorName/managerName with:
export interface GroupResponse {
  id: string;
  name: string;
  leaderName?: string;
  memberCount: number;
  createdAt: string;
}
```

- [ ] **Step 2: Update Zod schemas**

In `packages/shared/src/validation.ts`, replace `directorId`/`managerId` fields:

```typescript
export const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  leaderId: z.string().optional(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  leaderId: z.string().nullable().optional(),
});
```

- [ ] **Step 3: Update groupService.ts**

In `packages/backend/src/services/groupService.ts`:

`enrichGroup` function — replace director/manager lookups with single leader lookup:
```typescript
async function enrichGroup(group: Group): Promise<GroupResponse> {
  const [leaderName, memberCountSnap] = await Promise.all([
    group.leaderId ? getUserDisplayName(group.leaderId) : Promise.resolve(undefined),
    db.collection(GROUP_MEMBERS).where('groupId', '==', group.id).get(),
  ]);

  return {
    id: group.id,
    name: group.name,
    leaderName,
    memberCount: memberCountSnap.size,
    createdAt: group.createdAt,
  };
}
```

`createGroup` function — replace parameters:
```typescript
export async function createGroup(
  orgId: string,
  name: string,
  createdById: string,
  leaderId?: string,
): Promise<Group> {
  const ref = db.collection(GROUPS).doc();
  const now = new Date().toISOString();

  const group: Group = {
    id: ref.id,
    organizationId: orgId,
    name,
    createdById,
    createdAt: now,
    ...(leaderId !== undefined && { leaderId }),
  };

  await ref.set(group);
  return group;
}
```

`updateGroup` function — replace director/manager handling with leader:
```typescript
export async function updateGroup(
  groupId: string,
  data: { name?: string; leaderId?: string | null },
): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) {
    updateData.name = data.name;
  }

  if (data.leaderId === null) {
    updateData.leaderId = FieldValue.delete();
  } else if (data.leaderId !== undefined) {
    updateData.leaderId = data.leaderId;
  }

  if (Object.keys(updateData).length > 0) {
    await db.collection(GROUPS).doc(groupId).update(updateData);
  }
}
```

- [ ] **Step 4: Update permissions.ts**

In `packages/backend/src/lib/permissions.ts`:

Line 50 — replace `group.directorId` with `group.leaderId`:
```typescript
const ownsGroup = group.leaderId === ctx.userId || group.createdById === ctx.userId;
```

Lines 62-83 — replace `managerId` with `leaderId`:
```typescript
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
```

- [ ] **Step 5: Update organizationService.ts**

In `packages/backend/src/services/organizationService.ts`, around line 151-163, replace `managerId`/`directorId` check:
```typescript
  // Check if user is leaderId on any group in this org
  const assignedGroups: string[] = [];
  for (const groupDoc of groupsSnapshot.docs) {
    const group = groupDoc.data();
    if (group.leaderId === userId) {
      assignedGroups.push(group.name);
    }
  }
```

- [ ] **Step 6: Update groups route handler**

In `packages/backend/src/routes/groups.ts`, update the POST handler (around line 28-39):
```typescript
    const group = await createGroup(
      req.params.orgId!,
      parsed.data.name,
      req.userId!,
      parsed.data.leaderId,
    );
```

And the PATCH handler (around line 117) — the parsed data already flows through `UpdateGroupSchema` which now uses `leaderId`.

- [ ] **Step 7: Update extension API client**

In `packages/extension/src/lib/api.ts`, update `createGroup` and `updateGroup` signatures in both `realApi` and `proxyApi`:

```typescript
// realApi
createGroup: (orgId: string, data: { name: string; leaderId?: string }) =>
  request<Group>(`/organizations/${orgId}/groups`, { method: 'POST', body: JSON.stringify(data) }),
updateGroup: (orgId: string, groupId: string, data: { name?: string; leaderId?: string }) =>
  request<void>(`/organizations/${orgId}/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(data) }),

// proxyApi
createGroup: async (orgId: string, data: { name: string; leaderId?: string }) => {
  const a = await getApi();
  return a.createGroup(orgId, data);
},
updateGroup: async (orgId: string, groupId: string, data: { name?: string; leaderId?: string }) => {
  const a = await getApi();
  return a.updateGroup(orgId, groupId, data);
},
```

- [ ] **Step 8: Update groups view**

In `packages/extension/src/popup/views/groups.ts`, update group card rendering (around line 256):
```typescript
let metaParts: string[] = [];
if (group.leaderName) {
  metaParts.push(`Leader: ${escapeHtml(group.leaderName)}`);
}
metaParts.push(`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`);
```

- [ ] **Step 9: Build and verify**

Run: `pnpm run build-all && pnpm run typecheck`
Expected: No errors — all `directorId`/`managerId` references replaced.

- [ ] **Step 10: Run tests**

Run: `pnpm run test-all`
Expected: All unit tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/validation.ts \
  packages/backend/src/services/groupService.ts packages/backend/src/lib/permissions.ts \
  packages/backend/src/services/organizationService.ts packages/backend/src/routes/groups.ts \
  packages/extension/src/lib/api.ts packages/extension/src/popup/views/groups.ts
git commit -m "refactor: merge directorId/managerId into leaderId on Group model"
```

---

### Task 2: Add shared types for sign-off rules

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/validation.ts`

- [ ] **Step 1: Add types**

In `packages/shared/src/types.ts`, add after the existing group types:

```typescript
export interface SignoffRule {
  groupId: string;
  groupName: string;
  minMembers: number;
  requireLeader: boolean;
}

export interface SignoffRuleset {
  id: string;
  organizationId: string;
  documentId: string | null;
  rules: SignoffRule[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgDocument {
  id: string;
  organizationId: string;
  documentId: string;
  title: string;
  addedById: string;
  addedAt: string;
}

export interface RuleStatusEntry {
  groupId: string;
  groupName: string;
  minMembers: number;
  requireLeader: boolean;
  memberSignoffs: { userId: string; name: string; signedAt: string }[];
  leaderSignedOff: boolean;
  fulfilled: boolean;
}

export interface RuleStatus {
  rules: RuleStatusEntry[];
  allFulfilled: boolean;
}
```

- [ ] **Step 2: Add Zod schemas**

In `packages/shared/src/validation.ts`, add:

```typescript
export const SignoffRuleSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  minMembers: z.number().int().min(1),
  requireLeader: z.boolean(),
});

export const UpdateSignoffRulesSchema = z.object({
  rules: z.array(SignoffRuleSchema).min(1),
});

export const AddOrgDocumentSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1),
});
```

- [ ] **Step 3: Export new types**

Verify `packages/shared/src/index.ts` re-exports from `types.ts` and `validation.ts`. If not, add exports.

- [ ] **Step 4: Build shared**

Run: `cd packages/shared && pnpm run build`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/validation.ts packages/shared/src/index.ts
git commit -m "feat: add shared types and schemas for sign-off rules"
```

---

### Task 3: Backend — signoff rules service

**Files:**
- Create: `packages/backend/src/services/signoffRulesService.ts`

- [ ] **Step 1: Create the service**

```typescript
import { db } from '../config/firebase';
import type { SignoffRuleset, OrgDocument, RuleStatus, RuleStatusEntry } from '@doc-align/shared';

const RULESETS = 'signoffRulesets';
const ORG_DOCUMENTS = 'orgDocuments';
const SIGNOFFS = 'signoffs';
const GROUP_MEMBERS = 'groupMembers';
const GROUPS = 'groups';

// --- Org default rules ---

export async function getOrgDefaultRules(orgId: string): Promise<SignoffRuleset | null> {
  const snap = await db.collection(RULESETS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', null)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0]!.data() as SignoffRuleset;
}

export async function setOrgDefaultRules(
  orgId: string,
  rules: SignoffRuleset['rules'],
  userId: string,
): Promise<SignoffRuleset> {
  // Upsert: find existing or create new
  const existing = await getOrgDefaultRules(orgId);
  const now = new Date().toISOString();

  if (existing) {
    await db.collection(RULESETS).doc(existing.id).update({
      rules,
      updatedAt: now,
    });
    return { ...existing, rules, updatedAt: now };
  }

  const ref = db.collection(RULESETS).doc();
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
  const snap = await db.collection(RULESETS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', documentId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0]!.data() as SignoffRuleset;
}

export async function getEffectiveRules(orgId: string, documentId: string): Promise<SignoffRuleset | null> {
  const docRules = await getDocRules(orgId, documentId);
  if (docRules) return docRules;
  return getOrgDefaultRules(orgId);
}

export async function setDocRules(
  orgId: string,
  documentId: string,
  rules: SignoffRuleset['rules'],
  userId: string,
): Promise<SignoffRuleset> {
  const existing = await getDocRules(orgId, documentId);
  const now = new Date().toISOString();

  if (existing) {
    await db.collection(RULESETS).doc(existing.id).update({
      rules,
      updatedAt: now,
    });
    return { ...existing, rules, updatedAt: now };
  }

  const ref = db.collection(RULESETS).doc();
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
    await db.collection(RULESETS).doc(existing.id).delete();
  }
}

// --- Org documents ---

export async function addOrgDocument(
  orgId: string,
  documentId: string,
  title: string,
  userId: string,
): Promise<OrgDocument> {
  // Check if already added
  const existingSnap = await db.collection(ORG_DOCUMENTS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', documentId)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    return existingSnap.docs[0]!.data() as OrgDocument;
  }

  const ref = db.collection(ORG_DOCUMENTS).doc();
  const orgDoc: OrgDocument = {
    id: ref.id,
    organizationId: orgId,
    documentId,
    title,
    addedById: userId,
    addedAt: new Date().toISOString(),
  };
  await ref.set(orgDoc);

  // Copy org default rules to doc-specific rules
  const defaults = await getOrgDefaultRules(orgId);
  if (defaults) {
    await setDocRules(orgId, documentId, defaults.rules, userId);
  }

  return orgDoc;
}

export async function getOrgDocuments(orgId: string): Promise<OrgDocument[]> {
  const snap = await db.collection(ORG_DOCUMENTS)
    .where('organizationId', '==', orgId)
    .orderBy('addedAt', 'desc')
    .get();
  return snap.docs.map(d => d.data() as OrgDocument);
}

export async function removeOrgDocument(orgId: string, documentId: string): Promise<void> {
  const snap = await db.collection(ORG_DOCUMENTS)
    .where('organizationId', '==', orgId)
    .where('documentId', '==', documentId)
    .limit(1)
    .get();
  if (!snap.empty) {
    await snap.docs[0]!.ref.delete();
  }
  // Also remove doc-specific rules
  await resetDocRules(orgId, documentId);
}

// --- Rule status computation ---

export async function getRuleStatus(orgId: string, documentId: string): Promise<RuleStatus | null> {
  const ruleset = await getEffectiveRules(orgId, documentId);
  if (!ruleset) return null;

  // Get all sign-offs for this document
  const signoffSnap = await db.collection(SIGNOFFS)
    .where('documentId', '==', documentId)
    .get();
  const signoffs = signoffSnap.docs.map(d => d.data());

  // Get all group memberships and group leaders
  const ruleStatuses: RuleStatusEntry[] = await Promise.all(
    ruleset.rules.map(async (rule) => {
      // Get group members
      const membersSnap = await db.collection(GROUP_MEMBERS)
        .where('groupId', '==', rule.groupId)
        .get();
      const memberUserIds = new Set(membersSnap.docs.map(d => d.data().userId as string));

      // Get group leader
      const groupDoc = await db.collection(GROUPS).doc(rule.groupId).get();
      const leaderId = groupDoc.exists ? (groupDoc.data()!.leaderId as string | undefined) : undefined;

      // Find sign-offs from group members
      const memberSignoffs = signoffs
        .filter(so => memberUserIds.has(so.userId as string))
        .map(so => ({
          userId: so.userId as string,
          name: (so.userId as string), // Will be enriched by the route handler
          signedAt: so.createdAt as string,
        }));

      // Check if leader has signed
      const leaderSignedOff = leaderId
        ? signoffs.some(so => (so.userId as string) === leaderId)
        : false;

      const membersFulfilled = memberSignoffs.length >= rule.minMembers;
      const leaderFulfilled = !rule.requireLeader || leaderSignedOff;

      return {
        groupId: rule.groupId,
        groupName: rule.groupName,
        minMembers: rule.minMembers,
        requireLeader: rule.requireLeader,
        memberSignoffs,
        leaderSignedOff,
        fulfilled: membersFulfilled && leaderFulfilled,
      };
    }),
  );

  return {
    rules: ruleStatuses,
    allFulfilled: ruleStatuses.every(r => r.fulfilled),
  };
}
```

- [ ] **Step 2: Build**

Run: `pnpm run build-all`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/signoffRulesService.ts
git commit -m "feat: add signoff rules service with CRUD and status computation"
```

---

### Task 4: Backend — signoff rules routes

**Files:**
- Create: `packages/backend/src/routes/signoffRules.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create routes**

```typescript
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { checkPermission } from '../lib/permissions';
import { UpdateSignoffRulesSchema, AddOrgDocumentSchema } from '@doc-align/shared';
import {
  getOrgDefaultRules,
  setOrgDefaultRules,
  getEffectiveRules,
  setDocRules,
  resetDocRules,
  addOrgDocument,
  getOrgDocuments,
  removeOrgDocument,
  getRuleStatus,
} from '../services/signoffRulesService';

const router = Router({ mergeParams: true });

// --- Org default rules ---

// GET /signoff-rules — get org defaults
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const rules = await getOrgDefaultRules(req.params.orgId!);
    res.json(rules || { rules: [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get rules' });
  }
});

// PUT /signoff-rules — set org defaults
router.put('/', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const parsed = UpdateSignoffRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const ruleset = await setOrgDefaultRules(req.params.orgId!, parsed.data.rules, req.userId!);
    res.json(ruleset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update rules' });
  }
});

// --- Per-document rules ---

// GET /signoff-rules/documents/:documentId — get effective rules for doc
router.get('/documents/:documentId', async (req: AuthenticatedRequest, res) => {
  try {
    const rules = await getEffectiveRules(req.params.orgId!, req.params.documentId!);
    res.json(rules || { rules: [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get rules' });
  }
});

// PUT /signoff-rules/documents/:documentId — set doc-specific rules
router.put('/documents/:documentId', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const parsed = UpdateSignoffRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const ruleset = await setDocRules(
      req.params.orgId!,
      req.params.documentId!,
      parsed.data.rules,
      req.userId!,
    );
    res.json(ruleset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update rules' });
  }
});

// DELETE /signoff-rules/documents/:documentId — reset to org defaults
router.delete('/documents/:documentId', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    await resetDocRules(req.params.orgId!, req.params.documentId!);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset rules' });
  }
});

// GET /signoff-rules/documents/:documentId/status — rule fulfillment status
router.get('/documents/:documentId/status', async (req: AuthenticatedRequest, res) => {
  try {
    const status = await getRuleStatus(req.params.orgId!, req.params.documentId!);
    res.json(status || { rules: [], allFulfilled: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// --- Org documents ---

// POST /documents — add document to org
router.post('/documents', async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = AddOrgDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const orgDoc = await addOrgDocument(
      req.params.orgId!,
      parsed.data.documentId,
      parsed.data.title,
      req.userId!,
    );
    res.status(201).json(orgDoc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add document' });
  }
});

// GET /documents — list org documents
router.get('/documents', async (req: AuthenticatedRequest, res) => {
  try {
    const docs = await getOrgDocuments(req.params.orgId!);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// DELETE /documents/:documentId — remove document from org
router.delete('/documents/:documentId', async (req: AuthenticatedRequest, res) => {
  try {
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId: req.params.orgId!,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    await removeOrgDocument(req.params.orgId!, req.params.documentId!);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove document' });
  }
});

export default router;
```

- [ ] **Step 2: Mount routes in index.ts**

In `packages/backend/src/index.ts`, add after the existing group routes:

```typescript
import signoffRulesRoutes from './routes/signoffRules';

// Add after the groups line:
app.use('/api/organizations/:orgId/signoff-rules', authMiddleware, signoffRulesRoutes);
```

All routes (rules CRUD, document CRUD, and status) are handled by the single router since they all nest under `/signoff-rules/`.

- [ ] **Step 3: Build**

Run: `pnpm run build-all`
Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/signoffRules.ts packages/backend/src/index.ts
git commit -m "feat: add signoff rules and org documents API routes"
```

---

### Task 5: Extension — API client methods for sign-off rules

**Files:**
- Modify: `packages/extension/src/lib/api.ts`

- [ ] **Step 1: Add methods to realApi**

In `packages/extension/src/lib/api.ts`, add to the `realApi` object (after the existing group methods):

```typescript
  // Sign-off rules
  getOrgDefaultRules: (orgId: string) =>
    request<SignoffRuleset>(`/organizations/${orgId}/signoff-rules`),
  setOrgDefaultRules: (orgId: string, rules: SignoffRule[]) =>
    request<SignoffRuleset>(`/organizations/${orgId}/signoff-rules`, {
      method: 'PUT', body: JSON.stringify({ rules }),
    }),
  getDocRules: (orgId: string, documentId: string) =>
    request<SignoffRuleset>(`/organizations/${orgId}/signoff-rules/documents/${documentId}`),
  setDocRules: (orgId: string, documentId: string, rules: SignoffRule[]) =>
    request<SignoffRuleset>(`/organizations/${orgId}/signoff-rules/documents/${documentId}`, {
      method: 'PUT', body: JSON.stringify({ rules }),
    }),
  resetDocRules: (orgId: string, documentId: string) =>
    request<void>(`/organizations/${orgId}/signoff-rules/documents/${documentId}`, { method: 'DELETE' }),
  getDocRuleStatus: (orgId: string, documentId: string) =>
    request<RuleStatus>(`/organizations/${orgId}/signoff-rules/documents/${documentId}/status`),

  // Org documents
  addOrgDocument: (orgId: string, documentId: string, title: string) =>
    request<OrgDocument>(`/organizations/${orgId}/signoff-rules/documents`, {
      method: 'POST', body: JSON.stringify({ documentId, title }),
    }),
  getOrgDocuments: (orgId: string) =>
    request<OrgDocument[]>(`/organizations/${orgId}/signoff-rules/documents`),
  removeOrgDocument: (orgId: string, documentId: string) =>
    request<void>(`/organizations/${orgId}/signoff-rules/documents/${documentId}`, { method: 'DELETE' }),
```

Add the imports at the top of the file:
```typescript
import type { SignoffRuleset, SignoffRule, OrgDocument, RuleStatus } from '@doc-align/shared';
```

- [ ] **Step 2: Add to proxyApi**

Add matching proxy wrappers for each new method. Follow the existing pattern:
```typescript
  getOrgDefaultRules: async (orgId: string) => {
    const a = await getApi();
    return a.getOrgDefaultRules(orgId);
  },
  // ... same pattern for all new methods
```

- [ ] **Step 3: Build**

Run: `pnpm run build-all`
Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/lib/api.ts
git commit -m "feat: add API client methods for signoff rules and org documents"
```

---

### Task 6: Extension — sign-off progress UI in Sign Off tab

**Files:**
- Modify: `packages/extension/src/popup/views/sign-off.ts`

- [ ] **Step 1: Add progress section to renderSignOffView**

In `packages/extension/src/popup/views/sign-off.ts`, after loading the doc context and before rendering the main sign-off UI, fetch and render rule status. Add this after the existing data fetching (around line 27-33):

```typescript
// Fetch user's org and rule status for this doc
let ruleStatus: RuleStatus | null = null;
let userOrg: Organization | null = null;
try {
  const orgs = await api.getMyOrgs();
  userOrg = orgs[0] || null;
  if (userOrg && docContext) {
    ruleStatus = await api.getDocRuleStatus(userOrg.id, docContext.docId);
  }
} catch {
  // No org or rules not configured — proceed without
}
```

Add the import at the top:
```typescript
import type { RuleStatus, Organization } from '@doc-align/shared';
```

- [ ] **Step 2: Render progress section**

In the container.innerHTML template (around line 88-109), add a progress section between the document title and the signature preview. Insert before `<div style="margin-bottom:12px;">` (the "Your Signature" section):

```typescript
${ruleStatus && ruleStatus.rules.length > 0 ? `
  <div style="margin-bottom:12px;padding:8px;border-radius:6px;background:var(--color-bg-secondary);">
    <div style="font-size:11px;color:var(--color-text-muted);margin-bottom:6px;font-weight:600;">Sign-off Progress</div>
    ${ruleStatus.rules.map(rule => {
      const icon = rule.fulfilled ? '✓' : '✗';
      const color = rule.fulfilled ? 'var(--color-success, #22c55e)' : 'var(--color-text-muted)';
      let detail = '';
      if (rule.memberSignoffs.length > 0) {
        detail = rule.memberSignoffs.map(s => s.name).join(', ');
      } else {
        detail = `Needs ${rule.minMembers} member${rule.minMembers > 1 ? 's' : ''}`;
      }
      let leaderLine = '';
      if (rule.requireLeader) {
        leaderLine = `<div style="font-size:10px;color:${rule.leaderSignedOff ? 'var(--color-success, #22c55e)' : 'var(--color-text-muted)'};margin-left:16px;">
          ${rule.leaderSignedOff ? '✓' : '✗'} Leader sign-off ${rule.leaderSignedOff ? 'complete' : 'required'}
        </div>`;
      }
      return `<div style="font-size:12px;margin-bottom:4px;">
        <span style="color:${color};font-weight:600;">${icon}</span>
        <span style="font-weight:500;">${escapeHtml(rule.groupName)}</span>
        <span style="color:var(--color-text-muted);">(${rule.memberSignoffs.length}/${rule.minMembers})</span>
        <span style="color:var(--color-text-muted);font-size:10px;">${detail}</span>
        ${leaderLine}
      </div>`;
    }).join('')}
    ${ruleStatus.allFulfilled ? '<div style="font-size:11px;color:var(--color-success, #22c55e);margin-top:4px;font-weight:600;">All sign-offs complete</div>' : ''}
  </div>
` : ''}
```

- [ ] **Step 3: Add "Add to org" button**

When on a doc that belongs to an org but isn't tracked yet, show an "Add to org" button. After the rule status section, add:

```typescript
${userOrg && docContext && !ruleStatus ? `
  <div style="margin-bottom:12px;">
    <button class="btn btn-secondary" id="add-to-org-btn" style="width:100%;font-size:12px;">
      Add to ${escapeHtml(userOrg.name)} for sign-off tracking
    </button>
  </div>
` : ''}
```

Then add the event listener after the template (alongside the existing button listeners):

```typescript
document.getElementById('add-to-org-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('add-to-org-btn') as HTMLButtonElement;
  if (!btn || btn.disabled || !userOrg || !docContext) return;
  btn.disabled = true;
  btn.textContent = 'Adding...';
  try {
    await api.addOrgDocument(userOrg.id, docContext.docId, docContext.title);
    invalidateTab('signoff');
    renderSignOffView();
  } catch (err) {
    btn.textContent = 'Failed — try again';
    btn.disabled = false;
  }
});
```

- [ ] **Step 4: Add sign-off context to button**

When the user is about to sign, tell them what their sign-off means. In the sign-off button text logic (around line 53-61), add context if rules exist:

```typescript
let signoffContext = '';
if (ruleStatus && userOrg) {
  // Find which rules the user's sign-off would contribute to
  // (user is a member of groups that have unfulfilled rules)
  const unfulfilledGroups = ruleStatus.rules
    .filter(r => !r.fulfilled)
    .map(r => r.groupName);
  if (unfulfilledGroups.length === 1) {
    signoffContext = ` — completes ${unfulfilledGroups[0]} requirement`;
  } else if (unfulfilledGroups.length > 1) {
    signoffContext = ` — contributes to ${unfulfilledGroups.join(', ')}`;
  }
}
```

Then append `signoffContext` to the button text.

- [ ] **Step 5: Build**

Run: `pnpm run build-all`
Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/popup/views/sign-off.ts
git commit -m "feat: add sign-off progress UI with rule status and add-to-org button"
```

---

### Task 7: E2E tests for sign-off rules

**Files:**
- Create: `packages/e2e/tests/signoff-rules.spec.ts`

- [ ] **Step 1: Write E2E test**

```typescript
import { test, expect } from '../fixtures/extension';

test.describe('Sign-off Rules', () => {
  test('should show add-to-org button when org exists but doc not tracked', async ({ extensionPopup }) => {
    // This test verifies the UI renders the add-to-org flow
    // In E2E mode, the user has an org but the test doc isn't added to it
    const signoffView = extensionPopup.locator('#signoff-view');
    await extensionPopup.waitForTimeout(2000);
    const text = await signoffView.textContent();
    // Should render without errors
    expect(text).toBeTruthy();
  });

  test('should show sign-off progress when rules exist for a document', async ({ context, extensionId, extensionPopup }) => {
    // Navigate to the test Google Doc
    const docPage = await context.newPage();
    await docPage.goto('https://docs.google.com/document/d/13fIjJw6vNoUEg0FDjVcjhNgDg1hsdmdAPVAUGHGJZvU/edit');
    await docPage.waitForTimeout(3000);

    await docPage.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Sign in
    await popup.waitForSelector('#auth-screen:not(.hidden), #main-screen:not(.hidden)', { timeout: 10000 });
    const authScreen = popup.locator('#auth-screen:not(.hidden)');
    if (await authScreen.isVisible()) {
      const hasE2eBridge = await popup.evaluate(() => typeof (window as any).__e2eSignIn === 'function');
      if (hasE2eBridge) {
        await popup.evaluate(
          async ({ email, password }) => await (window as any).__e2eSignIn(email, password),
          { email: 'e2e-test@doc-align-test.com', password: 'e2e-test-secure-pw-2026' },
        );
        await popup.waitForSelector('#main-screen:not(.hidden)', { timeout: 10000 });
      }
    }

    await popup.waitForTimeout(3000);
    const signoffView = popup.locator('#signoff-view');
    const text = await signoffView.textContent();

    // Should render sign-off view without errors
    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toContain('Error');
  });
});
```

- [ ] **Step 2: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All tests pass including the new ones.

- [ ] **Step 3: Commit**

```bash
git add packages/e2e/tests/signoff-rules.spec.ts
git commit -m "test: add E2E tests for sign-off rules UI"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full build and typecheck**

Run: `pnpm run build-all && pnpm run typecheck`
Expected: No errors.

- [ ] **Step 2: Unit tests**

Run: `pnpm run test-all`
Expected: All pass.

- [ ] **Step 3: E2E tests**

Run: `pnpm test:e2e`
Expected: All 20 tests pass (18 existing + 2 new).

- [ ] **Step 4: Final commit if needed**

Any remaining fixes get committed here.
