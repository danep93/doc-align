# doc-align MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that lets users sign off on Google Docs with a hand-drawn signature, track all signed-off documents, and view diffs when documents change after sign-off.

**Architecture:** TypeScript monorepo (pnpm workspaces) with three packages: shared types/validation, a serverless Express backend (Cloud Functions + Firestore), and a Manifest V3 Chrome extension. The extension handles all doc content operations client-side; the backend stores only signature metadata, sign-off records, and subscription data.

**Tech Stack:** TypeScript, pnpm workspaces, webpack, Manifest V3, Firebase Auth, Firestore, Cloud Functions, Express, Stripe, Zod, diff-match-patch, vitest

**Spec:** `docs/superpowers/specs/2026-03-21-doc-align-design.md`

---

## File Structure

```
doc-align/
├── package.json                          # Root: pnpm scripts (build-all, test-all, typecheck, clean)
├── pnpm-workspace.yaml                   # packages/*
├── tsconfig.base.json                    # Shared TS config (ES2022, strict)
├── .gitignore
├── packages/
│   ├── shared/
│   │   ├── package.json                  # @doc-align/shared, vitest
│   │   ├── tsconfig.json                 # Extends base
│   │   └── src/
│   │       ├── index.ts                  # Re-exports all public API
│   │       ├── types.ts                  # Signature, SignOff, DocReference, UserProfile, Tier
│   │       ├── validation.ts             # Zod schemas for all types
│   │       ├── tiers.ts                  # TIER_LIMITS config, feature gating logic
│   │       └── constants.ts              # Shared constants (tier names, limits, defaults)
│   ├── backend/
│   │   ├── package.json                  # @doc-align/backend, express, firebase-admin, stripe
│   │   ├── tsconfig.json                 # Extends base
│   │   └── src/
│   │       ├── index.ts                  # Express app setup, routes, CORS, helmet
│   │       ├── config/
│   │       │   ├── firebase.ts           # Firebase Admin SDK init (Firestore + Auth)
│   │       │   └── stripe.ts             # Stripe client init
│   │       ├── middleware/
│   │       │   ├── auth.ts               # Verify Firebase Auth token, attach userId to req
│   │       │   └── tier.ts               # Check user tier, enforce feature/quota limits
│   │       ├── routes/
│   │       │   ├── signatures.ts         # CRUD for signature templates
│   │       │   ├── signoffs.ts           # Create sign-off, list sign-offs, co-signer counts
│   │       │   ├── users.ts              # Get/create user profile
│   │       │   └── subscriptions.ts      # Stripe checkout, webhook, portal
│   │       └── services/
│   │           ├── signatureService.ts   # Firestore ops for signatures collection
│   │           ├── signoffService.ts     # Firestore ops for signoffs collection + aggregation
│   │           └── userService.ts        # Firestore ops for users collection + quota tracking
│   └── extension/
│       ├── package.json                  # @doc-align/extension, webpack, ts-loader, @types/chrome
│       ├── tsconfig.json                 # Extends base, adds DOM lib + chrome types
│       ├── webpack.config.js             # Entry points: background, popup, content, sidebar
│       ├── manifest.json                 # Manifest V3, permissions, content scripts, OAuth
│       └── src/
│           ├── background.ts             # Service worker: auth state, message routing
│           ├── lib/
│           │   ├── api.ts                # Backend API client (fetch wrapper with auth token)
│           │   ├── auth.ts               # Firebase Auth (Google sign-in, token management)
│           │   ├── google-apis.ts        # Google Drive/Docs API calls (revisions, doc metadata)
│           │   ├── signature-canvas.ts   # Freehand drawing canvas (draw, clear, undo, export PNG)
│           │   ├── signature-renderer.ts # Composite signature image (drawing + name + date + title)
│           │   ├── diff-engine.ts        # diff-match-patch wrapper, fetch revisions, compute diff
│           │   └── theme.ts              # Theme manager (dark/light, system preference, CSS vars)
│           ├── popup/
│           │   ├── popup.html            # Shell HTML with tab structure
│           │   ├── popup.ts              # Tab routing, auth gate, event wiring
│           │   ├── popup.css             # All popup styles (CSS vars for theming)
│           │   ├── views/
│           │   │   ├── sign-off.ts       # Sign-off tab: signature preview, sign-off button
│           │   │   ├── documents.ts      # My Documents tab: doc list with status
│           │   │   └── settings.ts       # Settings tab: signature mgmt, theme, account
│           │   └── components/
│           │       ├── doc-card.ts        # Single document card (title, date, status, co-signers)
│           │       ├── signature-card.ts  # Signature template card (preview, actions)
│           │       ├── diff-viewer.ts     # Inline/side-by-side diff rendering
│           │       └── create-signature-modal.ts # Drawing canvas + fields + preview
│           ├── content/
│           │   ├── content.ts            # Content script: signature insertion, hover detection
│           │   └── content.css           # Tooltip styles, signature hover card
│           └── sidebar/
│               ├── sidebar.html          # Sidebar shell for diff viewer
│               ├── sidebar.ts            # Sidebar logic
│               └── sidebar.css           # Sidebar styles
```

---

## Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/extension/package.json`
- Create: `packages/extension/tsconfig.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "doc-align",
  "version": "0.1.0",
  "private": true,
  "description": "Sign-off and alignment platform for Google Docs",
  "scripts": {
    "build-all": "pnpm -r run build",
    "test-all": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "clean": "pnpm -r run clean"
  },
  "engines": {
    "node": ">=18",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.15.4"
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "exclude": ["node_modules", "dist", "coverage"]
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
coverage/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 5: Create packages/shared/package.json**

```json
{
  "name": "@doc-align/shared",
  "version": "0.1.0",
  "description": "Shared types, validation, and tier definitions for doc-align",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "files": ["dist"]
}
```

- [ ] **Step 6: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

- [ ] **Step 7: Create packages/backend/package.json**

```json
{
  "name": "@doc-align/backend",
  "version": "0.1.0",
  "description": "doc-align serverless backend with Firebase and Stripe",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@doc-align/shared": "workspace:*",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "express-rate-limit": "^7.4.0",
    "firebase-admin": "^12.6.0",
    "helmet": "^7.1.0",
    "stripe": "^16.12.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "files": ["dist"]
}
```

- [ ] **Step 8: Create packages/backend/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

- [ ] **Step 9: Create packages/extension/package.json**

```json
{
  "name": "@doc-align/extension",
  "version": "0.1.0",
  "private": true,
  "description": "doc-align Chrome Extension for Google Docs sign-off",
  "scripts": {
    "build": "webpack --mode production",
    "build:dev": "webpack --mode development",
    "watch": "webpack --mode development --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@doc-align/shared": "workspace:*",
    "diff-match-patch": "^1.0.5",
    "firebase": "^10.12.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "@types/diff-match-patch": "^1.0.36",
    "copy-webpack-plugin": "^12.0.2",
    "css-loader": "^7.1.2",
    "mini-css-extract-plugin": "^2.9.0",
    "ts-loader": "^9.5.1",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "webpack": "^5.91.0",
    "webpack-cli": "^5.1.4"
  }
}
```

- [ ] **Step 10: Create packages/extension/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022", "DOM"],
    "outDir": "dist",
    "rootDir": "src",
    "types": ["chrome"],
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

- [ ] **Step 11: Install dependencies and verify workspace**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm install`
Expected: All three packages resolved, lockfile created

Run: `pnpm -r run typecheck`
Expected: No errors (packages have no source files yet, should pass vacuously or skip)

- [ ] **Step 12: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages/shared/package.json packages/shared/tsconfig.json packages/backend/package.json packages/backend/tsconfig.json packages/extension/package.json packages/extension/tsconfig.json pnpm-lock.yaml
git commit -m "feat: scaffold monorepo with shared, backend, and extension packages"
```

---

## Task 2: Shared Types & Validation

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/tiers.ts`
- Create: `packages/shared/src/validation.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/__tests__/validation.test.ts`
- Create: `packages/shared/__tests__/tiers.test.ts`

- [ ] **Step 1: Write failing tests for validation schemas**

Create `packages/shared/__tests__/validation.test.ts`:

```typescript
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
```

- [ ] **Step 2: Write failing tests for tier logic**

Create `packages/shared/__tests__/tiers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TIER_LIMITS, canSignOff, canTrackDocument, canUseDiffViewer } from '../src/tiers';

describe('TIER_LIMITS', () => {
  it('defines limits for all three tiers', () => {
    expect(TIER_LIMITS.free).toBeDefined();
    expect(TIER_LIMITS.pro).toBeDefined();
    expect(TIER_LIMITS.enterprise).toBeDefined();
  });

  it('free tier has 10 sign-offs and 5 docs', () => {
    expect(TIER_LIMITS.free.maxSignOffsPerMonth).toBe(10);
    expect(TIER_LIMITS.free.maxTrackedDocuments).toBe(5);
  });

  it('pro tier has unlimited sign-offs and docs', () => {
    expect(TIER_LIMITS.pro.maxSignOffsPerMonth).toBe(Infinity);
    expect(TIER_LIMITS.pro.maxTrackedDocuments).toBe(Infinity);
  });
});

describe('canSignOff', () => {
  it('allows free tier under limit', () => {
    expect(canSignOff('free', 5)).toBe(true);
  });

  it('blocks free tier at limit', () => {
    expect(canSignOff('free', 10)).toBe(false);
  });

  it('always allows pro tier', () => {
    expect(canSignOff('pro', 9999)).toBe(true);
  });
});

describe('canTrackDocument', () => {
  it('allows free tier under limit', () => {
    expect(canTrackDocument('free', 3)).toBe(true);
  });

  it('blocks free tier at limit', () => {
    expect(canTrackDocument('free', 5)).toBe(false);
  });
});

describe('canUseDiffViewer', () => {
  it('returns false for free tier', () => {
    expect(canUseDiffViewer('free')).toBe(false);
  });

  it('returns true for pro tier', () => {
    expect(canUseDiffViewer('pro')).toBe(true);
  });

  it('returns true for enterprise tier', () => {
    expect(canUseDiffViewer('enterprise')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement types.ts**

Create `packages/shared/src/types.ts`:

```typescript
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
```

- [ ] **Step 5: Implement constants.ts**

Create `packages/shared/src/constants.ts`:

```typescript
export const SIGNATURE_IMAGE_PREFIX = 'doc-align-sig-';
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const FREE_TIER_SIGN_OFF_LIMIT = 10;
export const FREE_TIER_DOC_LIMIT = 5;
export const AUDIT_RETENTION_DAYS = {
  free: 7,
  pro: 90,
  enterprise: 365,
} as const;
```

- [ ] **Step 6: Implement tiers.ts**

Create `packages/shared/src/tiers.ts`:

```typescript
import type { Tier } from './types';

export interface TierLimits {
  maxSignOffsPerMonth: number;
  maxTrackedDocuments: number;
  signatureFormat: 'basic' | 'full';
  richDiffViewer: boolean;
  auditRetentionDays: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxSignOffsPerMonth: 10,
    maxTrackedDocuments: 5,
    signatureFormat: 'basic',
    richDiffViewer: false,
    auditRetentionDays: 7,
  },
  pro: {
    maxSignOffsPerMonth: Infinity,
    maxTrackedDocuments: Infinity,
    signatureFormat: 'full',
    richDiffViewer: true,
    auditRetentionDays: 90,
  },
  enterprise: {
    maxSignOffsPerMonth: Infinity,
    maxTrackedDocuments: Infinity,
    signatureFormat: 'full',
    richDiffViewer: true,
    auditRetentionDays: 365,
  },
};

export function canSignOff(tier: Tier, currentCount: number): boolean {
  return currentCount < TIER_LIMITS[tier].maxSignOffsPerMonth;
}

export function canTrackDocument(tier: Tier, currentCount: number): boolean {
  return currentCount < TIER_LIMITS[tier].maxTrackedDocuments;
}

export function canUseDiffViewer(tier: Tier): boolean {
  return TIER_LIMITS[tier].richDiffViewer;
}

export function canUseFullSignature(tier: Tier): boolean {
  return TIER_LIMITS[tier].signatureFormat === 'full';
}
```

- [ ] **Step 7: Implement validation.ts**

Create `packages/shared/src/validation.ts`:

```typescript
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
```

- [ ] **Step 8: Implement index.ts**

Create `packages/shared/src/index.ts`:

```typescript
export * from './types';
export * from './validation';
export * from './tiers';
export * from './constants';
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd packages/shared && npx vitest run`
Expected: All tests PASS

- [ ] **Step 10: Run typecheck**

Run: `cd packages/shared && pnpm run typecheck`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared types, validation schemas, and tier logic"
```

---

## Task 3: Backend — Config & Middleware

**Files:**
- Create: `packages/backend/src/config/firebase.ts`
- Create: `packages/backend/src/config/stripe.ts`
- Create: `packages/backend/src/middleware/auth.ts`
- Create: `packages/backend/src/middleware/tier.ts`
- Create: `packages/backend/__tests__/middleware.test.ts`

- [ ] **Step 1: Write failing tests for auth middleware**

Create `packages/backend/__tests__/middleware.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// We test the middleware logic, mocking Firebase
describe('auth middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const { authMiddleware } = await import('../src/middleware/auth');
    const req = { headers: {} } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header has no Bearer token', async () => {
    const { authMiddleware } = await import('../src/middleware/auth');
    const req = { headers: { authorization: 'Basic abc' } } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx vitest run`
Expected: FAIL — module not found

- [ ] **Step 3: Implement firebase.ts config**

Create `packages/backend/src/config/firebase.ts`:

```typescript
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

export const db = admin.firestore();
export const auth = admin.auth();
export { admin };
```

- [ ] **Step 4: Implement stripe.ts config**

Create `packages/backend/src/config/stripe.ts`:

```typescript
import Stripe from 'stripe';
import 'dotenv/config';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20',
});
```

- [ ] **Step 5: Implement auth middleware**

Create `packages/backend/src/middleware/auth.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.userId = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

- [ ] **Step 6: Implement tier middleware**

Create `packages/backend/src/middleware/tier.ts`:

```typescript
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';
import { db } from '../config/firebase';
import type { Tier } from '@doc-align/shared';

export interface TierRequest extends AuthenticatedRequest {
  userTier?: Tier;
}

export async function tierMiddleware(
  req: TierRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    if (!userDoc.exists) {
      req.userTier = 'free';
    } else {
      req.userTier = (userDoc.data()?.tier as Tier) || 'free';
    }
    next();
  } catch {
    res.status(500).json({ error: 'Failed to check subscription tier' });
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run`
Expected: Auth middleware tests PASS (the ones testing header parsing)

- [ ] **Step 8: Commit**

```bash
git add packages/backend/
git commit -m "feat: add backend config (Firebase, Stripe) and auth/tier middleware"
```

---

## Task 4: Backend — Services

**Files:**
- Create: `packages/backend/src/services/userService.ts`
- Create: `packages/backend/src/services/signatureService.ts`
- Create: `packages/backend/src/services/signoffService.ts`
- Create: `packages/backend/__tests__/services.test.ts`

- [ ] **Step 1: Write failing tests for service functions**

Create `packages/backend/__tests__/services.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { shouldResetSignOffCount } from '../src/services/userService';

describe('shouldResetSignOffCount', () => {
  it('returns true when reset date is in the past', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    expect(shouldResetSignOffCount(pastDate)).toBe(true);
  });

  it('returns false when reset date is in the future', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    expect(shouldResetSignOffCount(futureDate)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx vitest run`
Expected: FAIL — module not found

- [ ] **Step 3: Implement userService.ts**

Create `packages/backend/src/services/userService.ts`:

```typescript
import { db, admin } from '../config/firebase';
import type { UserProfile } from '@doc-align/shared';

const USERS = 'users';

export function shouldResetSignOffCount(resetAt: string): boolean {
  return new Date(resetAt).getTime() < Date.now();
}

function nextMonthReset(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

export async function getOrCreateUser(userId: string, email: string): Promise<UserProfile> {
  const ref = db.collection(USERS).doc(userId);
  const doc = await ref.get();

  if (doc.exists) {
    const data = doc.data() as UserProfile;
    if (shouldResetSignOffCount(data.signOffCountResetAt)) {
      await ref.update({ signOffCount: 0, signOffCountResetAt: nextMonthReset() });
      return { ...data, signOffCount: 0, signOffCountResetAt: nextMonthReset() };
    }
    return data;
  }

  const newUser: UserProfile = {
    id: userId,
    email,
    tier: 'free',
    signOffCount: 0,
    signOffCountResetAt: nextMonthReset(),
    createdAt: new Date().toISOString(),
  };
  await ref.set(newUser);
  return newUser;
}

export async function incrementSignOffCount(userId: string): Promise<void> {
  const ref = db.collection(USERS).doc(userId);
  await ref.update({
    signOffCount: admin.firestore.FieldValue.increment(1),
  });
}

export async function updateUserTier(userId: string, tier: string, stripeCustomerId: string): Promise<void> {
  await db.collection(USERS).doc(userId).update({ tier, stripeCustomerId });
}
```

- [ ] **Step 4: Implement signatureService.ts**

Create `packages/backend/src/services/signatureService.ts`:

```typescript
import { db } from '../config/firebase';
import type { Signature } from '@doc-align/shared';

const SIGNATURES = 'signatures';

export async function createSignature(
  userId: string,
  data: { name: string; title?: string; organization?: string; format: 'basic' | 'full'; drawingData: string },
): Promise<Signature> {
  const ref = db.collection(SIGNATURES).doc();
  const signature: Signature = {
    id: ref.id,
    userId,
    name: data.name,
    title: data.title,
    organization: data.organization,
    format: data.format,
    drawingData: data.drawingData,
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  await ref.set(signature);
  return signature;
}

export async function getSignatures(userId: string): Promise<Signature[]> {
  const snapshot = await db
    .collection(SIGNATURES)
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map((doc) => doc.data() as Signature);
}

export async function retireSignature(userId: string, signatureId: string): Promise<void> {
  const ref = db.collection(SIGNATURES).doc(signatureId);
  const doc = await ref.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error('Signature not found');
  }
  await ref.update({ status: 'retired' });
}
```

- [ ] **Step 5: Implement signoffService.ts**

Create `packages/backend/src/services/signoffService.ts`:

```typescript
import { db } from '../config/firebase';
import type { SignOff, DocReference } from '@doc-align/shared';

const SIGNOFFS = 'signoffs';
const DOC_REFS = 'docReferences';

export async function createSignOff(
  userId: string,
  data: { signatureId: string; documentId: string; revisionId: string; imageHash: string; documentTitle: string },
): Promise<SignOff> {
  const ref = db.collection(SIGNOFFS).doc();
  const signOff: SignOff = {
    id: ref.id,
    userId,
    signatureId: data.signatureId,
    documentId: data.documentId,
    revisionId: data.revisionId,
    imageHash: data.imageHash,
    createdAt: new Date().toISOString(),
  };

  const batch = db.batch();
  batch.set(ref, signOff);

  // Upsert doc reference for this user
  const docRefId = `${userId}_${data.documentId}`;
  const docRef: DocReference = {
    id: data.documentId,
    userId,
    title: data.documentTitle,
    lastKnownRevisionId: data.revisionId,
    updatedAt: new Date().toISOString(),
  };
  batch.set(db.collection(DOC_REFS).doc(docRefId), docRef);

  await batch.commit();
  return signOff;
}

export async function getMySignOffs(userId: string): Promise<SignOff[]> {
  const snapshot = await db
    .collection(SIGNOFFS)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map((doc) => doc.data() as SignOff);
}

export async function getMyDocReferences(userId: string): Promise<DocReference[]> {
  const snapshot = await db
    .collection(DOC_REFS)
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .get();
  return snapshot.docs.map((doc) => doc.data() as DocReference);
}

export async function getCoSigners(
  documentId: string,
  revisionId: string,
): Promise<{ count: number; userIds: string[] }> {
  const snapshot = await db
    .collection(SIGNOFFS)
    .where('documentId', '==', documentId)
    .where('revisionId', '==', revisionId)
    .get();
  const userIds = [...new Set(snapshot.docs.map((doc) => doc.data().userId as string))];
  return { count: userIds.length, userIds };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run`
Expected: shouldResetSignOffCount tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/ packages/backend/__tests__/services.test.ts
git commit -m "feat: add backend services for users, signatures, and sign-offs"
```

---

## Task 5: Backend — Routes & Express App

**Files:**
- Create: `packages/backend/src/routes/users.ts`
- Create: `packages/backend/src/routes/signatures.ts`
- Create: `packages/backend/src/routes/signoffs.ts`
- Create: `packages/backend/src/routes/subscriptions.ts`
- Create: `packages/backend/src/index.ts`

- [ ] **Step 1: Implement users route**

Create `packages/backend/src/routes/users.ts`:

```typescript
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { getOrCreateUser } from '../services/userService';

const router = Router();

router.get('/me', async (req: AuthenticatedRequest, res) => {
  try {
    const user = await getOrCreateUser(req.userId!, req.userEmail!);
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

export default router;
```

- [ ] **Step 2: Implement signatures route**

Create `packages/backend/src/routes/signatures.ts`:

```typescript
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { TierRequest } from '../middleware/tier';
import { tierMiddleware } from '../middleware/tier';
import { CreateSignatureSchema, canUseFullSignature } from '@doc-align/shared';
import { createSignature, getSignatures, retireSignature } from '../services/signatureService';

const router = Router();

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const signatures = await getSignatures(req.userId!);
    res.json(signatures);
  } catch {
    res.status(500).json({ error: 'Failed to get signatures' });
  }
});

router.post('/', tierMiddleware, async (req: TierRequest, res) => {
  const parsed = CreateSignatureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid signature data', details: parsed.error.issues });
    return;
  }

  if (parsed.data.format === 'full' && !canUseFullSignature(req.userTier!)) {
    res.status(403).json({ error: 'Full signature format requires Pro or Enterprise tier' });
    return;
  }

  try {
    const signature = await createSignature(req.userId!, parsed.data);
    res.status(201).json(signature);
  } catch {
    res.status(500).json({ error: 'Failed to create signature' });
  }
});

router.post('/:id/retire', async (req: AuthenticatedRequest, res) => {
  try {
    await retireSignature(req.userId!, req.params.id);
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Signature not found' });
  }
});

export default router;
```

- [ ] **Step 3: Implement signoffs route**

Create `packages/backend/src/routes/signoffs.ts`:

```typescript
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { TierRequest } from '../middleware/tier';
import { tierMiddleware } from '../middleware/tier';
import { CreateSignOffSchema, canSignOff } from '@doc-align/shared';
import { createSignOff, getMySignOffs, getMyDocReferences, getCoSigners } from '../services/signoffService';
import { getOrCreateUser, incrementSignOffCount } from '../services/userService';

const router = Router();

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const signOffs = await getMySignOffs(req.userId!);
    res.json(signOffs);
  } catch {
    res.status(500).json({ error: 'Failed to get sign-offs' });
  }
});

router.get('/documents', async (req: AuthenticatedRequest, res) => {
  try {
    const docs = await getMyDocReferences(req.userId!);
    res.json(docs);
  } catch {
    res.status(500).json({ error: 'Failed to get documents' });
  }
});

router.get('/co-signers/:documentId/:revisionId', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await getCoSigners(req.params.documentId, req.params.revisionId);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to get co-signers' });
  }
});

router.post('/', tierMiddleware, async (req: TierRequest, res) => {
  const parsed = CreateSignOffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid sign-off data', details: parsed.error.issues });
    return;
  }

  const user = await getOrCreateUser(req.userId!, req.userEmail!);
  if (!canSignOff(user.tier, user.signOffCount)) {
    res.status(403).json({ error: 'Monthly sign-off limit reached. Upgrade to Pro for unlimited sign-offs.' });
    return;
  }

  try {
    const signOff = await createSignOff(req.userId!, parsed.data);
    await incrementSignOffCount(req.userId!);
    res.status(201).json(signOff);
  } catch {
    res.status(500).json({ error: 'Failed to create sign-off' });
  }
});

export default router;
```

- [ ] **Step 4: Implement subscriptions route (Stripe)**

Create `packages/backend/src/routes/subscriptions.ts`:

```typescript
import { Router } from 'express';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { stripe } from '../config/stripe';
import { updateUserTier } from '../services/userService';

const router = Router();

const PRICE_IDS: Record<string, string> = {
  pro: process.env.STRIPE_PRO_PRICE_ID || '',
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
};

router.post('/checkout', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { plan } = req.body;
  if (!plan || !PRICE_IDS[plan]) {
    res.status(400).json({ error: 'Invalid plan' });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL || 'https://doc-align.app'}/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://doc-align.app'}/cancel`,
      metadata: { userId: req.userId! },
    });
    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/webhook', async (req: Request, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || '',
    );
  } catch {
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const customerId = session.customer as string;
    if (userId) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const priceId = sub.items.data[0]?.price.id;
      const tier = Object.entries(PRICE_IDS).find(([, id]) => id === priceId)?.[0] || 'pro';
      await updateUserTier(userId, tier, customerId);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customerId = sub.customer as string;
    // Find user by stripe customer ID and downgrade
    const { db } = await import('../config/firebase');
    const snapshot = await db.collection('users').where('stripeCustomerId', '==', customerId).get();
    if (!snapshot.empty) {
      await snapshot.docs[0]!.ref.update({ tier: 'free' });
    }
  }

  res.json({ received: true });
});

export default router;
```

- [ ] **Step 5: Implement Express app (index.ts)**

Create `packages/backend/src/index.ts`:

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';
import { authMiddleware } from './middleware/auth';
import usersRouter from './routes/users';
import signaturesRouter from './routes/signatures';
import signoffsRouter from './routes/signoffs';
import subscriptionsRouter from './routes/subscriptions';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Stripe webhook needs raw body
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/signatures', authMiddleware, signaturesRouter);
app.use('/api/signoffs', authMiddleware, signoffsRouter);

// Subscriptions: checkout is protected, webhook is not
app.use('/api/subscriptions', subscriptionsRouter);

app.listen(PORT, () => {
  console.log(`doc-align backend running on port ${PORT}`);
});

export default app;
```

- [ ] **Step 6: Verify typecheck**

Run: `cd packages/backend && pnpm run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/
git commit -m "feat: add backend routes (users, signatures, signoffs, subscriptions) and Express app"
```

---

## Task 6: Extension — Scaffolding (Manifest, Webpack, Build)

**Files:**
- Create: `packages/extension/manifest.json`
- Create: `packages/extension/webpack.config.js`
- Create: `packages/extension/src/background.ts`
- Create: `packages/extension/src/popup/popup.html`
- Create: `packages/extension/src/popup/popup.ts`
- Create: `packages/extension/src/popup/popup.css`
- Create: `packages/extension/src/content/content.ts`
- Create: `packages/extension/src/content/content.css`

- [ ] **Step 1: Create manifest.json**

Create `packages/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "doc-align",
  "version": "0.1.0",
  "description": "Sign off on Google Docs and track changes. Privacy-first document alignment.",
  "permissions": ["storage", "identity", "activeTab"],
  "host_permissions": ["https://docs.google.com/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://docs.google.com/document/*"],
      "js": ["content/content.js"],
      "css": ["content/content.css"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "oauth2": {
    "client_id": "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents"
    ]
  }
}
```

- [ ] **Step 2: Create webpack.config.js**

Create `packages/extension/webpack.config.js`:

```javascript
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  return {
    entry: {
      background: './src/background.ts',
      'popup/popup': './src/popup/popup.ts',
      'content/content': './src/content/content.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
        { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'src/popup/popup.html', to: 'popup/popup.html' },
          { from: 'src/icons', to: 'icons', noErrorOnMissing: true },
        ],
      }),
      new MiniCssExtractPlugin({ filename: '[name].css' }),
    ],
    devtool: isProduction ? false : 'inline-source-map',
    optimization: { minimize: isProduction },
  };
};
```

- [ ] **Step 3: Create minimal background.ts**

Create `packages/extension/src/background.ts`:

```typescript
// doc-align service worker
// Handles message routing between popup, content script, and sidebar

chrome.runtime.onInstalled.addListener(() => {
  console.log('doc-align extension installed');
});

// Message router
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_AUTH_TOKEN') {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      sendResponse({ token });
    });
    return true; // async response
  }
});
```

- [ ] **Step 4: Create popup.html shell**

Create `packages/extension/src/popup/popup.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>doc-align</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <div id="app">
    <!-- Auth gate -->
    <div id="auth-screen" class="screen">
      <div class="auth-container">
        <h1 class="logo">doc-align</h1>
        <p class="auth-subtitle">Sign off on documents.<br/>Track every change.</p>
        <button id="sign-in-btn" class="btn btn-primary">Sign in with Google</button>
      </div>
    </div>

    <!-- Main app -->
    <div id="main-screen" class="screen hidden">
      <!-- Header -->
      <div class="header">
        <span class="logo-sm">doc-align</span>
        <span id="user-email" class="user-email"></span>
        <span id="tier-badge" class="tier-badge">FREE</span>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab active" data-tab="signoff">Sign Off</button>
        <button class="tab" data-tab="documents">My Documents</button>
        <button class="tab" data-tab="settings">Settings</button>
      </div>

      <!-- Tab content -->
      <div id="tab-signoff" class="tab-content active">
        <div id="signoff-view"></div>
      </div>
      <div id="tab-documents" class="tab-content">
        <div id="documents-view"></div>
      </div>
      <div id="tab-settings" class="tab-content">
        <div id="settings-view"></div>
      </div>
    </div>
  </div>

  <!-- Modals -->
  <div id="create-sig-modal" class="modal-overlay hidden">
    <div class="modal">
      <div class="modal-header">
        <h2>Create Signature</h2>
        <button class="icon-btn modal-close">&times;</button>
      </div>
      <div class="modal-body" id="create-sig-body"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="create-sig-cancel">Cancel</button>
        <button class="btn btn-primary" id="create-sig-save">Save Signature</button>
      </div>
    </div>
  </div>

  <div id="diff-modal" class="modal-overlay hidden">
    <div class="modal modal-wide">
      <div class="modal-header">
        <h2>Changes Since Sign-off</h2>
        <button class="icon-btn modal-close">&times;</button>
      </div>
      <div class="modal-body" id="diff-body"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="diff-close">Close</button>
        <button class="btn btn-primary" id="diff-resignoff">Re-Sign Off</button>
      </div>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create minimal popup.ts**

Create `packages/extension/src/popup/popup.ts`:

```typescript
import './popup.css';

// Tab switching
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    const target = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${target}`)?.classList.add('active');
  });
});

// Modal close handlers
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.modal-overlay')?.classList.add('hidden');
  });
});

console.log('doc-align popup loaded');
```

- [ ] **Step 6: Create popup.css with theming**

Create `packages/extension/src/popup/popup.css`:

```css
/* Theme variables */
:root {
  --bg: #0a0a0f;
  --bg-raised: #12121a;
  --bg-surface: #1a1a25;
  --bg-hover: #22222f;
  --border: #2a2a3a;
  --text: #e2e2e8;
  --text-sec: #8b8b9e;
  --text-muted: #6b6b7e;
  --purple: #7c5cfc;
  --purple-hover: #6a4ae0;
  --green: #30a46c;
  --green-bg: rgba(48, 164, 108, 0.12);
  --orange: #f5a623;
  --orange-bg: rgba(245, 166, 35, 0.12);
  --red: #e5484d;
  --blue: #3b82f6;
  --radius: 8px;
  --radius-sm: 4px;
}

/* Light mode */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #ffffff;
    --bg-raised: #f8f8fa;
    --bg-surface: #f0f0f5;
    --bg-hover: #e8e8f0;
    --border: #d0d0dd;
    --text: #1a1a2e;
    --text-sec: #5a5a72;
    --text-muted: #8a8a9e;
  }
}

[data-theme="light"] {
  --bg: #ffffff;
  --bg-raised: #f8f8fa;
  --bg-surface: #f0f0f5;
  --bg-hover: #e8e8f0;
  --border: #d0d0dd;
  --text: #1a1a2e;
  --text-sec: #5a5a72;
  --text-muted: #8a8a9e;
}

/* Reset */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 400px;
  min-height: 480px;
  max-height: 580px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  overflow-y: auto;
}

/* Screens */
.screen { display: none; }
.screen.active, .screen:not(.hidden) { display: block; }
.hidden { display: none !important; }

/* Auth */
.auth-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 480px;
  padding: 32px;
  text-align: center;
}

.logo {
  font-size: 28px;
  font-weight: 700;
  color: var(--purple);
  margin-bottom: 8px;
}

.logo-sm {
  font-size: 14px;
  font-weight: 700;
  color: var(--purple);
}

.auth-subtitle {
  color: var(--text-sec);
  margin-bottom: 24px;
  line-height: 1.5;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.user-email {
  flex: 1;
  color: var(--text-sec);
  font-size: 11px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tier-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-surface);
  color: var(--text-sec);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tier-badge.pro { background: var(--purple); color: white; }
.tier-badge.enterprise { background: var(--green); color: white; }

/* Tabs */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 0 14px;
}

.tab {
  flex: 1;
  padding: 10px 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.tab:hover { color: var(--text); }
.tab.active { color: var(--purple); border-bottom-color: var(--purple); }

/* Tab content */
.tab-content { display: none; padding: 14px; }
.tab-content.active { display: block; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius);
  border: none;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn-primary {
  background: var(--purple);
  color: white;
}

.btn-primary:hover { background: var(--purple-hover); }

.btn-ghost {
  background: transparent;
  color: var(--text-sec);
  border: 1px solid var(--border);
}

.btn-ghost:hover { background: var(--bg-hover); }

.btn-danger {
  background: var(--red);
  color: white;
}

.icon-btn {
  background: none;
  border: none;
  color: var(--text-sec);
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.icon-btn:hover { color: var(--text); }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 360px;
  max-height: 520px;
  overflow-y: auto;
}

.modal-wide { width: 380px; }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.modal-header h2 {
  font-size: 15px;
  font-weight: 600;
}

.modal-body { padding: 16px; }

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

/* Document card */
.doc-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.doc-card:hover { background: var(--bg-hover); }

.doc-card-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.doc-card-status.current { background: var(--green); }
.doc-card-status.changed { background: var(--orange); }

.doc-card-info { flex: 1; min-width: 0; }

.doc-card-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-card-meta {
  font-size: 11px;
  color: var(--text-sec);
  margin-top: 2px;
}

.doc-card-cosigners {
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 6px;
  background: var(--bg-surface);
  border-radius: 10px;
  white-space: nowrap;
}

/* Signature card */
.sig-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  margin-bottom: 8px;
}

.sig-card:hover { background: var(--bg-hover); }

.sig-card-preview {
  width: 48px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.sig-card-preview img {
  max-width: 100%;
  max-height: 100%;
}

.sig-card-info { flex: 1; }

.sig-card-name {
  font-size: 13px;
  font-weight: 500;
}

.sig-card-meta {
  font-size: 11px;
  color: var(--text-sec);
}

/* Diff viewer */
.diff-container {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
}

.diff-line { padding: 1px 8px; white-space: pre-wrap; }
.diff-add { background: var(--green-bg); color: var(--green); }
.diff-remove { background: rgba(229, 72, 77, 0.12); color: var(--red); }
.diff-context { color: var(--text-muted); }

/* Signature canvas */
.sig-canvas-container {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: white;
  margin-bottom: 12px;
}

.sig-canvas {
  width: 100%;
  height: 120px;
  cursor: crosshair;
}

.sig-canvas-actions {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
}

/* Form inputs */
.form-group { margin-bottom: 12px; }

.form-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-sec);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
}

.form-input:focus { border-color: var(--purple); }

/* Signature preview */
.sig-preview {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  background: white;
  text-align: center;
  margin-top: 12px;
}

.sig-preview img { max-width: 100%; }

/* Empty states */
.empty-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-muted);
}

.empty-state p { margin-top: 8px; font-size: 12px; }

/* Utility */
.text-green { color: var(--green); }
.text-orange { color: var(--orange); }
.text-red { color: var(--red); }
.mt-8 { margin-top: 8px; }
.mt-16 { margin-top: 16px; }
```

- [ ] **Step 7: Create minimal content.ts and content.css**

Create `packages/extension/src/content/content.ts`:

```typescript
// doc-align content script — runs on Google Docs pages
console.log('doc-align content script loaded');

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_DOC_INFO') {
    const docId = extractDocId(window.location.href);
    const title = document.title.replace(' - Google Docs', '').trim();
    sendResponse({ docId, title });
  }
  return true;
});

function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
```

Create `packages/extension/src/content/content.css`:

```css
/* doc-align tooltip on Google Docs */
.da-tooltip {
  position: absolute;
  background: #12121a;
  color: #e2e2e8;
  border: 1px solid #2a2a3a;
  border-radius: 8px;
  padding: 10px 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  z-index: 10000;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  max-width: 240px;
}

.da-tooltip-name {
  font-weight: 600;
  font-size: 13px;
}

.da-tooltip-date {
  color: #8b8b9e;
  font-size: 11px;
  margin-top: 2px;
}

.da-tooltip-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 11px;
}

.da-tooltip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.da-tooltip-dot.current { background: #30a46c; }
.da-tooltip-dot.changed { background: #f5a623; }

.da-tooltip-link {
  color: #7c5cfc;
  font-size: 11px;
  margin-top: 4px;
  cursor: pointer;
  pointer-events: auto;
}

.da-tooltip-link:hover { text-decoration: underline; }
```

- [ ] **Step 8: Build extension**

Run: `cd packages/extension && pnpm run build:dev`
Expected: Build succeeds, dist/ folder created with background.js, popup/, content/

- [ ] **Step 9: Commit**

```bash
git add packages/extension/
git commit -m "feat: scaffold Chrome extension with manifest, webpack, popup shell, and content script"
```

---

## Task 7: Extension — Auth & API Client

**Files:**
- Create: `packages/extension/src/lib/auth.ts`
- Create: `packages/extension/src/lib/api.ts`
- Create: `packages/extension/__tests__/api.test.ts`

- [ ] **Step 1: Write failing test for API client URL construction**

Create `packages/extension/__tests__/api.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildUrl } from '../src/lib/api';

describe('buildUrl', () => {
  it('constructs URL with base and path', () => {
    expect(buildUrl('https://api.example.com', '/users/me')).toBe(
      'https://api.example.com/users/me',
    );
  });

  it('handles trailing slash on base', () => {
    expect(buildUrl('https://api.example.com/', '/users/me')).toBe(
      'https://api.example.com/users/me',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run`
Expected: FAIL — module not found

- [ ] **Step 3: Implement auth.ts**

Create `packages/extension/src/lib/auth.ts`:

```typescript
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export async function signIn(): Promise<User> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Failed to get auth token'));
        return;
      }
      try {
        const credential = GoogleAuthProvider.credential(null, token);
        const result = await signInWithCredential(auth, credential);
        resolve(result.user);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
  return new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => resolve());
  });
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export function getCurrentUser(): User | null {
  return auth.currentUser;
}
```

- [ ] **Step 4: Implement api.ts**

Create `packages/extension/src/lib/api.ts`:

```typescript
import { getIdToken } from './auth';

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

export const api = {
  getUser: () => request('/users/me'),
  getSignatures: () => request('/signatures'),
  createSignature: (data: object) =>
    request('/signatures', { method: 'POST', body: JSON.stringify(data) }),
  retireSignature: (id: string) =>
    request(`/signatures/${id}/retire`, { method: 'POST' }),
  getSignOffs: () => request('/signoffs'),
  getDocuments: () => request('/signoffs/documents'),
  createSignOff: (data: object) =>
    request('/signoffs', { method: 'POST', body: JSON.stringify(data) }),
  getCoSigners: (docId: string, revId: string) =>
    request(`/signoffs/co-signers/${docId}/${revId}`),
  createCheckout: (plan: string) =>
    request('/subscriptions/checkout', { method: 'POST', body: JSON.stringify({ plan }) }),
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/extension && npx vitest run`
Expected: buildUrl tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/lib/auth.ts packages/extension/src/lib/api.ts packages/extension/__tests__/
git commit -m "feat: add Firebase auth and backend API client for extension"
```

---

## Task 8: Extension — Signature Drawing Canvas

**Files:**
- Create: `packages/extension/src/lib/signature-canvas.ts`
- Create: `packages/extension/__tests__/signature-canvas.test.ts`

- [ ] **Step 1: Write failing test for canvas stroke data**

Create `packages/extension/__tests__/signature-canvas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StrokeRecorder } from '../src/lib/signature-canvas';

describe('StrokeRecorder', () => {
  it('starts with empty strokes', () => {
    const recorder = new StrokeRecorder();
    expect(recorder.getStrokes()).toEqual([]);
    expect(recorder.isEmpty()).toBe(true);
  });

  it('records a stroke', () => {
    const recorder = new StrokeRecorder();
    recorder.beginStroke(10, 20);
    recorder.addPoint(15, 25);
    recorder.addPoint(20, 30);
    recorder.endStroke();

    expect(recorder.getStrokes()).toHaveLength(1);
    expect(recorder.getStrokes()[0]).toEqual([
      { x: 10, y: 20 },
      { x: 15, y: 25 },
      { x: 20, y: 30 },
    ]);
    expect(recorder.isEmpty()).toBe(false);
  });

  it('undoes last stroke', () => {
    const recorder = new StrokeRecorder();
    recorder.beginStroke(10, 20);
    recorder.addPoint(15, 25);
    recorder.endStroke();

    recorder.beginStroke(30, 40);
    recorder.addPoint(35, 45);
    recorder.endStroke();

    expect(recorder.getStrokes()).toHaveLength(2);
    recorder.undo();
    expect(recorder.getStrokes()).toHaveLength(1);
  });

  it('clears all strokes', () => {
    const recorder = new StrokeRecorder();
    recorder.beginStroke(10, 20);
    recorder.endStroke();
    recorder.clear();
    expect(recorder.isEmpty()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run`
Expected: FAIL — StrokeRecorder not found

- [ ] **Step 3: Implement signature-canvas.ts**

Create `packages/extension/src/lib/signature-canvas.ts`:

```typescript
export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

export class StrokeRecorder {
  private strokes: Stroke[] = [];
  private currentStroke: Stroke | null = null;

  beginStroke(x: number, y: number): void {
    this.currentStroke = [{ x, y }];
  }

  addPoint(x: number, y: number): void {
    if (this.currentStroke) {
      this.currentStroke.push({ x, y });
    }
  }

  endStroke(): void {
    if (this.currentStroke && this.currentStroke.length > 0) {
      this.strokes.push(this.currentStroke);
    }
    this.currentStroke = null;
  }

  undo(): void {
    this.strokes.pop();
  }

  clear(): void {
    this.strokes = [];
    this.currentStroke = null;
  }

  isEmpty(): boolean {
    return this.strokes.length === 0;
  }

  getStrokes(): Stroke[] {
    return [...this.strokes];
  }
}

export class SignatureCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: StrokeRecorder;
  private isDrawing = false;
  private lineWidth = 2;
  private strokeColor = '#1a1a2e';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.recorder = new StrokeRecorder();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerleave', this.onPointerUp.bind(this));
  }

  private getCanvasPoint(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDrawing = true;
    const point = this.getCanvasPoint(e);
    this.recorder.beginStroke(point.x, point.y);
    this.ctx.beginPath();
    this.ctx.moveTo(point.x, point.y);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;
    const point = this.getCanvasPoint(e);
    this.recorder.addPoint(point.x, point.y);
    this.ctx.lineTo(point.x, point.y);
    this.ctx.strokeStyle = this.strokeColor;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  }

  private onPointerUp(): void {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.recorder.endStroke();
    }
  }

  undo(): void {
    this.recorder.undo();
    this.redraw();
  }

  clear(): void {
    this.recorder.clear();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  isEmpty(): boolean {
    return this.recorder.isEmpty();
  }

  private redraw(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of this.recorder.getStrokes()) {
      if (stroke.length < 2) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (let i = 1; i < stroke.length; i++) {
        this.ctx.lineTo(stroke[i]!.x, stroke[i]!.y);
      }
      this.ctx.strokeStyle = this.strokeColor;
      this.ctx.lineWidth = this.lineWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();
    }
  }

  toDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }

  getRecorder(): StrokeRecorder {
    return this.recorder;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/extension && npx vitest run`
Expected: All StrokeRecorder tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/signature-canvas.ts packages/extension/__tests__/signature-canvas.test.ts
git commit -m "feat: add signature drawing canvas with stroke recording and undo"
```

---

## Task 9: Extension — Signature Renderer (Composite Image)

**Files:**
- Create: `packages/extension/src/lib/signature-renderer.ts`
- Create: `packages/extension/__tests__/signature-renderer.test.ts`

- [ ] **Step 1: Write failing test for hash computation**

Create `packages/extension/__tests__/signature-renderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeImageHash } from '../src/lib/signature-renderer';

describe('computeImageHash', () => {
  it('produces a hex string from a data URL', async () => {
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const hash = await computeImageHash(fakeDataUrl);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces same hash for same input', async () => {
    const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const hash1 = await computeImageHash(data);
    const hash2 = await computeImageHash(data);
    expect(hash1).toBe(hash2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run`
Expected: FAIL — computeImageHash not found

- [ ] **Step 3: Implement signature-renderer.ts**

Create `packages/extension/src/lib/signature-renderer.ts`:

```typescript
export interface SignatureRenderOptions {
  drawingDataUrl: string;
  name: string;
  date: string;
  title?: string;
  organization?: string;
  format: 'basic' | 'full';
  width?: number;
}

export async function computeImageHash(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(',')[1] || '';
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function renderSignatureImage(options: SignatureRenderOptions): Promise<string> {
  const { drawingDataUrl, name, date, title, organization, format, width = 320 } = options;

  return new Promise((resolve) => {
    const drawingImg = new Image();
    drawingImg.onload = () => {
      // Calculate dimensions
      const drawingHeight = 80;
      const textLineHeight = 18;
      const padding = 16;
      let totalHeight = padding + drawingHeight + 8 + textLineHeight + padding; // sig + name + date line

      if (format === 'full') {
        if (title) totalHeight += textLineHeight;
        if (organization) totalHeight += textLineHeight;
      }

      // Add date line
      totalHeight += textLineHeight;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d')!;

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, totalHeight);

      // Draw the signature drawing (centered)
      const drawScale = Math.min((width - 2 * padding) / drawingImg.width, drawingHeight / drawingImg.height);
      const drawWidth = drawingImg.width * drawScale;
      const drawX = (width - drawWidth) / 2;
      ctx.drawImage(drawingImg, drawX, padding, drawWidth, drawingImg.height * drawScale);

      // Divider line
      let y = padding + drawingHeight + 4;
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      y += 8;

      // Name
      ctx.fillStyle = '#1a1a2e';
      ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(name, padding, y);
      y += textLineHeight;

      // Title (Pro+ only)
      if (format === 'full' && title) {
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = '#5a5a72';
        ctx.fillText(title, padding, y);
        y += textLineHeight;
      }

      // Organization (Pro+ only)
      if (format === 'full' && organization) {
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = '#5a5a72';
        ctx.fillText(organization, padding, y);
        y += textLineHeight;
      }

      // Date
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = '#8a8a9e';
      ctx.fillText(date, padding, y);

      resolve(canvas.toDataURL('image/png'));
    };
    drawingImg.src = drawingDataUrl;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/extension && npx vitest run`
Expected: computeImageHash tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/signature-renderer.ts packages/extension/__tests__/signature-renderer.test.ts
git commit -m "feat: add signature image renderer with SHA-256 tamper detection hash"
```

---

## Task 10: Extension — Google APIs Client (Revisions & Doc Metadata)

**Files:**
- Create: `packages/extension/src/lib/google-apis.ts`

- [ ] **Step 1: Implement google-apis.ts**

Create `packages/extension/src/lib/google-apis.ts`:

```typescript
import { getIdToken } from './auth';

async function getGoogleToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error('Failed to get Google token'));
        return;
      }
      resolve(token);
    });
  });
}

export interface DocMetadata {
  id: string;
  title: string;
}

export interface Revision {
  id: string;
  modifiedTime: string;
}

export async function getDocMetadata(docId: string): Promise<DocMetadata> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}?fields=id,name`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Failed to get doc metadata');
  const data = await res.json();
  return { id: data.id, title: data.name };
}

export async function listRevisions(docId: string): Promise<Revision[]> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/revisions?fields=revisions(id,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Failed to list revisions');
  const data = await res.json();
  return data.revisions || [];
}

export async function getLatestRevisionId(docId: string): Promise<string> {
  const revisions = await listRevisions(docId);
  if (revisions.length === 0) throw new Error('No revisions found');
  return revisions[revisions.length - 1]!.id;
}

export async function getRevisionContent(docId: string, revisionId: string): Promise<string> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/revisions/${revisionId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Failed to get revision content');
  return res.text();
}

export async function insertImageIntoDoc(docId: string, imageDataUrl: string): Promise<void> {
  const token = await getGoogleToken();

  // Convert data URL to blob for upload
  const base64 = imageDataUrl.split(',')[1] || '';
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });

  // Upload image to Google Drive
  const metadata = { name: 'doc-align-signature.png', mimeType: 'image/png' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  if (!uploadRes.ok) throw new Error('Failed to upload signature image');
  const uploadData = await uploadRes.json();
  const imageFileId = uploadData.id;

  // Insert image into doc at end
  const docRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertInlineImage: {
              uri: `https://drive.google.com/uc?id=${imageFileId}`,
              location: { index: 1 }, // End of document body
              objectSize: {
                width: { magnitude: 250, unit: 'PT' },
                height: { magnitude: 150, unit: 'PT' },
              },
            },
          },
        ],
      }),
    },
  );
  if (!docRes.ok) throw new Error('Failed to insert signature into document');
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/src/lib/google-apis.ts
git commit -m "feat: add Google APIs client for revisions, doc metadata, and image insertion"
```

---

## Task 11: Extension — Diff Engine

**Files:**
- Create: `packages/extension/src/lib/diff-engine.ts`
- Create: `packages/extension/__tests__/diff-engine.test.ts`

- [ ] **Step 1: Write failing test for diff computation**

Create `packages/extension/__tests__/diff-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTextDiff, type DiffLine } from '../src/lib/diff-engine';

describe('computeTextDiff', () => {
  it('returns empty diff for identical text', () => {
    const result = computeTextDiff('hello world', 'hello world');
    const changes = result.filter((l) => l.type !== 'context');
    expect(changes).toHaveLength(0);
  });

  it('detects additions', () => {
    const result = computeTextDiff('line one', 'line one\nline two');
    const adds = result.filter((l) => l.type === 'add');
    expect(adds.length).toBeGreaterThan(0);
  });

  it('detects removals', () => {
    const result = computeTextDiff('line one\nline two', 'line one');
    const removes = result.filter((l) => l.type === 'remove');
    expect(removes.length).toBeGreaterThan(0);
  });

  it('detects modifications', () => {
    const result = computeTextDiff('the quick brown fox', 'the slow brown fox');
    const changes = result.filter((l) => l.type !== 'context');
    expect(changes.length).toBeGreaterThan(0);
  });

  it('handles empty old text', () => {
    const result = computeTextDiff('', 'new content');
    const adds = result.filter((l) => l.type === 'add');
    expect(adds.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run`
Expected: FAIL — computeTextDiff not found

- [ ] **Step 3: Implement diff-engine.ts**

Create `packages/extension/src/lib/diff-engine.ts`:

```typescript
import DiffMatchPatch from 'diff-match-patch';

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
}

const dmp = new DiffMatchPatch();

export function computeTextDiff(oldText: string, newText: string): DiffLine[] {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const lines: DiffLine[] = [];
  for (const [op, text] of diffs) {
    if (op === 0) {
      lines.push({ type: 'context', text });
    } else if (op === -1) {
      lines.push({ type: 'remove', text });
    } else if (op === 1) {
      lines.push({ type: 'add', text });
    }
  }
  return lines;
}

export function diffToHtml(diffLines: DiffLine[]): string {
  return diffLines
    .map((line) => {
      const escaped = escapeHtml(line.text);
      switch (line.type) {
        case 'add':
          return `<span class="diff-add">${escaped}</span>`;
        case 'remove':
          return `<span class="diff-remove">${escaped}</span>`;
        case 'context':
          return `<span class="diff-context">${escaped}</span>`;
      }
    })
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/extension && npx vitest run`
Expected: All computeTextDiff tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/diff-engine.ts packages/extension/__tests__/diff-engine.test.ts
git commit -m "feat: add diff engine using diff-match-patch with HTML rendering"
```

---

## Task 12: Extension — Theme Manager

**Files:**
- Create: `packages/extension/src/lib/theme.ts`
- Create: `packages/extension/__tests__/theme.test.ts`

- [ ] **Step 1: Write failing test for theme logic**

Create `packages/extension/__tests__/theme.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/lib/theme';

describe('resolveTheme', () => {
  it('returns dark when preference is dark', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('returns light when preference is light', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('returns system default when preference is system', () => {
    // In test env (no matchMedia), defaults to dark
    expect(resolveTheme('system')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run`
Expected: FAIL — resolveTheme not found

- [ ] **Step 3: Implement theme.ts**

Create `packages/extension/src/lib/theme.ts`:

```typescript
export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'doc-align-theme';

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'dark' || preference === 'light') return preference;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export async function loadThemePreference(): Promise<ThemePreference> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve((result[STORAGE_KEY] as ThemePreference) || 'system');
      });
    } else {
      resolve('system');
    }
  });
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [STORAGE_KEY]: preference }, resolve);
    } else {
      resolve();
    }
  });
}

export async function initTheme(): Promise<void> {
  const preference = await loadThemePreference();
  const resolved = resolveTheme(preference);
  applyTheme(resolved);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/extension && npx vitest run`
Expected: resolveTheme tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/theme.ts packages/extension/__tests__/theme.test.ts
git commit -m "feat: add theme manager with dark/light/system preference support"
```

---

## Task 13: Extension — Popup Views (Sign-off, Documents, Settings)

**Files:**
- Create: `packages/extension/src/popup/views/sign-off.ts`
- Create: `packages/extension/src/popup/views/documents.ts`
- Create: `packages/extension/src/popup/views/settings.ts`
- Create: `packages/extension/src/popup/components/doc-card.ts`
- Create: `packages/extension/src/popup/components/signature-card.ts`
- Create: `packages/extension/src/popup/components/diff-viewer.ts`
- Create: `packages/extension/src/popup/components/create-signature-modal.ts`
- Modify: `packages/extension/src/popup/popup.ts`

- [ ] **Step 1: Implement doc-card component**

Create `packages/extension/src/popup/components/doc-card.ts`:

```typescript
import type { DocSignOffSummary } from '@doc-align/shared';

export function renderDocCard(doc: DocSignOffSummary, onClick: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'doc-card';
  card.addEventListener('click', onClick);

  const statusClass = doc.hasChanged ? 'changed' : 'current';
  const statusLabel = doc.hasChanged ? 'Modified' : 'Up to date';
  const coSignerText =
    doc.totalSignOffsOnRevision > 1
      ? `You + ${doc.totalSignOffsOnRevision - 1} other${doc.totalSignOffsOnRevision > 2 ? 's' : ''}`
      : 'Only you';

  card.innerHTML = `
    <div class="doc-card-status ${statusClass}" title="${statusLabel}"></div>
    <div class="doc-card-info">
      <div class="doc-card-title">${escapeHtml(doc.title)}</div>
      <div class="doc-card-meta">Signed ${formatDate(doc.mySignOffDate)}</div>
    </div>
    <div class="doc-card-cosigners">${coSignerText}</div>
  `;
  return card;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] **Step 2: Implement signature-card component**

Create `packages/extension/src/popup/components/signature-card.ts`:

```typescript
import type { Signature } from '@doc-align/shared';

export function renderSignatureCard(
  sig: Signature,
  onRetire: () => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'sig-card';

  card.innerHTML = `
    <div class="sig-card-preview">
      <img src="${sig.drawingData}" alt="Signature" />
    </div>
    <div class="sig-card-info">
      <div class="sig-card-name">${escapeHtml(sig.name)}</div>
      <div class="sig-card-meta">${sig.format === 'full' && sig.title ? sig.title : 'Basic signature'}</div>
    </div>
  `;

  const retireBtn = document.createElement('button');
  retireBtn.className = 'btn btn-ghost';
  retireBtn.textContent = 'Retire';
  retireBtn.style.fontSize = '11px';
  retireBtn.style.padding = '4px 8px';
  retireBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onRetire();
  });
  card.appendChild(retireBtn);

  return card;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] **Step 3: Implement diff-viewer component**

Create `packages/extension/src/popup/components/diff-viewer.ts`:

```typescript
import { computeTextDiff, diffToHtml } from '../../lib/diff-engine';
import { getRevisionContent } from '../../lib/google-apis';

export async function renderDiffViewer(
  container: HTMLElement,
  docId: string,
  signOffRevisionId: string,
): Promise<void> {
  container.innerHTML = '<div class="empty-state"><p>Loading diff...</p></div>';

  try {
    const [oldText, newText] = await Promise.all([
      getRevisionContent(docId, signOffRevisionId),
      getRevisionContent(docId, 'head'),
    ]);

    const diffLines = computeTextDiff(oldText, newText);
    const html = diffToHtml(diffLines);

    container.innerHTML = `<div class="diff-container">${html}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Failed to load diff. Make sure you have access to this document.</p></div>`;
  }
}
```

- [ ] **Step 4: Implement create-signature-modal component**

Create `packages/extension/src/popup/components/create-signature-modal.ts`:

```typescript
import { SignatureCanvas } from '../../lib/signature-canvas';
import { renderSignatureImage, type SignatureRenderOptions } from '../../lib/signature-renderer';
import { api } from '../../lib/api';
import type { Tier } from '@doc-align/shared';
import { canUseFullSignature } from '@doc-align/shared';

export function initCreateSignatureModal(
  userTier: Tier,
  onSaved: () => void,
): void {
  const body = document.getElementById('create-sig-body')!;
  const isFullAllowed = canUseFullSignature(userTier);
  const format = isFullAllowed ? 'full' : 'basic';

  body.innerHTML = `
    <div class="sig-canvas-container">
      <canvas id="sig-draw-canvas" class="sig-canvas" width="328" height="120"></canvas>
      <div class="sig-canvas-actions">
        <button class="btn btn-ghost" id="sig-undo" style="font-size:11px;padding:4px 8px;">Undo</button>
        <button class="btn btn-ghost" id="sig-clear" style="font-size:11px;padding:4px 8px;">Clear</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Full Name</label>
      <input type="text" class="form-input" id="sig-name" placeholder="Jane Doe" />
    </div>
    ${isFullAllowed ? `
    <div class="form-group">
      <label class="form-label">Title</label>
      <input type="text" class="form-input" id="sig-title" placeholder="Engineering Lead" />
    </div>
    <div class="form-group">
      <label class="form-label">Organization</label>
      <input type="text" class="form-input" id="sig-org" placeholder="Acme Corp" />
    </div>
    ` : ''}
    <div class="sig-preview" id="sig-preview">
      <p style="color:var(--text-muted);font-size:12px;">Draw your signature above to see preview</p>
    </div>
  `;

  const canvas = document.getElementById('sig-draw-canvas') as HTMLCanvasElement;
  const sigCanvas = new SignatureCanvas(canvas);

  document.getElementById('sig-undo')!.addEventListener('click', () => sigCanvas.undo());
  document.getElementById('sig-clear')!.addEventListener('click', () => sigCanvas.clear());

  // Live preview on pointer up
  canvas.addEventListener('pointerup', () => updatePreview());

  async function updatePreview(): Promise<void> {
    if (sigCanvas.isEmpty()) return;
    const name = (document.getElementById('sig-name') as HTMLInputElement).value || 'Your Name';
    const title = document.getElementById('sig-title') as HTMLInputElement | null;
    const org = document.getElementById('sig-org') as HTMLInputElement | null;

    const opts: SignatureRenderOptions = {
      drawingDataUrl: sigCanvas.toDataURL(),
      name,
      date: new Date().toLocaleDateString(),
      title: title?.value || undefined,
      organization: org?.value || undefined,
      format,
    };

    const imageUrl = await renderSignatureImage(opts);
    const preview = document.getElementById('sig-preview')!;
    preview.innerHTML = `<img src="${imageUrl}" alt="Signature preview" />`;
  }

  // Save handler
  document.getElementById('create-sig-save')!.addEventListener('click', async () => {
    const name = (document.getElementById('sig-name') as HTMLInputElement).value.trim();
    if (!name) {
      alert('Please enter your name');
      return;
    }
    if (sigCanvas.isEmpty()) {
      alert('Please draw your signature');
      return;
    }

    const title = document.getElementById('sig-title') as HTMLInputElement | null;
    const org = document.getElementById('sig-org') as HTMLInputElement | null;

    await api.createSignature({
      name,
      title: title?.value?.trim() || undefined,
      organization: org?.value?.trim() || undefined,
      format,
      drawingData: sigCanvas.toDataURL(),
    });

    document.getElementById('create-sig-modal')!.classList.add('hidden');
    onSaved();
  });

  // Cancel handler
  document.getElementById('create-sig-cancel')!.addEventListener('click', () => {
    document.getElementById('create-sig-modal')!.classList.add('hidden');
  });
}
```

- [ ] **Step 5: Implement sign-off view**

Create `packages/extension/src/popup/views/sign-off.ts`:

```typescript
import { api } from '../../lib/api';
import { getLatestRevisionId, insertImageIntoDoc } from '../../lib/google-apis';
import { renderSignatureImage, computeImageHash } from '../../lib/signature-renderer';
import type { Signature } from '@doc-align/shared';

interface DocContext {
  docId: string;
  title: string;
}

export async function renderSignOffView(container: HTMLElement): Promise<void> {
  // Get current doc context from content script
  const docContext = await getDocContext();

  if (!docContext) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Open a Google Doc to sign off on it.</p>
      </div>
    `;
    return;
  }

  // Get user's signatures
  const signatures = (await api.getSignatures()) as Signature[];

  if (signatures.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No signatures yet.</p>
        <button class="btn btn-primary mt-8" id="create-sig-trigger">Create Signature</button>
      </div>
    `;
    document.getElementById('create-sig-trigger')?.addEventListener('click', () => {
      document.getElementById('create-sig-modal')?.classList.remove('hidden');
    });
    return;
  }

  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Current Document</div>
      <div style="font-size:14px;font-weight:500;margin-top:4px;">${escapeHtml(docContext.title)}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Your Signature</div>
      <div id="active-sig-preview" class="sig-card">
        <div class="sig-card-preview">
          <img src="${signatures[0]!.drawingData}" alt="Signature" />
        </div>
        <div class="sig-card-info">
          <div class="sig-card-name">${escapeHtml(signatures[0]!.name)}</div>
          <div class="sig-card-meta">${signatures[0]!.format === 'full' && signatures[0]!.title ? signatures[0]!.title : 'Basic'}</div>
        </div>
      </div>
    </div>
    <button class="btn btn-primary" id="sign-off-btn" style="width:100%;">Sign Off on This Document</button>
  `;

  document.getElementById('sign-off-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('sign-off-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Signing off...';

    try {
      const sig = signatures[0]!;
      const revisionId = await getLatestRevisionId(docContext.docId);

      const imageDataUrl = await renderSignatureImage({
        drawingDataUrl: sig.drawingData,
        name: sig.name,
        date: new Date().toLocaleDateString(),
        title: sig.title,
        organization: sig.organization,
        format: sig.format,
      });

      const imageHash = await computeImageHash(imageDataUrl);

      await insertImageIntoDoc(docContext.docId, imageDataUrl);

      await api.createSignOff({
        signatureId: sig.id,
        documentId: docContext.docId,
        revisionId,
        imageHash,
        documentTitle: docContext.title,
      });

      btn.textContent = 'Signed Off!';
      btn.style.background = 'var(--green)';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign Off on This Document';
      alert('Failed to sign off. Please try again.');
    }
  });
}

async function getDocContext(): Promise<DocContext | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.includes('docs.google.com/document')) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'GET_DOC_INFO' }, (response) => {
        if (chrome.runtime.lastError || !response?.docId) {
          resolve(null);
          return;
        }
        resolve({ docId: response.docId, title: response.title });
      });
    });
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] **Step 6: Implement documents view**

Create `packages/extension/src/popup/views/documents.ts`:

```typescript
import { api } from '../../lib/api';
import { getLatestRevisionId } from '../../lib/google-apis';
import { renderDocCard } from '../components/doc-card';
import { renderDiffViewer } from '../components/diff-viewer';
import type { SignOff, DocReference, DocSignOffSummary } from '@doc-align/shared';

export async function renderDocumentsView(container: HTMLElement): Promise<void> {
  container.innerHTML = '<div class="empty-state"><p>Loading documents...</p></div>';

  try {
    const [signOffs, docRefs] = await Promise.all([
      api.getSignOffs() as Promise<SignOff[]>,
      api.getDocuments() as Promise<DocReference[]>,
    ]);

    if (docRefs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No signed documents yet.</p>
          <p>Sign off on a Google Doc to see it here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    // Build summaries
    for (const docRef of docRefs) {
      const mySignOffs = signOffs.filter((so) => so.documentId === docRef.id);
      const latestSignOff = mySignOffs[0]; // Already sorted by createdAt desc
      if (!latestSignOff) continue;

      let hasChanged = false;
      try {
        const currentRevId = await getLatestRevisionId(docRef.id);
        hasChanged = currentRevId !== latestSignOff.revisionId;
      } catch {
        // Can't check — assume unchanged
      }

      // Get co-signer count
      let coSignerData = { count: 1, userIds: [] as string[] };
      try {
        coSignerData = (await api.getCoSigners(docRef.id, latestSignOff.revisionId)) as {
          count: number;
          userIds: string[];
        };
      } catch {
        // Ignore
      }

      const summary: DocSignOffSummary = {
        documentId: docRef.id,
        title: docRef.title,
        mySignOffDate: latestSignOff.createdAt,
        myRevisionId: latestSignOff.revisionId,
        totalSignOffsOnRevision: coSignerData.count,
        signerNames: [],
        hasChanged,
      };

      const card = renderDocCard(summary, () => {
        if (hasChanged) {
          const diffModal = document.getElementById('diff-modal')!;
          const diffBody = document.getElementById('diff-body')!;
          diffModal.classList.remove('hidden');
          renderDiffViewer(diffBody, docRef.id, latestSignOff.revisionId);
        } else {
          // Open the doc
          chrome.tabs.create({ url: `https://docs.google.com/document/d/${docRef.id}/edit` });
        }
      });
      container.appendChild(card);
    }
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load documents.</p></div>';
  }
}
```

- [ ] **Step 7: Implement settings view**

Create `packages/extension/src/popup/views/settings.ts`:

```typescript
import { api } from '../../lib/api';
import { signOut } from '../../lib/auth';
import { loadThemePreference, saveThemePreference, resolveTheme, applyTheme, type ThemePreference } from '../../lib/theme';
import type { UserProfile } from '@doc-align/shared';

export async function renderSettingsView(container: HTMLElement): Promise<void> {
  const user = (await api.getUser()) as UserProfile;
  const currentTheme = await loadThemePreference();

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      <div class="form-label">Account</div>
      <div style="padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius);font-size:13px;">
        <div>${escapeHtml(user.email)}</div>
        <div style="font-size:11px;color:var(--text-sec);margin-top:4px;">
          ${user.tier.toUpperCase()} plan · ${user.signOffCount} sign-offs this month
        </div>
      </div>
    </div>

    ${user.tier === 'free' ? `
    <button class="btn btn-primary" id="upgrade-btn" style="width:100%;margin-bottom:16px;">
      Upgrade to Pro
    </button>
    ` : ''}

    <div style="margin-bottom:16px;">
      <div class="form-label">Signatures</div>
      <button class="btn btn-ghost" id="manage-sigs-btn" style="width:100%;">
        Create New Signature
      </button>
    </div>

    <div style="margin-bottom:16px;">
      <div class="form-label">Theme</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost theme-btn ${currentTheme === 'system' ? 'active' : ''}" data-theme="system" style="flex:1;font-size:11px;">System</button>
        <button class="btn btn-ghost theme-btn ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark" style="flex:1;font-size:11px;">Dark</button>
        <button class="btn btn-ghost theme-btn ${currentTheme === 'light' ? 'active' : ''}" data-theme="light" style="flex:1;font-size:11px;">Light</button>
      </div>
    </div>

    <button class="btn btn-ghost" id="sign-out-btn" style="width:100%;color:var(--red);">
      Sign Out
    </button>
  `;

  // Theme switching
  container.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pref = (btn as HTMLElement).dataset.theme as ThemePreference;
      await saveThemePreference(pref);
      applyTheme(resolveTheme(pref));
      container.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Upgrade
  document.getElementById('upgrade-btn')?.addEventListener('click', async () => {
    const { url } = (await api.createCheckout('pro')) as { url: string };
    chrome.tabs.create({ url });
  });

  // Create signature
  document.getElementById('manage-sigs-btn')?.addEventListener('click', () => {
    document.getElementById('create-sig-modal')?.classList.remove('hidden');
  });

  // Sign out
  document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
    await signOut();
    window.location.reload();
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

- [ ] **Step 8: Update popup.ts to wire everything together**

Replace `packages/extension/src/popup/popup.ts`:

```typescript
import './popup.css';
import { signIn, onAuthChange, getCurrentUser } from '../lib/auth';
import { initTheme } from '../lib/theme';
import { renderSignOffView } from './views/sign-off';
import { renderDocumentsView } from './views/documents';
import { renderSettingsView } from './views/settings';
import { initCreateSignatureModal } from './components/create-signature-modal';
import { api } from '../lib/api';
import type { UserProfile } from '@doc-align/shared';

// Init theme
initTheme();

// Tab switching
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    const target = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${target}`)?.classList.add('active');

    // Lazy-load tab content
    if (target === 'signoff') renderSignOffView(document.getElementById('signoff-view')!);
    if (target === 'documents') renderDocumentsView(document.getElementById('documents-view')!);
    if (target === 'settings') renderSettingsView(document.getElementById('settings-view')!);
  });
});

// Modal close handlers
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.modal-overlay')?.classList.add('hidden');
  });
});

// Diff modal close
document.getElementById('diff-close')?.addEventListener('click', () => {
  document.getElementById('diff-modal')?.classList.add('hidden');
});

// Auth state
onAuthChange(async (user) => {
  const authScreen = document.getElementById('auth-screen')!;
  const mainScreen = document.getElementById('main-screen')!;

  if (user) {
    authScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');

    // Set user info in header
    const emailEl = document.getElementById('user-email')!;
    emailEl.textContent = user.email || '';

    // Get tier
    try {
      const profile = (await api.getUser()) as UserProfile;
      const badge = document.getElementById('tier-badge')!;
      badge.textContent = profile.tier.toUpperCase();
      badge.className = `tier-badge ${profile.tier}`;

      // Init create signature modal
      initCreateSignatureModal(profile.tier, () => {
        renderSignOffView(document.getElementById('signoff-view')!);
      });
    } catch {
      // Continue without tier info
    }

    // Load default tab
    renderSignOffView(document.getElementById('signoff-view')!);
  } else {
    authScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  }
});

// Sign in button
document.getElementById('sign-in-btn')?.addEventListener('click', async () => {
  try {
    await signIn();
  } catch (err) {
    alert('Sign-in failed. Please try again.');
  }
});
```

- [ ] **Step 9: Build and verify**

Run: `cd packages/extension && pnpm run build:dev`
Expected: Build succeeds

- [ ] **Step 10: Commit**

```bash
git add packages/extension/src/popup/
git commit -m "feat: add popup views (sign-off, documents, settings) and UI components"
```

---

## Task 14: Extension — Content Script (Signature Insertion & Hover Tooltip)

**Files:**
- Modify: `packages/extension/src/content/content.ts`
- Modify: `packages/extension/src/content/content.css`

- [ ] **Step 1: Implement full content script with hover detection**

Replace `packages/extension/src/content/content.ts`:

```typescript
import './content.css';

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_DOC_INFO') {
    const docId = extractDocId(window.location.href);
    const title = document.title.replace(' - Google Docs', '').trim();
    sendResponse({ docId, title });
  }
  return true;
});

function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Signature hover detection
// Look for images that match doc-align signature pattern
function setupHoverDetection(): void {
  const observer = new MutationObserver(() => {
    detectSignatureImages();
  });

  // Observe the document editor for changes
  const editor = document.querySelector('.kix-appview-editor');
  if (editor) {
    observer.observe(editor, { childList: true, subtree: true });
  }

  // Initial scan
  detectSignatureImages();
}

function detectSignatureImages(): void {
  // Google Docs renders images as <img> inside the editor
  const images = document.querySelectorAll('.kix-appview-editor img');
  images.forEach((img) => {
    if ((img as HTMLElement).dataset.daProcessed) return;
    (img as HTMLElement).dataset.daProcessed = 'true';

    img.addEventListener('mouseenter', (e) => showTooltip(e as MouseEvent, img as HTMLImageElement));
    img.addEventListener('mouseleave', hideTooltip);
  });
}

let tooltipEl: HTMLElement | null = null;

function showTooltip(e: MouseEvent, img: HTMLImageElement): void {
  // Check if this image is a doc-align signature by querying the backend
  // For now, show a generic tooltip for any image that could be a signature
  // In production, we'd verify the image hash against stored sign-offs

  hideTooltip();

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'da-tooltip';
  tooltipEl.innerHTML = `
    <div class="da-tooltip-name">Checking signature...</div>
  `;

  document.body.appendChild(tooltipEl);
  positionTooltip(e);

  // Query background for sign-off info
  const docId = extractDocId(window.location.href);
  if (docId) {
    chrome.runtime.sendMessage(
      { type: 'CHECK_SIGNATURE', docId, imgSrc: img.src },
      (response) => {
        if (response?.found && tooltipEl) {
          const statusClass = response.hasChanged ? 'changed' : 'current';
          const statusText = response.hasChanged ? 'Document modified' : 'No changes since sign-off';
          tooltipEl.innerHTML = `
            <div class="da-tooltip-name">${escapeHtml(response.signerName)}</div>
            <div class="da-tooltip-date">Signed ${response.signedDate}</div>
            <div class="da-tooltip-status">
              <div class="da-tooltip-dot ${statusClass}"></div>
              ${statusText}
            </div>
            ${response.hasChanged ? '<div class="da-tooltip-link">View changes</div>' : ''}
          `;
        } else if (tooltipEl) {
          hideTooltip();
        }
      },
    );
  }
}

function positionTooltip(e: MouseEvent): void {
  if (!tooltipEl) return;
  tooltipEl.style.left = `${e.pageX + 12}px`;
  tooltipEl.style.top = `${e.pageY + 12}px`;
}

function hideTooltip(): void {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Init
if (document.readyState === 'complete') {
  setupHoverDetection();
} else {
  window.addEventListener('load', setupHoverDetection);
}
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/extension && pnpm run build:dev`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/content/
git commit -m "feat: add content script with signature hover detection and tooltip"
```

---

## Task 15: Placeholder Icons & Final Build Verification

**Files:**
- Create: `packages/extension/src/icons/` (placeholder PNGs)

- [ ] **Step 1: Create placeholder icon files**

Generate minimal placeholder icons (these would be replaced with real brand icons later):

```bash
cd packages/extension && mkdir -p src/icons
# Create minimal 1x1 transparent PNGs as placeholders
# In practice, replace with actual brand icons
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10\x08\x06\x00\x00\x00\x1f\xf3\xffa\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > src/icons/icon-16.png
cp src/icons/icon-16.png src/icons/icon-48.png
cp src/icons/icon-16.png src/icons/icon-128.png
```

- [ ] **Step 2: Full build of all packages**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm run build-all`
Expected: shared builds (tsc), backend builds (tsc), extension builds (webpack) — all succeed

- [ ] **Step 3: Run all tests**

Run: `cd /Users/daniel/git_repos/doc-align && pnpm run test-all`
Expected: All tests pass across all packages

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/icons/
git commit -m "feat: add placeholder icons and verify full build"
```

---

## Task 16: Integration Smoke Test & README

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create CLAUDE.md with project conventions**

Create `CLAUDE.md`:

```markdown
# doc-align

Privacy-first Chrome extension for Google Docs sign-off and alignment.

## Project Structure

TypeScript monorepo with pnpm workspaces:
- `packages/shared` — types, validation (Zod), tier logic
- `packages/backend` — Express API (Firebase Auth, Firestore, Stripe)
- `packages/extension` — Chrome extension (Manifest V3, webpack)

## Commands

- `pnpm install` — install all dependencies
- `pnpm run build-all` — build all packages
- `pnpm run test-all` — run all tests
- `pnpm run typecheck` — typecheck all packages
- `cd packages/extension && pnpm run watch` — dev build with watch
- `cd packages/backend && pnpm run dev` — dev server with hot reload

## Key Conventions

- All types shared via `@doc-align/shared` workspace package
- Backend stores NO document content — only signature metadata and doc references
- Diff computation is always client-side (extension)
- Firebase Auth for both extension auth and backend API auth
- Zod schemas validate at API boundaries
- Tests use vitest
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "feat: add CLAUDE.md with project conventions"
```

- [ ] **Step 3: Verify final git state**

Run: `cd /Users/daniel/git_repos/doc-align && git log --oneline`
Expected: Clean commit history with all tasks committed
