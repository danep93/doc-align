import { api } from '../../lib/api';
import type {
  Organization,
  GroupResponse,
  Invite,
  OrgRole,
  OrgMemberResponse,
  SignoffRule,
  SignoffRuleset,
} from '@doc-align/shared';

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

type GroupsToggle = 'members' | 'groups' | 'rules';
let activeGroupsToggle: GroupsToggle = 'members';

export async function renderGroupsView(container: HTMLElement): Promise<void> {
  container.innerHTML =
    '<div class="docs-loading"><div class="docs-spinner"></div><p>Loading groups...</p></div>';

  let orgs: Organization[] = [];
  let invites: Invite[] = [];

  try {
    [orgs, invites] = await Promise.all([
      api.getMyOrgs() as Promise<Organization[]>,
      api.getMyPendingInvites() as Promise<Invite[]>,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes('require backend') ||
      msg.toLowerCase().includes('backend connection')
    ) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Backend not available</div>
          <div class="empty-state-subtitle">Groups require a backend connection. Please check your settings.</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Failed to load groups</div>
          <div class="empty-state-subtitle">${escapeHtml(msg)}</div>
        </div>
      `;
    }
    return;
  }

  container.innerHTML = '';

  // Render pending invites (incoming) at top
  if (invites.length > 0) {
    const invitesSection = document.createElement('div');
    invitesSection.className = 'mb-3';

    const invitesHeader = document.createElement('div');
    invitesHeader.className = 'org-header';
    invitesHeader.style.fontSize = '13px';
    invitesHeader.textContent = 'Pending Invites';
    invitesSection.appendChild(invitesHeader);

    for (const invite of invites) {
      const card = renderIncomingInviteCard(invite, container);
      invitesSection.appendChild(card);
    }

    const divider = document.createElement('div');
    divider.className = 'divider';
    invitesSection.appendChild(divider);

    container.appendChild(invitesSection);
  }

  // No org and no invites
  if (orgs.length === 0 && invites.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No organization yet</div>
        <div class="empty-state-subtitle">Create an organization to start managing groups and members.</div>
        <button class="btn btn-primary mt-3" id="groups-create-org">Create Organization</button>
        <div class="text-xs text-muted mt-2">Requires Pro or Enterprise plan</div>
      </div>
    `;

    document.getElementById('groups-create-org')?.addEventListener('click', () => {
      showCreateOrgForm(container);
    });
    return;
  }

  // No org but has invites (already rendered above)
  if (orgs.length === 0) {
    const createSection = document.createElement('div');
    createSection.className = 'empty-state';
    createSection.style.minHeight = '100px';
    createSection.innerHTML = `
      <div class="empty-state-subtitle">Or create your own organization</div>
      <button class="btn btn-ghost btn-sm mt-2" id="groups-create-org">Create Organization</button>
      <div class="text-xs text-muted mt-1">Requires Pro or Enterprise plan</div>
    `;
    container.appendChild(createSection);

    document.getElementById('groups-create-org')?.addEventListener('click', () => {
      showCreateOrgForm(container);
    });
    return;
  }

  // Render org view (use first org)
  const org = orgs[0]!;
  await renderOrgView(container, org);
}

/* ============================================================
   Incoming invite card (user was invited to an org)
   ============================================================ */
function renderIncomingInviteCard(invite: Invite, rootContainer: HTMLElement): HTMLElement {
  const card = document.createElement('div');
  card.className = 'invite-card';
  card.innerHTML = `
    <div class="invite-card-org">Organization Invite</div>
    <div class="invite-card-role">Role: ${escapeHtml(invite.role)}</div>
    <div class="invite-card-actions">
      <button class="btn btn-primary btn-sm invite-accept">Accept</button>
      <button class="btn btn-ghost btn-sm invite-decline">Decline</button>
    </div>
  `;

  const acceptBtn = card.querySelector('.invite-accept') as HTMLButtonElement;
  const declineBtn = card.querySelector('.invite-decline') as HTMLButtonElement;

  acceptBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true;
    acceptBtn.textContent = 'Accepting...';
    try {
      await api.acceptInvite(invite.id);
      renderGroupsView(rootContainer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showInlineError(card, msg);
      acceptBtn.disabled = false;
      acceptBtn.textContent = 'Accept';
    }
  });

  declineBtn.addEventListener('click', async () => {
    declineBtn.disabled = true;
    declineBtn.textContent = 'Declining...';
    try {
      await api.declineInvite(invite.id);
      card.remove();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showInlineError(card, msg);
      declineBtn.disabled = false;
      declineBtn.textContent = 'Decline';
    }
  });

  return card;
}

/* ============================================================
   Inline create-org form (replaces prompt())
   ============================================================ */
function showCreateOrgForm(rootContainer: HTMLElement): void {
  // Avoid double form
  if (rootContainer.querySelector('.inline-form')) return;

  const form = document.createElement('div');
  form.className = 'inline-form';
  form.innerHTML = `
    <input type="text" placeholder="Organization name" class="create-org-name" />
    <div class="inline-form-actions">
      <button class="btn btn-primary btn-sm create-org-submit">Create</button>
      <button class="btn btn-ghost btn-sm create-org-cancel">Cancel</button>
    </div>
  `;
  rootContainer.appendChild(form);

  const input = form.querySelector('.create-org-name') as HTMLInputElement;
  const submitBtn = form.querySelector('.create-org-submit') as HTMLButtonElement;
  const cancelBtn = form.querySelector('.create-org-cancel') as HTMLButtonElement;

  input.focus();

  submitBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    try {
      await api.createOrganization({ name });
      renderGroupsView(rootContainer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showInlineError(form, msg);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create';
    }
  });

  cancelBtn.addEventListener('click', () => form.remove());
}

/* ============================================================
   Org view — toggle bar + subviews
   ============================================================ */
async function renderOrgView(container: HTMLElement, org: Organization): Promise<void> {
  const header = document.createElement('div');
  header.className = 'org-header';
  header.textContent = org.name;
  container.appendChild(header);

  // Open full view button
  const openTabBtn = document.createElement('button');
  openTabBtn.className = 'btn btn-ghost docs-open-tab-btn';
  openTabBtn.textContent = 'Open full view';
  openTabBtn.addEventListener('click', () => {
    const extUrl = chrome.runtime.getURL('popup/popup.html?view=groups');
    chrome.tabs.create({ url: extUrl });
  });
  container.appendChild(openTabBtn);

  // Toggle bar
  const toggleBar = document.createElement('div');
  toggleBar.className = 'groups-toggle-bar';

  const toggles: { label: string; value: GroupsToggle }[] = [
    { label: 'Members', value: 'members' },
    { label: 'Groups', value: 'groups' },
    { label: 'Rules', value: 'rules' },
  ];

  const contentArea = document.createElement('div');

  for (const t of toggles) {
    const btn = document.createElement('button');
    btn.className = `btn btn-sm groups-toggle-btn ${activeGroupsToggle === t.value ? 'btn-primary' : 'btn-ghost'}`;
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      activeGroupsToggle = t.value;
      // Update button states
      toggleBar.querySelectorAll('.groups-toggle-btn').forEach((b) => {
        b.className = `btn btn-sm groups-toggle-btn btn-ghost`;
      });
      btn.className = `btn btn-sm groups-toggle-btn btn-primary`;
      renderSubview(contentArea, org);
    });
    toggleBar.appendChild(btn);
  }

  container.appendChild(toggleBar);
  container.appendChild(contentArea);

  await renderSubview(contentArea, org);
}

async function renderSubview(contentArea: HTMLElement, org: Organization): Promise<void> {
  contentArea.innerHTML =
    '<div class="docs-loading"><div class="docs-spinner"></div></div>';

  try {
    switch (activeGroupsToggle) {
      case 'members':
        await renderMembersView(contentArea, org);
        break;
      case 'groups':
        await renderGroupsSubview(contentArea, org);
        break;
      case 'rules':
        await renderRulesView(contentArea, org);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    contentArea.innerHTML = `<div class="text-sm text-muted">Failed to load: ${escapeHtml(msg)}</div>`;
  }
}

/* ============================================================
   MEMBERS VIEW
   ============================================================ */
async function renderMembersView(contentArea: HTMLElement, org: Organization): Promise<void> {
  const [orgInvites, members] = await Promise.all([
    api.getOrgInvites(org.id) as Promise<Invite[]>,
    api.getOrgMembers(org.id) as Promise<OrgMemberResponse[]>,
  ]);

  contentArea.innerHTML = '';

  // Search bar
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search members or invites...';
  searchInput.className = 'form-input mb-3';
  searchInput.style.fontSize = '12px';
  contentArea.appendChild(searchInput);

  const listContainer = document.createElement('div');
  contentArea.appendChild(listContainer);

  const renderFiltered = (filter: string) => {
    listContainer.innerHTML = '';
    const f = filter.toLowerCase();

    // Pending invites section
    const filteredInvites = orgInvites.filter(
      (inv) => inv.status === 'pending' && inv.inviteeEmail.toLowerCase().includes(f)
    );
    renderCollapsibleSection(
      listContainer,
      `\u{1F4E9} Pending Invites`,
      filteredInvites.length,
      true, // accent style
      (body) => {
        if (filteredInvites.length === 0) {
          body.innerHTML = '<div class="text-xs text-muted">No pending invites</div>';
          return;
        }
        for (const inv of filteredInvites) {
          const row = document.createElement('div');
          row.className = 'member-item';
          const sentDate = new Date(inv.createdAt).toLocaleDateString();
          row.innerHTML = `
            <div>
              <span>${escapeHtml(inv.inviteeEmail)}</span>
              <span class="member-role member-role-${inv.role}">${escapeHtml(inv.role)}</span>
              <div class="text-xs text-muted">Sent ${sentDate}</div>
            </div>
          `;
          const revokeBtn = document.createElement('button');
          revokeBtn.className = 'btn btn-danger btn-sm';
          revokeBtn.textContent = 'Revoke';
          revokeBtn.addEventListener('click', async () => {
            revokeBtn.disabled = true;
            revokeBtn.textContent = 'Revoking...';
            try {
              await api.revokeInvite(org.id, inv.id);
              // Remove from local array and re-render
              const idx = orgInvites.indexOf(inv);
              if (idx >= 0) orgInvites.splice(idx, 1);
              renderFiltered(searchInput.value);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              showInlineError(row, msg);
              revokeBtn.disabled = false;
              revokeBtn.textContent = 'Revoke';
            }
          });
          row.appendChild(revokeBtn);
          body.appendChild(row);
        }
      }
    );

    // Active members section
    const filteredMembers = members.filter(
      (m) =>
        m.displayName.toLowerCase().includes(f) ||
        m.email.toLowerCase().includes(f)
    );
    renderCollapsibleSection(
      listContainer,
      `\u{1F465} Active Members`,
      filteredMembers.length,
      false,
      (body) => {
        if (filteredMembers.length === 0) {
          body.innerHTML = '<div class="text-xs text-muted">No members found</div>';
          return;
        }
        for (const m of filteredMembers) {
          const row = document.createElement('div');
          row.className = 'member-item';
          row.innerHTML = `
            <div>
              <span>${escapeHtml(m.displayName || m.email)}</span>
              <span class="member-role member-role-${m.role}">${escapeHtml(m.role)}</span>
            </div>
          `;

          // Role change dropdown
          const roleSelect = document.createElement('select');
          roleSelect.className = 'form-select';
          roleSelect.style.width = 'auto';
          roleSelect.style.fontSize = '10px';
          roleSelect.style.padding = '2px 20px 2px 6px';
          for (const r of ['admin', 'director', 'member'] as OrgRole[]) {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            if (r === m.role) opt.selected = true;
            roleSelect.appendChild(opt);
          }
          roleSelect.addEventListener('change', async () => {
            const newRole = roleSelect.value as OrgRole;
            try {
              await api.changeOrgMemberRole(org.id, m.userId, newRole);
              m.role = newRole;
              renderFiltered(searchInput.value);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              showInlineError(row, msg);
              roleSelect.value = m.role;
            }
          });
          row.appendChild(roleSelect);
          body.appendChild(row);
        }
      }
    );
  };

  searchInput.addEventListener('input', () => renderFiltered(searchInput.value));
  renderFiltered('');

  // "+ Invite Member" button
  const inviteBtn = document.createElement('button');
  inviteBtn.className = 'btn btn-ghost btn-sm mt-3';
  inviteBtn.textContent = '+ Invite Member';
  inviteBtn.addEventListener('click', () => {
    if (contentArea.querySelector('.invite-inline-form')) return;
    const form = document.createElement('div');
    form.className = 'inline-form invite-inline-form';
    form.innerHTML = `
      <input type="email" placeholder="Email address" class="invite-email" />
      <select class="invite-role">
        <option value="member">Member</option>
        <option value="director">Director</option>
        <option value="admin">Admin</option>
      </select>
      <div class="inline-form-actions">
        <button class="btn btn-primary btn-sm invite-send">Send</button>
        <button class="btn btn-ghost btn-sm invite-cancel">Cancel</button>
      </div>
    `;
    contentArea.appendChild(form);

    const emailInput = form.querySelector('.invite-email') as HTMLInputElement;
    emailInput.focus();

    (form.querySelector('.invite-send') as HTMLButtonElement).addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const role = (form.querySelector('.invite-role') as HTMLSelectElement).value as OrgRole;
      if (!email) return;
      const sendBtn = form.querySelector('.invite-send') as HTMLButtonElement;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
      try {
        const newInvite = (await api.createInvite(org.id, { email, role })) as Invite;
        orgInvites.push(newInvite);
        form.remove();
        renderFiltered(searchInput.value);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showInlineError(form, msg);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    });

    (form.querySelector('.invite-cancel') as HTMLButtonElement).addEventListener('click', () =>
      form.remove()
    );
  });
  contentArea.appendChild(inviteBtn);
}

/* ============================================================
   GROUPS VIEW
   ============================================================ */
async function renderGroupsSubview(contentArea: HTMLElement, org: Organization): Promise<void> {
  const groups = (await api.getOrgGroups(org.id)) as GroupResponse[];
  const allMembers = (await api.getOrgMembers(org.id)) as OrgMemberResponse[];

  contentArea.innerHTML = '';

  if (groups.length === 0) {
    contentArea.innerHTML = `
      <div class="empty-state" style="min-height:120px">
        <div class="empty-state-title">No groups yet</div>
        <div class="empty-state-subtitle">Create a group to organize your team members.</div>
      </div>
    `;
  } else {
    // Expanded state tracker
    const expanded: Record<string, boolean> = {};

    const renderGroups = () => {
      // Clear only group cards, preserve create-group form if present
      const existingForm = contentArea.querySelector('.create-group-form');
      contentArea.innerHTML = '';

      for (const group of groups) {
        const card = document.createElement('div');
        card.className = 'group-card';
        card.style.cursor = 'pointer';

        const metaParts: string[] = [];
        if (group.leaderName) metaParts.push(`Leader: ${escapeHtml(group.leaderName)}`);
        metaParts.push(`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`);

        const arrow = expanded[group.id] ? '\u25BE' : '\u25B8';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="group-card-name">${arrow} ${escapeHtml(group.name)}</div>
              <div class="group-card-meta">${metaParts.join(' \u00B7 ')}</div>
            </div>
          </div>
        `;

        card.addEventListener('click', async (e) => {
          // Ignore clicks on buttons/inputs inside expanded area
          if ((e.target as HTMLElement).closest('.group-expanded-area')) return;
          expanded[group.id] = !expanded[group.id];
          renderGroups();
          if (expanded[group.id]) {
            await loadGroupExpanded(card, org, group, allMembers, renderGroups);
          }
        });

        contentArea.appendChild(card);

        if (expanded[group.id]) {
          loadGroupExpanded(card, org, group, allMembers, renderGroups);
        }
      }

      // Re-add create group button
      const createBtn = document.createElement('button');
      createBtn.className = 'btn btn-ghost btn-sm mt-3';
      createBtn.textContent = '+ Create Group';
      createBtn.addEventListener('click', () => showCreateGroupForm(contentArea, org, groups, renderGroups));
      contentArea.appendChild(createBtn);

      if (existingForm) contentArea.appendChild(existingForm);
    };

    renderGroups();
  }

  if (groups.length === 0) {
    const createBtn = document.createElement('button');
    createBtn.className = 'btn btn-ghost btn-sm mt-3';
    createBtn.textContent = '+ Create Group';
    createBtn.addEventListener('click', () => {
      showCreateGroupForm(contentArea, org, groups, () => {
        renderGroupsSubview(contentArea, org);
      });
    });
    contentArea.appendChild(createBtn);
  }
}

async function loadGroupExpanded(
  card: HTMLElement,
  org: Organization,
  group: GroupResponse,
  allMembers: OrgMemberResponse[],
  rerender: () => void
): Promise<void> {
  // Remove existing expanded area
  card.querySelector('.group-expanded-area')?.remove();

  const area = document.createElement('div');
  area.className = 'group-expanded-area collapsible-body';
  area.innerHTML = '<div class="text-xs text-muted">Loading members...</div>';
  card.appendChild(area);

  try {
    const groupMembers = (await api.getGroupMembers(org.id, group.id)) as OrgMemberResponse[];
    area.innerHTML = '';

    for (const m of groupMembers) {
      const row = document.createElement('div');
      row.className = 'member-item';
      const isLeader = group.leaderName === m.displayName;
      row.innerHTML = `
        <div>
          <span>${escapeHtml(m.displayName || m.email)}</span>
          ${isLeader ? '<span style="color:var(--color-accent);font-size:10px;margin-left:4px">Leader</span>' : ''}
        </div>
      `;
      if (!isLeader) {
        const removeLink = document.createElement('button');
        removeLink.className = 'btn btn-ghost btn-sm';
        removeLink.style.fontSize = '10px';
        removeLink.textContent = 'Remove';
        removeLink.addEventListener('click', async (e) => {
          e.stopPropagation();
          removeLink.disabled = true;
          try {
            await api.removeGroupMember(org.id, group.id, m.userId);
            group.memberCount = Math.max(0, group.memberCount - 1);
            row.remove();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showInlineError(row, msg);
            removeLink.disabled = false;
          }
        });
        row.appendChild(removeLink);
      }
      area.appendChild(row);
    }

    // Set Leader button
    const setLeaderBtn = document.createElement('button');
    setLeaderBtn.className = 'btn btn-ghost btn-sm mt-2';
    setLeaderBtn.textContent = 'Set Leader';
    setLeaderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (area.querySelector('.set-leader-form')) return;
      const form = document.createElement('div');
      form.className = 'inline-form set-leader-form';
      const select = document.createElement('select');
      select.style.width = '100%';
      select.style.marginBottom = '6px';
      for (const m of groupMembers) {
        const opt = document.createElement('option');
        opt.value = m.userId;
        opt.textContent = m.displayName || m.email;
        select.appendChild(opt);
      }
      form.appendChild(select);

      const actions = document.createElement('div');
      actions.className = 'inline-form-actions';
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn btn-primary btn-sm';
      confirmBtn.textContent = 'Confirm';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-ghost btn-sm';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBtn);
      form.appendChild(actions);
      area.appendChild(form);

      confirmBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        confirmBtn.disabled = true;
        try {
          await api.updateGroup(org.id, group.id, { leaderId: select.value });
          const chosen = groupMembers.find((gm) => gm.userId === select.value);
          if (chosen) group.leaderName = chosen.displayName || chosen.email;
          rerender();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showInlineError(form, msg);
          confirmBtn.disabled = false;
        }
      });
      cancelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        form.remove();
      });
    });
    area.appendChild(setLeaderBtn);

    // Add Member button
    const addMemberBtn = document.createElement('button');
    addMemberBtn.className = 'btn btn-ghost btn-sm mt-2';
    addMemberBtn.style.marginLeft = '6px';
    addMemberBtn.textContent = '+ Add Member';
    addMemberBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (area.querySelector('.add-member-form')) return;
      const form = document.createElement('div');
      form.className = 'inline-form add-member-form';

      // Show org members not already in this group
      const groupMemberIds = new Set(groupMembers.map((gm) => gm.userId));
      const available = allMembers.filter((m) => !groupMemberIds.has(m.userId));

      if (available.length === 0) {
        form.innerHTML = '<div class="text-xs text-muted">All org members are already in this group</div>';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn btn-ghost btn-sm mt-1';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          form.remove();
        });
        form.appendChild(closeBtn);
        area.appendChild(form);
        return;
      }

      const select = document.createElement('select');
      select.style.width = '100%';
      select.style.marginBottom = '6px';
      for (const m of available) {
        const opt = document.createElement('option');
        opt.value = m.userId;
        opt.textContent = `${m.displayName || m.email} (${m.email})`;
        select.appendChild(opt);
      }
      form.appendChild(select);

      const actions = document.createElement('div');
      actions.className = 'inline-form-actions';
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary btn-sm';
      addBtn.textContent = 'Add';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-ghost btn-sm';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(addBtn);
      actions.appendChild(cancelBtn);
      form.appendChild(actions);
      area.appendChild(form);

      addBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        addBtn.disabled = true;
        try {
          await api.addGroupMember(org.id, group.id, select.value);
          group.memberCount += 1;
          // Reload expanded
          await loadGroupExpanded(card, org, group, allMembers, rerender);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showInlineError(form, msg);
          addBtn.disabled = false;
        }
      });
      cancelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        form.remove();
      });
    });
    area.appendChild(addMemberBtn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    area.innerHTML = `<div class="text-xs text-muted">Failed to load members: ${escapeHtml(msg)}</div>`;
  }
}

function showCreateGroupForm(
  contentArea: HTMLElement,
  org: Organization,
  groups: GroupResponse[],
  onCreated: () => void
): void {
  if (contentArea.querySelector('.create-group-form')) return;
  const form = document.createElement('div');
  form.className = 'inline-form create-group-form';
  form.innerHTML = `
    <input type="text" placeholder="Group name" class="group-name-input" />
    <div class="inline-form-actions">
      <button class="btn btn-primary btn-sm group-create-submit">Create</button>
      <button class="btn btn-ghost btn-sm group-create-cancel">Cancel</button>
    </div>
  `;
  contentArea.appendChild(form);

  const input = form.querySelector('.group-name-input') as HTMLInputElement;
  input.focus();

  (form.querySelector('.group-create-submit') as HTMLButtonElement).addEventListener(
    'click',
    async () => {
      const name = input.value.trim();
      if (!name) return;
      const btn = form.querySelector('.group-create-submit') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Creating...';
      try {
        const created = await api.createGroup(org.id, { name });
        groups.push({ id: created.id, name: created.name, leaderName: undefined, memberCount: 0, createdAt: created.createdAt });
        form.remove();
        onCreated();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showInlineError(form, msg);
        btn.disabled = false;
        btn.textContent = 'Create';
      }
    }
  );

  (form.querySelector('.group-create-cancel') as HTMLButtonElement).addEventListener('click', () =>
    form.remove()
  );
}

/* ============================================================
   RULES VIEW
   ============================================================ */
async function renderRulesView(contentArea: HTMLElement, org: Organization): Promise<void> {
  const [ruleset, groups] = await Promise.all([
    api.getOrgDefaultRules(org.id).catch(() => null) as Promise<SignoffRuleset | null>,
    api.getOrgGroups(org.id) as Promise<GroupResponse[]>,
  ]);

  let rules: SignoffRule[] = ruleset?.rules ?? [];
  let connectors: ('AND' | 'OR')[] = ruleset?.connectors ?? [];

  contentArea.innerHTML = '';

  const desc = document.createElement('div');
  desc.className = 'text-xs text-muted mb-3';
  desc.textContent = 'Default sign-off requirements for all new documents.';
  contentArea.appendChild(desc);

  const rulesContainer = document.createElement('div');
  contentArea.appendChild(rulesContainer);

  const renderRules = () => {
    rulesContainer.innerHTML = '';

    if (rules.length === 0) {
      rulesContainer.innerHTML = '<div class="text-xs text-muted mb-3">No rules configured yet.</div>';
    }

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;

      // Rule card
      const card = document.createElement('div');
      card.className = 'rule-card mb-1';

      let ruleDesc: string;
      if (rule.minMembers > 0 && rule.requireLeader) {
        ruleDesc = `${rule.minMembers} ${escapeHtml(rule.groupName)} member(s) + leader must sign`;
      } else if (rule.minMembers > 0) {
        ruleDesc = `${rule.minMembers} ${escapeHtml(rule.groupName)} member(s) must sign`;
      } else {
        ruleDesc = `${escapeHtml(rule.groupName)} leader must sign`;
      }

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="text-sm">${ruleDesc}</div>
          <button class="btn btn-ghost btn-sm rule-remove" style="font-size:10px">\u2715</button>
        </div>
      `;

      (card.querySelector('.rule-remove') as HTMLButtonElement).addEventListener('click', () => {
        rules.splice(i, 1);
        // Remove adjacent connector
        if (connectors.length >= i && connectors.length > 0) {
          if (i === 0) {
            connectors.shift();
          } else {
            connectors.splice(i - 1, 1);
          }
        }
        persistRules();
        renderRules();
      });

      rulesContainer.appendChild(card);

      // Connector pill between cards
      if (i < rules.length - 1 && i < connectors.length + 1) {
        const connector = document.createElement('div');
        connector.className = 'rule-connector';
        const connectorType = connectors[i] ?? 'AND';
        connector.innerHTML = `
          <div class="rule-connector-line"></div>
          <span class="rule-connector-pill ${connectorType === 'AND' ? 'rule-connector-and' : 'rule-connector-or'}">${connectorType} \u25BE</span>
        `;
        (connector.querySelector('.rule-connector-pill') as HTMLElement).addEventListener(
          'click',
          () => {
            connectors[i] = connectors[i] === 'AND' ? 'OR' : 'AND';
            persistRules();
            renderRules();
          }
        );
        rulesContainer.appendChild(connector);
      }
    }

    // Summary box
    if (rules.length > 0) {
      const summary = document.createElement('div');
      summary.className = 'rule-summary mt-3';
      summary.innerHTML = `<strong>Summary:</strong> ${escapeHtml(buildRuleSummary(rules, connectors))}`;
      rulesContainer.appendChild(summary);
    }
  };

  const persistRules = async () => {
    try {
      await api.setOrgDefaultRules(org.id, rules, connectors);
    } catch {
      // Silently fail — user will see stale state on next load
    }
  };

  renderRules();

  // "+ Add Rule" button
  const addRuleBtn = document.createElement('button');
  addRuleBtn.className = 'btn btn-ghost btn-sm mt-2';
  addRuleBtn.textContent = '+ Add Rule';
  addRuleBtn.addEventListener('click', () => {
    if (contentArea.querySelector('.add-rule-form')) return;

    const usedGroupIds = new Set(rules.map((r) => r.groupId));
    const available = groups.filter((g) => !usedGroupIds.has(g.id));

    if (available.length === 0) {
      const notice = document.createElement('div');
      notice.className = 'text-xs text-muted mt-2';
      notice.textContent = 'All groups already have rules.';
      contentArea.appendChild(notice);
      setTimeout(() => notice.remove(), 3000);
      return;
    }

    const form = document.createElement('div');
    form.className = 'inline-form add-rule-form';

    // Group select
    const groupSelect = document.createElement('select');
    groupSelect.className = 'form-select';
    groupSelect.style.marginBottom = '6px';
    for (const g of available) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      opt.dataset.groupName = g.name;
      groupSelect.appendChild(opt);
    }
    form.appendChild(groupSelect);

    // Requirement checkboxes
    const checkDiv = document.createElement('div');
    checkDiv.style.cssText = 'margin-bottom:8px;font-size:12px';
    checkDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <input type="checkbox" class="rule-members-check" checked style="width:16px;height:16px;margin:0;flex-shrink:0;" />
        <span>Members:</span>
        <input type="number" min="1" value="1" class="rule-member-count" style="width:44px;padding:4px 6px;text-align:center;background:var(--color-surface-1);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-primary);font-size:12px;flex-shrink:0;" />
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <input type="checkbox" class="rule-leader-check" style="width:16px;height:16px;margin:0;flex-shrink:0;" />
        <span>Require leader</span>
      </div>
      <div class="rule-validation-msg text-xs text-danger" style="display:none;margin-top:4px;">At least one option must be selected</div>
    `;
    form.appendChild(checkDiv);

    const membersCheck = checkDiv.querySelector('.rule-members-check') as HTMLInputElement;
    const leaderCheck = checkDiv.querySelector('.rule-leader-check') as HTMLInputElement;
    const memberCountInput = checkDiv.querySelector('.rule-member-count') as HTMLInputElement;
    const validationMsg = checkDiv.querySelector('.rule-validation-msg') as HTMLElement;

    // Toggle count input enabled state
    membersCheck.addEventListener('change', () => {
      memberCountInput.disabled = !membersCheck.checked;
      validationMsg.style.display = (!membersCheck.checked && !leaderCheck.checked) ? 'block' : 'none';
    });
    leaderCheck.addEventListener('change', () => {
      validationMsg.style.display = (!membersCheck.checked && !leaderCheck.checked) ? 'block' : 'none';
    });

    const actions = document.createElement('div');
    actions.className = 'inline-form-actions';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.textContent = 'Add';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(addBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    contentArea.appendChild(form);

    addBtn.addEventListener('click', async () => {
      if (!membersCheck.checked && !leaderCheck.checked) {
        validationMsg.style.display = 'block';
        return;
      }

      const selectedOpt = groupSelect.selectedOptions[0]!;

      const newRule: SignoffRule = {
        groupId: selectedOpt.value,
        groupName: selectedOpt.dataset.groupName || selectedOpt.textContent || '',
        minMembers: membersCheck.checked ? (parseInt(memberCountInput.value, 10) || 1) : 0,
        requireLeader: leaderCheck.checked,
      };

      if (rules.length > 0) {
        connectors.push('AND');
      }
      rules.push(newRule);
      await persistRules();
      form.remove();
      renderRules();
    });

    cancelBtn.addEventListener('click', () => form.remove());
  });
  contentArea.appendChild(addRuleBtn);
}

/* ============================================================
   Helpers
   ============================================================ */
function buildRuleSummary(rules: SignoffRule[], connectors: ('AND' | 'OR')[]): string {
  const parts: string[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]!;
    if (r.minMembers > 0 && r.requireLeader) {
      parts.push(`${r.minMembers} from ${r.groupName} + leader`);
    } else if (r.minMembers > 0) {
      parts.push(`${r.minMembers} from ${r.groupName}`);
    } else {
      parts.push(`${r.groupName} leader`);
    }
    if (i < rules.length - 1) {
      parts.push(connectors[i] ?? 'AND');
    }
  }
  return parts.join(' ');
}

function renderCollapsibleSection(
  parent: HTMLElement,
  title: string,
  count: number,
  accent: boolean,
  renderBody: (body: HTMLElement) => void
): void {
  let collapsed = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'mb-2';

  const header = document.createElement('div');
  header.className = `collapsible-header ${accent ? 'invite-pending-header' : ''}`;
  header.innerHTML = `
    <span>${title} <span class="collapsible-count ${accent ? 'invite-pending-count' : ''}">${count}</span></span>
    <span class="collapsible-arrow">\u25BE</span>
  `;

  const body = document.createElement('div');
  body.className = 'collapsible-body';
  renderBody(body);

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'block';
    (header.querySelector('.collapsible-arrow') as HTMLElement).textContent = collapsed
      ? '\u25B8'
      : '\u25BE';
  });

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  parent.appendChild(wrapper);
}

function showInlineError(parent: HTMLElement, message: string): void {
  // Remove prior error
  parent.querySelector('.inline-error')?.remove();
  const el = document.createElement('div');
  el.className = 'inline-error text-xs text-danger mt-1';
  el.textContent = message;
  parent.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
