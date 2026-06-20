# doc-align: Workspace Add-on Design (2026-06-14, updated)

## Context

doc-align helps teams get everyone aligned on a PRD before starting work. The PRD owner requests sign-offs from reviewers; signers commit to the document at a point in time; if the doc drifts meaningfully afterward, signers are notified and must re-review.

The existing `packages/workspace-addon` (Apps Script + React iframe) is a POC with no persistent backend. It is being replaced entirely.

The goal of this design:
1. Multi-surface Google Workspace Add-on (Docs sidebar + Gmail contextual trigger)
2. Full custom backend (Go + Firestore + Cloud Run)
3. Privacy model where document content never persists on our servers
4. Distribution that works for enterprise without requiring Marketplace listing at MVP

---

## Platform Decision

| Dimension | Decision |
|---|---|
| UI framework | Card Service (native Google look, no custom CSS) |
| Backend language | Go |
| Backend hosting | Cloud Run |
| Database | Firestore |
| Surfaces | Google Docs sidebar + Gmail contextual trigger |
| Distribution | Cloud Console install (MVP) → Unlisted Marketplace → Admin Console domain-wide |
| Auth | Google OIDC JWT (from add-on event payload), verified by backend |
| Doc content access | Google Docs REST API (`documents.readonly`) + Drive Revisions API (`drive.file`) |
| Revision auth | Owner's refresh token stored encrypted in Firestore (see Revision Auth section) |
| Content storage | Never persisted — revision IDs and metadata only |

**Why Go over Node.js?** Every Card Service interaction is a fresh HTTP POST from Google's servers. Cold start on Cloud Run is <100ms in Go vs 1–2s in Node. Users feel this on every sidebar tap. Goroutines also make parallel revision fetches (N signers = N API calls) natural.

**Why Firestore over Postgres?** Data is naturally hierarchical (doc → signers, history, requests). No relational queries across documents. No schema migrations. Postgres's strengths don't apply here.

**Why not Chrome Extension?** Enterprise orgs block or restrict extension installs. Workspace Add-ons can be admin-deployed org-wide.

**Why not HTML Service (React)?** Looks like a web app in an iframe rather than native Workspace UI. Enterprise customers expect the native Card Service look.

---

## Surfaces

### Google Docs Sidebar
Triggered when the user opens the add-on in a Google Doc. Primary surface for the owner (create baseline, manage signers, view status). Secondary surface for signers (view status, sign).

### Gmail Contextual Trigger
Fires automatically when any user opens any email (unconditional trigger — no sender filtering is available in the manifest). The backend checks the sender immediately; if not from `noreply@doc-align.com`, returns an empty card response within 50ms without touching Firestore.

When the email IS from doc-align, the backend extracts the `docId` from a custom email header (`X-DocAlign-DocId`), looks up Firestore state, and returns a context-appropriate card. This means:
- **Review request email** → Gmail sidebar shows the request details + "Open document" link
- **Drift notification email** → Gmail sidebar shows the diff inline + "Re-sign" button

This is the primary sign path for signers. They open the notification email, the sidebar auto-opens, and they re-sign without ever navigating to Google Docs.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Docs surface                                        │
│                                                     │
│  User opens sidebar in Google Docs                  │
│    → Google POSTs to /addon/homepage                │
│      body: { docs: { id, title },                   │
│              authorizationEventObject: {            │
│                userOAuthToken },                    │
│              Authorization: "Bearer <OIDC JWT>" }   │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│ Gmail surface                                       │
│                                                     │
│  User opens any email in Gmail                      │
│    → Google POSTs to /addon/gmail-trigger           │
│      body: { gmail: { messageId },                  │
│              authorizationEventObject: {            │
│                userOAuthToken },                    │
│              Authorization: "Bearer <OIDC JWT>" }   │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
        Go middleware: verifyGoogleOIDC
          - Verifies JWT signature via Google's JWKS endpoint
          - Extracts user email from JWT sub claim
                    │
                    ▼
        Addon router (packages/backend/addon/)
          - Reads Firestore state for docId + user
          - If drift check due: fetches doc text + revision text
            (in memory only, discarded after use)
          - Builds and returns Card Service JSON
                    │
                    ▼
        Card Service JSON → rendered in Docs sidebar or Gmail sidebar
```

Every interaction (button click, form submit) is a new POST. State is held in Firestore, not in the card.

---

## Revision Auth

**Problem:** The Drive Revisions API requires writer-level access or higher. Most signers are commenters or viewers — they cannot call the Revisions API. Using the signer's `userOAuthToken` for drift detection would silently fail for the majority of signers.

**Solution:** Store the owner's refresh token in Firestore, encrypted via Cloud KMS. Use it to:
1. Mark the baseline revision `keepForever` at baseline creation
2. Fetch signed revision text at drift detection time (for all signers)

The owner consents to this at first use — the OAuth consent screen explicitly states doc-align will access the document on their behalf. This is standard practice for Workspace integrations (same model as Zapier, Slack, Notion).

The requesting user's `userOAuthToken` is used only for reading the current doc text (they have read access to the doc they have open). Revision fetches always use the owner's token.

---

## OAuth Scopes

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.addons.current.message.metadata"
]
```

| Scope | Classification | Purpose |
|---|---|---|
| `documents.readonly` | **Sensitive** | Read current doc content via Docs API for drift comparison |
| `drive.file` | Non-sensitive | Revision management — list, mark keepForever, export baseline text |
| `userinfo.email` | Non-sensitive | Identify who is opening the sidebar |
| `gmail.addons.current.message.metadata` | Non-sensitive | Read email sender/headers in Gmail contextual trigger |

No restricted scopes are used. `drive.readonly` (restricted, requires CASA audit) is explicitly avoided. The one sensitive scope (`documents.readonly`) requires Google's sensitive scope verification — a form submission + demo video, typically 1–2 weeks.

**Optimization to evaluate during implementation:** The Drive API `files.export` endpoint can export a Google Doc as `text/html`, which preserves heading tags (`<h1>/<h2>`). If this works with `drive.file` scope alone for files opened through the add-on, `documents.readonly` can be dropped entirely, making all scopes non-sensitive. Verify this early — it affects the verification timeline.

---

## Privacy Model

**Guarantee: document content is never written to doc-align servers or databases.**

### What Firestore stores

```
documents/{docId}
  title
  ownerId
  ownerRefreshToken    ← encrypted via Cloud KMS, used for revision fetches
  baselineRevisionId
  lastDriftCheckedAt   ← cache: skip drift check if fresher than 5 minutes
  createdAt

documents/{docId}/signers/{email}
  status               — 'pending' | 'signed' | 'drifted'
  signedAt
  signedRevisionId     — Google's revision ID at time of signing (not content)
  driftDetectedAt
  notifiedAt

documents/{docId}/history/{id}
  action, actorEmail, timestamp, commitMessage, revisionId

documents/{docId}/reviewRequests/{id}
  requestedBy, requestedAt, signerEmails, message
```

### How revision-based snapshots work

At baseline creation:
1. Backend calls `GET /drive/v3/files/{docId}/revisions` with owner's token → gets latest revision ID
2. Calls `PATCH /drive/v3/files/{docId}/revisions/{revisionId}` with `{ keepForever: true }` → prevents Google pruning it
3. Stores only the revision ID in Firestore under `baselineRevisionId`

At drift detection (triggered on homepage open, skipped if `lastDriftCheckedAt` < 5 min ago):
1. Fetch current doc text via Docs API using requesting user's `userOAuthToken` (in memory)
2. For each signer with `status == 'signed'`:
   a. Fetch `signedRevisionId` export text via Drive Revisions API using **owner's decrypted refresh token** (in memory)
   b. Compare, compute diff, update Firestore status if drifted
3. Update `lastDriftCheckedAt`
4. Discard all text — nothing written to storage

**Audit statement to customers:** "doc-align stores only document IDs, revision IDs, signer metadata, and sign-off timestamps. Your document content never leaves Google's infrastructure. We store an encrypted OAuth token to check your document for drift on your behalf; you can revoke access at any time."

---

## Card Views — Docs Surface

Eight views total. Cards are personalized based on whether the requesting user is the owner or a signer (determined by comparing JWT email against Firestore `ownerId`).

### 1. Empty State
*`POST /addon/homepage` — no baseline exists, requesting user is owner*

- TextParagraph: "No baseline yet. Create one to start collecting sign-offs."
- Button: "Create baseline" → `POST /addon/create-baseline`

Non-owners who open the sidebar before a baseline exists see: "The document owner hasn't created a baseline yet."

### 2. Add Signers
*`POST /addon/create-baseline`*

Baseline revision is marked `keepForever` immediately when this endpoint is called — before signers are saved. This avoids orphaned state if the user abandons the card.

- SelectionInput (MULTI_SELECT): pre-populated with current Drive collaborators on the doc
- TextInput: freeform email field for adding non-collaborators
- Warning banner (if any selected emails lack read access to the doc): "These signers don't have access to this document — share it with them before sending requests"
- Button footer: "Done" → `POST /addon/save-signers`

### 3. Status Card — Owner View
*`POST /addon/homepage` — baseline exists, requesting user is owner*

- TextParagraph: "{N} signed · {N} drifted · {N} pending"
- DecoratedText rows per signer (sorted: drifted → pending → signed):
  - Icon: CHECK_CIRCLE (signed), WARNING (drifted), HOURGLASS (pending)
  - Top label: display name or email
  - Bottom label: status + relative timestamp
  - If drifted: "View changes" button → `POST /addon/diff`
- Button footer: "History" → `POST /addon/history`
- Overflow menu (CardAction): "Simulate drift" (demo only), "Reset demo"

### 4. Status Card — Signer View
*`POST /addon/homepage` — baseline exists, requesting user is a signer*

- DecoratedText: their own status (icon + label + timestamp)
- If `status == 'drifted'`: TextParagraph summarising what changed, Button "View changes" → `POST /addon/diff`
- If `status == 'pending'` or `status == 'drifted'`: Button "Sign this doc" → `POST /addon/sign-form`
- If `status == 'signed'`: TextParagraph "You signed off on {date}. {commitMessage}"

### 5. Sign Form
*`POST /addon/sign-form`*

- TextParagraph: "Signing as {userEmail}"
- TextInput (multiline, optional): commit message
  - On **re-sign after drift**: pre-filled with 1–2 line AI suggestion (Claude Haiku, generated from the diff)
  - On **first sign**: empty, no suggestion
- ButtonSet quick-sign chips: LGTM · Approved · Looks good · Signed off (each submits with that text as commit message → `POST /addon/quick-sign`)
- Button footer: "Sign" → `POST /addon/sign`, "Cancel" → `POST /addon/homepage`

### 6. Diff View
*`POST /addon/diff`*

- TextParagraph: "+{N} added · -{N} removed"
- One Section per changed document section:
  - Header: section title (e.g. "Requirements", "Success Metrics")
  - TextParagraph with color markup: `<font color="#1e8e3e">+ added</font>` / `<font color="#d93025">- removed</font>`
- Button footer: "Re-sign" → `POST /addon/sign-form`, "Back" → `POST /addon/homepage`

### 7. History
*`POST /addon/history`*

- DecoratedText rows (newest first):
  - Icon: STAR (baseline created), CHECK_CIRCLE (signed), WARNING (drift), PERSON (review requested)
  - Top label: "{actor} {action}"
  - Bottom label: "{relative time} · {commitMessage}"
- Button footer: "Back" → `POST /addon/homepage`

---

## Card Views — Gmail Surface

### 8. Gmail: Review Request
*`POST /addon/gmail-trigger` — email is a review request notification*

- TextParagraph: "{requester} has asked you to review: {docTitle}"
- TextParagraph: requester's message (if any)
- Button: "Open document" → opens `https://docs.google.com/document/d/{docId}` in new tab

### 9. Gmail: Drift Notification
*`POST /addon/gmail-trigger` — email is a drift notification*

- TextParagraph: "This document has changed since you signed off."
- Diff summary (same structure as Diff View card)
- Button footer: "Re-sign" → `POST /addon/sign` (with empty commit message) or redirects to Sign Form, "View in document" → opens doc

---

## Drift Detection

### Caching
Drift check runs on every `POST /addon/homepage` and `POST /addon/gmail-trigger` (for drift emails). To avoid N Drive API calls on every open, the check is skipped if `lastDriftCheckedAt` is less than 5 minutes ago. The cached result (current signer statuses) is returned immediately from Firestore.

### Algorithm (MVP — heuristic)

```
If now - lastDriftCheckedAt < 5 minutes: return cached statuses

1. Fetch current doc text via Docs API (requesting user's token)
2. For each signer with status == 'signed':
   a. Decrypt owner's refresh token from Firestore
   b. Exchange for access token via Google OAuth
   c. Fetch signedRevisionId export text via Drive Revisions API
   d. Parse both texts into sections by heading (H1/H2)
   e. Run LCS diff per section
   f. Flag as drifted if:
      - Any section heading was added or removed
      - Similarity score of any section < 0.80
   g. If newly drifted:
      - Update Firestore: status = 'drifted', driftDetectedAt = now
      - Send email to signer (if notifiedAt is null)
3. Update lastDriftCheckedAt = now
4. Discard all text
```

### What does NOT trigger drift
- Whitespace or punctuation-only changes
- Rewording within a section above 0.80 similarity
- Changes to sections with no signed-off reviewers

### Phase 2: AI drift classification
Pass the diff to Claude Haiku:
> "Does this diff represent a new requirement, removed requirement, or significant scope change? Answer YES or NO."

Only flag drift if YES. ~$0.001 per check. Reduces false positives from significant-but-non-semantic rewording.

---

## Notifications

Sent via SendGrid (or Resend). No Gmail API scope needed for outbound email.

| Trigger | Recipient | Content |
|---|---|---|
| Review requested | Each signer | Doc title, requester name, message, link to doc |
| All signers signed | Owner | "{N} reviewers have signed off on {docTitle}" |
| Drift detected | Drifted signer | Diff summary (sections + line counts), "Re-sign anyway" link, "View in document" link |

Email headers include `X-DocAlign-DocId: {docId}` so the Gmail contextual trigger can identify doc-align emails without reading the body.

The sidebar reflects current Firestore state on every open. No live push updates to an already-open sidebar.

---

## Distribution

Three paths in order of complexity. No path requires the other.

### Path 1: Testing mode (MVP, today)
Install via Google Cloud Console → Workspace Add-on SDK → HTTP Deployments → Install. Share with up to ~100 test users by adding their Google accounts to the Cloud project. Users see an "unverified app" warning but can proceed. Refresh tokens expire every 7 days — users re-authorize weekly. No review, no privacy policy required.

### Path 2: Unlisted Marketplace (early customers)
Publish to Marketplace but mark as unlisted (not publicly searchable). Users install via a direct link you share. Requires:
- Hosted privacy policy URL
- Sensitive scope verification (`documents.readonly`): submit use case + demo video, ~1–2 weeks
- No editorial review, no Marketplace listing page

### Path 3: Enterprise admin deployment (B2B)
Customer's IT admin installs the add-on via their Google Admin Console → Apps → Google Workspace Marketplace apps. The add-on appears for all users in scope without any per-user install or consent prompt. The admin sees and approves the scopes once. This is the primary enterprise distribution path and does not require a public Marketplace listing.

---

## Error States

Every card must handle these cases:

| Error | Card response |
|---|---|
| Drive API timeout or 5xx | TextParagraph: "Couldn't reach Google Drive. Try reopening the sidebar." |
| Signer lacks doc access | Warning on Add Signers card before saving |
| Revision no longer accessible | TextParagraph: "The baseline revision is no longer available. The owner may need to recreate the baseline." |
| Owner token expired/revoked | TextParagraph: "doc-align lost access to this document. The owner needs to reconnect." with "Reconnect" button → OAuth re-authorization |
| Firestore read error | TextParagraph: "Something went wrong. Please try again." |

---

## Code Structure

```
packages/workspace-addon/
  manifest/
    appsscript.json        ← add-on manifest: HTTPS endpoints, OAuth scopes, Docs + Gmail triggers
  [Remove: apps-script/, sidebar/]

packages/backend/
  addon/
    middleware/
      verify_oidc.go       ← verify Google-signed OIDC JWT; extract email from sub claim
    routes/
      homepage.go          ← POST /addon/homepage
      gmail_trigger.go     ← POST /addon/gmail-trigger
      create_baseline.go   ← POST /addon/create-baseline
      save_signers.go      ← POST /addon/save-signers
      sign_form.go         ← POST /addon/sign-form
      sign.go              ← POST /addon/sign
      quick_sign.go        ← POST /addon/quick-sign
      diff.go              ← POST /addon/diff
      history.go           ← POST /addon/history
    cards/
      empty_state.go       ← card builders returning Card Service JSON structs
      add_signers.go
      status_owner.go
      status_signer.go
      sign_form.go
      diff_view.go
      history_view.go
      gmail_review.go
      gmail_drift.go
    services/
      doc_revisions.go     ← Drive Revisions API: list, keepForever, export text (uses owner token)
      doc_text.go          ← Docs API: fetch current text, parse sections by heading
      drift_detection.go   ← LCS diff, section comparison, similarity scoring, cache check
      owner_token.go       ← store/retrieve/refresh owner OAuth token via Cloud KMS
      notifications.go     ← SendGrid: review request, all-signed, drift emails
      commit_message.go    ← Claude Haiku: generate 1–2 line commit message from diff (re-sign only)
```

---

## Post-MVP: Linear Integration

1. "Create ticket" button appears on sections in the Diff View
2. `POST /addon/create-ticket` → backend sends section text to Claude → draft title + description
3. New card: pre-filled ticket form; user confirms
4. Backend calls Linear API → ticket created → `documents/{docId}/tickets/{ticketId}` in Firestore
5. Linked ticket status shown alongside the section on future sidebar opens

**Bidirectional sync:**
- Linear webhook → backend → Firestore (ticket status updates on next open)
- On drift: check if changed sections have linked tickets → surface "suggest ticket update" prompt

---

## Verification Checklist

1. Deploy backend to Cloud Run staging
2. Register add-on in Google Cloud Console with staging endpoint
3. Developer-install on a test Google Doc and a test Gmail account
4. Walk all card views in Docs: Empty State → Add Signers → Status (owner) → Sign Form → Diff View → History
5. Walk all card views in Gmail: open review request email (trigger fires, card shows), open drift email (diff card shows, re-sign works)
6. Confirm Firestore after sign-off: only revision ID stored, no text fields
7. Edit doc after signing → reopen sidebar → confirm drift detected and Diff View renders correctly
8. Confirm owner receives email when last signer signs
9. Confirm signer receives drift email with diff summary
10. Verify Drive API: signed revision has `keepForever: true`
11. Test error states: revoke owner token → confirm reconnect card appears
12. `go test ./...`
