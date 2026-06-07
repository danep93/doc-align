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
  { id: "alice", name: "Alice M.", email: "alice@acme.com" },
  { id: "john",  name: "John D.",  email: "john@acme.com" },
  { id: "rahul", name: "Rahul K.", email: "rahul@acme.com" }
];

var DEMO_USER_EMAIL = "rahul@acme.com";

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

    var isHeading = text.length > 0 && text.length < 60;

    if (isHeading) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { title: text, type: line.type, added: 0, removed: 0, context: 0 };
    } else if (currentSection) {
      if (line.type === "added") currentSection.added++;
      else if (line.type === "removed") currentSection.removed++;
      else currentSection.context++;
    } else {
      currentSection = { title: "Document content", type: line.type, added: 0, removed: 0, context: 0 };
      if (line.type === "added") currentSection.added++;
      else if (line.type === "removed") currentSection.removed++;
      else currentSection.context++;
    }
  }

  if (currentSection) sections.push(currentSection);

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
// MENU & SIDEBAR ENTRY POINTS
// ============================================================

function onOpen() {
  DocumentApp.getUi()
    .createAddonMenu()
    .addItem('Open Sidebar', 'showSidebar')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('doc-align')
    .setWidth(350);
  DocumentApp.getUi().showSidebar(html);
}

// ============================================================
// VIEW DETERMINATION
// ============================================================

function determineView(state) {
  if (!state || !state.docTitle) return 'empty';
  if (!state.signers || state.signers.length === 0) return 'addSigners';
  return 'status';
}

// ============================================================
// SERVER FUNCTIONS (JSON-returning, for google.script.run)
// ============================================================

function getInitialState() {
  var state = getState();
  var view = determineView(state);
  return { view: view, state: state };
}

function createBaseline() {
  var docTitle = getDocTitle();
  var revId = nextRevisionId();
  var now = new Date().toISOString();
  var state = {
    docTitle: docTitle,
    signers: [],
    history: [{
      action: 'created', name: null, commitMessage: null,
      revisionId: revId, timestamp: now, status: null
    }]
  };
  saveState(state);
  return { view: 'addSigners', state: state };
}

function addSigners(payload) {
  var state = getState();
  if (!state) return { view: 'empty', state: null };
  var selectedIds = payload.selectedIds || [];
  var signers = [];
  for (var j = 0; j < MOCK_SIGNERS.length; j++) {
    var ms = MOCK_SIGNERS[j];
    if (selectedIds.indexOf(ms.id) !== -1) {
      signers.push({
        id: ms.id, name: ms.name, email: ms.email,
        status: 'pending', commitMessage: null,
        revisionId: null, timestamp: null
      });
    }
  }
  if (payload.customEmail) {
    var customName = payload.customEmail.replace(/@.*$/, '').replace(/\./g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    signers.push({
      id: 'custom_' + Date.now(), name: customName, email: payload.customEmail,
      status: 'pending', commitMessage: null, revisionId: null, timestamp: null
    });
  }
  state.signers = signers;
  saveState(state);
  return { view: 'status', state: state };
}

function signOff(payload) {
  var state = getState();
  if (!state) return { view: 'empty', state: null };
  var commitMessage = (payload.commitMessage || '').trim() || 'Signed off';
  var currentText = getDocText() || '';
  var revId = nextRevisionId();
  var now = new Date().toISOString();
  var signers = state.signers || [];
  var signerName = 'You';
  for (var i = 0; i < signers.length; i++) {
    if (signers[i].status === 'pending') {
      signerName = signers[i].name;
      signers[i].status = 'signed';
      signers[i].signoffSnapshot = currentText;
      signers[i].commitMessage = commitMessage;
      signers[i].revisionId = revId;
      signers[i].timestamp = now;
      break;
    }
  }
  var history = state.history || [];
  history.unshift({
    action: 'signed', name: signerName, commitMessage: commitMessage,
    revisionId: revId, timestamp: now, status: 'signed'
  });
  state.signers = signers;
  state.history = history;
  saveState(state);
  return { view: 'status', state: state };
}

function quickSign(payload) {
  return signOff({ commitMessage: payload.message || 'Signed off' });
}

function cancelSign() {
  var state = getState();
  state = checkDriftAndSave(state);
  return { view: 'status', state: state };
}

function simulateDrift() {
  var state = getState();
  if (!state) return { view: 'empty', state: null };
  var signers = state.signers || [];
  for (var i = 0; i < signers.length; i++) {
    if (signers[i].status === 'signed') signers[i].status = 'drifted';
  }
  saveState(state);
  return { view: 'status', state: state };
}

function resetDemo() {
  var cache = CacheService.getUserCache();
  cache.remove('docAlignState');
  cache.remove('docAlignRevCounter');
  return { view: 'empty', state: null };
}

function getDiff(signerId) {
  var state = getState();
  var signers = (state && state.signers) || [];
  var signer = null;
  for (var i = 0; i < signers.length; i++) {
    if (signers[i].id === signerId) { signer = signers[i]; break; }
  }
  var signoffText = (signer && signer.signoffSnapshot) || '';
  var currentText = getDocText() || '';
  var diff = computeDiff(signoffText, currentText);
  if (diff.sections.length === 0) {
    diff = {
      summary: '3 added, 1 removed',
      stats: { added: 3, removed: 1, modified: 2 },
      sections: [
        { title: 'Scope & Requirements', type: 'modified', added: 2, removed: 1, context: 3 },
        { title: 'Budget Estimation', type: 'added', added: 3, removed: 0, context: 0 },
        { title: 'Legacy Timeline', type: 'removed', added: 0, removed: 2, context: 0 },
        { title: 'Team Assignments', type: 'modified', added: 1, removed: 1, context: 2 }
      ]
    };
  }
  return diff;
}

function getHistory() {
  var state = getState();
  return {
    entries: (state && state.history) || [],
    docTitle: (state && state.docTitle) || getDocTitle()
  };
}

function goHome() {
  var state = getState();
  state = checkDriftAndSave(state);
  var view = determineView(state);
  return { view: view, state: state };
}
