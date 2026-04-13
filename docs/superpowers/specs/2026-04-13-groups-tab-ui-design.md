# Groups Tab UI Expansion Design

Rebuild the Groups tab from a barebones group list into a full management interface with three sub-views: Members, Groups, and Rules.

## Overview

The Groups tab currently shows a flat list of group cards with `prompt()` dialogs for actions. This redesign replaces it with a three-toggle interface (Members | Groups | Rules) using the same toggle pattern as signed/tracked documents. All forms are inline — no browser prompt dialogs.

## Data Model Changes

### Updated `SignoffRule` — either members or leader, not both

```typescript
interface SignoffRule {
  groupId: string;
  groupName: string;
  type: 'members' | 'leader';  // replaces minMembers + requireLeader
  minMembers?: number;          // only when type is 'members'
}
```

The current model has `minMembers` + `requireLeader` on every rule, which conflates two different requirements. The new model makes each rule either "N members from this group" or "the leader of this group." If you need both, create two separate rules connected by AND.

### New `connector` field on `SignoffRuleset`

```typescript
interface SignoffRuleset {
  id: string;
  organizationId: string;
  documentId: string | null;
  rules: SignoffRule[];
  connectors: ('AND' | 'OR')[];  // NEW: connectors[i] sits between rules[i] and rules[i+1]
  createdById: string;
  createdAt: string;
  updatedAt: string;
}
```

`connectors` has length `rules.length - 1`. For example, 3 rules have 2 connectors: `rules[0] [connectors[0]] rules[1] [connectors[1]] rules[2]`.

### Rule status computation update

`fulfilled` logic changes based on connectors. For AND: all connected rules must be fulfilled. For OR: at least one must be fulfilled. Evaluation groups rules by connector precedence (AND binds tighter than OR, like multiplication vs addition).

## UI Design

### Toggle bar

Three toggles: **Members** | **Groups** | **Rules** (left to right). Same visual pattern as the signed/tracked toggle on My Documents.

### Members view (left toggle)

- **Search bar** at top — filters both pending invites and active members
- **Pending Invites** — collapsible section with count badge (e.g., "📩 Pending Invites [2]"). Expand to see each invite: email, sent date, invited role, and "Revoke" button.
- **Active Members** — collapsible section with count badge (e.g., "👥 Active Members [4]"). Expand to see each member: name, role badge (Admin/Director/Member), and "Change role" dropdown for admins/directors.
- **"+ Invite Member"** button at bottom — expands inline form with email input and role selector.

### Groups view (middle toggle)

- **Accordion group cards** — each shows group name, leader name, member count. Click to expand.
- **Expanded group** shows:
  - Member list with leader badge
  - "Remove" link per non-leader member
  - "+ Add Member" button — inline form with email/name input
  - "Set Leader" button — inline dropdown of current members
- **"+ Create Group"** button at bottom — inline form with group name input.

### Rules view (right toggle)

- **Description** at top: "Default sign-off requirements for all new documents."
- **Rule cards** stacked vertically, each showing:
  - Group name
  - Requirement: "1 member must sign" or "Leader must sign"
  - "✕" remove button
- **AND/OR connector pills** between each pair of rule cards:
  - Purple pill for AND, orange pill for OR
  - Clickable — click to toggle between AND and OR
  - Small ▾ indicator showing it's interactive
  - Vertical line connecting the cards through the pill
- **Summary box** at bottom — plain English readout of the combined rule logic (e.g., "1 from Product AND Engineering leader OR Design leader")
- **"+ Add Rule"** form:
  - Group dropdown (select from org's groups)
  - Radio: "Member(s)" with count input, or "Leader"
  - Add button — new rule gets AND-connected to the last rule by default

## Inline Forms (replace all prompt() dialogs)

All user input happens within the extension popup:

- **Invite member**: email input + role dropdown + Send/Cancel buttons
- **Create group**: name input + Create/Cancel buttons
- **Add group member**: email input + Add/Cancel buttons
- **Set leader**: dropdown of current group members
- **Add rule**: group dropdown + member/leader radio + Add button
- **Change role**: inline dropdown replacing the current role badge

Forms expand in-place where the action button was, pushing content down. Cancel collapses the form.

## API Endpoints Used

All endpoints already exist in the backend. No new endpoints needed — this is purely a UI feature.

**Members view:**
- `GET /organizations/me` — get user's org
- `GET /organizations/:orgId/members` — list members (existing)
- `GET /organizations/me/invites` — list pending invites (existing, needs filtering by org)
- `POST /organizations/:orgId/invite` — send invite (existing)
- `DELETE /organizations/:orgId/invites/:inviteId` — revoke invite (existing)
- `PATCH /organizations/:orgId/members/:userId` — change role (existing)

**Groups view:**
- `GET /organizations/:orgId/groups` — list groups (existing)
- `GET /organizations/:orgId/groups/:groupId/members` — list group members (existing)
- `POST /organizations/:orgId/groups` — create group (existing)
- `POST /organizations/:orgId/groups/:groupId/members` — add member (existing)
- `DELETE /organizations/:orgId/groups/:groupId/members/:userId` — remove member (existing)
- `PATCH /organizations/:orgId/groups/:groupId` — update group (set leader) (existing)

**Rules view:**
- `GET /organizations/:orgId/signoff-rules` — get default rules (existing)
- `PUT /organizations/:orgId/signoff-rules` — update default rules (existing)

## Shared Type Updates

Update in `@doc-align/shared`:

```typescript
// Replace existing SignoffRule
interface SignoffRule {
  groupId: string;
  groupName: string;
  type: 'members' | 'leader';
  minMembers?: number;
}

// Add connectors to SignoffRuleset
interface SignoffRuleset {
  // ... existing fields ...
  connectors: ('AND' | 'OR')[];
}
```

Update `SignoffRuleSchema` in validation:
```typescript
export const SignoffRuleSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  type: z.enum(['members', 'leader']),
  minMembers: z.number().int().min(1).optional(),
});

export const UpdateSignoffRulesSchema = z.object({
  rules: z.array(SignoffRuleSchema),
  connectors: z.array(z.enum(['AND', 'OR'])),
});
```

## Scope

**In scope:**
- Three-toggle UI (Members, Groups, Rules)
- Inline forms replacing all `prompt()` dialogs
- Member management (list, search, invite, revoke, change role)
- Group management (list, expand, members, add/remove, set leader, create)
- Rules management (list, add, remove, AND/OR connectors, summary)
- SignoffRule type change (members vs leader)
- Connectors on SignoffRuleset
- Updated rule status computation

**Out of scope:**
- Per-document rule overrides UI (editing rules for a specific doc)
- Notifications
- OpenFGA permissions
