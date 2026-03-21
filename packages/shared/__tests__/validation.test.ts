import { describe, it, expect } from 'vitest';
import {
  SignatureSchema,
  SignOffSchema,
  DocReferenceSchema,
  UserProfileSchema,
} from '../src/validation';

describe('SignatureSchema', () => {
  it('validates a basic signature', () => {
    const result = SignatureSchema.safeParse({
      id: 'sig_1',
      userId: 'user_1',
      name: 'Jane Doe',
      format: 'basic',
      drawingData: 'data:image/png;base64,abc123',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('validates a full signature with title and org', () => {
    const result = SignatureSchema.safeParse({
      id: 'sig_2',
      userId: 'user_1',
      name: 'Jane Doe',
      title: 'Engineering Lead',
      organization: 'Acme Corp',
      format: 'full',
      drawingData: 'data:image/png;base64,abc123',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('rejects signature without name', () => {
    const result = SignatureSchema.safeParse({
      id: 'sig_1',
      userId: 'user_1',
      format: 'basic',
      drawingData: 'data:image/png;base64,abc123',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid format', () => {
    const result = SignatureSchema.safeParse({
      id: 'sig_1',
      userId: 'user_1',
      name: 'Jane',
      format: 'unknown',
      drawingData: 'data:image/png;base64,abc123',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    expect(result.success).toBe(false);
  });
});

describe('SignOffSchema', () => {
  it('validates a sign-off record', () => {
    const result = SignOffSchema.safeParse({
      id: 'so_1',
      userId: 'user_1',
      signatureId: 'sig_1',
      documentId: 'doc_abc123',
      revisionId: 'rev_42',
      imageHash: 'sha256_hash_here',
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects sign-off without documentId', () => {
    const result = SignOffSchema.safeParse({
      id: 'so_1',
      userId: 'user_1',
      signatureId: 'sig_1',
      revisionId: 'rev_42',
      imageHash: 'sha256_hash_here',
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe('DocReferenceSchema', () => {
  it('validates a doc reference', () => {
    const result = DocReferenceSchema.safeParse({
      id: 'doc_abc123',
      userId: 'user_1',
      title: 'Product Requirements Doc',
      lastKnownRevisionId: 'rev_42',
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe('UserProfileSchema', () => {
  it('validates a free tier user', () => {
    const result = UserProfileSchema.safeParse({
      id: 'user_1',
      email: 'jane@example.com',
      tier: 'free',
      signOffCount: 3,
      signOffCountResetAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('validates a pro user with stripe ID', () => {
    const result = UserProfileSchema.safeParse({
      id: 'user_1',
      email: 'jane@example.com',
      tier: 'pro',
      stripeCustomerId: 'cus_abc123',
      signOffCount: 0,
      signOffCountResetAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid tier', () => {
    const result = UserProfileSchema.safeParse({
      id: 'user_1',
      email: 'jane@example.com',
      tier: 'platinum',
      signOffCount: 0,
      signOffCountResetAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
