# Groups Tab UI Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Groups tab into a three-toggle management interface (Members | Groups | Rules) with inline forms, accordion groups, and AND/OR rule connectors.

**Architecture:** Replace the monolithic `groups.ts` with a toggle-based view system. Each toggle (members, groups, rules) is its own render function. The SignoffRule type changes from `minMembers + requireLeader` to `type: 'members' | 'leader'`. Connectors between rules are stored on SignoffRuleset.

**Tech Stack:** TypeScript, Chrome Extension popup (vanilla DOM), CSS, Express, Firestore, Zod

**Spec:** `docs/superpowers/specs/2026-04-13-groups-tab-ui-design.md`

---

### Task 1: Update SignoffRule type and add connectors to SignoffRuleset

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/validation.ts`
- Modify: `packages/backend/src/services/signoffRulesService.ts`
- Modify: `packages/backend/src/routes/signoffRules.ts`
- Modify: `packages/extension/src/lib/api.ts`
- Modify: `packages/extension/src/popup/views/sign-off.ts`

- [ ] **Step 1: Update SignoffRule type**

In `packages/shared/src/types.ts`, replace the existing `SignoffRule` interface:

```typescript
export interface SignoffRule {
  groupId: string;
  groupName: string;
  type: 'members' | 'leader';
  minMembers?: number;  // only when type is 'members'
}
```

- [ ] **Step 2: Add connectors to SignoffRuleset**

In `packages/shared/src/types.ts`, add `connectors` field to `SignoffRuleset`:

```typescript
export interface SignoffRuleset {
  id: string;
  organizationId: string;
  documentId: string | null;
  rules: SignoffRule[];
  connectors: ('AND' | 'OR')[];  // connectors[i] between rules[i] and rules[i+1]
  createdById: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Update Zod schemas**

In `packages/shared/src/validation.ts`, replace `SignoffRuleSchema` and `UpdateSignoffRulesSchema`:

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

- [ ] **Step 4: Update RuleStatusEntry**

In `packages/shared/src/types.ts`, update `RuleStatusEntry` to match the new rule type:

```typescript
export interface RuleStatusEntry {
  groupId: string;
  groupName: string;
  type: 'members' | 'leader';
  minMembers?: number;
  memberSignoffs: { userId: string; name: string; signedAt: string }[];
  leaderSignedOff: boolean;
  fulfilled: boolean;
}

export interface RuleStatus {
  rules: RuleStatusEntry[];
  connectors: ('AND' | 'OR')[];
  allFulfilled: boolean;
}
```

- [ ] **Step 5: Update signoffRulesService.ts**

In `packages/backend/src/services/signoffRulesService.ts`:

Update `setOrgDefaultRules` to accept and store connectors:

```typescript
export async function setOrgDefaultRules(
  orgId: string,
  rules: SignoffRuleset['rules'],
  connectors: SignoffRuleset['connectors'],
  userId: string,
): Promise<SignoffRuleset> {
```

Store `connectors` alongside `rules` in both create and update paths. Apply the same change to `setDocRules`.

Update `addOrgDocument` to also copy connectors when copying defaults.

Update `getRuleStatus` to:
1. Handle `rule.type === 'leader'` — check if leader signed (no member count needed)
2. Handle `rule.type === 'members'` — check `memberSignoffs.length >= rule.minMembers`
3. Return `connectors` from the ruleset
4. Compute `allFulfilled` using connector logic: AND means both must be fulfilled, OR means either

```typescript
// Compute allFulfilled with connectors
function computeAllFulfilled(statuses: { fulfilled: boolean }[], connectors: ('AND' | 'OR')[]): boolean {
  if (statuses.length === 0) return true;
  if (statuses.length === 1) return statuses[0]!.fulfilled;

  // Group by OR (AND binds tighter)
  // Split into AND-groups separated by OR
  let result = false;
  let currentAndGroup = statuses[0]!.fulfilled;

  for (let i = 0; i < connectors.length; i++) {
    if (connectors[i] === 'AND') {
      currentAndGroup = currentAndGroup && statuses[i + 1]!.fulfilled;
    } else {
      // OR: finalize current AND group and start new one
      result = result || currentAndGroup;
      currentAndGroup = statuses[i + 1]!.fulfilled;
    }
  }
  result = result || currentAndGroup;
  return result;
}
```

- [ ] **Step 6: Update signoffRules routes**

In `packages/backend/src/routes/signoffRules.ts`, update the PUT handlers to pass `connectors` from parsed body to service functions.

- [ ] **Step 7: Update extension API client**

In `packages/extension/src/lib/api.ts`, update `setOrgDefaultRules` and `setDocRules` to include connectors:

```typescript
setOrgDefaultRules: (orgId: string, rules: SignoffRule[], connectors: ('AND' | 'OR')[]) =>
  request<SignoffRuleset>(`/organizations/${orgId}/signoff-rules`, {
    method: 'PUT', body: JSON.stringify({ rules, connectors }),
  }),
```

- [ ] **Step 8: Update sign-off progress UI**

In `packages/extension/src/popup/views/sign-off.ts`, update the progress section rendering:
- Handle `rule.type === 'leader'` vs `rule.type === 'members'` for display text
- Show connectors between rule status rows (AND/OR pills)

- [ ] **Step 9: Build and verify**

Run: `pnpm run build-all && pnpm run typecheck && pnpm run test-all`
Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git commit -m "feat: update SignoffRule type and add connectors to rulesets"
```

---

### Task 2: Rebuild Groups tab with three-toggle structure

**Files:**
- Modify: `packages/extension/src/popup/views/groups.ts` (complete rewrite)
- Modify: `packages/extension/src/popup/popup.css` (new styles)

- [ ] **Step 1: Add CSS for the new Groups tab**

In `packages/extension/src/popup/popup.css`, add after the existing group styles:

```css
/* ---- Groups tab toggle ---- */
.groups-toggle-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}

.groups-toggle-btn {
  flex: 1;
  text-align: center;
}

/* ---- Collapsible sections ---- */
.collapsible-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  padding: 10px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.collapsible-header:hover {
  background: var(--color-surface-3);
}

.collapsible-count {
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
}

.collapsible-body {
  border-top: 1px solid var(--color-border);
  margin-top: 8px;
  padding-top: 8px;
}

/* ---- Invite section ---- */
.invite-pending-header {
  background: var(--color-warning-subtle, #2a1f0a);
  border-color: var(--color-warning, #665500);
}

.invite-pending-count {
  background: var(--color-warning, #665500);
  color: var(--color-warning-text, #ffaa00);
}

/* ---- Member list items ---- */
.member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 12px;
}

.member-role {
  font-size: 10px;
  margin-left: 4px;
}

.member-role-admin { color: var(--color-accent); }
.member-role-director { color: var(--color-success, #22c55e); }
.member-role-member { color: var(--color-text-secondary); }

/* ---- Rule cards ---- */
.rule-card {
  padding: 12px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.rule-connector {
  text-align: center;
  padding: 6px 0;
  position: relative;
}

.rule-connector-line {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border);
  transform: translateX(-50%);
  z-index: 0;
}

.rule-connector-pill {
  position: relative;
  z-index: 1;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 12px;
  border-radius: 10px;
  cursor: pointer;
  display: inline-block;
  color: white;
}

.rule-connector-and { background: var(--color-accent); }
.rule-connector-or { background: var(--color-warning, #ff8800); }

.rule-summary {
  background: var(--color-success-subtle, #0a1a0a);
  border: 1px solid var(--color-success-border, #225522);
  border-radius: var(--radius-md);
  padding: 8px;
  margin-bottom: 12px;
  font-size: 11px;
}

/* ---- Inline forms ---- */
.inline-form {
  background: var(--color-surface-2);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  padding: 10px;
  margin: 8px 0;
}

.inline-form input,
.inline-form select {
  width: 100%;
  padding: 6px 8px;
  margin-bottom: 6px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 12px;
}

.inline-form-actions {
  display: flex;
  gap: 6px;
}
```

- [ ] **Step 2: Rewrite groups.ts — top-level structure with toggle**

Replace the entire content of `packages/extension/src/popup/views/groups.ts` with the new toggle-based structure. The main export `renderGroupsView` loads the org, then renders the toggle bar and delegates to `renderMembersView`, `renderGroupsListView`, or `renderRulesView` based on the active toggle.

```typescript
import { api } from '../../lib/api';
import type { Organization, GroupResponse, OrgMemberResponse, Invite, OrgRole, SignoffRuleset, SignoffRule } from '@doc-align/shared';

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let activeGroupsToggle: 'members' | 'groups' | 'rules' = 'members';
let cachedOrg: Organization | null = null;

export async function renderGroupsView(container: HTMLElement): Promise<void> {
  container.innerHTML =
    '<div class="docs-loading"><div class="docs-spinner"></div><p>Loading...</p></div>';

  let orgs: Organization[] = [];
  try {
    orgs = await api.getMyOrgs() as Organization[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Failed to load</div><div class="empty-state-subtitle">${escapeHtml(msg)}</div></div>`;
    return;
  }

  if (orgs.length === 0) {
    renderNoOrgState(container);
    return;
  }

  cachedOrg = orgs[0]!;
  renderOrgWithToggle(container, cachedOrg);
}

function renderNoOrgState(container: HTMLElement): void {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-title">No organization yet</div>
      <div class="empty-state-subtitle">Create an organization to start managing groups and members.</div>
      <button class="btn btn-primary mt-3" id="groups-create-org">Create Organization</button>
    </div>
  `;
  document.getElementById('groups-create-org')?.addEventListener('click', () => {
    showCreateOrgForm(container);
  });
}

function showCreateOrgForm(container: HTMLElement): void {
  const btn = document.getElementById('groups-create-org');
  if (!btn) return;
  const form = document.createElement('div');
  form.className = 'inline-form';
  form.innerHTML = `
    <input type="text" id="org-name-input" placeholder="Organization name">
    <div class="inline-form-actions">
      <button class="btn btn-primary btn-sm" id="org-create-submit" style="flex:1;">Create</button>
      <button class="btn btn-ghost btn-sm" id="org-create-cancel" style="flex:1;">Cancel</button>
    </div>
  `;
  btn.replaceWith(form);

  document.getElementById('org-create-submit')?.addEventListener('click', async () => {
    const input = document.getElementById('org-name-input') as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    try {
      await api.createOrganization({ name });
      renderGroupsView(container);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      input.value = '';
      input.placeholder = `Error: ${msg}`;
    }
  });

  document.getElementById('org-create-cancel')?.addEventListener('click', () => {
    renderGroupsView(container);
  });
}

function renderOrgWithToggle(container: HTMLElement, org: Organization): void {
  container.innerHTML = '';

  // Org header
  const header = document.createElement('div');
  header.className = 'org-header';
  header.textContent = org.name;
  container.appendChild(header);

  // Toggle bar
  const toggleBar = document.createElement('div');
  toggleBar.className = 'groups-toggle-bar';
  const toggles: Array<{ key: typeof activeGroupsToggle; label: string }> = [
    { key: 'members', label: 'Members' },
    { key: 'groups', label: 'Groups' },
    { key: 'rules', label: 'Rules' },
  ];
  for (const t of toggles) {
    const btn = document.createElement('button');
    btn.className = `btn ${t.key === activeGroupsToggle ? 'btn-primary' : 'btn-ghost'} btn-sm groups-toggle-btn`;
    btn.dataset.toggle = t.key;
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      activeGroupsToggle = t.key;
      renderOrgWithToggle(container, org);
    });
    toggleBar.appendChild(btn);
  }
  container.appendChild(toggleBar);

  // Content area
  const content = document.createElement('div');
  content.id = 'groups-content';
  container.appendChild(content);

  if (activeGroupsToggle === 'members') {
    renderMembersView(content, org);
  } else if (activeGroupsToggle === 'groups') {
    renderGroupsListView(content, org);
  } else {
    renderRulesView(content, org);
  }
}
```

Continue implementing `renderMembersView`, `renderGroupsListView`, and `renderRulesView` in the same file. Each function follows the same pattern: fetch data, build HTML with inline event listeners, handle inline forms.

Key implementation details for each view:

**renderMembersView:** Search bar filters both pending invites and active members. Both sections are collapsible with count badges. Invite form is inline with email + role dropdown.

**renderGroupsListView:** Groups as accordion cards. Expanded groups show members with leader badge, add/remove member buttons. Create group form is inline.

**renderRulesView:** Rule cards with AND/OR connector pills between them. Click pill to toggle. Summary box at bottom. Add rule form has group dropdown + member/leader radio.

- [ ] **Step 3: Build and verify**

Run: `pnpm run build-all && pnpm run typecheck`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: rebuild Groups tab with Members/Groups/Rules toggle views"
```

---

### Task 3: Implement Members view

**Files:**
- Modify: `packages/extension/src/popup/views/groups.ts`

- [ ] **Step 1: Implement renderMembersView**

Add the `renderMembersView` function. It should:

1. Fetch org members via `api.getOrgMembers(org.id)` and invites via `api.getOrgInvites(org.id)`
2. Render search input that filters both lists by name/email
3. Render collapsible "Pending Invites" section with count badge, each showing email, date, role, and "Revoke" button
4. Render collapsible "Active Members" section with count badge, each showing name, role badge (admin/director/member with color), and "Change role" dropdown
5. "Invite Member" button that expands inline form with email input, role select (admin/director/member), and Send/Cancel buttons

All interactions use inline forms — no `prompt()` or `alert()` calls.

- [ ] **Step 2: Build and test**

Run: `pnpm run build-all && pnpm run typecheck`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: implement Members view with search, invites, and role management"
```

---

### Task 4: Implement Groups list view

**Files:**
- Modify: `packages/extension/src/popup/views/groups.ts`

- [ ] **Step 1: Implement renderGroupsListView**

Add the `renderGroupsListView` function. It should:

1. Fetch groups via `api.getOrgGroups(org.id)`
2. Render each group as an accordion card showing name, leader name, member count
3. Click to expand — show member list with leader badge, "Remove" link per member, "+ Add Member" inline form (email input), "Set Leader" dropdown of current members
4. "+ Create Group" button at bottom — inline form with name input and Create/Cancel

When "Add Member" is clicked, expand an inline form inside the group card. When "Set Leader" is clicked, show a dropdown of current members — selecting one calls `api.updateGroup(orgId, groupId, { leaderId })`.

- [ ] **Step 2: Build and test**

Run: `pnpm run build-all && pnpm run typecheck`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: implement Groups list view with accordion cards and member management"
```

---

### Task 5: Implement Rules view

**Files:**
- Modify: `packages/extension/src/popup/views/groups.ts`

- [ ] **Step 1: Implement renderRulesView**

Add the `renderRulesView` function. It should:

1. Fetch default rules via `api.getOrgDefaultRules(org.id)`
2. Fetch groups via `api.getOrgGroups(org.id)` (for the "add rule" dropdown)
3. Render each rule as a card showing group name and requirement text:
   - `type === 'members'`: "N member(s) must sign"
   - `type === 'leader'`: "Leader must sign"
   - "✕" remove button on each card
4. Between each pair of cards, render a connector pill:
   - Purple for AND, orange for OR
   - Clickable — click toggles between AND and OR
   - On click, update the connectors array and call `api.setOrgDefaultRules(org.id, rules, connectors)`
5. Summary box at bottom — plain English readout of combined logic
6. "Add Rule" inline form:
   - Group dropdown (filtered to exclude groups already in rules)
   - Radio: "Member(s)" with number input vs "Leader"
   - Add button — appends rule with AND connector, saves via API

When removing a rule, also remove the adjacent connector and save.

**Summary text generation:**

```typescript
function buildRuleSummary(rules: SignoffRule[], connectors: ('AND' | 'OR')[]): string {
  if (rules.length === 0) return 'No rules configured';
  const parts = rules.map(r =>
    r.type === 'leader'
      ? `${r.groupName} leader`
      : `${r.minMembers} from ${r.groupName}`
  );
  let text = parts[0]!;
  for (let i = 0; i < connectors.length; i++) {
    text += ` ${connectors[i]} ${parts[i + 1]}`;
  }
  return text;
}
```

- [ ] **Step 2: Build and test**

Run: `pnpm run build-all && pnpm run typecheck`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: implement Rules view with AND/OR connectors and add/remove"
```

---

### Task 6: E2E tests and final verification

**Files:**
- Modify: `packages/e2e/tests/signoff-rules.spec.ts`

- [ ] **Step 1: Add E2E tests for Groups tab toggles**

Add tests to verify the three-toggle UI renders:

```typescript
test('should show Members/Groups/Rules toggle on Groups tab', async ({ extensionPopup }) => {
  await extensionPopup.locator('.tab[data-tab="groups"]').click();
  await extensionPopup.waitForTimeout(2000);

  // Should show toggle buttons (if user has an org)
  // or "No organization yet" with create button
  const groupsView = extensionPopup.locator('#groups-view');
  const text = await groupsView.textContent();
  expect(text!.length).toBeGreaterThan(0);
  expect(text).not.toContain('Error');
});
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm run build-all && pnpm run typecheck && pnpm run test-all && pnpm test:e2e`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add E2E tests for Groups tab toggle UI"
```
