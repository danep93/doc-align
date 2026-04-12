import { api } from '../../lib/api';
import type { Organization, GroupResponse, Invite, OrgRole } from '@doc-align/shared';

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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
    if (msg.toLowerCase().includes('require backend') || msg.toLowerCase().includes('backend connection')) {
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

  // Render pending invites at top
  if (invites.length > 0) {
    const invitesSection = document.createElement('div');
    invitesSection.className = 'mb-3';

    const invitesHeader = document.createElement('div');
    invitesHeader.className = 'org-header';
    invitesHeader.style.fontSize = '13px';
    invitesHeader.textContent = 'Pending Invites';
    invitesSection.appendChild(invitesHeader);

    for (const invite of invites) {
      const card = renderInviteCard(invite, container);
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

    document.getElementById('groups-create-org')?.addEventListener('click', async () => {
      const name = prompt('Organization name:');
      if (!name || !name.trim()) return;
      try {
        await api.createOrganization({ name: name.trim() });
        renderGroupsView(container);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Failed to create organization: ${msg}`);
      }
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

    document.getElementById('groups-create-org')?.addEventListener('click', async () => {
      const name = prompt('Organization name:');
      if (!name || !name.trim()) return;
      try {
        await api.createOrganization({ name: name.trim() });
        renderGroupsView(container);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Failed to create organization: ${msg}`);
      }
    });
    return;
  }

  // Render org view (use first org)
  const org = orgs[0]!;
  await renderOrgView(container, org);
}

function renderInviteCard(invite: Invite, rootContainer: HTMLElement): HTMLElement {
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
      alert(`Failed to accept invite: ${msg}`);
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
      alert(`Failed to decline invite: ${msg}`);
      declineBtn.disabled = false;
      declineBtn.textContent = 'Decline';
    }
  });

  return card;
}

async function renderOrgView(container: HTMLElement, org: Organization): Promise<void> {
  const header = document.createElement('div');
  header.className = 'org-header';
  header.textContent = org.name;
  container.appendChild(header);

  // Admin actions
  const actions = document.createElement('div');
  actions.className = 'org-actions';
  actions.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="groups-invite-member">Invite to Org</button>
    <button class="btn btn-ghost btn-sm" id="groups-create-group">Create Group</button>
  `;
  container.appendChild(actions);

  document.getElementById('groups-invite-member')?.addEventListener('click', async () => {
    const email = prompt('Email address to invite:');
    if (!email || !email.trim()) return;

    const roleInput = prompt('Role (admin, director, or member):');
    if (!roleInput) return;
    const role = roleInput.trim().toLowerCase();
    if (role !== 'admin' && role !== 'director' && role !== 'member') {
      alert('Role must be admin, director, or member.');
      return;
    }

    try {
      await api.createInvite(org.id, { email: email.trim(), role: role as OrgRole });
      alert('Invite sent!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to send invite: ${msg}`);
    }
  });

  document.getElementById('groups-create-group')?.addEventListener('click', async () => {
    const name = prompt('Group name:');
    if (!name || !name.trim()) return;
    try {
      await api.createGroup(org.id, { name: name.trim() });
      renderGroupsView(container);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to create group: ${msg}`);
    }
  });

  // Open full view button
  const openTabBtn = document.createElement('button');
  openTabBtn.className = 'btn btn-ghost docs-open-tab-btn';
  openTabBtn.textContent = 'Open full view';
  openTabBtn.addEventListener('click', () => {
    const extUrl = chrome.runtime.getURL('popup/popup.html?view=groups');
    chrome.tabs.create({ url: extUrl });
  });
  container.appendChild(openTabBtn);

  // Load and render groups
  let groups: GroupResponse[] = [];
  try {
    groups = (await api.getOrgGroups(org.id)) as GroupResponse[];
  } catch {
    const errMsg = document.createElement('div');
    errMsg.className = 'text-sm text-muted';
    errMsg.textContent = 'Failed to load groups.';
    container.appendChild(errMsg);
    return;
  }

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.minHeight = '120px';
    empty.innerHTML = `
      <div class="empty-state-title">No groups yet</div>
      <div class="empty-state-subtitle">Create a group to organize your team members.</div>
    `;
    container.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const card = document.createElement('div');
    card.className = 'group-card';

    let metaParts: string[] = [];
    if (group.leaderName) {
      metaParts.push(`Leader: ${escapeHtml(group.leaderName)}`);
    }
    metaParts.push(`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`);

    card.innerHTML = `
      <div class="group-card-name">${escapeHtml(group.name)}</div>
      <div class="group-card-meta">${metaParts.join(' &middot; ')}</div>
    `;
    container.appendChild(card);
  }
}
