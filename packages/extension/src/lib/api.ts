import { DEV_MODE, devApi } from './dev-mode';
import { getIdToken, getCurrentUser } from './auth';
import { deleteSnapshot } from './google-apis';
import { TIER_LIMITS } from '@doc-align/shared';
import type { Signature, SignOff, DocReference, UserProfile, Tier } from '@doc-align/shared';

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
};

export const api = DEV_MODE ? devApi : proxyApi;
