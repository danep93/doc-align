# MVP Scope Cut: Remove PRD Coaching, Simplify Sign-Off

After running the full add-on flow end-to-end for the first time (baseline → PRD coaching → add signers → sign → status), the owner-side UI was judged too cluttered relative to what the product actually needs to prove out first. This cuts scope back to a single, tight loop and removes a just-shipped feature that isn't part of it.

## Problem

doc-align's MVP goal is narrower than what's currently built: get everyone aligned on a document by inviting signers, having them sign, and letting everyone see (a) who has signed and (b) what's changed since their last signature. PRD completeness coaching (Press Release / Definition of Done extraction) is a real feature with its own roadmap value, but it sits in front of the core loop, adds a full LLM-backed card + Firestore fields + a resolve route, and was flagged directly as UI clutter after hands-on testing. The sign form separately offered three redundant ways to submit the same action (4 quick-sign chips, a note field, and a Sign button).

## Decision

Cut PRD coaching completely, and collapse the sign form to one action. Everything else in the current card map (`EmptyState`, `AddSigners`, `StatusOwner`, `StatusSigner`, `History`, `DiffView`, `ConnectDocument`, remove-signer) stays as-is — those were each individually confirmed as in-scope for the MVP loop during design review, not cut.

### 1. Remove PRD completeness coaching entirely

Delete, don't disable — this is a full removal, not a feature flag:

- `cards/coaching.go`, `cards/coaching_test.go` — the `PRDCoaching` card
- `services/prd_coaching.go` — `EvaluateCoaching` decision logic
- `services/anthropic.go` — the Anthropic API client (nothing else in the codebase uses it; confirmed via grep before this spec was written)
- `routes/coach_resolve.go` — the `/addon/coach-resolve` handler
- `routes/coaching_e2e_test.go` — tests for the removed flow

Edit in place:

- `routes/create_baseline.go` — remove the entire coaching branch (doc-text fetch for classification, `ClassifyPRDCompleteness` call, `EvaluateCoaching`, the `PRDCoaching` card response). After `CreateDoc` and fetching collaborators, always respond with `cards.Push(cards.AddSigners(collaborators, docID))` — the same response the "re-run create-baseline on an existing doc" path already produces today. This also removes the now-unneeded `isFirstBaseline` branching and the `anthropicClient` parameter from `CreateBaseline`'s signature.
- `main.go` — remove `ANTHROPIC_API_KEY` loading, the `anthropicClient` construction, and the `/addon/coach-resolve` route registration.
- `services/firestore.go` — remove `CoachingResult *PRDCoachingResult` from `DocRecord` and delete the `PRDCoachingResult` type. `UpdateDocFields` (the generic field-patcher these called) stays — it's generic infrastructure, not coaching-specific.
- `CLAUDE.md` — remove every PRD-coaching reference: the owner-flow description, the `PRDCoaching` card-map row, the Firestore schema's `coachingResult` field, and the "PRD completeness coaching" subsection under Active Work.

Not touched: `docs/superpowers/specs/2026-09-01-prd-completeness-coaching-design.md` stays in place as a historical record of a feature that was built, tested, and then explicitly descoped — specs document decisions at the time they were made, not current state.

### 2. Simplify the sign form to one action

- `cards/sign_form.go` — remove the "Quick sign:" label and the four chip buttons (LGTM / Approved / Looks good / Signed off). Keep the optional multi-line note field and the `Sign` / `Cancel` buttons. Result: one clear way to sign, with an optional note.
- `routes/quick_sign.go` — delete. It shares all logic with `Sign` via `completeSign` in `routes/sign_common.go`, so nothing else depends on it.
- `main.go` — remove the `/addon/quick-sign` route registration.

## Data flow after this change

```
EmptyState → [Create baseline clicked]
           → CreateDoc, fetch collaborators
           → AddSigners                      (was: coaching check → sometimes PRDCoaching → AddSigners)
```

Sign-off itself is unchanged except for the trimmed form:

```
StatusSigner → [Sign this document] → SignForm (note field + Sign button only) → Sign → StatusSigner
```

## Scope boundaries

**In scope:**
- Full removal of every PRD-coaching file, route, schema field, and doc reference listed above
- Sign form reduced to note + single Sign button, with the now-dead quick-sign route removed
- `go build ./...` and `go test ./...` passing after the change
- Manual re-verification on the local ngrok test stack: "Create baseline" goes straight to `AddSigners` with no intermediate card

**Out of scope (explicitly kept, not touched by this spec):**
- `History` card and its Firestore-backed audit log
- `DiffView` card and the `/addon/diff` route (kept alongside `StatusSigner`'s inline "What changed" section, which already shares the same `changeSummaryWidgets` helper)
- The remove-signer button on `StatusOwner`
- `AddSigners`, `EmptyState`, `ConnectDocument`, `StatusOwner`, `StatusSigner` — no content or layout changes beyond what's listed above
- Any future Linear-conversion or drift-tracking work referenced in the PRD coaching spec — unaffected by this cut; if that roadmap resumes, it will need its own design, informed by the fact that PRD coaching's extracted fields no longer exist to feed it
