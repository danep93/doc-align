# Workspace Add-on Card Service POC (2026-06-06)

## What Was Built (Session 2 — UI Polish & Full Demo)

A polished Google Docs add-on sidebar using Apps Script Card Service that implements progressive disclosure across 6 card states. Uses in-memory state via `CacheService`, real document text access via `DocumentApp`, an LCS-based diff engine, and mocked signer data. Demo-ready end-to-end flow: Create Baseline → Add Signers → Sign → Detect Drift → View Diff → View History.

### Files

| File | Purpose |
|------|---------|
| `packages/workspace-addon/apps-script/Code.gs` | All card-building functions, state machine, mock data, LCS diff, callbacks (~1000 lines) |
| `packages/workspace-addon/apps-script/appsscript.json` | Manifest: homepage trigger, OAuth scopes, primary color |

### State Machine

```
NO_BASELINE → NO_SIGNERS → SIGNERS_READY → DRIFT_DETECTED → (re-sign) → SIGNERS_READY
```

All state stored in `CacheService.getUserCache()` as JSON. Resets on page reload (acceptable for demo). 6-hour TTL.

### Cards (Progressive Disclosure)

| # | Card | Trigger | Key Elements |
|---|------|---------|-------------|
| 1 | **Empty State** | No baseline in cache | Hero image, subtitle, purple "Create Baseline" CTA |
| 2 | **Add Signers** | After baseline created | Checkbox picker (Alice M., John D., Rahul K. + "you" label), custom signer inputs, "Done" footer |
| 3 | **Status Card** | Baseline + signers exist | Summary bar (● N signed · ● N drifted · ○ N pending), signers grouped by status, "View Diff" on drifted rows, footer: [Sign This Doc] [View History] |
| 4 | **Sign Form** | "Sign This Doc" clicked | "Signing as: You (demo user)", commit message input, quick-tap chips (LGTM, Approved, Looks good, Signed off), footer: [Sign] [Cancel] |
| 5 | **Diff View** | "View Diff" on drifted signer | Header with signer name, summary stats (+N lines -M lines), color-coded diff lines (green/red/grey), mock data fallback when doc unchanged, footer: [Back to Status] |
| 6 | **History** | "View History" clicked | Timeline grouped by date labels, entries with icons and colored action text, revision + relative time, footer: [Back to Status] |

### Actions Section (Status Card)

- **Simulate Drift** — marks all signed signers as drifted (demo shortcut; real drift via `DocumentApp` text comparison)
- **+ Add Signer** — disabled placeholder
- **Reset Demo** — clears cache, returns to empty state

### Features

- **DocumentApp integration**: `getDocText()` reads live doc content via `DocumentApp.getActiveDocument().getBody().getText()`. Snapshot taken at baseline creation and on sign-off for drift comparison.
- **LCS diff engine**: Line-by-line diff using longest common subsequence. Real diff when doc content changed; mock diff fallback for demo when unchanged.
- **Quick-sign chips**: Pre-fill commit message with one tap (LGTM, Approved, Looks good, Signed off).
- **Drift detection**: `checkDriftAndSave()` compares current doc text against baseline on every homepage render and navigation. If different, signed signers become drifted.
- **Error handling**: Try/catch on `buildHistoryCard()` and `buildDiffCard()` with fallback error card. JSON parse error handling in `getState()`. Diff lines capped at 50.

## Deployment

### Apps Script Project

- **Project ID:** `1PGi_Qg263jt-6psI6tXNkyYQAmperMIBSBSCEQ9OpMlFLYpNNdsWqYW7`
- **Deployment ID:** `AKfycbzxhUXQ-VLkucd9wxAR8fBfnn8B6LvR4ftjleCZGDTA`
- **Runtime:** V8

### Deploy Flow

1. Navigate to the [project editor](https://script.google.com/home/projects/1PGi_Qg263jt-6psI6tXNkyYQAmperMIBSBSCEQ9OpMlFLYpNNdsWqYW7/edit)
2. Inject code from `Code.gs` into the Monaco editor (see Playwright injection below)
3. Press Cmd+S to save. Wait for `cloud_done` icon (may take 30+ seconds for large files). Ignore persistent "Saving project..." tooltip if `cloud_done` is present.
4. Open any Google Doc → click `doc-align` tab in the right sidebar

### Deploy from CLI via Playwright

```javascript
// Step 1: Build injection script
// python3 << 'PYEOF'
// import json
// with open('Code.gs', 'r') as f: code = f.read()
// js_code = "async (page) => { ... " + json.dumps(code, ensure_ascii=False) + " ... }"
// write to .playwright-mcp/inject_code.js
// PYEOF

// Step 2: Navigate to editor
await page.goto('https://script.google.com/home/projects/1PGi_Qg263jt-6psI6tXNkyYQAmperMIBSBSCEQ9OpMlFLYpNNdsWqYW7/edit');
await page.waitForTimeout(4000); // wait for Monaco

// Step 3: Inject code via Monaco API
const code = fs.readFileSync('/path/to/Code.gs', 'utf8');
await page.evaluate((c) => {
  const models = window.monaco?.editor?.getModels?.();
  const jsModel = models.find(m => m.getLanguageId() === 'javascript');
  if (jsModel) jsModel.setValue(c);
}, code);

// Step 4: Save
await page.keyboard.press('Meta+s');
// Wait for cloud_done icon (check: document.body.innerHTML.includes('cloud_done'))
```

**Important:** Use `ensure_ascii=False` in Python's `json.dumps()` to preserve literal UTF-8 characters (●/○/·). Never use `\uXXXX` escape sequences in `.gs` files — they cause HTTP 500.

**Injection script must be within the workspace root** (`.playwright-mcp/` directory). Use the `filename` parameter of `playwright_browser_run_code_unsafe`.

### Verifying Deploy (Playwright)

```javascript
// Open fresh Google Doc
await page.goto('https://docs.google.com/document/create');
await page.waitForTimeout(3000);

// Click doc-align tab
await page.getByRole('tab', { name: 'doc-align' }).click();
await page.waitForTimeout(5000);

// Check addon frame content
const addonFrame = page.frames().find(f => f.url().includes('addons.gsuite.google.com'));
const text = await addonFrame.evaluate(() => document.body.innerText);
```

### Interacting with Add-on Buttons (Playwright)

Buttons in the add-on iframe are not always visible in the viewport. Use JS click:

```javascript
await addonFrame.evaluate((buttonText) => {
  document.querySelectorAll('button').forEach(b => {
    if (b.textContent?.trim() === buttonText) b.click();
  });
}, 'Create Baseline');
```

**Note:** Card navigation is async (makes Apps Script RPC calls). Click one button at a time with waits between clicks. Batching all clicks in a single `evaluate()` call will fail because the card doesn't update synchronously.

## Bugs Found & Root Causes

### Bug 1: Unicode escape sequences → 500 crash

`\u25CF`, `\u25CB`, `\u00B7` escape sequences in JavaScript string literals cause `ExecuteAddOn` to return HTTP 500.

**Fix:** Use literal UTF-8 characters (●/○/·) directly in the source file. Apps Script handles UTF-8 in `.gs` files. When generating injection scripts via Python, use `json.dumps(code, ensure_ascii=False)`.

### Bug 2: TextButton without onClickAction → 500 crash

`CardService.newTextButton()` without `setOnClickAction()` causes HTTP 500, whether added directly via `addWidget()` or inside a `ButtonSet`.

**Fix:** Always call `setOnClickAction()` on every `TextButton`, including disabled ones.

### Bug 3: Invalid gstatic icon URLs → "type cannot be used" error

Custom icon URLs like `flag_black_24dp.png`, `person_black_24dp.png`, `history_black_24dp.png`, etc. do not exist on gstatic. Using them in `setIconUrl()` causes the card to be rejected with: "The value returned from Apps Script has a type that cannot be used by the add-ons platform."

**Symptom:** Card renders with section headers but no widgets. The JSON output shows `"sections": [{"header": "Today"}]` with empty widgets — the DecoratedText widgets fail silently because of invalid icon URLs.

**Fix:** Only use verified-working gstatic icon URLs:
```
check_circle_black_24dp.png     ✓
error_black_24dp.png            ✓
radio_button_unchecked_black_24dp.png ✓
description_black_24dp.png      ✓
```

All custom icons should use one of these four URLs.

### Bug 4: builder.addSection() before widget addition → empty sections

In Card Service, once `builder.addSection(section)` is called, further modifications to the section (via `section.addWidget()`) are NOT reflected in the built card.

**Symptom:** Card has section headers but no widgets — same JSON output as Bug 3.

**Fix:** Build the section completely (add all widgets first), THEN call `builder.addSection(section)`.

```javascript
// WRONG — widgets added after section is in builder are lost
builder.addSection(section);
section.addWidget(widget);  // this widget won't appear

// CORRECT — add all widgets first, then add section to builder
section.addWidget(widget);
section.addWidget(widget2);
builder.addSection(section);
```

### Bug 5: Project overwritten with unrelated code

At some point the Apps Script project was overwritten with a different add-on ("DocAlign Ultra") that had functions `onCommonHomepage`, `onDocsHomepage`, etc. instead of `onHomepage`. This caused "Script function not found: onHomepage" errors.

**Fix:** Re-injected our code and saved. After deployment, verify the editor shows the correct code with `function onHomepage`.

### Bug 6: Save propagation delay / stuck "Saving project..."

Large files (~32K chars) take 30+ seconds to save in Apps Script. The browser UI shows "Saving project..." and `cloud_done` simultaneously. The `cloud_done` icon indicates the save completed; the tooltip may persist as a UI artifact. After saving, the deployment auto-updates for test deployments within a few seconds.

### Debugging Workflow

1. Start from known-working baseline (minimal card)
2. Add ONE change at a time
3. Deploy → open Google Doc → check ExecuteAddOn HTTP status
4. If 500, revert that change and try alternative
5. Use Playwright to automate the deploy/verify cycle
6. When modifying the editor code, always check `cloud_done` icon before testing
7. When clicking add-on buttons via Playwright, click one at a time with 2-3s waits

## Card Service Constraints

| Supported | Not Supported |
|-----------|---------------|
| `setText()` with `<font color>` | HTML in `setTopLabel()` / `setBottomLabel()` |
| `setIconUrl()` with HTTPS image URLs | Data URIs in `setIconUrl()` |
| `<b>`, `<i>` in `setText()` | Custom CSS/fonts/padding |
| `setSecondaryButton()` on FixedFooter | SVG icons (use PNG) |
| `setDisabled(true)` with onClickAction | Disabled button without onClickAction |
| Literal UTF-8 Unicode in source | `\uXXXX` escape sequences |
| 4 verified gstatic Material icons | Arbitrary/unverified gstatic icon paths |
| Sections modified BEFORE builder.addSection() | Sections modified AFTER builder.addSection() |

## Design Decisions

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#6c47ff` | Buttons, manifest primaryColor |
| Clean | `#30a46c` | Signed status, added diff lines |
| Drifted | `#d97706` | Drifted status |
| Pending | `#8b8b9e` | Pending status, context diff lines |
| Removed | `#e54d2e` | Removed diff lines |

### Icon URLs (only 4 verified-working)

```javascript
var ICONS = {
  doc:        "https://www.gstatic.com/images/icons/material/system/1x/description_black_24dp.png",
  signed:     "https://www.gstatic.com/images/icons/material/system/1x/check_circle_black_24dp.png",
  drifted:    "https://www.gstatic.com/images/icons/material/system/1x/error_black_24dp.png",
  pending:    "https://www.gstatic.com/images/icons/material/system/1x/radio_button_unchecked_black_24dp.png",
  // All aliases below use one of the 4 verified URLs above:
  person:     "…check_circle_black_24dp.png",  // reuses signed icon
  baseline:   "…description_black_24dp.png",   // reuses doc icon
  history:    "…description_black_24dp.png",   // reuses doc icon
  hero:       "…check_circle_black_48dp.png"   // 2x size
};
```

### Widget Layout per Signer Row

```
[Icon]  Alice M.                              ← setTopLabel (plain text)
        ● Signed -- Approved scope for v2     ← setText (HTML: colored dot + status + commit msg)
        Product Manager · Rev a3f2 · 2h ago   ← setBottomLabel (plain text)
        [View Diff]                            ← setButton (drifted only)
```

### Card Structure (Status Card)

```
CardHeader: title + subtitle
├── Summary section: colored inline counts
├── SIGNED section: DecoratedText rows (if any)
├── DRIFTED section: DecoratedText rows + View Diff buttons (if any)
├── PENDING section: DecoratedText rows (if any)
├── Actions section: [Simulate Drift] [+ Add Signer] [Reset Demo]
└── FixedFooter: [Sign This Doc] [View History]
```

## Code Structure (Updated)

```
Code.gs (~1000 lines)
├── STATE MANAGEMENT  — getState, saveState, nextRevisionId (CacheService)
├── MOCK DATA         — MOCK_SIGNERS, DEMO_USER_ID
├── ICONS & COLORS    — 4 verified gstatic URLs + color palette
├── UTILITIES         — coloredText, boldText, getRelativeTime, getStatusLabel/Color/Icon,
│                       getActionIcon, countByStatus
├── DIFF ENGINE       — computeDiff, buildLcsTable, backtrackDiff (LCS line diff)
├── DOCUMENT ACCESS   — getDocText, getDocTitle (DocumentApp wrapper)
├── DRIFT DETECTION   — checkDriftAndSave (compares baselineText vs current doc text)
├── CARD BUILDERS
│   ├── buildEmptyStateCard()        — hero image + "Create Baseline" CTA
│   ├── buildAddSignersCard()        — checkbox picker + custom signer inputs
│   ├── buildStatusCard() + buildSignerRow() — summary bar + grouped signer rows
│   ├── buildSignFormCard(msg)       — commit input + quick chips
│   ├── buildDiffCard(id)            — LCS diff + mock fallback (with error handling)
│   ├── buildHistoryCard()           — timeline with date groups (with error handling)
│   └── _buildErrorCard(msg)         — fallback error card with back button
└── CALLBACKS
    ├── onHomepage                   — state machine entry: decides which card to show
    ├── onCreateBaseline             — snapshots doc, transitions to Add Signers
    ├── onDoneAddSigners             — parses form, saves selected signers
    ├── onSignThisDoc / onSubmitSign / onQuickSign / onCancelSign
    ├── onViewDiff / onViewHistory   — push diff/history cards
    ├── onSimulateDrift              — demo: marks signed signers as drifted
    ├── onGoHome                     — back navigation + drift check
    └── onResetDemo                  — clears cache, returns to empty state
```

## Known Issues

1. **onGoHome clears state**: Navigating "Back to Status" from diff/history cards sometimes returns to empty state instead of status card. Root cause: `checkDriftAndSave` may detect `getState() === null` (cache eviction) and the null check in `onGoHome` defaults to empty state. Workaround: re-create baseline. For demo purposes this is acceptable since the flow is linear.

2. **DocumentApp drift detection doesn't work with Playwright typing**: `DocumentApp.getActiveDocument().getBody().getText()` doesn't pick up text typed via Playwright's `page.type()`. It works correctly with real user keyboard input. For demo, use "Simulate Drift" button.

3. **Save propagation delay**: After saving in the editor, test deployments take 5-15 seconds to pick up changes. Verify with `cloud_done` icon before testing.

4. **Quick-sign chips need staggered clicks**: When clicking LGTM chip followed by Sign, the cards must update between clicks. Batching fails because the form card isn't updated by the time Sign is clicked.

## Architecture Context

This POC validates the Card Service approach for the broader [Workspace Add-on pivot design](specs/2026-06-06-workspace-addon-pivot-design.md). The long-term plan is:

1. **Phase 1** — Build production add-on with React SPA sidebar + Apps Script glue
2. **Phase 2** — Coexistence: Workspace Add-on is primary, Chrome Extension shows upgrade banner
3. **Phase 3** — Sunset Chrome Extension entirely

The POC proves Card Service can handle the core UI patterns (status cards, commit messages, diff views, history, state machine, progressive disclosure) without needing the full React SPA for the initial prototype.

## Related Docs

- `docs/superpowers/specs/2026-06-06-addon-ui-polish-design.md` — UI polish design spec from this session
- `docs/superpowers/specs/2026-06-06-workspace-addon-pivot-design.md` — Architecture and migration plan
- `docs/superpowers/specs/2026-06-07-addon-ui-redesign-material-cards.md` — Material Cards redesign spec
- `docs/superpowers/plans/2026-06-07-addon-ui-redesign.md` — Implementation plan
- `docs/superpowers/mockups/approach-a-material-cards.html` — Visual mockup (all 6 card states)

## Session 3: Material Cards UI Redesign (2026-06-07)

### What Was Done

Complete UI redesign of the Card Service add-on from the POC's basic layout to a rich, Material 3-inspired design. All changes in `packages/workspace-addon/apps-script/Code.gs`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Per-signer snapshots instead of global baseline | Each signer's drift is personal — "doc changed since YOU signed" |
| Progress + unified list for status card | Fewer sections, clearer at a glance in 300px sidebar |
| Visual summary diff (section-level) instead of line-by-line | Better for non-technical reviewers |
| Material 3 palette | Native Google feel |
| `ui-avatars.com` for avatar circles | Colored initials match status (green/amber/grey) |
| Reset + Simulate Drift in header menu (⋮) | Where settings/refresh buttons typically live |

### Card Changes from POC

| Card | POC | Redesigned |
|------|-----|-----------|
| Empty State | Hero icon + subtitle | Purple bold title "Track sign-offs", grey subtitle, single CTA |
| Add Signers | Same structure | Same structure (no changes needed) |
| Status | Grouped by status sections | Progress label + status chips, unified signer list sorted by priority (drifted→pending→signed), dividers between rows |
| Signer Row | Icon + name topLabel, status text | Role as topLabel (small), name+badge as main text, status message as bottomLabel, avatar circle icon |
| Sign Form | Same structure | Removed icon from "Signing as" row |
| Diff View | Line-by-line colored text | Stats line (+N added, -N removed, ~N modified), section-level change cards with colored  prefix |
| History | Same structure | Same structure |

### Color Palette (Material 3)

| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#6750a4` | Buttons, active states |
| Signed | `#1e8e3e` | Signed status, avatar bg, added diff |
| Drifted | `#e37400` | Drifted status, avatar bg, modified diff |
| Pending | `#9aa0a6` | Pending status, avatar bg |
| Removed | `#d93025` | Removed diff |
| On Surface Variant | `#5f6368` | Secondary text, commit messages |

### Data Model Changes

- **Removed:** `state.baselineText` (global baseline)
- **Added:** `signer.signoffSnapshot` (per-signer doc text snapshot)
- **Status rename:** `"clean"` → `"signed"` throughout

### Callback Changes

- `onCreateBaseline` — no longer stores `baselineText`
- `onSubmitSign` — saves `signoffSnapshot` on the signing signer
- `checkDriftAndSave` — compares each signer's snapshot to current doc
- `onGoHome` — checks `state.signers` instead of `state.baselineText`
- `onSimulateDrift` — unchanged (marks signed signers as drifted)
- `onResetDemo` — unchanged (clears cache)

### Issues Faced

1. **`addCardAction` chained on `newCardHeader()` → TypeError**: `CardService.newCardHeader().setTitle().setSubtitle().addCardAction()` is not a function. Must call `builder.addCardAction()` separately after `builder.setHeader(header)`.

2. **`ui-avatars.com` avatar images**: These are external URLs and may not load in the add-on iframe if CORS or network restrictions apply. If avatars don't render, fall back to the 4 verified gstatic icons.

3. **Deployment propagation**: After saving code in the Apps Script editor, the test deployment does NOT auto-update. Must manually: Deploy → Manage deployments → Edit → New version → Deploy. Wait 30-60 seconds for propagation.

4. **Add-on iframe not loading in fresh docs**: The add-on tab appears in the sidebar but clicking it doesn't load the iframe. This is a deployment issue — the test deployment needs to be updated to the latest code version. Once deployment is updated, it works.

5. **Playwright can't type into Google Docs for drift testing**: `DocumentApp.getActiveDocument().getBody().getText()` doesn't pick up text typed via Playwright's `page.type()`. Works with real user keyboard input. Use "Simulate Drift" menu action for testing.

6. **Quick-sign chip + Sign need staggered clicks**: Batching both clicks in a single `evaluate()` fails because the card doesn't update synchronously. Must click one at a time with 2-3s waits between.

### Files

| File | Purpose |
|------|---------|
| `packages/workspace-addon/apps-script/Code.gs` | Complete rewrite (~1090 lines): Material 3 colors, per-signer snapshots, section-level diff, avatar circles, header menu actions |
| `packages/workspace-addon/apps-script/appsscript.json` | Unchanged |
| `docs/superpowers/mockups/approach-a-material-cards.html` | Visual mockup of all 6 card states (saved for future sessions) |

### Deployment

- **Project ID:** `1PGi_Qg263jt-6psI6tXNkyYQAmperMIBSBSCEQ9OpMlFLYpNNdsWqYW7`
- **Deployment ID:** `AKfycbzxhUXQ-VLkucd9wxAR8fBfnn8B6LvR4ftjleCZGDTA`
- **Status:** Code saved in editor (cloud_done). **Test deployment needs manual update** to pick up latest code.

### Deploy Flow (Updated)

1. Navigate to the [project editor](https://script.google.com/home/projects/1PGi_Qg263jt-6psI6tXNkyYQAmperMIBSBSCEQ9OpMlFLYpNNdsWqYW7/edit)
2. Inject code from `Code.gs` into the Monaco editor (see Playwright injection below)
3. Press Cmd+S to save. Wait for `cloud_done` icon (may take 30+ seconds for large files).
4. **CRITICAL: Update the test deployment** — Deploy → Manage deployments → Edit (pencil icon) → Version: New version → Deploy
5. Wait 30-60 seconds for propagation
6. Open any Google Doc → click `doc-align` tab in the right sidebar

### Next Session Checklist

- [ ] Update test deployment to latest code version
- [ ] Verify full flow: Empty → Baseline → Add Signers → Status → Sign → Simulate Drift → View Diff → Re-sign → History → Reset
- [ ] Verify avatar circles render (ui-avatars.com may be blocked)
- [ ] Verify header menu (⋮) shows "Simulate drift" and "Reset demo"
- [ ] If avatars don't load, fall back to gstatic icons
