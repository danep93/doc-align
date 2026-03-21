import { z } from 'zod';

export const SignatureSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
  organization: z.string().optional(),
  format: z.enum(['basic', 'full']),
  drawingData: z.string().min(1),
  createdAt: z.string(),
  status: z.enum(['active', 'retired']),
});

export const CreateSignatureSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  organization: z.string().optional(),
  format: z.enum(['basic', 'full']),
  drawingData: z.string().min(1),
});

export const SignOffSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  signatureId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  imageHash: z.string().min(1),
  createdAt: z.string(),
});

export const CreateSignOffSchema = z.object({
  signatureId: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  imageHash: z.string().min(1),
  documentTitle: z.string().min(1),
});

export const DocReferenceSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(1),
  lastKnownRevisionId: z.string().min(1),
  updatedAt: z.string(),
});

export const UserProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  tier: z.enum(['free', 'pro', 'enterprise']),
  stripeCustomerId: z.string().optional(),
  signOffCount: z.number().int().min(0),
  signOffCountResetAt: z.string(),
  createdAt: z.string(),
});
