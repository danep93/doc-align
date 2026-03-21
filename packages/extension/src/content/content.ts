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
  return match ? (match[1] ?? null) : null;
}
