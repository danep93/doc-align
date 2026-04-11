// Dev mode: bypasses Firebase auth and uses local storage stubs for everything.
// E2E mode: uses real Firebase auth + real backend API, but stubs Google Drive/Docs APIs
//           (since chrome.identity OAuth isn't available in Playwright's Chromium).
// Set via E2E_MODE=true or DEV_MODE_FLAG=true environment variables at build time.
declare const __E2E_MODE__: boolean;
declare const __DEV_MODE_FLAG__: boolean;
export const DEV_MODE = typeof __DEV_MODE_FLAG__ !== 'undefined' ? __DEV_MODE_FLAG__ : false;
export const E2E_MODE = typeof __E2E_MODE__ !== 'undefined' ? __E2E_MODE__ : false;
// Stub Google APIs in both dev and E2E mode (chrome.identity unavailable in both)
export const STUB_GOOGLE_APIS = DEV_MODE || E2E_MODE;

import type { Signature, SignOff, DocReference, UserProfile, TrackedDoc, Tier } from '@doc-align/shared';
import { TIER_LIMITS, canTrackDocument } from '@doc-align/shared';

const devUser: UserProfile = {
  id: 'dev-user-1',
  email: 'dev@doc-align.local',
  tier: 'pro',
  signOffCount: 3,
  signOffCountResetAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  createdAt: new Date().toISOString(),
};

// Fake user object that matches the shape popup.ts expects
export const devFakeUser = {
  uid: devUser.id,
  email: devUser.email,
  displayName: 'Dev User',
  getIdToken: async () => 'dev-token',
};

// --- chrome.storage.local helpers for persistence across popup opens ---

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

export const devApi = {
  getUser: async () => devUser,

  getSignatures: async () => {
    const sigs = await loadStore<Signature[]>('dev_signatures', []);
    return sigs.filter((s) => s.status === 'active');
  },

  createSignature: async (data: Record<string, unknown>) => {
    const sigs = await loadStore<Signature[]>('dev_signatures', []);
    const sig: Signature = {
      id: `sig_${Date.now()}`,
      userId: devUser.id,
      name: data.name as string,
      title: data.title as string | undefined,
      organization: data.organization as string | undefined,
      format: data.format as 'basic' | 'full',
      drawingData: data.drawingData as string,
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    sigs.push(sig);
    await saveStore('dev_signatures', sigs);
    return sig;
  },

  retireSignature: async (id: string) => {
    const sigs = await loadStore<Signature[]>('dev_signatures', []);
    const sig = sigs.find((s) => s.id === id);
    if (sig) sig.status = 'retired';
    await saveStore('dev_signatures', sigs);
    return { success: true };
  },

  getSignOffs: async () => loadStore<SignOff[]>('dev_signoffs', []),

  getSignOffsForDoc: async (docId: string) => {
    const signOffs = await loadStore<SignOff[]>('dev_signoffs', []);
    return signOffs
      .filter((so) => so.documentId === docId && so.userId === devUser.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  getDocuments: async () => loadStore<DocReference[]>('dev_docrefs', []),

  createSignOff: async (data: Record<string, unknown>) => {
    const signOffs = await loadStore<SignOff[]>('dev_signoffs', []);
    const docRefs = await loadStore<DocReference[]>('dev_docrefs', []);
    const counter = await loadStore<number>('dev_signoff_counter', 0);

    const tier = devUser.tier;
    const maxCheckpoints = TIER_LIMITS[tier].maxCheckpointsPerDoc;
    const docId = data.documentId as string;

    // Get existing sign-offs for this doc, sorted oldest first
    const existingForDoc = signOffs
      .filter((so) => so.documentId === docId && so.userId === devUser.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Prune oldest if at or over limit
    const toRemoveIds = new Set<string>();
    while (existingForDoc.length >= maxCheckpoints) {
      const oldest = existingForDoc.shift()!;
      toRemoveIds.add(oldest.id);
      // Remove snapshot
      const snapshotKey = `snapshot_${oldest.documentId}_${oldest.revisionId}`;
      await new Promise<void>((resolve) => chrome.storage.local.remove(snapshotKey, resolve));
    }
    const filteredSignOffs = signOffs.filter((so) => !toRemoveIds.has(so.id));

    const so: SignOff = {
      id: `so_${counter + 1}`,
      userId: devUser.id,
      signatureId: data.signatureId as string,
      documentId: docId,
      revisionId: data.revisionId as string,
      imageHash: data.imageHash as string,
      createdAt: new Date().toISOString(),
    };
    filteredSignOffs.push(so);

    // Upsert doc reference
    const existingIdx = docRefs.findIndex((d) => d.id === so.documentId);
    const ref: DocReference = {
      id: so.documentId,
      userId: devUser.id,
      title: (data.documentTitle as string) || 'Untitled Document',
      lastKnownRevisionId: so.revisionId,
      updatedAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      docRefs[existingIdx] = ref;
    } else {
      docRefs.push(ref);
    }

    await saveStore('dev_signoffs', filteredSignOffs);
    await saveStore('dev_docrefs', docRefs);
    await saveStore('dev_signoff_counter', counter + 1);
    return so;
  },

  deleteSignOff: async (signOffId: string) => {
    const signOffs = await loadStore<SignOff[]>('dev_signoffs', []);
    const toDelete = signOffs.find((so) => so.id === signOffId);
    if (toDelete) {
      const snapshotKey = `snapshot_${toDelete.documentId}_${toDelete.revisionId}`;
      await new Promise<void>((resolve) => chrome.storage.local.remove(snapshotKey, resolve));
    }
    const filtered = signOffs.filter((so) => so.id !== signOffId);
    await saveStore('dev_signoffs', filtered);
    return { success: true };
  },

  getCoSigners: async (_docId: string, _revId: string) => ({
    count: 1,
    userIds: [devUser.id],
  }),

  createCheckout: async (_plan: string) => ({
    url: 'https://example.com/checkout-disabled-in-dev-mode',
  }),

  getTrackedDocs: async (): Promise<TrackedDoc[]> => {
    const docs = await loadStore<TrackedDoc[]>('dev_tracked_docs', []);
    return docs.filter((d) => d.userId === devUser.id);
  },

  trackDoc: async (data: { documentId: string; title: string; baselineRevisionId: string }): Promise<TrackedDoc> => {
    const docs = await loadStore<TrackedDoc[]>('dev_tracked_docs', []);
    const userDocs = docs.filter((d) => d.userId === devUser.id);
    const tier = devUser.tier as Tier;

    if (!canTrackDocument(tier, userDocs.length)) {
      throw new Error('Tracking limit reached');
    }

    // Remove existing tracking for this doc (if re-tracking)
    const filtered = docs.filter((d) => !(d.documentId === data.documentId && d.userId === devUser.id));

    const tracked: TrackedDoc = {
      id: `td_${Date.now()}`,
      documentId: data.documentId,
      userId: devUser.id,
      title: data.title,
      baselineRevisionId: data.baselineRevisionId,
      trackedAt: new Date().toISOString(),
    };
    filtered.push(tracked);
    await saveStore('dev_tracked_docs', filtered);
    return tracked;
  },

  untrackDoc: async (docId: string): Promise<{ success: boolean }> => {
    const docs = await loadStore<TrackedDoc[]>('dev_tracked_docs', []);
    const toRemove = docs.find((d) => d.documentId === docId && d.userId === devUser.id);
    if (toRemove) {
      const snapshotKey = `snapshot_${toRemove.documentId}_${toRemove.baselineRevisionId}`;
      await new Promise<void>((resolve) => chrome.storage.local.remove(snapshotKey, resolve));
    }
    const filtered = docs.filter((d) => !(d.documentId === docId && d.userId === devUser.id));
    await saveStore('dev_tracked_docs', filtered);
    return { success: true };
  },

  isDocTracked: async (docId: string): Promise<boolean> => {
    const docs = await loadStore<TrackedDoc[]>('dev_tracked_docs', []);
    return docs.some((d) => d.documentId === docId && d.userId === devUser.id);
  },

  // Organizations & Groups — require backend
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
