// Dev mode: set to true to bypass Firebase auth and use in-memory API stubs
export const DEV_MODE = true;

import type { Signature, SignOff, DocReference, UserProfile } from '@doc-align/shared';

// In-memory stores
const signatures: Signature[] = [];
const signOffs: SignOff[] = [];
const docRefs: DocReference[] = [];

let signOffCounter = 0;

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

export const devApi = {
  getUser: async () => devUser,

  getSignatures: async () => signatures.filter((s) => s.status === 'active'),

  createSignature: async (data: Record<string, unknown>) => {
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
    signatures.push(sig);
    return sig;
  },

  retireSignature: async (id: string) => {
    const sig = signatures.find((s) => s.id === id);
    if (sig) sig.status = 'retired';
    return { success: true };
  },

  getSignOffs: async () => signOffs,

  getDocuments: async () => docRefs,

  createSignOff: async (data: Record<string, unknown>) => {
    const so: SignOff = {
      id: `so_${++signOffCounter}`,
      userId: devUser.id,
      signatureId: data.signatureId as string,
      documentId: data.documentId as string,
      revisionId: data.revisionId as string,
      imageHash: data.imageHash as string,
      createdAt: new Date().toISOString(),
    };
    signOffs.push(so);

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

    devUser.signOffCount++;
    return so;
  },

  getCoSigners: async (_docId: string, _revId: string) => ({
    count: 1,
    userIds: [devUser.id],
  }),

  createCheckout: async (_plan: string) => ({
    url: 'https://example.com/checkout-disabled-in-dev-mode',
  }),
};
