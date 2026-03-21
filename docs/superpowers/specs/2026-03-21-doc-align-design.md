# doc-align Design Spec

## Product Overview

doc-align is a Chrome extension that turns Google Docs into a sign-off and alignment platform for product requirements, contracts, and cross-team agreements.

**Core promise:** Sign off on a document, and always know if it changed after you agreed to it.

**Target users:** Product managers, engineering leads, designers, legal teams, and cross-company partners who need formal alignment on documents before work begins.

**Enterprise selling point:** doc-align is privacy-first. Document content never leaves Google Drive. The backend stores only signature metadata, document references (Google Doc IDs + revision IDs), and subscription data. From the server's perspective, it knows "User X signed off on Doc ABC at revision 42" but has zero knowledge of what's in that document. All revisions live in the customer's own Google Drive.

## Privacy Model

- Document content never leaves Google Drive. Ever.
- The doc-align backend stores only: user identity, subscription tier, signature metadata, and references to Google Doc IDs + revision IDs.
- Diff computation happens client-side in the extension using the user's own Google OAuth credentials.
- AI features (future) use BYOK (bring your own key) — the user's own API key, calls go directly from the browser to the LLM provider. The backend stores only the encrypted key for convenience.

## Subscription Tiers

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Sign-offs per month | 10 | Unlimited | Unlimited |
| Tracked documents | 5 | Unlimited | Unlimited |
| Signature format | Basic (name + date) | Full (name + title + org + date) | Full |
| Diff viewer | Google native link | Rich in-extension diff | Rich in-extension diff |
| AI summaries (future) | — | BYOK | BYOK + custom prompts |
| Section-level sign-off (future) | — | Yes | Yes |
| Team management (future) | — | — | Yes |
| Audit log retention | 7 days | 90 days | 1 year |

## Architecture

**Approach:** Extension-heavy with backend growth path. The extension handles signature rendering, diff computation, and doc management. The backend handles only auth, subscription tiers, and the signature registry. The monorepo structure and shared types make it straightforward to migrate capabilities to the backend as enterprise features demand it.

### Monorepo Structure

```
doc-align/
├── packages/
│   ├── extension/        # Chrome extension (Manifest V3, TypeScript)
│   │   ├── popup/        # Extension popup UI (doc list, settings)
│   │   ├── sidebar/      # Google Docs sidebar (sign-off flow, diff viewer)
│   │   ├── content/      # Content script (signature insertion, hover interactions)
│   │   └── background/   # Service worker (auth, storage sync)
│   ├── backend/          # Cloud Functions (TypeScript, Express)
│   │   ├── auth/         # Google OAuth + session management
│   │   ├── signatures/   # Signature registry CRUD
│   │   ├── subscriptions/# Stripe integration, tier enforcement
│   │   └── keys/         # Encrypted BYOK key storage (future)
│   └── shared/           # Shared TypeScript types, validation schemas (Zod)
│       ├── types/        # SignOff, Signature, Subscription, DocReference
│       └── validation/   # Input validation shared across extension + backend
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

### Technology Choices

- **pnpm workspaces** — monorepo management
- **TypeScript** — across all packages with shared types
- **Manifest V3** — required for new Chrome extensions
- **Firestore** — stores signature records, subscription data, doc references. Serverless, scales to zero.
- **Firebase Auth** — handles Google OAuth. Users already have a Google account.
- **Cloud Functions** — serverless backend deployment. $0 at rest, pay-per-invocation.
- **Stripe** — subscription management via webhooks
- **Zod** — shared validation schemas between extension and backend
- **diff-match-patch** — Google's text diffing library for client-side diff computation

### Responsibility Matrix

| Concern | Where | Why |
|---------|-------|-----|
| Signature image rendering | Extension (canvas to PNG) | Fast, no server round-trip, no doc content leaves browser |
| Signature drawing | Extension (freehand canvas) | User draws their own signature in the extension |
| Signature insertion into doc | Extension (content script) | Direct DOM/clipboard access needed |
| Diff computation | Extension (Revisions API) | Doc content stays client-side |
| Sign-off record storage | Backend to Firestore | Source of truth for "who signed what, when, at which revision" |
| Sign-off counts per revision | Backend to Firestore | Aggregates sign-offs from all users on a doc+revision |
| Subscription enforcement | Backend middleware | Cannot trust client-side tier checks |
| User profile / tier info | Backend to Firestore | Stripe webhook updates tier |
| Encrypted API keys (future) | Backend to Firestore | Secure storage for BYOK keys |

## Data Model

### Signature (template — reusable across sign-offs)

```typescript
{
  id: string
  userId: string
  name: string
  title?: string              // Pro+ only
  organization?: string       // Pro+ only
  format: 'basic' | 'full'   // basic = drawn sig + name + date; full = drawn sig + name + title + org + date
  drawingData: string         // Base64 PNG or serialized stroke data of the hand-drawn signature
  createdAt: Timestamp
  status: 'active' | 'retired'
}
```

### SignOff (immutable record — one per sign-off action)

```typescript
{
  id: string
  userId: string
  signatureId: string         // Which signature template was used
  documentId: string          // Google Doc ID
  revisionId: string          // Google Docs revision ID at time of sign-off
  imageHash: string           // SHA-256 of the rendered signature image (tamper detection)
  createdAt: Timestamp
}
```

### DocReference (lightweight doc pointer — no content)

Stored as a subcollection under each user in Firestore (e.g., `users/{userId}/docReferences/{docId}`). Each user has their own set of doc references scoped to docs they have signed off on.

```typescript
{
  id: string                  // Google Doc ID
  userId: string              // Owner of this reference
  title: string               // Doc title (for display in extension popup)
  lastKnownRevisionId: string // Most recent revision we are aware of
  updatedAt: Timestamp
}
```

### UserProfile

```typescript
{
  id: string                  // Firebase Auth UID
  email: string
  tier: 'free' | 'pro' | 'enterprise'
  stripeCustomerId?: string
  signOffCount: number        // Current month's sign-off count (for free tier limits)
  signOffCountResetAt: Timestamp
  createdAt: Timestamp
}
```

### Key Design Decisions

- **SignOff is immutable** — once created, never modified. This is the audit trail. Un-signing would be a separate retraction record (future feature).
- **Signature is a template, SignOff is an instance** — create a signature once, use it to sign off on many docs. Separates identity from action.
- **revisionId is the anchor** — everything about "what changed" is derived by comparing the sign-off's revisionId against the doc's current revision via Google's API. No content stored.
- **imageHash for tamper detection** — when the signature image is rendered and inserted, it is hashed. If someone modifies and re-inserts a signature, the hash will not match the backend record.

## MVP User Flows

### Flow 1: First-time Setup

1. User installs Chrome extension.
2. Opens a Google Doc. Extension icon becomes active.
3. Clicks extension icon. Popup prompts Google sign-in (Firebase Auth).
4. After auth, user creates their signature template:
   - Draws their signature freehand on a canvas (with clear/undo).
   - Enters name (required), title and organization (Pro+ only).
   - Sees a live preview of the final composited signature image.
5. Saves. Signature template stored in backend.

### Flow 2: Signing Off on a Document

1. User is in a Google Doc, clicks extension icon.
2. Popup shows their active signature(s) and a "Sign Off" button.
3. User clicks "Sign Off":
   - Extension calls Google Docs Revisions API to create/capture the current revision ID.
   - Extension renders the signature image (drawn sig + name + date, or drawn sig + name + title + org + date) on a canvas, converts to PNG.
   - Extension computes SHA-256 hash of the image.
   - Extension inserts the image into the document at the cursor position (or end of doc).
   - Extension sends sign-off record to backend (userId, signatureId, docId, revisionId, imageHash).
   - Backend validates subscription limits, stores the SignOff record.
4. Popup confirms: "Signed off on [Doc Title] at revision [X]."

### Flow 3: Viewing Your Signed-off Documents

1. User clicks extension icon (from any tab).
2. Popup shows a list of all documents the user has signed off on, sorted by most recent.
3. Each doc card shows:
   - Doc title
   - Sign-off date
   - Number of signatures on this revision (e.g., "You + 2 others")
   - Status indicator:
     - **Green** — doc has not changed since your sign-off
     - **Orange** — doc has been modified since your sign-off

4. Status is checked by comparing the stored revisionId against the doc's current revision (via Revisions API, using user's auth).

### Flow 4: Viewing What Changed (Diff)

1. From the doc list, user clicks on an orange (modified) document.
2. Extension fetches two revisions from Google: the one at sign-off time and the current one.
3. Extension computes a text diff client-side using diff-match-patch and renders a git-diff-style view:
   - Red/green highlighting for removed/added text.
   - Inline view (default): single column, additions in green, deletions in red.
   - Side-by-side view: two columns, original left and current right (in sidebar).
4. User can re-sign-off (goes to Flow 2) or follow up with the doc author.

### Flow 5: Hovering Over a Signature in a Doc

1. User hovers over a signature stamp image in a Google Doc.
2. Content script detects the hover, shows a small tooltip/card:
   - Signer name, date.
   - Status: "No changes since sign-off" (green) or "Document modified" (orange).
   - If modified: "View changes" link that opens the diff view in the extension sidebar.

## Google APIs and Permissions

### Chrome Extension Permissions (Manifest V3)

- `identity` — for Google OAuth via Firebase
- `storage` — local storage for user preferences, cached data
- `activeTab` — access to the current Google Docs tab
- Host permission: `https://docs.google.com/*` — content script injection

### Google APIs Used (via user's own OAuth token)

- **Google Docs API** — insert signature image into document
- **Google Drive Revisions API** — list revisions, fetch revision content for diff computation
- **Google Drive API** — get doc metadata (title, last modified)

### OAuth Scopes

- `https://www.googleapis.com/auth/drive.file` — access only to files the user opens with/creates through the extension (narrowest scope that covers our needs)
- `https://www.googleapis.com/auth/documents` — read/write Google Docs content (for signature insertion)

### Auth Flow

1. User signs into the extension. Firebase Auth with Google provider.
2. Firebase provides a Google OAuth token with the scopes above.
3. Extension uses that token directly to call Google APIs client-side.
4. Backend uses Firebase Auth tokens (not Google tokens) for its own API calls — it never touches Google APIs.

**Note:** Google Drive Revisions API with `drive.file` scope is a sensitive scope. Google will require a security review before the extension can be published. This is expected and should be planned for in the launch timeline.

## Diff Engine

### How It Works (all client-side)

1. User requests a diff for a doc they signed off on.
2. Extension fetches two pieces of content from Google Drive Revisions API:
   - The revision at sign-off time (stored revisionId).
   - The current/latest revision.
3. Both come back as plain text (Google exports revisions as text).
4. Extension runs diff-match-patch (Google's text diffing library).
5. Result rendered as inline or side-by-side diff view.

### Why diff-match-patch

- Created by Google specifically for diffing text documents.
- Handles character-level and word-level diffs well.
- Small library, runs fast in the browser.
- Proven in many editor/document tools.

### Display Options

- **Inline view** (default) — single column, additions in green, deletions in red (like GitHub unified diff).
- **Side-by-side view** — two columns, original left and current right (in sidebar where space permits).

### Performance

- Loading state with progress indicator for large docs.
- Cache the sign-off revision text locally (it is immutable and will never change).
- Fetch current revision on demand only.

## Extension UI and Styling

### Design Language

Linear-inspired aesthetic with both dark and light modes.

### Extension Popup (~400x500px)

Tabs/views:
- **Sign Off** — current doc context, signature preview, sign-off button.
- **My Documents** — list of all signed-off docs with status indicators and co-signer counts.
- **Settings** — signature management, theme toggle, account/subscription info.

### Google Docs Sidebar

- Diff viewer renders here (more space than popup).
- Future: AI summaries, section-level sign-offs.

### Signature Creation Modal

- Canvas area for freehand drawing (with clear/undo).
- Text fields: name (required), title (Pro+), organization (Pro+).
- Live preview of the final composited signature image.
- Save button.

### Hover Tooltip (Content Script)

- Small, non-intrusive card on hover over signature image in doc.
- Shows: signer name, date, status badge (green/orange).
- "View changes" link if modified.

### Theme

- Dark mode (default) + light mode toggle.
- Respects system preference by default.
- CSS variables for easy theming.

## Future Features (Not MVP)

These are explicitly out of scope for MVP but the architecture supports them:

- **Section-level sign-offs** — sign off on specific headings/sections of a doc (Pro+).
- **Role-based group sign-offs** — designate that "one person from Engineering" and "one person from Product" must sign off. Groups with seniority awareness via title field.
- **AI summaries and ambiguity detection** — BYOK model, user's API key, calls go directly from browser to LLM. Backend stores only the encrypted key.
- **Team management** — Enterprise tier, admin dashboards, org-level settings.
- **Sign-off retraction** — formal un-signing with audit trail.
- **Webhook notifications** — notify stakeholders when a signed-off doc changes.
