# Groups Feature Design

## Overview

Organizations and groups enable multi-user collaboration in doc-align. An IT admin creates an organization, invites users, and creates groups (e.g., "Product", "Engineering"). Directors oversee groups. Group managers manage membership. Members sign documents. This is subsystem 1 of 3 for the collaboration feature set.

## Subsystem Roadmap

1. **Groups** (this spec) — orgs, roles, groups, membership, invites
2. **Document sign-off requirements** — assign groups as required signers on a document
3. **Dashboard / status view** — green/yellow/red status per document based on sign-off requirements

## Data Model

### Organization

```typescript
interface Organization {
  id: string;
  name: string;               // "Acme Corp"
  ownerId: string;            // userId of the creating admin — cannot be removed or demoted
  createdAt: string;
  updatedAt: string;
}
```

### OrganizationMember

```typescript
type OrgRole = 'admin' | 'director' | 'member';

interface OrganizationMember {
  id: string;                 // Firestore auto-generated ID (not composite)
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
}
```

**Roles:**
- `admin` — IT admin. Creates org, manages everything, handles billing. Can create groups, assign directors, manage all members.
- `director` — Department head (CEO, VP). Creates groups, assigns group managers, manages groups they oversee. Can invite users to org. No org settings or billing access.
- `member` — Signs docs, participates in groups. No management ability.

Note: there is no `group_manager` OrgRole. Group management is determined by the `managerId` field on the Group entity. A `member` who is assigned as a group's manager gets management permissions for that specific group.

The org owner (`ownerId`) is always an admin and cannot be removed or demoted by other admins. Ownership transfer is out of scope for v1.

### Group

```typescript
interface Group {
  id: string;
  organizationId: string;
  name: string;               // "Product", "Engineering"
  directorId?: string;        // userId of the director who oversees this group
  managerId?: string;         // userId of the group manager (can be assigned later)
  createdById: string;        // userId of the admin/director who created the group
  createdAt: string;
}
```

A group optionally has one manager and one director. Both can be assigned after creation. "Their groups" for a director means groups where `directorId` matches or `createdById` matches their userId.

### GroupMember

```typescript
interface GroupMember {
  id: string;                 // Firestore auto-generated ID
  groupId: string;
  userId: string;
  createdAt: string;
}
```

A user can be in multiple groups within the same organization.

### Invite

```typescript
type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

interface Invite {
  id: string;
  organizationId: string;
  inviterUserId: string;
  inviteeEmail: string;       // must match accepting user's Firebase auth email
  role: OrgRole;
  groupId?: string;           // optional — pre-assign to a group on accept
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;          // invites expire after 30 days
}
```

Invites are for existing doc-align users only (email lookup in Firestore). Inviting non-users (with email + install prompt) is a future enhancement. On accept, the backend verifies the authenticated user's email matches `inviteeEmail`.

## Permissions Matrix

| Action | Admin | Director | Group Manager* | Member |
|---|---|---|---|---|
| Create organization | Yes | - | - | - |
| Edit org settings / billing | Yes | - | - | - |
| Invite users to org | Yes | Yes | - | - |
| Remove users from org | Yes** | - | - | - |
| Revoke pending invite | Yes | Yes (their invites) | - | - |
| Leave org voluntarily | Yes*** | Yes | Yes | Yes |
| Create groups | Yes | Yes | - | - |
| Delete groups | Yes | Yes (their groups) | - | - |
| Assign/change group manager | Yes | Yes (their groups) | - | - |
| Add members to a group | Yes | Yes (their groups) | Yes (their group) | - |
| Remove members from a group | Yes | Yes (their groups) | Yes (their group) | - |
| View all org groups | Yes | Yes | Their group only | Their group only |
| View org member list | Yes | Yes | Search only**** | - |
| Search org members by email | Yes | Yes | Yes | - |
| Leave a group voluntarily | Yes | Yes | Yes | Yes |

*Group Manager = any org member whose userId matches `Group.managerId`. This is not an OrgRole — it's derived from the Group entity.

**Cannot remove the org owner. Cannot remove a user who is a `managerId` or `directorId` on any group — must reassign first.

***Org owner cannot leave (must transfer ownership first — out of scope for v1, effectively: owner is permanent).

****Group managers get a scoped search endpoint (`GET /api/organizations/:orgId/members/search?email=...`) that returns matching members without exposing the full list.

## Tier Gating

- **Free users** can be members of groups and sign documents. They cannot create organizations.
- **Pro / Enterprise users** can create organizations and manage groups.
- For v1, the creating user's personal tier is checked for org creation. Organization-level billing (Stripe subscription determining features for all members) is deferred to a future iteration.

## Backend API

All endpoints validate the caller's role against the permissions matrix. Role checks are isolated behind a `checkPermission(userId, orgId, action, resourceId?)` function in `packages/backend/src/lib/permissions.ts`. This function can be swapped to OpenFGA later.

### Organization endpoints

- `POST /api/organizations` — create org (pro/enterprise only, caller becomes admin + owner)
- `GET /api/organizations/:orgId` — get org details (any member)
- `PATCH /api/organizations/:orgId` — update org name/settings (admin only)

### Member management

- `GET /api/organizations/:orgId/members` — list all org members with display names (admin, director)
- `GET /api/organizations/:orgId/members/search?email=<query>` — search members by email prefix (admin, director, group managers)
- `POST /api/organizations/:orgId/invites` — invite user by email (admin, director)
- `GET /api/organizations/:orgId/invites` — list org invites (admin, director)
- `DELETE /api/organizations/:orgId/invites/:inviteId` — revoke pending invite (admin, or director who sent it)
- `GET /api/users/me/invites` — get current user's pending invites (any authenticated user)
- `POST /api/users/me/invites/:inviteId/accept` — accept invite (verifies email match, creates OrganizationMember)
- `POST /api/users/me/invites/:inviteId/decline` — decline invite
- `PATCH /api/organizations/:orgId/members/:userId` — change role (admin only, cannot demote owner)
- `DELETE /api/organizations/:orgId/members/:userId` — remove from org (admin only, blocks if user is manager/director — must reassign first, cannot remove owner)
- `POST /api/organizations/:orgId/members/me/leave` — leave org voluntarily (removes from all groups, blocks if owner)

### Group endpoints (all nested under org)

- `POST /api/organizations/:orgId/groups` — create group (admin, director)
- `GET /api/organizations/:orgId/groups` — list groups (filtered by role/visibility)
- `GET /api/organizations/:orgId/groups/:groupId` — get group details
- `PATCH /api/organizations/:orgId/groups/:groupId` — update group name, manager, director (admin, owning director)
- `DELETE /api/organizations/:orgId/groups/:groupId` — delete group + all group members (admin, owning director)
- `POST /api/organizations/:orgId/groups/:groupId/members` — add org member to group
- `DELETE /api/organizations/:orgId/groups/:groupId/members/:userId` — remove from group
- `POST /api/organizations/:orgId/groups/:groupId/members/me/leave` — leave group voluntarily
- `GET /api/organizations/:orgId/groups/:groupId/members` — list group members with display names

### Response shapes

List endpoints return enriched objects with user display info:
```typescript
// GET /api/organizations/:orgId/members returns:
interface OrgMemberResponse {
  userId: string;
  email: string;
  displayName: string;
  role: OrgRole;
  createdAt: string;
}

// GET /api/organizations/:orgId/groups returns:
interface GroupResponse {
  id: string;
  name: string;
  directorName?: string;
  managerName?: string;
  memberCount: number;
  createdAt: string;
}
```

Error responses follow existing pattern: `{ error: string }` with appropriate HTTP status codes (400 bad request, 403 forbidden, 404 not found, 409 conflict for duplicate invites).

## Firestore Collections

- `organizations` — doc ID: auto-generated → Organization fields
- `orgMembers` — doc ID: auto-generated → OrganizationMember fields (queried by orgId + userId)
- `groups` — doc ID: auto-generated → Group fields
- `groupMembers` — doc ID: auto-generated → GroupMember fields
- `invites` — doc ID: auto-generated → Invite fields

All collections use Firestore auto-generated IDs. No composite keys.

Indexes needed:
- `orgMembers` by `organizationId`
- `orgMembers` by `userId`
- `orgMembers` compound: `organizationId` + `userId` (unique lookup)
- `groups` by `organizationId`
- `groups` by `managerId`
- `groups` by `directorId`
- `groups` by `createdById`
- `groupMembers` by `groupId`
- `groupMembers` by `userId`
- `groupMembers` compound: `groupId` + `userId` (unique lookup)
- `invites` by `inviteeEmail` + `status`
- `invites` by `organizationId` + `status`

## Extension UI

### New "Groups" tab

Added to the popup alongside Sign Off / My Documents / Settings.

**No org yet:**
- "Create Organization" button (pro/enterprise only)
- Or: pending invite notification with Accept/Decline

**Member view:**
- List of groups the user belongs to
- Each group card: group name, member count, manager name

**Group Manager view (member + managerId match):**
- Groups they manage with member lists
- "Add Member" button — email search among org members
- "Remove" button next to each member

**Director view:**
- All groups they oversee
- "Create Group" button
- Assign group manager from org members
- Add/remove members in their groups

**Admin view:**
- All groups in the org
- "Create Group" button
- "Invite to Org" button — invite by email (existing users only)
- Manage any group, assign directors, assign managers
- Org settings access

All views have an **"Open full view"** button that opens `popup.html?view=groups` in a full Chrome tab for detailed management.

### Invite flow

When a user opens the extension, pending invites are checked via `GET /api/users/me/invites`. If any exist, a notification badge appears on the Groups tab. Clicking shows the invite with org name, inviter name, and Accept/Decline buttons. On accept, a success toast shows and the Groups tab refreshes to show the new org.

### Loading and error states

- Loading: spinner (same as My Documents)
- Backend unavailable: "Groups require a doc-align account. Sign in and connect to use collaborative features."
- No org: "Create Organization" button or pending invite display
- Permission errors: toast with message
- Empty group: "No members yet. Add members to get started."

## Shared Types and Validation

All new types go in `packages/shared/src/types.ts`. New Zod schemas in `packages/shared/src/validation.ts`:

- `CreateOrganizationSchema` — `{ name: string }`
- `UpdateOrganizationSchema` — `{ name?: string }`
- `CreateGroupSchema` — `{ name: string, directorId?: string, managerId?: string }`
- `UpdateGroupSchema` — `{ name?: string, directorId?: string, managerId?: string }`
- `CreateInviteSchema` — `{ email: string, role: OrgRole, groupId?: string }`
- `AddGroupMemberSchema` — `{ userId: string }`

Input validation: org and group names max 100 characters, alphanumeric + spaces + common punctuation. Email validated as email format.

## Out of Scope

- Inviting non-doc-align users (requires email service)
- OpenFGA integration (designed for, not implemented)
- Document sign-off requirements (subsystem 2)
- Dashboard status view (subsystem 3)
- Organization-level billing in Stripe (uses creator's personal tier for now)
- Real-time notifications (polling on popup open is sufficient)
- Ownership transfer
- Organization deletion
- Pagination on list endpoints (acceptable for v1 scale)
- Audit logging (noted as future concern for enterprise)
