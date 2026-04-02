import { DEV_MODE, devApi } from './dev-mode';
import { getIdToken, getCurrentUser } from './auth';
import { deleteSnapshot } from './google-apis';
import { TIER_LIMITS } from '@doc-align/shared';
import type { Signature, SignOff, DocReference, UserProfile, Tier, TrackedDoc, Organization, OrgMemberResponse, OrgRole, Invite, GroupResponse, Group } from '@doc-align/shared';
import { canTrackDocument } from '@doc-align/shared';

const API_BASE = 'http://localhost:8080/api';

export function buildUrl(base: string, path: string): string {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${cleanBase}${path}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('Not authenticated');

  const url = buildUrl(API_BASE, path);
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// --- Local storage API (used when backend is unavailable) ---

async function loadStore<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve((result[key] as T) ?? fallback);
    });
  });
}

async function saveStore<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

async function getLocalUserId(): Promise<string> {
  const user = await getCurrentUser();
  return (user as { uid: string } | null)?.uid || 'unknown';
}

async function getLocalUserEmail(): Promise<string> {
  const user = await getCurrentUser();
  return (user as { email: string | null } | null)?.email || 'unknown';
}

const localApi = {
  getUser: async (): Promise<UserProfile> => {
    const userId = await getLocalUserId();
    const email = await getLocalUserEmail();
    const tierOverride = await loadStore<string | null>('debug_tier_override', null);
    return {
      id: userId,
      email,
      tier: (tierOverride as Tier) || 'free',
      signOffCount: 0,
      signOffCountResetAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      createdAt: new Date().toISOString(),
    };
  },

  getSignatures: async () => {
    const sigs = await loadStore<Signature[]>('local_signatures', []);
    return sigs.filter((s) => s.status === 'active');
  },

  createSignature: async (data: Record<string, unknown>) => {
    const sigs = await loadStore<Signature[]>('local_signatures', []);
    const userId = await getLocalUserId();
    const sig: Signature = {
      id: `sig_${Date.now()}`,
      userId,
      name: data.name as string,
      title: data.title as string | undefined,
      organization: data.organization as string | undefined,
      format: data.format as 'basic' | 'full',
      drawingData: data.drawingData as string,
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    sigs.push(sig);
    await saveStore('local_signatures', sigs);
    return sig;
  },

  retireSignature: async (id: string) => {
    const sigs = await loadStore<Signature[]>('local_signatures', []);
    const sig = sigs.find((s) => s.id === id);
    if (sig) sig.status = 'retired';
    await saveStore('local_signatures', sigs);
    return { success: true };
  },

  getSignOffs: async () => loadStore<SignOff[]>('local_signoffs', []),

  getSignOffsForDoc: async (docId: string) => {
    const signOffs = await loadStore<SignOff[]>('local_signoffs', []);
    const userId = await getLocalUserId();
    return signOffs
      .filter((so) => so.documentId === docId && so.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  getDocuments: async () => loadStore<DocReference[]>('local_docrefs', []),

  createSignOff: async (data: Record<string, unknown>) => {
    const signOffs = await loadStore<SignOff[]>('local_signoffs', []);
    const docRefs = await loadStore<DocReference[]>('local_docrefs', []);
    const counter = await loadStore<number>('local_signoff_counter', 0);
    const userId = await getLocalUserId();

    // Determine tier and max checkpoints
    const userProfile = await localApi.getUser();
    const tier = userProfile.tier as Tier;
    const maxCheckpoints = TIER_LIMITS[tier].maxCheckpointsPerDoc;
    const docId = data.documentId as string;

    // Get existing sign-offs for this doc by this user, sorted oldest first
    const existingForDoc = signOffs
      .filter((so) => so.documentId === docId && so.userId === userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Prune: if at or over limit, remove oldest until we have room for 1 new one
    const toRemove: SignOff[] = [];
    while (existingForDoc.length >= maxCheckpoints) {
      const oldest = existingForDoc.shift()!;
      toRemove.push(oldest);
    }

    // Remove pruned sign-offs and their snapshots
    const removeIds = new Set(toRemove.map((so) => so.id));
    const filteredSignOffs = signOffs.filter((so) => !removeIds.has(so.id));
    for (const removed of toRemove) {
      await deleteSnapshot(removed.documentId, removed.revisionId);
    }

    const so: SignOff = {
      id: `so_${counter + 1}`,
      userId,
      signatureId: data.signatureId as string,
      documentId: docId,
      revisionId: data.revisionId as string,
      imageHash: data.imageHash as string,
      createdAt: new Date().toISOString(),
    };
    filteredSignOffs.push(so);

    const existingIdx = docRefs.findIndex((d) => d.id === so.documentId);
    const ref: DocReference = {
      id: so.documentId,
      userId,
      title: (data.documentTitle as string) || 'Untitled Document',
      lastKnownRevisionId: so.revisionId,
      updatedAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      docRefs[existingIdx] = ref;
    } else {
      docRefs.push(ref);
    }

    await saveStore('local_signoffs', filteredSignOffs);
    await saveStore('local_docrefs', docRefs);
    await saveStore('local_signoff_counter', counter + 1);
    return so;
  },

  deleteSignOff: async (signOffId: string) => {
    const signOffs = await loadStore<SignOff[]>('local_signoffs', []);
    const toDelete = signOffs.find((so) => so.id === signOffId);
    if (toDelete) {
      await deleteSnapshot(toDelete.documentId, toDelete.revisionId);
    }
    const filtered = signOffs.filter((so) => so.id !== signOffId);
    await saveStore('local_signoffs', filtered);
    return { success: true };
  },

  getCoSigners: async (_docId: string, _revId: string) => ({
    count: 1,
    userIds: [] as string[],
  }),

  createCheckout: async (_plan: string) => ({
    url: 'https://example.com/checkout-not-available',
  }),

  getTrackedDocs: async (): Promise<TrackedDoc[]> => {
    const docs = await loadStore<TrackedDoc[]>('local_tracked_docs', []);
    const userId = await getLocalUserId();
    return docs.filter((d) => d.userId === userId);
  },

  trackDoc: async (data: { documentId: string; title: string; baselineRevisionId: string }): Promise<TrackedDoc> => {
    const docs = await loadStore<TrackedDoc[]>('local_tracked_docs', []);
    const userId = await getLocalUserId();
    const userDocs = docs.filter((d) => d.userId === userId);
    const userProfile = await localApi.getUser();
    const tier = userProfile.tier as Tier;

    if (!canTrackDocument(tier, userDocs.length)) {
      throw new Error('Tracking limit reached');
    }

    // Remove existing tracking for this doc (if re-tracking)
    const filtered = docs.filter((d) => !(d.documentId === data.documentId && d.userId === userId));

    const tracked: TrackedDoc = {
      id: `td_${Date.now()}`,
      documentId: data.documentId,
      userId,
      title: data.title,
      baselineRevisionId: data.baselineRevisionId,
      trackedAt: new Date().toISOString(),
    };
    filtered.push(tracked);
    await saveStore('local_tracked_docs', filtered);
    return tracked;
  },

  untrackDoc: async (docId: string): Promise<{ success: boolean }> => {
    const docs = await loadStore<TrackedDoc[]>('local_tracked_docs', []);
    const userId = await getLocalUserId();
    const toRemove = docs.find((d) => d.documentId === docId && d.userId === userId);
    if (toRemove) {
      await deleteSnapshot(toRemove.documentId, toRemove.baselineRevisionId);
    }
    const filtered = docs.filter((d) => !(d.documentId === docId && d.userId === userId));
    await saveStore('local_tracked_docs', filtered);
    return { success: true };
  },

  isDocTracked: async (docId: string): Promise<boolean> => {
    const docs = await loadStore<TrackedDoc[]>('local_tracked_docs', []);
    const userId = await getLocalUserId();
    return docs.some((d) => d.documentId === docId && d.userId === userId);
  },

  // Organizations & Groups — not available in local mode
  getMyOrgs: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  createOrganization: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  getOrganization: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  updateOrganization: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  getOrgMembers: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  searchOrgMembers: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  changeOrgMemberRole: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  removeOrgMember: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  leaveOrganization: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  createInvite: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  getOrgInvites: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  revokeInvite: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  getMyPendingInvites: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  acceptInvite: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  declineInvite: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  getOrgGroups: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  createGroup: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  updateGroup: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  deleteGroup: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  getGroupMembers: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  addGroupMember: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  removeGroupMember: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
  leaveGroup: async (): Promise<never> => { throw new Error('Groups require backend connection'); },
};

// --- Backend API with local fallback ---

async function isBackendAvailable(): Promise<boolean> {
  try {
    const res = await fetch(buildUrl(API_BASE, '/health'), { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

let backendAvailable: boolean | null = null;

async function getApi() {
  if (backendAvailable === null) {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.log('[doc-align] Backend unavailable, using local storage');
    }
  }
  return backendAvailable ? realApi : localApi;
}

const realApi = {
  getUser: () => request('/users/me'),
  getSignatures: () => request('/signatures'),
  createSignature: (data: object) =>
    request('/signatures', { method: 'POST', body: JSON.stringify(data) }),
  retireSignature: (id: string) =>
    request(`/signatures/${id}/retire`, { method: 'POST' }),
  getSignOffs: () => request('/signoffs'),
  getSignOffsForDoc: (docId: string) =>
    request(`/signoffs/document/${docId}`),
  getDocuments: () => request('/signoffs/documents'),
  createSignOff: (data: object) =>
    request('/signoffs', { method: 'POST', body: JSON.stringify(data) }),
  deleteSignOff: (signOffId: string) =>
    request(`/signoffs/${signOffId}`, { method: 'DELETE' }),
  getCoSigners: (docId: string, revId: string) =>
    request(`/signoffs/co-signers/${docId}/${revId}`),
  createCheckout: (plan: string) =>
    request('/subscriptions/checkout', { method: 'POST', body: JSON.stringify({ plan }) }),
  getTrackedDocs: () => request<TrackedDoc[]>('/tracked-docs'),
  trackDoc: (data: { documentId: string; title: string; baselineRevisionId: string }) =>
    request<TrackedDoc>('/tracked-docs', { method: 'POST', body: JSON.stringify(data) }),
  untrackDoc: (docId: string) =>
    request<{ success: boolean }>(`/tracked-docs/${docId}`, { method: 'DELETE' }),
  isDocTracked: async (docId: string) => {
    const result = await request<{ tracked: boolean }>(`/tracked-docs/${docId}/status`);
    return result.tracked;
  },

  // Organizations
  getMyOrgs: () => request<Organization[]>('/organizations/me'),
  createOrganization: (data: { name: string }) =>
    request<Organization>('/organizations', { method: 'POST', body: JSON.stringify(data) }),
  getOrganization: (orgId: string) => request<Organization>(`/organizations/${orgId}`),
  updateOrganization: (orgId: string, data: { name?: string }) =>
    request<void>(`/organizations/${orgId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getOrgMembers: (orgId: string) => request<OrgMemberResponse[]>(`/organizations/${orgId}/members`),
  searchOrgMembers: (orgId: string, email: string) =>
    request<OrgMemberResponse[]>(`/organizations/${orgId}/members/search?email=${encodeURIComponent(email)}`),
  changeOrgMemberRole: (orgId: string, userId: string, role: OrgRole) =>
    request<void>(`/organizations/${orgId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeOrgMember: (orgId: string, userId: string) =>
    request<void>(`/organizations/${orgId}/members/${userId}`, { method: 'DELETE' }),
  leaveOrganization: (orgId: string) =>
    request<void>(`/organizations/${orgId}/members/me/leave`, { method: 'POST' }),
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
};

// Proxy that resolves the backend on first call
const proxyApi = {
  getUser: async () => (await getApi()).getUser(),
  getSignatures: async () => (await getApi()).getSignatures(),
  createSignature: async (data: object) => (await getApi()).createSignature(data as Record<string, unknown>),
  retireSignature: async (id: string) => (await getApi()).retireSignature(id),
  getSignOffs: async () => (await getApi()).getSignOffs(),
  getSignOffsForDoc: async (docId: string) => (await getApi()).getSignOffsForDoc(docId),
  getDocuments: async () => (await getApi()).getDocuments(),
  createSignOff: async (data: object) => (await getApi()).createSignOff(data as Record<string, unknown>),
  deleteSignOff: async (signOffId: string) => (await getApi()).deleteSignOff(signOffId),
  getCoSigners: async (docId: string, revId: string) => (await getApi()).getCoSigners(docId, revId),
  createCheckout: async (plan: string) => (await getApi()).createCheckout(plan),
  getTrackedDocs: async () => (await getApi()).getTrackedDocs(),
  trackDoc: async (data: { documentId: string; title: string; baselineRevisionId: string }) => (await getApi()).trackDoc(data),
  untrackDoc: async (docId: string) => (await getApi()).untrackDoc(docId),
  isDocTracked: async (docId: string) => (await getApi()).isDocTracked(docId),

  // Organizations
  getMyOrgs: async () => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.getMyOrgs();
  },
  createOrganization: async (data: { name: string }) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.createOrganization(data);
  },
  getOrganization: async (orgId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.getOrganization(orgId);
  },
  updateOrganization: async (orgId: string, data: { name?: string }) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.updateOrganization(orgId, data);
  },
  getOrgMembers: async (orgId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.getOrgMembers(orgId);
  },
  searchOrgMembers: async (orgId: string, email: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.searchOrgMembers(orgId, email);
  },
  changeOrgMemberRole: async (orgId: string, userId: string, role: OrgRole) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.changeOrgMemberRole(orgId, userId, role);
  },
  removeOrgMember: async (orgId: string, userId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.removeOrgMember(orgId, userId);
  },
  leaveOrganization: async (orgId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.leaveOrganization(orgId);
  },
  createInvite: async (orgId: string, data: { email: string; role: OrgRole; groupId?: string }) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.createInvite(orgId, data);
  },
  getOrgInvites: async (orgId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.getOrgInvites(orgId);
  },
  revokeInvite: async (orgId: string, inviteId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.revokeInvite(orgId, inviteId);
  },
  getMyPendingInvites: async () => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.getMyPendingInvites();
  },
  acceptInvite: async (inviteId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.acceptInvite(inviteId);
  },
  declineInvite: async (inviteId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.declineInvite(inviteId);
  },
  getOrgGroups: async (orgId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.getOrgGroups(orgId);
  },
  createGroup: async (orgId: string, data: { name: string; directorId?: string; managerId?: string }) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.createGroup(orgId, data);
  },
  updateGroup: async (orgId: string, groupId: string, data: { name?: string; directorId?: string; managerId?: string }) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.updateGroup(orgId, groupId, data);
  },
  deleteGroup: async (orgId: string, groupId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.deleteGroup(orgId, groupId);
  },
  getGroupMembers: async (orgId: string, groupId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.getGroupMembers(orgId, groupId);
  },
  addGroupMember: async (orgId: string, groupId: string, userId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.addGroupMember(orgId, groupId, userId);
  },
  removeGroupMember: async (orgId: string, groupId: string, userId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.removeGroupMember(orgId, groupId, userId);
  },
  leaveGroup: async (orgId: string, groupId: string) => {
    const a = await getApi();
    if (a === localApi) throw new Error('Groups require backend connection');
    return a.leaveGroup(orgId, groupId);
  },
};

export const api = DEV_MODE ? devApi : proxyApi;
