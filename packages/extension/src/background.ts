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

  if (message.type === 'RELOAD_EXTENSION') {
    sendResponse({ ok: true });
    // Small delay so the response gets sent before reload
    setTimeout(() => chrome.runtime.reload(), 100);
    return true;
  }
});
