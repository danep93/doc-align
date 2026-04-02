# Groups Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organizations, groups, membership, and invites to enable multi-user collaboration.

**Architecture:** New Firestore collections for orgs/groups/members/invites, new backend routes behind a permissions layer, new Groups tab in the extension popup with role-based views. Backend-only feature — no local storage fallback.

**Tech Stack:** Express, Firebase Admin SDK (Firestore), Zod validation, TypeScript, Chrome Extension Manifest V3, webpack

**Spec:** `docs/superpowers/specs/2026-04-02-groups-design.md`

---

## File Structure

### New files to create:

**Shared:**
- `packages/shared/src/types.ts` — add Organization, OrganizationMember, Group, GroupMember, Invite types (modify existing)
- `packages/shared/src/validation.ts` — add Zod schemas (modify existing)
- `packages/shared/src/tiers.ts` — add `canCreateOrganization()` helper (modify existing)

**Backend services:**
- `packages/backend/src/services/organizationService.ts` — org CRUD + member management
- `packages/backend/src/services/groupService.ts` — group CRUD + member management
- `packages/backend/src/services/inviteService.ts` — invite CRUD + acceptance logic

**Backend routes:**
- `packages/backend/src/routes/organizations.ts` — org + member + invite endpoints
- `packages/backend/src/routes/groups.ts` — group + member endpoints

**Backend permissions:**
- `packages/backend/src/lib/permissions.ts` — `checkPermission()` function

**Backend indexes:**
- `packages/backend/firestore.indexes.json` — Firestore composite index definitions

**Backend index:**
- `packages/backend/src/index.ts` — mount new routes (modify existing)

**Extension:**
- `packages/extension/src/popup/views/groups.ts` — Groups tab view with role-based rendering
- `packages/extension/src/popup/popup.html` — add Groups tab (modify existing)
- `packages/extension/src/popup/popup.ts` — wire Groups tab (modify existing)
- `packages/extension/src/popup/popup.css` — add Groups styles (modify existing)
- `packages/extension/src/lib/api.ts` — add group API methods (modify existing)
- `packages/extension/src/lib/dev-mode.ts` — add group method stubs (modify existing)

---

## Task 1: Shared Types and Validation

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/validation.ts`
- Modify: `packages/shared/src/tiers.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add new types to types.ts**

Add after the `TrackedDoc` interface:

```typescript
// --- Organization & Groups ---

export type OrgRole = 'admin' | 'director' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
}

export interface Group {
  id: string;
  organizationId: string;
  name: string;
  directorId?: string;
  managerId?: string;
  createdById: string;
  createdAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  organizationId: string;
  inviterUserId: string;
  inviteeEmail: string;
  role: OrgRole;
  groupId?: string;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
}

// API response shapes for enriched data
export interface OrgMemberResponse {
  userId: string;
  email: string;
  displayName: string;
  role: OrgRole;
  createdAt: string;
}

export interface GroupResponse {
  id: string;
  name: string;
  directorName?: string;
  managerName?: string;
  memberCount: number;
  createdAt: string;
}
```

- [ ] **Step 2: Add Zod schemas to validation.ts**

```typescript
import { z } from 'zod';

export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[\w\s\-.,&'()]+$/, 'Name contains invalid characters'),
});

export const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[\w\s\-.,&'()]+$/, 'Name contains invalid characters').optional(),
});

export const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[\w\s\-.,&'()]+$/, 'Name contains invalid characters'),
  directorId: z.string().optional(),
  managerId: z.string().optional(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[\w\s\-.,&'()]+$/, 'Name contains invalid characters').optional(),
  directorId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
});

export const CreateInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'director', 'member']),
  groupId: z.string().optional(),
});

export const AddGroupMemberSchema = z.object({
  userId: z.string().min(1),
});

export const ChangeRoleSchema = z.object({
  role: z.enum(['admin', 'director', 'member']),
});
```

- [ ] **Step 3: Add canCreateOrganization helper to tiers.ts**

```typescript
export function canCreateOrganization(tier: Tier): boolean {
  return tier === 'pro' || tier === 'enterprise';
}
```

- [ ] **Step 4: Export new types from index.ts**

Ensure all new types, schemas, and helpers are re-exported from `packages/shared/src/index.ts`.

- [ ] **Step 5: Build shared package and verify**

Run: `cd packages/shared && pnpm run build`
Expected: compiles with zero errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "feat: add organization, group, and invite types with validation schemas"
```

---

## Task 2: Firestore Indexes

**Files:**
- Create: `packages/backend/firestore.indexes.json`

- [ ] **Step 1: Create firestore.indexes.json**

Create `packages/backend/firestore.indexes.json` with all composite indexes required by the groups feature:

```json
{
  "indexes": [
    {
      "collectionGroup": "orgMembers",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "organizationId", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "orgMembers",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "userId", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "orgMembers",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "organizationId", "order": "ASCENDING" },
        { "fieldPath": "userId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "groups",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "organizationId", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "groups",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "managerId", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "groups",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "directorId", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "groups",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "createdById", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "groups",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "organizationId", "order": "ASCENDING" },
        { "fieldPath": "managerId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "groupMembers",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "groupId", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "groupMembers",
      "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "userId", "order": "ASCENDING" }]
    },
    {
      "collectionGroup": "groupMembers",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "groupId", "order": "ASCENDING" },
        { "fieldPath": "userId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "invites",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "inviteeEmail", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "invites",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "organizationId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/firestore.indexes.json
git commit -m "feat: add Firestore composite index definitions for groups feature"
```

---

## Task 3: Permissions Layer

**Files:**
- Create: `packages/backend/src/lib/permissions.ts`

- [ ] **Step 1: Create permissions.ts**

```typescript
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
  // Look up the user's org role
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
      const ownsGroup = group.directorId === ctx.userId || group.createdById === ctx.userId;
      if (!ownsGroup) return false;

      const groupActions: Action[] = [
        'group:delete', 'group:edit', 'group:add_member',
        'group:remove_member', 'group:view_members',
      ];
      return groupActions.includes(ctx.action);
    }
    return false;
  }

  // Member permissions — check if they're a group manager
  if (role === 'member' && ctx.groupId) {
    const groupDoc = await db.collection('groups').doc(ctx.groupId).get();
    if (!groupDoc.exists) return false;
    const group = groupDoc.data()!;
    if (group.managerId !== ctx.userId) return false;

    const managerActions: Action[] = [
      'group:add_member', 'group:remove_member', 'group:view_members',
    ];
    return managerActions.includes(ctx.action);
  }

  // Search members — group managers get this
  if (role === 'member' && ctx.action === 'org:search_members') {
    // Check if user is a manager of any group in this org
    const managedGroups = await db.collection('groups')
      .where('organizationId', '==', ctx.orgId)
      .where('managerId', '==', ctx.userId)
      .limit(1)
      .get();
    return !managedGroups.empty;
  }

  return false;
}

// Helper: get user's org role or null
export async function getOrgRole(userId: string, orgId: string): Promise<string | null> {
  const snap = await db.collection('orgMembers')
    .where('organizationId', '==', orgId)
    .where('userId', '==', userId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0]!.data().role as string;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/backend && pnpm run build`
Expected: compiles

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/lib/
git commit -m "feat: add role-based permissions layer for organizations and groups"
```

---

## Task 4: Organization Service

**Files:**
- Create: `packages/backend/src/services/organizationService.ts`

- [ ] **Step 1: Create organizationService.ts**

Implement these functions following the pattern in `userService.ts` and `signoffService.ts`:

```typescript
import { db } from '../config/firebase';
import type { Organization, OrganizationMember, OrgRole, OrgMemberResponse } from '@doc-align/shared';

export async function createOrganization(userId: string, name: string): Promise<Organization> {
  // Batch: create org + create orgMember with role 'admin'
  // Set ownerId to userId
  // Return the created org
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  // Get org doc by ID
}

export async function updateOrganization(orgId: string, data: { name?: string }): Promise<void> {
  // Update org fields + updatedAt
}

export async function getOrgMembers(orgId: string): Promise<OrgMemberResponse[]> {
  // Query orgMembers by orgId
  // For each, fetch user profile to get email + displayName
  // Return enriched list
}

export async function searchOrgMembers(orgId: string, emailQuery: string): Promise<OrgMemberResponse[]> {
  // Query orgMembers by orgId
  // Filter by email prefix match (case-insensitive)
  // Return enriched list (max 10 results)
}

export async function addOrgMember(orgId: string, userId: string, role: OrgRole): Promise<OrganizationMember> {
  // Check if already a member (return existing if so)
  // Create orgMember doc
}

export async function changeOrgMemberRole(orgId: string, userId: string, newRole: OrgRole): Promise<void> {
  // Find the orgMember doc
  // Check: cannot demote org owner
  // Update role
}

export async function removeOrgMember(orgId: string, userId: string, orgOwnerId: string): Promise<void> {
  // Block if userId === orgOwnerId
  // Block if user is managerId or directorId on any group — return error with group names
  // Remove from all groupMembers in this org
  // Remove orgMember doc
}

export async function getOrgsForUser(userId: string): Promise<Organization[]> {
  // Query orgMembers by userId
  // Fetch each org doc
  // Return org list
}

export async function leaveOrganization(orgId: string, userId: string, orgOwnerId: string): Promise<void> {
  // Block if userId === orgOwnerId
  // Same cascading removal as removeOrgMember
}
```

- [ ] **Step 2: Build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/organizationService.ts
git commit -m "feat: add organization service with CRUD and member management"
```

---

## Task 5: Group Service

**Files:**
- Create: `packages/backend/src/services/groupService.ts`

- [ ] **Step 1: Create groupService.ts**

```typescript
import { db } from '../config/firebase';
import type { Group, GroupMember, GroupResponse } from '@doc-align/shared';

export async function createGroup(
  orgId: string,
  name: string,
  createdById: string,
  directorId?: string,
  managerId?: string,
): Promise<Group> {
  // Create group doc
}

export async function getGroup(groupId: string): Promise<Group | null> {
  // Get group doc
}

export async function getOrgGroups(orgId: string): Promise<GroupResponse[]> {
  // Query groups by orgId
  // Enrich with director/manager display names and member counts
}

export async function getGroupsForUser(orgId: string, userId: string): Promise<GroupResponse[]> {
  // Query groupMembers by userId
  // Filter to groups in this org
  // Enrich with names and counts
}

export async function updateGroup(
  groupId: string,
  data: { name?: string; directorId?: string | null; managerId?: string | null },
): Promise<void> {
  // Update group fields
}

export async function deleteGroup(groupId: string): Promise<void> {
  // Delete all groupMembers for this group
  // Delete group doc
}

export async function addGroupMember(groupId: string, userId: string): Promise<GroupMember> {
  // Check if already a member
  // Create groupMember doc
}

export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  // Find and delete groupMember doc
}

export async function getGroupMembers(groupId: string): Promise<{ userId: string; email: string; displayName: string; createdAt: string }[]> {
  // Query groupMembers by groupId
  // Enrich with user info
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  // Same as removeGroupMember
}
```

- [ ] **Step 2: Build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/groupService.ts
git commit -m "feat: add group service with CRUD and member management"
```

---

## Task 6: Invite Service

**Files:**
- Create: `packages/backend/src/services/inviteService.ts`

- [ ] **Step 1: Create inviteService.ts**

```typescript
import { db } from '../config/firebase';
import type { Invite, OrgRole } from '@doc-align/shared';

const INVITE_EXPIRY_DAYS = 30;

export async function createInvite(
  orgId: string,
  inviterUserId: string,
  inviteeEmail: string,
  role: OrgRole,
  groupId?: string,
): Promise<Invite> {
  // Check if inviteeEmail exists in users collection
  // If not, throw: "User not found. They must have doc-align installed first."
  // Check for existing pending invite (same org + email) — throw 409 if exists
  // Create invite with expiresAt = now + 30 days
}

export async function getPendingInvitesForUser(userEmail: string): Promise<Invite[]> {
  // Query invites by inviteeEmail + status='pending'
  // Filter out expired invites
}

export async function getOrgInvites(orgId: string): Promise<Invite[]> {
  // Query invites by orgId + status='pending'
}

export async function acceptInvite(inviteId: string, acceptingUserEmail: string): Promise<void> {
  // Get invite doc
  // Verify invite.inviteeEmail === acceptingUserEmail (security check)
  // Verify invite.status === 'pending'
  // Verify not expired
  // Batch:
  //   - Update invite status to 'accepted'
  //   - Create orgMember with invite.role
  //   - If invite.groupId: create groupMember
}

export async function declineInvite(inviteId: string, userEmail: string): Promise<void> {
  // Verify email match
  // Update status to 'declined'
}

export async function revokeInvite(inviteId: string): Promise<void> {
  // Update status to 'revoked'
}
```

- [ ] **Step 2: Build and verify**

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/inviteService.ts
git commit -m "feat: add invite service with create, accept, decline, revoke"
```

---

## Task 7: Organization Routes

**Files:**
- Create: `packages/backend/src/routes/organizations.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create organizations.ts**

Follow the pattern in `signoffs.ts` — Express Router with `AuthenticatedRequest`.

Implement all org + member + invite endpoints from the spec:

```typescript
import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { TierRequest } from '../middleware/tier';
import { checkPermission } from '../lib/permissions';
import { CreateOrganizationSchema, CreateInviteSchema, ChangeRoleSchema } from '@doc-align/shared';
import { canCreateOrganization } from '@doc-align/shared';
import * as orgService from '../services/organizationService';
import * as inviteService from '../services/inviteService';

const router = Router();

// GET /api/organizations/me — list orgs for current user
// Must be defined before /:orgId so Express doesn't match "me" as an orgId
router.get('/me', async (req: AuthenticatedRequest, res) => {
  // Call orgService.getOrgsForUser(req.userId)
});

// POST /api/organizations — create org
router.post('/', async (req: TierRequest, res) => {
  // Validate with CreateOrganizationSchema
  // Check canCreateOrganization(req.userTier)
  // Call orgService.createOrganization
});

// GET /api/organizations/:orgId — get org details
router.get('/:orgId', async (req: AuthenticatedRequest, res) => {
  // Verify user is org member
  // Return org
});

// PATCH /api/organizations/:orgId — update org
router.patch('/:orgId', async (req: AuthenticatedRequest, res) => {
  // checkPermission org:edit
  // Validate with UpdateOrganizationSchema
  // Call orgService.updateOrganization
});

// GET /api/organizations/:orgId/members — list members
router.get('/:orgId/members', async (req: AuthenticatedRequest, res) => {
  // checkPermission org:view_members
  // Call orgService.getOrgMembers
});

// GET /api/organizations/:orgId/members/search — search by email
router.get('/:orgId/members/search', async (req: AuthenticatedRequest, res) => {
  // checkPermission org:search_members
  // Call orgService.searchOrgMembers(orgId, req.query.email)
});

// PATCH /api/organizations/:orgId/members/:userId — change role
router.patch('/:orgId/members/:userId', async (req: AuthenticatedRequest, res) => {
  // Admin only
  // Validate with ChangeRoleSchema
  // Cannot demote owner
  // Call orgService.changeOrgMemberRole
});

// DELETE /api/organizations/:orgId/members/:userId — remove member
router.delete('/:orgId/members/:userId', async (req: AuthenticatedRequest, res) => {
  // checkPermission org:remove_member
  // Call orgService.removeOrgMember
});

// POST /api/organizations/:orgId/members/me/leave — leave org
router.post('/:orgId/members/me/leave', async (req: AuthenticatedRequest, res) => {
  // Get org to check ownerId
  // Call orgService.leaveOrganization
});

// POST /api/organizations/:orgId/invites — create invite
router.post('/:orgId/invites', async (req: AuthenticatedRequest, res) => {
  // checkPermission org:invite
  // Validate with CreateInviteSchema
  // Call inviteService.createInvite
});

// GET /api/organizations/:orgId/invites — list org invites
router.get('/:orgId/invites', async (req: AuthenticatedRequest, res) => {
  // checkPermission org:invite (same perm to view)
  // Call inviteService.getOrgInvites
});

// DELETE /api/organizations/:orgId/invites/:inviteId — revoke invite
router.delete('/:orgId/invites/:inviteId', async (req: AuthenticatedRequest, res) => {
  // Admin can revoke any, director can revoke their own
  // Call inviteService.revokeInvite
});

export default router;
```

- [ ] **Step 2: Create user-scoped invite routes**

Add to `packages/backend/src/routes/users.ts` (or a new file `packages/backend/src/routes/invites.ts`):

```typescript
// GET /api/users/me/invites — pending invites for current user
// POST /api/users/me/invites/:inviteId/accept — accept invite (verify email match)
// POST /api/users/me/invites/:inviteId/decline — decline invite
```

- [ ] **Step 3: Mount routes in index.ts**

Add to `packages/backend/src/index.ts` after the existing route mounts:

```typescript
import organizationRoutes from './routes/organizations';
// Mount with auth middleware
app.use('/api/organizations', authMiddleware, organizationRoutes);
```

For tier-gated routes (org creation), use `tierMiddleware` on specific route handlers.

- [ ] **Step 4: Build and verify**

Run: `cd packages/backend && pnpm run build`

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/ packages/backend/src/index.ts
git commit -m "feat: add organization and invite API routes"
```

---

## Task 8: Group Routes

**Files:**
- Create: `packages/backend/src/routes/groups.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create groups.ts**

All endpoints nested under `/api/organizations/:orgId/groups`:

```typescript
import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { checkPermission } from '../lib/permissions';
import { CreateGroupSchema, UpdateGroupSchema, AddGroupMemberSchema } from '@doc-align/shared';
import * as groupService from '../services/groupService';

const router = Router({ mergeParams: true }); // mergeParams to access :orgId

// POST / — create group
router.post('/', async (req: AuthenticatedRequest, res) => {
  // checkPermission group:create
  // Validate with CreateGroupSchema
  // createdById = req.userId
  // Call groupService.createGroup
});

// GET / — list groups (filtered by role)
router.get('/', async (req: AuthenticatedRequest, res) => {
  // Admin/Director: getOrgGroups(orgId)
  // Member/Manager: getGroupsForUser(orgId, userId)
});

// GET /:groupId — get group details
router.get('/:groupId', async (req: AuthenticatedRequest, res) => {
  // checkPermission group:view_members
  // Call groupService.getGroup
});

// PATCH /:groupId — update group
router.patch('/:groupId', async (req: AuthenticatedRequest, res) => {
  // checkPermission group:edit
  // Validate with UpdateGroupSchema
  // Call groupService.updateGroup
});

// DELETE /:groupId — delete group
router.delete('/:groupId', async (req: AuthenticatedRequest, res) => {
  // checkPermission group:delete
  // Call groupService.deleteGroup
});

// POST /:groupId/members — add member to group
router.post('/:groupId/members', async (req: AuthenticatedRequest, res) => {
  // checkPermission group:add_member
  // Validate with AddGroupMemberSchema
  // Verify userId is an org member first
  // Call groupService.addGroupMember
});

// DELETE /:groupId/members/:userId — remove from group
router.delete('/:groupId/members/:userId', async (req: AuthenticatedRequest, res) => {
  // checkPermission group:remove_member
  // Call groupService.removeGroupMember
});

// POST /:groupId/members/me/leave — leave group
router.post('/:groupId/members/me/leave', async (req: AuthenticatedRequest, res) => {
  // Call groupService.leaveGroup
});

// GET /:groupId/members — list group members
router.get('/:groupId/members', async (req: AuthenticatedRequest, res) => {
  // checkPermission group:view_members
  // Call groupService.getGroupMembers
});

export default router;
```

- [ ] **Step 2: Mount in index.ts**

```typescript
import groupRoutes from './routes/groups';
app.use('/api/organizations/:orgId/groups', authMiddleware, groupRoutes);
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/backend && pnpm run build`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/groups.ts packages/backend/src/index.ts
git commit -m "feat: add group API routes with permission checks"
```

---

## Task 9: Extension API Methods

**Files:**
- Modify: `packages/extension/src/lib/api.ts`
- Modify: `packages/extension/src/lib/dev-mode.ts`

- [ ] **Step 1: Add group API methods to realApi**

Add to the `realApi` object in `api.ts`:

```typescript
// Organizations
getMyOrgs: () => request<Organization[]>('/organizations/me'),
createOrganization: (data: { name: string }) =>
  request<Organization>('/organizations', { method: 'POST', body: JSON.stringify(data) }),
getOrganization: (orgId: string) => request<Organization>(`/organizations/${orgId}`),
updateOrganization: (orgId: string, data: { name?: string }) =>
  request<void>(`/organizations/${orgId}`, { method: 'PATCH', body: JSON.stringify(data) }),

// Org members
getOrgMembers: (orgId: string) => request<OrgMemberResponse[]>(`/organizations/${orgId}/members`),
searchOrgMembers: (orgId: string, email: string) =>
  request<OrgMemberResponse[]>(`/organizations/${orgId}/members/search?email=${encodeURIComponent(email)}`),
changeOrgMemberRole: (orgId: string, userId: string, role: OrgRole) =>
  request<void>(`/organizations/${orgId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
removeOrgMember: (orgId: string, userId: string) =>
  request<void>(`/organizations/${orgId}/members/${userId}`, { method: 'DELETE' }),
leaveOrganization: (orgId: string) =>
  request<void>(`/organizations/${orgId}/members/me/leave`, { method: 'POST' }),

// Invites
createInvite: (orgId: string, data: { email: string; role: OrgRole; groupId?: string }) =>
  request<Invite>(`/organizations/${orgId}/invites`, { method: 'POST', body: JSON.stringify(data) }),
getOrgInvites: (orgId: string) => request<Invite[]>(`/organizations/${orgId}/invites`),
revokeInvite: (orgId: string, inviteId: string) =>
  request<void>(`/organizations/${orgId}/invites/${inviteId}`, { method: 'DELETE' }),
getMyPendingInvites: () => request<Invite[]>('/users/me/invites'),
acceptInvite: (inviteId: string) =>
  request<void>(`/users/me/invites/${inviteId}/accept`, { method: 'POST' }),
declineInvite: (inviteId: string) =>
  request<void>(`/users/me/invites/${inviteId}/decline`, { method: 'POST' }),

// Groups
getOrgGroups: (orgId: string) => request<GroupResponse[]>(`/organizations/${orgId}/groups`),
createGroup: (orgId: string, data: { name: string; directorId?: string; managerId?: string }) =>
  request<Group>(`/organizations/${orgId}/groups`, { method: 'POST', body: JSON.stringify(data) }),
updateGroup: (orgId: string, groupId: string, data: { name?: string; directorId?: string; managerId?: string }) =>
  request<void>(`/organizations/${orgId}/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(data) }),
deleteGroup: (orgId: string, groupId: string) =>
  request<void>(`/organizations/${orgId}/groups/${groupId}`, { method: 'DELETE' }),
getGroupMembers: (orgId: string, groupId: string) =>
  request<OrgMemberResponse[]>(`/organizations/${orgId}/groups/${groupId}/members`),
addGroupMember: (orgId: string, groupId: string, userId: string) =>
  request<void>(`/organizations/${orgId}/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
removeGroupMember: (orgId: string, groupId: string, userId: string) =>
  request<void>(`/organizations/${orgId}/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
leaveGroup: (orgId: string, groupId: string) =>
  request<void>(`/organizations/${orgId}/groups/${groupId}/members/me/leave`, { method: 'POST' }),
```

- [ ] **Step 2: Add same methods to proxyApi**

Group methods should NOT fall back to local storage. They should throw an error if backend is unavailable:

```typescript
// In proxyApi, for all group methods:
getMyOrgs: async () => {
  const api = await getApi();
  if (api === localApi) throw new Error('Groups require backend connection');
  return api.getMyOrgs();
},
// ... same pattern for all group/org methods
```

- [ ] **Step 3: Add group method stubs to devApi in dev-mode.ts**

Update `devApi` in `packages/extension/src/lib/dev-mode.ts` — add all group/org methods as stubs that throw since groups require a real backend:

```typescript
// Organizations & Groups — require backend connection
getMyOrgs: async () => { throw new Error('Groups require backend connection'); },
createOrganization: async () => { throw new Error('Groups require backend connection'); },
getOrganization: async () => { throw new Error('Groups require backend connection'); },
updateOrganization: async () => { throw new Error('Groups require backend connection'); },
getOrgMembers: async () => { throw new Error('Groups require backend connection'); },
searchOrgMembers: async () => { throw new Error('Groups require backend connection'); },
changeOrgMemberRole: async () => { throw new Error('Groups require backend connection'); },
removeOrgMember: async () => { throw new Error('Groups require backend connection'); },
leaveOrganization: async () => { throw new Error('Groups require backend connection'); },
createInvite: async () => { throw new Error('Groups require backend connection'); },
getOrgInvites: async () => { throw new Error('Groups require backend connection'); },
revokeInvite: async () => { throw new Error('Groups require backend connection'); },
getMyPendingInvites: async () => { throw new Error('Groups require backend connection'); },
acceptInvite: async () => { throw new Error('Groups require backend connection'); },
declineInvite: async () => { throw new Error('Groups require backend connection'); },
getOrgGroups: async () => { throw new Error('Groups require backend connection'); },
createGroup: async () => { throw new Error('Groups require backend connection'); },
updateGroup: async () => { throw new Error('Groups require backend connection'); },
deleteGroup: async () => { throw new Error('Groups require backend connection'); },
getGroupMembers: async () => { throw new Error('Groups require backend connection'); },
addGroupMember: async () => { throw new Error('Groups require backend connection'); },
removeGroupMember: async () => { throw new Error('Groups require backend connection'); },
leaveGroup: async () => { throw new Error('Groups require backend connection'); },
```

- [ ] **Step 4: Build extension and verify**

Run: `cd packages/extension && npx webpack --mode development`

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/api.ts packages/extension/src/lib/dev-mode.ts
git commit -m "feat: add organization and group API methods to extension client"
```

---

## Task 10: Groups Tab UI

**Files:**
- Create: `packages/extension/src/popup/views/groups.ts`
- Modify: `packages/extension/src/popup/popup.html`
- Modify: `packages/extension/src/popup/popup.ts`
- Modify: `packages/extension/src/popup/popup.css`

- [ ] **Step 1: Add Groups tab to popup.html**

Add a new tab button and content container. In the tab bar (after Settings):

```html
<button class="tab" data-tab="groups">Groups</button>
```

Add tab content container:

```html
<div id="tab-groups" class="tab-content">
  <div id="groups-view"></div>
</div>
```

- [ ] **Step 2: Create groups.ts view**

```typescript
import { api } from '../../lib/api';
import type { Organization, GroupResponse, OrgMemberResponse, OrgRole, Invite } from '@doc-align/shared';

export async function renderGroupsView(container: HTMLElement): Promise<void> {
  container.innerHTML = '<div class="docs-loading"><div class="docs-spinner"></div><p>Loading groups...</p></div>';

  try {
    // Check for pending invites
    const pendingInvites = await api.getMyPendingInvites();

    // Get user's orgs
    const orgs = await api.getMyOrgs();

    if (orgs.length === 0 && pendingInvites.length === 0) {
      renderNoOrgView(container);
      return;
    }

    if (pendingInvites.length > 0) {
      renderInvites(container, pendingInvites);
    }

    if (orgs.length > 0) {
      // For v1, show first org (most users will have one)
      await renderOrgView(container, orgs[0]!);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('require backend')) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Groups require a doc-align account.</p>
          <p>Sign in and connect to use collaborative features.</p>
        </div>
      `;
    } else {
      container.innerHTML = `<div class="empty-state"><p>Failed to load groups: ${msg}</p></div>`;
    }
  }
}

function renderNoOrgView(container: HTMLElement): void {
  container.innerHTML = `
    <div class="empty-state">
      <p>No organization yet.</p>
      <button class="btn btn-primary" id="create-org-btn">Create Organization</button>
      <p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">
        Requires Pro or Enterprise plan
      </p>
    </div>
  `;

  document.getElementById('create-org-btn')?.addEventListener('click', async () => {
    // Prompt for org name, call api.createOrganization
    const name = prompt('Organization name:');
    if (!name) return;
    try {
      await api.createOrganization({ name: name.trim() });
      renderGroupsView(container);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed: ${msg}`);
    }
  });
}

function renderInvites(container: HTMLElement, invites: Invite[]): void {
  // Render pending invite cards with Accept/Decline buttons
}

async function renderOrgView(container: HTMLElement, org: Organization): Promise<void> {
  // Determine user's role
  // Render role-appropriate view (admin/director/member)
  // Include "Open full view" button
}
```

This is a starting point — the implementation agent should build out the full role-based views following the spec's UI section.

- [ ] **Step 3: Wire Groups tab in popup.ts**

Add Groups to the tab rendering and preloading:

```typescript
import { renderGroupsView } from './views/groups';

// In renderTab():
if (target === 'groups') renderGroupsView(document.getElementById('groups-view')!);

// In onAuthChange preload:
renderTab('groups');
```

- [ ] **Step 4: Add Groups styles to popup.css**

Add styles for group cards, invite cards, member lists, and the org header. Follow the existing `.doc-card` pattern for group cards.

- [ ] **Step 5: Build extension and verify**

Run: `cd packages/extension && npx webpack --mode development`

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/popup/
git commit -m "feat: add Groups tab with role-based views and invite handling"
```

---

## Task 11: Invite Notification Badge

**Files:**
- Modify: `packages/extension/src/popup/popup.ts`
- Modify: `packages/extension/src/popup/popup.css`

- [ ] **Step 1: Add badge check on auth**

In the `onAuthChange` callback in `popup.ts`, after preloading tabs, check for pending invites:

```typescript
try {
  const invites = await api.getMyPendingInvites();
  if (invites.length > 0) {
    const groupsTab = document.querySelector('.tab[data-tab="groups"]');
    if (groupsTab) {
      groupsTab.innerHTML = `Groups <span class="tab-badge">${invites.length}</span>`;
    }
  }
} catch {
  // Backend unavailable — no badge
}
```

- [ ] **Step 2: Add badge CSS**

```css
.tab-badge {
  background: var(--color-danger);
  color: white;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 8px;
  margin-left: 4px;
  font-weight: 700;
}
```

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/popup/popup.ts packages/extension/src/popup/popup.css
git commit -m "feat: add invite notification badge on Groups tab"
```

---

## Task 12: Integration Testing

**Files:**
- Verify all packages build together

- [ ] **Step 1: Build all packages**

```bash
cd /Users/daniel/git_repos/doc-align
pnpm run build-all
```

Expected: all three packages compile with zero errors.

- [ ] **Step 2: Verify backend starts**

```bash
cd packages/backend && pnpm run dev
```

Verify the health endpoint works: `curl http://localhost:8080/api/health`

- [ ] **Step 3: Verify extension builds**

```bash
cd packages/extension && npx webpack --mode production
```

- [ ] **Step 4: Commit any fixes**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete groups feature — orgs, roles, invites, and extension UI"
```
