// Injects the content script into the active tab on demand (activeTab + scripting permissions).
// Must be called before sending messages to the content script.
// Safe to call multiple times — Chrome ignores re-injection if the script is already running.

let injectedTabs = new Set<number>();

export async function ensureContentScript(tabId: number): Promise<void> {
  if (injectedTabs.has(tabId)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
    injectedTabs.add(tabId);
  } catch {
    // May fail if tab isn't a valid target — caller handles the error
  }
}

export async function getActiveDocTab(): Promise<{ tabId: number; url: string; title: string } | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.includes('docs.google.com/document')) {
        resolve(null);
        return;
      }
      resolve({ tabId: tab.id, url: tab.url, title: tab.title || '' });
    });
  });
}
