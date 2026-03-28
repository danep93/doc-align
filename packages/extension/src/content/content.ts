// Minimal content script — injected programmatically via chrome.scripting.executeScript
// Only runs when the popup needs doc info (activeTab permission, no host_permissions needed)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_DOC_INFO') {
    const docId = extractDocId(window.location.href);
    const title = document.title.replace(' - Google Docs', '').trim();
    sendResponse({ docId, title });
  }
  if (message.type === 'GET_DOC_TEXT_HASH') {
    const text = extractDocText();
    hashText(text).then((hash) => sendResponse({ hash }));
    return true; // async response
  }
  return true;
});

function extractDocText(): string {
  const editor = document.querySelector('.kix-appview-editor');
  return editor?.textContent?.trim() || '';
}

async function hashText(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? (match[1] ?? null) : null;
}
