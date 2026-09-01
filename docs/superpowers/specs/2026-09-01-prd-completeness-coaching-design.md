# PRD Completeness Coaching Design

Before a PRD's first signature is collected, doc-align checks that the doc states what's being built and how success will be measured — and coaches the owner to fill gaps on the spot, rather than discovering them after everyone's already signed.

## Overview

This is the first piece of a larger roadmap (sign-off accountability → convert to a Linear project with coaching → post-doc drift/retro tracking). It's scoped narrowly on purpose: it only handles the pre-signature completeness check. Converting a doc to a Linear project and tracking drift/scope-creep after that are separate future specs that will consume the data this feature produces, but are not designed here.

**Problem:** stakeholders sign off on PRDs that are missing basic clarity — what's being built and why, and what "done" looks like. Discovering this later (e.g., when someone tries to turn the doc into a project) is too late: people already signed something incomplete, and fixing it after the fact either means asking for re-signature or letting the gap ride.

**Approach:** gate the moment right after "Create baseline," before any signers are invited. Read the doc's text, ask Claude to classify whether two things are present, and if not, let the owner fill them in inline without leaving the sidebar.

## The two required elements

1. **Press Release** — what's being built and why people should care (Amazon-style working-backwards framing).
2. **Definition of Done** — a demo description and/or success metrics proving it was hit.

Both are fixed and mandatory for every org — no per-org configuration, no template registry, no required/optional distinction. (An earlier version of this design explored org-configurable Google Docs templates with up to three registered header-lists; that was deliberately dropped in favor of this simpler, fixed pair. Per-org configurability may return later if usage shows the fixed pair doesn't fit everyone, but isn't built now.)

## Detection method

The doc's fetched text is sent to Claude (Haiku tier) for classification and extraction, rather than matching against expected headings. Heading-matching was considered and rejected: it's brittle against phrasing variation (a "Problem Statement" heading may contain a perfectly good Press Release-equivalent). Two Claude calls' worth of judgment is cheap and far more forgiving than string matching.

**This is a deliberate departure from this project's earlier "privacy-first, never analyze document content" positioning.** That framing has been explicitly deprioritized in favor of hitting product goals (see `CLAUDE.md` and project memory `project_privacy_priority_shift`). The one invariant that survives is narrower: document content is still never *persisted* wholesale — only the two extracted snippets (Press Release / DoD text) are stored, the same way `changeSummary` already stores section-level diff metadata without the full document.

If the LLM call fails for any reason (bad/missing key, timeout, network error, malformed response) or the model reports either element missing, the owner sees a manual-entry fallback — the feature never requires the LLM to be reachable in order for the owner to proceed.

## Flow placement

Inserted between "Create baseline" and the `AddSigners` card — i.e., before any signer is invited, not at sign-time. This is deliberate: review should happen upfront, before anyone commits to reviewing or signing an incomplete doc.

```
EmptyState → [Create baseline clicked]
           → (new) fetch doc text, classify via Claude
           → both found?  ──yes──> AddSigners (unchanged, fully automatic)
                  │no
                  ▼
           PRDCoaching card (shows found/missing per field,
           inline text entry for anything missing, "Continue" to proceed)
           → [Continue clicked] → AddSigners
```

**Runs once per doc, on first baseline creation only.** If an owner re-triggers baseline creation on a doc that already has a resolved coaching result, the check does not re-run and does not overwrite what's already there — a manually-typed Definition of Done shouldn't get silently clobbered by a second automated pass.

## Coaching UX

- **Both found:** fully automatic, no card shown — the owner never sees this step at all.
- **Anything missing (or the check failed entirely):** a card shows each field's status. Found fields display a read-only excerpt of what was extracted. Missing fields show an inline text box to fill in on the spot.
- **Override:** the owner can leave a missing field blank and click "Continue" anyway — this isn't a hard gate, it's a nudge. What's recorded reflects the source of each field: found by the LLM, typed manually, or explicitly skipped.

## Data captured

Per document, once resolved: whether each of the two elements is present, its text (LLM-extracted or manually typed), where it came from (llm / manual / skipped), and when/by whom it was resolved. This becomes durable baseline data for the future Linear-conversion phase — it is not re-derived or re-checked after this step.

## Scope boundaries

**In scope:**
- Fetching doc text and classifying it via Claude for the two required elements
- The `PRDCoaching` card: status display, inline capture for gaps, override-by-continuing
- Persisting the resolved result once, guarded against re-running on subsequent baseline-creation attempts for the same doc
- Manual-entry fallback fully independent of LLM availability
- Tests covering the LLM client and the end-to-end route flow (happy path, partial gaps, override, LLM failure)

**Out of scope (future work):**
- Converting the doc into a Linear project (a separate future spec; will read the data this feature produces)
- Drift/scope-creep tracking and the "Project Management Score" retro (a separate future spec)
- Per-org configurable required fields / Google Docs template registry (explicitly considered and dropped for this round)
- Org bring-your-own-model/API-key support (Haiku via a single shared `ANTHROPIC_API_KEY` is sufficient for now; the config is not being built to anticipate per-org keys yet)
- Any change to how signers interact with the doc — this only affects the owner, before signers are invited
