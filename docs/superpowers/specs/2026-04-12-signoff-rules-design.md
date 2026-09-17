# Sign-off Rules Design

Configurable rules that define who needs to sign off on a document before it's considered approved.

## Overview

Organizations can define default sign-off requirements (e.g., "all docs need 1 product sign-off and 1 engineering sign-off"). When a document is added to the org for tracking, the defaults are copied as the doc's own rules. Admins and directors can modify per-document rules (add/remove requirements, change counts). The extension shows real-time progress against these rules.

## Prerequisites: Group model refactor

Consolidate `directorId` and `managerId` on `Group` into a single `leaderId`. The group leader is the person responsible for the group (e.g., VP of Product leads the Product group).

```typescript
// Before
interface Group {
  id: string;
  organizationId: string;
  name: string;
  directorId?: string;   // remove
  managerId?: string;     // remove
  createdById: string;
  createdAt: string;
}

// After
interface Group {
  id: string;
  organizationId: string;
  name: string;
  leaderId?: string;      // single leader field
  createdById: string;
  createdAt: string;
}
```

Update all references: backend routes, services, shared types, extension views. The `requireLeader` field on sign-off rules refers to this `leaderId`.

## Data Model

### `signoffRulesets` collection

Stores sign-off requirements for both org defaults and per-document overrides.

```typescript
interface SignoffRuleset {
  id: string;
  organizationId: string;
  documentId: string | null;  // null = org default, set = per-document
  rules: SignoffRule[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

interface SignoffRule {
  groupId: string;           // references an existing org group
  groupName: string;         // denormalized for display
  minMembers: number;        // how many group members must sign (usually 1)
  requireLeader: boolean;  // whether the group's leader must also sign
}
```

- One record per org where `documentId = null` holds the defaults.
- One record per tracked document holds the doc-specific rules (copied from defaults on first add).
- Modifying org defaults does not retroactively change existing document rules.

### `orgDocuments` collection

Links a Google Doc to an organization for rule tracking.

```typescript
interface OrgDocument {
  id: string;
  organizationId: string;
  documentId: string;        // Google Doc ID
  title: string;
  addedById: string;
  addedAt: string;
}
```

- Created when any org member adds a document to the org.
- Triggers copying the org default ruleset to a doc-specific ruleset.

## API Endpoints

### Org default rules

| Method | Path | Description | Permissions |
|--------|------|-------------|-------------|
| GET | `/organizations/:orgId/signoff-rules` | Get org default ruleset | Any member |
| PUT | `/organizations/:orgId/signoff-rules` | Set/update org default rules | Admin, Director |

### Per-document rules

| Method | Path | Description | Permissions |
|--------|------|-------------|-------------|
| GET | `/organizations/:orgId/signoff-rules/documents/:documentId` | Get rules for doc (doc-specific if exists, else org default) | Any member |
| PUT | `/organizations/:orgId/signoff-rules/documents/:documentId` | Update doc-specific rules | Admin, Director |
| DELETE | `/organizations/:orgId/signoff-rules/documents/:documentId` | Reset doc to org defaults | Admin, Director |

### Org documents

| Method | Path | Description | Permissions |
|--------|------|-------------|-------------|
| POST | `/organizations/:orgId/documents` | Add a document to the org (copies default rules) | Any member |
| GET | `/organizations/:orgId/documents` | List all org documents | Any member |
| DELETE | `/organizations/:orgId/documents/:documentId` | Remove a document from the org | Admin, Director |

### Sign-off status against rules

| Method | Path | Description | Permissions |
|--------|------|-------------|-------------|
| GET | `/organizations/:orgId/signoff-rules/documents/:documentId/status` | Get rules with fulfillment status | Any member |

**Status response shape:**

```typescript
interface RuleStatus {
  rules: {
    groupId: string;
    groupName: string;
    minMembers: number;
    requireLeader: boolean;
    memberSignoffs: { userId: string; name: string; signedAt: string }[];
    leaderSignedOff: boolean;
    fulfilled: boolean;
  }[];
  allFulfilled: boolean;
}
```

`fulfilled` is true for a rule when `memberSignoffs.length >= minMembers` and (if `requireLeader`) `leaderSignedOff` is true. `allFulfilled` is true when every rule is fulfilled.

## Extension UI

### Sign-off progress (Sign Off tab)

When on a Google Doc that's tracked by the user's org, the Sign Off tab shows a progress section:

```
Sign-off Progress
─────────────────
✓ Product (1/1)     Jane Smith — Apr 10
✗ Engineering (0/1) Needs 1 member
✗ Design Leader     Awaiting leader sign-off
```

- Green check for fulfilled requirements, X for pending.
- Shows who has signed and when.
- If your sign-off would fulfill a requirement, the sign-off button shows context: "Your sign-off completes the Engineering requirement."
- If all requirements are fulfilled: "All sign-offs complete."

### Adding a document to the org

When on a Google Doc that isn't tracked by the org yet, the extension shows an "Add to [org name] for sign-off" button. Clicking it:

1. Calls `POST /organizations/:orgId/documents` with the doc ID and title.
2. Backend creates the `orgDocument` record and copies org default rules to a doc-specific ruleset.
3. Extension refreshes to show the sign-off progress section.

### Looking up the user's org

The extension calls `GET /organizations/me` (existing endpoint) on load to get the user's org. Since a user belongs to one org, this is a single lookup cached for the session. If the user has no org, no rules UI is shown.

## Shared Types

Add to `@doc-align/shared`:

```typescript
interface SignoffRuleset { ... }  // as defined above
interface SignoffRule { ... }
interface OrgDocument { ... }
interface RuleStatus { ... }
```

## Scope Boundaries

**In scope:**
- Refactor Group model: merge `directorId`/`managerId` into `leaderId`
- Org default rules (CRUD)
- Per-document rules (copy-on-add, override, reset to defaults)
- Org document tracking (add/list/remove)
- Rule fulfillment status computation
- Extension UI for progress display and "add to org" action
- Sign-off button context ("your sign-off completes X")

**Out of scope (future features):**
- OpenFGA-based permissions (currently uses org role checks)
- Admin dashboard / Monday-board view
- Partial document sign-offs (section-level)
- Folders / document grouping
- Notifications when requirements are fulfilled
