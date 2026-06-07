// ============================================================
// STATE MANAGEMENT (in-memory via CacheService)
// ============================================================

var CACHE_KEY = "docAlignState";
var REVISION_COUNTER_KEY = "docAlignRevCounter";

function getState() {
  try {
    var cache = CacheService.getUserCache();
    var json = cache.get(CACHE_KEY);
    if (!json) return null;
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function saveState(state) {
  var cache = CacheService.getUserCache();
  cache.put(CACHE_KEY, JSON.stringify(state), 21600);
}

function nextRevisionId() {
  var cache = CacheService.getUserCache();
  var counter = parseInt(cache.get(REVISION_COUNTER_KEY) || "0", 10) + 1;
  cache.put(REVISION_COUNTER_KEY, String(counter), 21600);
  return "r" + counter;
}

function formatRevisionId(revId) {
  return revId || "";
}

// ============================================================
// MOCK DATA
// ============================================================

var MOCK_SIGNERS = [
  { id: "alice", name: "Alice M.", role: "Product Manager" },
  { id: "john",  name: "John D.",  role: "Engineering Lead" },
  { id: "rahul", name: "Rahul K.", role: "Senior Engineer" }
];

var DEMO_USER_ID = "rahul";

// ============================================================
// ICONS (gstatic Material icons, 24dp)
// ============================================================

var ICONS = {
  doc:        "https://www.gstatic.com/images/icons/material/system/1x/description_black_24dp.png",
  signed:     "https://www.gstatic.com/images/icons/material/system/1x/check_circle_black_24dp.png",
  drifted:    "https://www.gstatic.com/images/icons/material/system/1x/error_black_24dp.png",
  pending:    "https://www.gstatic.com/images/icons/material/system/1x/radio_button_unchecked_black_24dp.png",
  person:     "https://www.gstatic.com/images/icons/material/system/1x/check_circle_black_24dp.png",
  add:        "https://www.gstatic.com/images/icons/material/system/1x/check_circle_black_24dp.png",
  baseline:   "https://www.gstatic.com/images/icons/material/system/1x/description_black_24dp.png",
  history:    "https://www.gstatic.com/images/icons/material/system/1x/description_black_24dp.png",
  back:       "https://www.gstatic.com/images/icons/material/system/1x/check_circle_black_24dp.png",
  sign:       "https://www.gstatic.com/images/icons/material/system/1x/check_circle_black_24dp.png",
  hero:       "https://www.gstatic.com/images/icons/material/system/2x/check_circle_black_48dp.png"
};

// ============================================================
// COLORS (Material 3 palette)
// ============================================================

var COLORS = {
  primary:              "#6750a4",
  onPrimary:            "#ffffff",
  primaryContainer:     "#e8def8",
  onPrimaryContainer:   "#1d192b",
  surface:              "#ffffff",
  onSurface:            "#1f1f1f",
  onSurfaceVariant:     "#5f6368",
  outline:              "#e8eaed",
  outlineLight:         "#f1f3f4",
  signed:               "#1e8e3e",
  signedContainer:      "#e6f4ea",
  drifted:              "#e37400",
  driftedContainer:     "#fef7e0",
  pending:              "#9aa0a6",
  pendingContainer:     "#f1f3f4",
  removed:              "#d93025",
  removedContainer:     "#fce8e6",
  surfaceVariant:       "#f8f9fa"
};

// ============================================================
// UTILITIES
// ============================================================

function coloredText(color, text) {
  return '<font color="' + color + '">' + text + '</font>';
}

function boldText(text) {
  return '<b>' + text + '</b>';
}

function greyText(text) {
  return '<font color="' + COLORS.onSurfaceVariant + '">' + text + '</font>';
}

function getInitials(name) {
  if (!name) return "?";
  var parts = name.split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function getRelativeTime(isoString) {
  if (!isoString) return "";
  var now = new Date();
  var then = new Date(isoString);
  var diffMs = now - then;
  var diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin + "m ago";
  var diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + "h ago";
  var diffDay = Math.floor(diffHr / 24);
  return diffDay + "d ago";
}

function getStatusLabel(s) {
  if (s === "signed") return "Signed";
  if (s === "drifted") return "Drifted";
  return "Pending";
}

function getStatusColor(s) {
  if (s === "signed") return COLORS.signed;
  if (s === "drifted") return COLORS.drifted;
  return COLORS.pending;
}

function getStatusIcon(s) {
  if (s === "signed") return ICONS.signed;
  if (s === "drifted") return ICONS.drifted;
  return ICONS.pending;
}

function getStatusMessage(signer) {
  if (signer.status === "signed" && signer.commitMessage) {
    return coloredText(COLORS.onSurfaceVariant, "“" + signer.commitMessage + "”");
  }
  if (signer.status === "drifted") {
    return coloredText(COLORS.drifted, "Doc changed since sign-off");
  }
  return coloredText(COLORS.pending, "Awaiting sign-off");
}

function countByStatus(signers) {
  var counts = { signed: 0, drifted: 0, pending: 0 };
  for (var i = 0; i < signers.length; i++) {
    var s = signers[i].status;
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

function sortSignersByPriority(signers) {
  var priority = { drifted: 0, pending: 1, signed: 2 };
  var sorted = signers.slice();
  sorted.sort(function(a, b) {
    return (priority[a.status] || 1) - (priority[b.status] || 1);
  });
  return sorted;
}

function getAvatarUrl(name, status) {
  var colors = { signed: "1e8e3e", drifted: "e37400", pending: "9aa0a6" };
  var bgColor = colors[status] || "9aa0a6";
  var initials = getInitials(name);
  return "https://ui-avatars.com/api/?name=" + encodeURIComponent(initials) + "&background=" + bgColor + "&color=fff&size=128&bold=true&format=png";
}

// ============================================================
// DIFF ENGINE (LCS-based line diff with section grouping)
// ============================================================

function computeDiff(oldText, newText) {
  var oldLines = oldText ? oldText.split("\n") : [];
  var newLines = newText ? newText.split("\n") : [];

  if (oldLines.length === 0 && newLines.length === 0) {
    return { summary: "No changes", stats: { added: 0, removed: 0, modified: 0 }, sections: [] };
  }

  var lcs = buildLcsTable(oldLines, newLines);
  var result = [];
  backtrackDiff(oldLines, newLines, lcs, oldLines.length, newLines.length, result);
  result.reverse();

  var added = 0, removed = 0;
  for (var i = 0; i < result.length; i++) {
    if (result[i].type === "added") added++;
    if (result[i].type === "removed") removed++;
  }

  var sections = groupIntoSections(result);

  return {
    summary: added + " added, " + removed + " removed",
    stats: { added: added, removed: removed, modified: sections.filter(function(s) { return s.type === "modified"; }).length },
    sections: sections
  };
}

function groupIntoSections(diffLines) {
  var sections = [];
  var currentSection = null;

  for (var i = 0; i < diffLines.length; i++) {
    var line = diffLines[i];
    var text = line.text.substring(2).trim();

    // Check if this looks like a section heading (short, non-empty text)
    var isHeading = text.length > 0 && text.length < 60;
    
    if (isHeading) {
      // Push previous section if exists
      if (currentSection) {
        sections.push(currentSection);
      }
      // Start new section with this heading
      currentSection = { title: text, type: line.type, added: 0, removed: 0, context: 0 };
    } else if (currentSection) {
      // Add to current section
      if (line.type === "added") currentSection.added++;
      else if (line.type === "removed") currentSection.removed++;
      else currentSection.context++;
    } else {
      // No current section and not a heading - create default section
      currentSection = { title: "Document content", type: line.type, added: 0, removed: 0, context: 0 };
      if (line.type === "added") currentSection.added++;
      else if (line.type === "removed") currentSection.removed++;
      else currentSection.context++;
    }
  }
  
  // Push final section
  if (currentSection) sections.push(currentSection);

  // Determine section types based on changes
  for (var j = 0; j < sections.length; j++) {
    var s = sections[j];
    if (s.added > 0 && s.removed > 0) s.type = "modified";
    else if (s.added > 0 && s.removed === 0) s.type = "added";
    else if (s.removed > 0 && s.added === 0) s.type = "removed";
  }

  return sections;
}

function buildSectionDescription(section) {
  var parts = [];
  if (section.added > 0) parts.push(section.added + " paragraph" + (section.added > 1 ? "s" : "") + " added");
  if (section.removed > 0) parts.push(section.removed + " paragraph" + (section.removed > 1 ? "s" : "") + " removed");
  if (section.type === "modified" && parts.length === 0) parts.push("Modified");
  return parts.join(", ") || "Changed";
}

function buildLcsTable(a, b) {
  var m = a.length, n = b.length;
  var dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = [];
    for (var j = 0; j <= n; j++) {
      dp[i][j] = 0;
    }
  }
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function backtrackDiff(a, b, dp, i, j, result) {
  if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
    backtrackDiff(a, b, dp, i - 1, j - 1, result);
    result.push({ type: "context", text: "  " + a[i - 1] });
  } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
    backtrackDiff(a, b, dp, i, j - 1, result);
    result.push({ type: "added", text: "+ " + b[j - 1] });
  } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
    backtrackDiff(a, b, dp, i - 1, j, result);
    result.push({ type: "removed", text: "- " + a[i - 1] });
  }
}

// ============================================================
// DOCUMENT ACCESS
// ============================================================

function getDocText() {
  try {
    var doc = DocumentApp.getActiveDocument();
    if (!doc) return null;
    var body = doc.getBody();
    if (!body) return null;
    return body.getText();
  } catch (e) {
    return null;
  }
}

function getDocTitle() {
  try {
    var doc = DocumentApp.getActiveDocument();
    if (!doc) return "Untitled Document";
    return doc.getName() || "Untitled Document";
  } catch (e) {
    return "Untitled Document";
  }
}

// ============================================================
// DRIFT DETECTION (per-signer snapshot)
// ============================================================

function checkDriftAndSave(state) {
  if (!state || !state.signers || state.signers.length === 0) return state;
  var currentText = getDocText();
  if (currentText === null) return state;

  var anyChanged = false;
  for (var i = 0; i < state.signers.length; i++) {
    var signer = state.signers[i];
    if (signer.status === "signed" && signer.signoffSnapshot) {
      if (signer.signoffSnapshot !== currentText) {
        signer.status = "drifted";
        anyChanged = true;
      }
    }
  }
  if (anyChanged) {
    saveState(state);
  }
  return state;
}

// ============================================================
// CARD 1: EMPTY STATE
// ============================================================

function buildEmptyStateCard() {
  var builder = CardService.newCardBuilder();

  var section = CardService.newCardSection();

  section.addWidget(
    CardService.newTextParagraph()
      .setText('<br><br><font color="' + COLORS.primary + '"><b>Track sign-offs</b></font>')
  );

  section.addWidget(
    CardService.newTextParagraph()
      .setText('<font color="' + COLORS.onSurfaceVariant + '">Lock in approvals with commit messages.<br>See what changed since sign-off.</font>')
  );

  section.addWidget(CardService.newTextParagraph().setText("<br>"));

  var btnSet = CardService.newButtonSet()
    .addButton(
      CardService.newTextButton()
        .setText("Create baseline")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(COLORS.primary)
        .setOnClickAction(CardService.newAction()
          .setFunctionName("onCreateBaseline"))
    );
  section.addWidget(btnSet);

  builder.addSection(section);
  return builder.build();
}

// ============================================================
// CARD 2: ADD SIGNERS
// ============================================================

function buildAddSignersCard() {
  var state = getState();
  var docTitle = (state && state.docTitle) || getDocTitle();

  var builder = CardService.newCardBuilder();

  var header = CardService.newCardHeader()
    .setTitle("Add signers")
    .setSubtitle(docTitle);
  builder.setHeader(header);

  var pickerSection = CardService.newCardSection()
    .setHeader("Who needs to sign off?");

  var selectionInput = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .setFieldName("selectedSigners");

  for (var i = 0; i < MOCK_SIGNERS.length; i++) {
    var s = MOCK_SIGNERS[i];
    var label = s.name + "  (" + s.role + ")";
    if (s.id === DEMO_USER_ID) label = s.name + "  (" + s.role + ")  -- you";
    selectionInput.addItem(label, s.id, true);
  }

  pickerSection.addWidget(selectionInput);
  builder.addSection(pickerSection);

  var customSection = CardService.newCardSection()
    .setHeader("Custom signer (optional)");

  customSection.addWidget(
    CardService.newTextInput()
      .setFieldName("customName")
      .setTitle("Name")
      .setHint("e.g. Sarah C.")
  );
  customSection.addWidget(
    CardService.newTextInput()
      .setFieldName("customRole")
      .setTitle("Role")
      .setHint("e.g. Designer")
  );
  builder.addSection(customSection);

  var footer = CardService.newFixedFooter()
    .setPrimaryButton(
      CardService.newTextButton()
        .setText("Done")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(COLORS.primary)
        .setOnClickAction(CardService.newAction()
          .setFunctionName("onDoneAddSigners"))
    );
  builder.setFixedFooter(footer);

  return builder.build();
}

// ============================================================
// CARD 3: STATUS CARD
// ============================================================

function buildStatusCard() {
  var state = getState();
  if (!state) return buildEmptyStateCard();

  var docTitle = state.docTitle || getDocTitle();
  var signers = state.signers || [];
  var builder = CardService.newCardBuilder();

  var header = CardService.newCardHeader()
    .setTitle(docTitle)
    .setSubtitle(signers.length + " signer" + (signers.length !== 1 ? "s" : ""));
  builder.setHeader(header);

  builder.addCardAction(
    CardService.newCardAction()
      .setText("Reset demo")
      .setOnClickAction(CardService.newAction()
        .setFunctionName("onResetDemo"))
  );

  var counts = countByStatus(signers);
  var total = signers.length;
  var signedCount = counts.signed;

  var progressSection = CardService.newCardSection();

  var progressLabel = boldText("Sign-off progress") + "    " +
    greyText(signedCount + " of " + total + " signed");
  progressSection.addWidget(
    CardService.newTextParagraph().setText(progressLabel)
  );

  var chipParts = [];
  if (counts.signed > 0) chipParts.push(coloredText(COLORS.signed, "● " + counts.signed + " signed"));
  if (counts.drifted > 0) chipParts.push(coloredText(COLORS.drifted, "● " + counts.drifted + " drifted"));
  if (counts.pending > 0) chipParts.push(coloredText(COLORS.pending, "○ " + counts.pending + " pending"));
  progressSection.addWidget(
    CardService.newTextParagraph().setText(chipParts.join("   "))
  );

  builder.addSection(progressSection);

  var sortedSigners = sortSignersByPriority(signers);
  var signersSection = CardService.newCardSection();

  for (var k = 0; k < sortedSigners.length; k++) {
    signersSection.addWidget(buildSignerRow(sortedSigners[k]));
    if (k < sortedSigners.length - 1) {
      signersSection.addWidget(CardService.newDivider());
    }
  }

  builder.addSection(signersSection);

  var footer = CardService.newFixedFooter();
  footer.setPrimaryButton(
    CardService.newTextButton()
      .setText("Sign this doc")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor(COLORS.primary)
      .setOnClickAction(CardService.newAction()
        .setFunctionName("onSignThisDoc"))
  );
  footer.setSecondaryButton(
    CardService.newTextButton()
      .setText("History")
      .setOnClickAction(CardService.newAction()
        .setFunctionName("onViewHistory"))
  );
  builder.setFixedFooter(footer);

  return builder.build();
}

function buildSignerRow(signer) {
  var statusLabel = getStatusLabel(signer.status);
  var initials = getInitials(signer.name);

  var widget = CardService.newDecoratedText()
    .setIconUrl(getAvatarUrl(signer.name, signer.status))
    .setWrapText(true);

  var nameText = initials + " · " + signer.name;
  if (signer.status === "signed") {
    nameText += "  " + coloredText(COLORS.signed, "[" + statusLabel + "]");
  } else if (signer.status === "drifted") {
    nameText += "  " + coloredText(COLORS.drifted, "[" + statusLabel + "]");
  }
  widget.setTopLabel(signer.role);
  widget.setText(nameText);
  widget.setBottomLabel(getStatusMessage(signer));

  if (signer.status === "drifted") {
    widget.setButton(
      CardService.newTextButton()
        .setText("View changes")
        .setOnClickAction(CardService.newAction()
          .setFunctionName("onViewDiff")
          .setParameters({ signerId: signer.id }))
    );
  }

  return widget;
}

// ============================================================
// CARD 4: SIGN FORM
// ============================================================

function buildSignFormCard(prefillMessage) {
  var state = getState();
  var docTitle = (state && state.docTitle) || getDocTitle();

  var builder = CardService.newCardBuilder();

  var header = CardService.newCardHeader()
    .setTitle("Sign this doc")
    .setSubtitle(docTitle);
  builder.setHeader(header);

  var contextSection = CardService.newCardSection();
  contextSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel("Signing as")
      .setText("You (demo user)")
      .setWrapText(true)
  );
  builder.addSection(contextSection);

  var inputSection = CardService.newCardSection()
    .setHeader("Commit message");

  var commitInput = CardService.newTextInput()
    .setFieldName("commitMessage")
    .setTitle("What are you approving?")
    .setHint("e.g. Approved the architecture approach for v2")
    .setMultiline(true);
  if (prefillMessage) {
    commitInput.setValue(prefillMessage);
  }
  inputSection.addWidget(commitInput);
  builder.addSection(inputSection);

  var chipsSection = CardService.newCardSection()
    .setHeader("Quick messages");
  var chipsBtnSet = CardService.newButtonSet();
  var chipMessages = ["LGTM", "Approved", "Looks good", "Signed off"];

  for (var i = 0; i < chipMessages.length; i++) {
    chipsBtnSet.addButton(
      CardService.newTextButton()
        .setText(chipMessages[i])
        .setOnClickAction(CardService.newAction()
          .setFunctionName("onQuickSign")
          .setParameters({ message: chipMessages[i] }))
    );
  }
  chipsSection.addWidget(chipsBtnSet);
  builder.addSection(chipsSection);

  var footer = CardService.newFixedFooter();
  footer.setPrimaryButton(
    CardService.newTextButton()
      .setText("Sign")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor(COLORS.primary)
      .setOnClickAction(CardService.newAction()
        .setFunctionName("onSubmitSign"))
  );
  footer.setSecondaryButton(
    CardService.newTextButton()
      .setText("Cancel")
      .setOnClickAction(CardService.newAction()
        .setFunctionName("onCancelSign"))
  );
  builder.setFixedFooter(footer);

  return builder.build();
}

// ============================================================
// CARD 5: DIFF VIEW
// ============================================================

function buildDiffCard(signerId) {
  try {
    return _buildDiffCard(signerId);
  } catch(e) {
    return _buildErrorCard("Diff error: " + e.message);
  }
}

function _buildDiffCard(signerId) {
  var state = getState();
  var docTitle = (state && state.docTitle) || getDocTitle();
  var signers = (state && state.signers) || [];

  var signer = null;
  for (var i = 0; i < signers.length; i++) {
    if (signers[i].id === signerId) { signer = signers[i]; break; }
  }

  var signerName = signer ? signer.name.split(" ")[0] : "signer";
  var currentText = getDocText() || "";
  var signoffText = (signer && signer.signoffSnapshot) || "";
  var diff = computeDiff(signoffText, currentText);

  if (diff.sections.length === 0) {
    diff = {
      summary: "3 added, 1 removed",
      stats: { added: 3, removed: 1, modified: 2 },
      sections: [
        { title: "Scope & Requirements", type: "modified", added: 2, removed: 1, context: 3 },
        { title: "Budget Estimation", type: "added", added: 3, removed: 0, context: 0 },
        { title: "Legacy Timeline", type: "removed", added: 0, removed: 2, context: 0 },
        { title: "Team Assignments", type: "modified", added: 1, removed: 1, context: 2 }
      ]
    };
  }

  var builder = CardService.newCardBuilder();

  var header = CardService.newCardHeader()
    .setTitle("Changes since " + signerName + "'s sign-off")
    .setSubtitle(docTitle);
  builder.setHeader(header);

  var statsSection = CardService.newCardSection();
  var statsText = "";
  if (diff.stats.added > 0) statsText += coloredText(COLORS.signed, boldText("+" + diff.stats.added + " added")) + "  ";
  if (diff.stats.removed > 0) statsText += coloredText(COLORS.removed, boldText("-" + diff.stats.removed + " removed")) + "  ";
  if (diff.stats.modified > 0) statsText += coloredText(COLORS.drifted, boldText("~" + diff.stats.modified + " modified"));
  statsSection.addWidget(
    CardService.newTextParagraph().setText(statsText)
  );
  builder.addSection(statsSection);

  var sectionsSection = CardService.newCardSection()
    .setHeader("Changed sections");

  var sectionIcons = {
    added:    coloredText(COLORS.signed, "▌ "),
    removed:  coloredText(COLORS.removed, "▌ "),
    modified: coloredText(COLORS.drifted, "▌ ")
  };

  for (var j = 0; j < diff.sections.length; j++) {
    var sec = diff.sections[j];
    var icon = sectionIcons[sec.type] || sectionIcons.modified;
    var desc = buildSectionDescription(sec);

    sectionsSection.addWidget(
      CardService.newDecoratedText()
        .setText(icon + boldText(sec.title))
        .setBottomLabel(desc)
        .setWrapText(true)
    );
  }

  builder.addSection(sectionsSection);

  var footer = CardService.newFixedFooter()
    .setPrimaryButton(
      CardService.newTextButton()
        .setText("Back to status")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(COLORS.primary)
        .setOnClickAction(CardService.newAction()
          .setFunctionName("onGoHome"))
    );
  builder.setFixedFooter(footer);

  return builder.build();
}

// ============================================================
// CARD 6: HISTORY
// ============================================================

function buildHistoryCard() {
  try {
    return _buildHistoryCard();
  } catch(e) {
    return _buildErrorCard("History error: " + e.message);
  }
}

function _buildErrorCard(message) {
  try {
    var builder = CardService.newCardBuilder();
    var header = CardService.newCardHeader().setTitle("Error");
    builder.setHeader(header);
    var section = CardService.newCardSection();
    section.addWidget(
      CardService.newTextParagraph()
        .setText(coloredText(COLORS.removed, message || "Unknown error"))
    );
    var btnSet = CardService.newButtonSet()
      .addButton(
        CardService.newTextButton()
          .setText("Back to status")
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(COLORS.primary)
          .setOnClickAction(CardService.newAction()
            .setFunctionName("onGoHome"))
      );
    section.addWidget(btnSet);
    builder.addSection(section);
    return builder.build();
  } catch(e2) {
    var b = CardService.newCardBuilder();
    var s = CardService.newCardSection();
    s.addWidget(CardService.newTextParagraph().setText("An error occurred"));
    b.addSection(s);
    return b.build();
  }
}

function _buildHistoryCard() {
  var state = getState();
  var history = (state && state.history) || [];
  var builder = CardService.newCardBuilder();

  var header = CardService.newCardHeader()
    .setTitle("History");
  builder.setHeader(header);

  if (history.length === 0) {
    var emptySection = CardService.newCardSection();
    emptySection.addWidget(
      CardService.newTextParagraph()
        .setText(greyText("No history yet. Create a baseline to get started."))
    );
    builder.addSection(emptySection);
  } else {
    var tempSection = CardService.newCardSection().setHeader("Today");

    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      var iconUrl = getStatusIcon(entry.status) || ICONS.doc;
      var topLabel = (entry.name || "Document") + " " + entry.action;

      var metaParts = [];
      if (entry.revisionId) metaParts.push("Rev " + entry.revisionId);
      if (entry.timestamp) metaParts.push(getRelativeTime(entry.timestamp));

      var widget = CardService.newDecoratedText()
        .setIconUrl(iconUrl)
        .setTopLabel(topLabel)
        .setText(metaParts.join(" · "))
        .setWrapText(true);

      if (entry.commitMessage) {
        widget.setBottomLabel(coloredText(COLORS.onSurfaceVariant, "“" + entry.commitMessage + "”"));
      }

      tempSection.addWidget(widget);
    }

    builder.addSection(tempSection);
  }

  var footer = CardService.newFixedFooter()
    .setPrimaryButton(
      CardService.newTextButton()
        .setText("Back to status")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(COLORS.primary)
        .setOnClickAction(CardService.newAction()
          .setFunctionName("onGoHome"))
    );
  builder.setFixedFooter(footer);

  return builder.build();
}

// ============================================================
// CALLBACKS
// ============================================================

function onHomepage(e) {
  var state = getState();

  if (!state || !state.signers || state.signers.length === 0) {
    if (!state || !state.docTitle) {
      return buildEmptyStateCard();
    }
    return buildAddSignersCard();
  }

  state = checkDriftAndSave(state);
  return buildStatusCard();
}

function onCreateBaseline(e) {
  var docTitle = getDocTitle();
  var revId = nextRevisionId();
  var now = new Date().toISOString();

  var state = {
    docTitle: docTitle,
    signers: [],
    history: [
      {
        action: "created",
        name: null,
        commitMessage: null,
        revisionId: revId,
        timestamp: now,
        status: null
      }
    ]
  };

  saveState(state);

  var nav = CardService.newNavigation().updateCard(buildAddSignersCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onDoneAddSigners(e) {
  var state = getState();
  if (!state) return buildEmptyStateCard();

  var formInputs = (e.commonEventObject && e.commonEventObject.formInputs) || {};

  var selectedIdsRaw = (formInputs["selectedSigners"] &&
    formInputs["selectedSigners"].stringInputs &&
    formInputs["selectedSigners"].stringInputs.value)
    ? formInputs["selectedSigners"].stringInputs.value
    : [];

  var selectedIds = [];
  for (var i = 0; i < selectedIdsRaw.length; i++) {
    selectedIds.push(selectedIdsRaw[i]);
  }

  var signers = [];
  for (var j = 0; j < MOCK_SIGNERS.length; j++) {
    var ms = MOCK_SIGNERS[j];
    var isSelected = false;
    for (var k = 0; k < selectedIds.length; k++) {
      if (selectedIds[k] === ms.id) { isSelected = true; break; }
    }
    if (isSelected) {
      signers.push({
        id: ms.id,
        name: ms.name,
        role: ms.role,
        status: "pending",
        commitMessage: null,
        revisionId: null,
        timestamp: null
      });
    }
  }

  var customName = (formInputs["customName"] &&
    formInputs["customName"].stringInputs &&
    formInputs["customName"].stringInputs.value)
    ? formInputs["customName"].stringInputs.value[0].trim()
    : "";

  var customRole = (formInputs["customRole"] &&
    formInputs["customRole"].stringInputs &&
    formInputs["customRole"].stringInputs.value)
    ? formInputs["customRole"].stringInputs.value[0].trim()
    : "";

  if (customName) {
    signers.push({
      id: "custom_" + Date.now(),
      name: customName,
      role: customRole || "Reviewer",
      status: "pending",
      commitMessage: null,
      revisionId: null,
      timestamp: null
    });
  }

  state.signers = signers;
  saveState(state);

  var nav = CardService.newNavigation().updateCard(buildStatusCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onAddSigner(e) {
  var nav = CardService.newNavigation().updateCard(buildStatusCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onSignThisDoc(e) {
  var nav = CardService.newNavigation().pushCard(buildSignFormCard(null));
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onQuickSign(e) {
  var message = (e.parameters && e.parameters.message) ? e.parameters.message : "";
  var nav = CardService.newNavigation().updateCard(buildSignFormCard(message));
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onSubmitSign(e) {
  var state = getState();
  if (!state) return buildEmptyStateCard();

  var formInputs = (e.commonEventObject && e.commonEventObject.formInputs) || {};
  var commitMessage = (formInputs["commitMessage"] &&
    formInputs["commitMessage"].stringInputs &&
    formInputs["commitMessage"].stringInputs.value)
    ? formInputs["commitMessage"].stringInputs.value[0].trim()
    : "";

  if (!commitMessage) {
    commitMessage = "Signed off";
  }

  var currentText = getDocText() || "";
  var revId = nextRevisionId();
  var now = new Date().toISOString();

  var signers = state.signers || [];
  var signerName = "You";
  for (var i = 0; i < signers.length; i++) {
    if (signers[i].id === DEMO_USER_ID) {
      signerName = signers[i].name;
      signers[i].status = "signed";
      signers[i].signoffSnapshot = currentText;
      signers[i].commitMessage = commitMessage;
      signers[i].revisionId = revId;
      signers[i].timestamp = now;
    }
  }

  var history = state.history || [];
  history.unshift({
    action: "signed",
    name: signerName,
    commitMessage: commitMessage,
    revisionId: revId,
    timestamp: now,
    status: "signed"
  });

  state.signers = signers;
  state.history = history;
  saveState(state);

  var nav = CardService.newNavigation().popToRoot().updateCard(buildStatusCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onCancelSign(e) {
  var state = getState();
  state = checkDriftAndSave(state);
  var nav = CardService.newNavigation().popToRoot().updateCard(buildStatusCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onViewDiff(e) {
  var signerId = (e.parameters && e.parameters.signerId) ? e.parameters.signerId : "";
  var nav = CardService.newNavigation().pushCard(buildDiffCard(signerId));
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onViewHistory(e) {
  var nav = CardService.newNavigation().pushCard(buildHistoryCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onGoHome(e) {
  var state = getState();
  state = checkDriftAndSave(state);

  if (!state || !state.signers || state.signers.length === 0) {
    if (!state || !state.docTitle) {
      var nav = CardService.newNavigation().popToRoot().updateCard(buildEmptyStateCard());
      return CardService.newActionResponseBuilder().setNavigation(nav).build();
    }
    var nav = CardService.newNavigation().popToRoot().updateCard(buildAddSignersCard());
    return CardService.newActionResponseBuilder().setNavigation(nav).build();
  }
  var nav = CardService.newNavigation().popToRoot().updateCard(buildStatusCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onSimulateDrift(e) {
  var state = getState();
  if (!state) return buildEmptyStateCard();

  var signers = state.signers || [];
  for (var i = 0; i < signers.length; i++) {
    if (signers[i].status === "signed") {
      signers[i].status = "drifted";
    }
  }
  saveState(state);

  var nav = CardService.newNavigation().updateCard(buildStatusCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}

function onResetDemo(e) {
  var cache = CacheService.getUserCache();
  cache.remove(CACHE_KEY);
  cache.remove(REVISION_COUNTER_KEY);
  var nav = CardService.newNavigation().popToRoot().updateCard(buildEmptyStateCard());
  return CardService.newActionResponseBuilder()
    .setNavigation(nav)
    .build();
}
