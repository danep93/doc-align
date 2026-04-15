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

export interface TrackedDoc {
  id: string;
  documentId: string;
  userId: string;
  title: string;
  baselineRevisionId: string;
  trackedAt: string;
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

// --- Organization & Groups ---

export type OrgRole = 'admin' | 'director' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
}

export interface Group {
  id: string;
  organizationId: string;
  name: string;
  leaderId?: string;
  createdById: string;
  createdAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  organizationId: string;
  inviterUserId: string;
  inviteeEmail: string;
  role: OrgRole;
  groupId?: string;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
}

export interface OrgMemberResponse {
  userId: string;
  email: string;
  displayName: string;
  role: OrgRole;
  createdAt: string;
}

export interface GroupResponse {
  id: string;
  name: string;
  leaderName?: string;
  memberCount: number;
  createdAt: string;
}

export interface SignoffRule {
  groupId: string;
  groupName: string;
  minMembers: number;
  requireLeader: boolean;
}

export interface SignoffRuleset {
  id: string;
  organizationId: string;
  documentId: string | null;
  rules: SignoffRule[];
  connectors: ('AND' | 'OR')[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgDocument {
  id: string;
  organizationId: string;
  documentId: string;
  title: string;
  addedById: string;
  addedAt: string;
}

export interface RuleStatusEntry {
  groupId: string;
  groupName: string;
  minMembers: number;
  requireLeader: boolean;
  memberSignoffs: { userId: string; name: string; signedAt: string }[];
  leaderSignedOff: boolean;
  fulfilled: boolean;
}

export interface RuleStatus {
  rules: RuleStatusEntry[];
  connectors: ('AND' | 'OR')[];
  allFulfilled: boolean;
}
