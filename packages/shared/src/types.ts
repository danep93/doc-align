export type Tier = 'free' | 'pro' | 'enterprise';
export type SignatureFormat = 'basic' | 'full';
export type SignatureStatus = 'active' | 'retired';

export interface Signature {
  id: string;
  userId: string;
  name: string;
  title?: string;
  organization?: string;
  format: SignatureFormat;
  drawingData: string;
  createdAt: string;
  status: SignatureStatus;
}

export interface SignOff {
  id: string;
  userId: string;
  signatureId: string;
  documentId: string;
  revisionId: string;
  imageHash: string;
  createdAt: string;
}

export interface DocReference {
  id: string;
  userId: string;
  title: string;
  lastKnownRevisionId: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  tier: Tier;
  stripeCustomerId?: string;
  signOffCount: number;
  signOffCountResetAt: string;
  createdAt: string;
}

export interface SignOffWithSigner {
  signOff: SignOff;
  signerName: string;
}

export interface DocSignOffSummary {
  documentId: string;
  title: string;
  mySignOffDate: string;
  myRevisionId: string;
  totalSignOffsOnRevision: number;
  signerNames: string[];
  hasChanged: boolean;
}
