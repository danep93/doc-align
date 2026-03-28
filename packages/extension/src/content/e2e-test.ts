// E2E test interface — injected as a separate content script
// Allows driving extension operations from the page context via window.postMessage

window.addEventListener('message', async (event) => {
  if (event.source !== window || !event.data?.type?.startsWith('DA_E2E_')) return;

  const { type } = event.data;
  try {
    let result: unknown;

    if (type === 'DA_E2E_SIGN_OFF') {
      const docId = e2eExtractDocId(window.location.href);
      const title = document.title.replace(' - Google Docs', '').trim();
      if (!docId) throw new Error('Not on a Google Doc');

      const token = await bgMessage({ type: 'GET_AUTH_TOKEN' });
      if (!token?.token) throw new Error('No auth token');

      const revRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${docId}/revisions?fields=revisions(id,modifiedTime)`,
        { headers: { Authorization: `Bearer ${token.token}` } },
      );
      if (!revRes.ok) throw new Error(`List revisions failed: ${revRes.status}`);
      const revData = await revRes.json();
      const revisions = revData.revisions || [];
      if (revisions.length === 0) throw new Error('No revisions');
      const revisionId = revisions[revisions.length - 1].id;

      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${token.token}` } },
      );
      if (!exportRes.ok) throw new Error(`Export failed: ${exportRes.status}`);
      const docText = await exportRes.text();

      const snapshotKey = `snapshot_${docId}_${revisionId}`;
      await chromeStorageSet({ [snapshotKey]: docText });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sigs: any[] = (await chromeStorageGet('local_signatures')) || [];
      const signatureId = sigs.length > 0 ? sigs[0].id : 'no-sig';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signOffs: any[] = (await chromeStorageGet('local_signoffs')) || [];
      const counter: number = (await chromeStorageGet('local_signoff_counter')) || 0;
      const signOff = {
        id: `so_${counter + 1}`,
        userId: 'test',
        signatureId,
        documentId: docId,
        revisionId,
        imageHash: 'test-hash',
        createdAt: new Date().toISOString(),
      };
      signOffs.push(signOff);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docRefs: any[] = (await chromeStorageGet('local_docrefs')) || [];
      const existingIdx = docRefs.findIndex((d: { id: string }) => d.id === docId);
      const ref = {
        id: docId,
        userId: 'test',
        title,
        lastKnownRevisionId: revisionId,
        updatedAt: new Date().toISOString(),
      };
      if (existingIdx >= 0) docRefs[existingIdx] = ref;
      else docRefs.push(ref);

      await chromeStorageSet({
        local_signoffs: signOffs,
        local_docrefs: docRefs,
        local_signoff_counter: counter + 1,
      });

      result = { success: true, revisionId, snapshotLength: docText.length, title };

    } else if (type === 'DA_E2E_CHECK_CHANGES') {
      const docId = e2eExtractDocId(window.location.href);
      if (!docId) throw new Error('Not on a Google Doc');

      const token = await bgMessage({ type: 'GET_AUTH_TOKEN' });
      if (!token?.token) throw new Error('No auth token');

      const revRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${docId}/revisions?fields=revisions(id,modifiedTime)`,
        { headers: { Authorization: `Bearer ${token.token}` } },
      );
      const revData = await revRes.json();
      const currentRevId = revData.revisions?.[revData.revisions.length - 1]?.id;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signOffs: any[] = (await chromeStorageGet('local_signoffs')) || [];
      const docSignOffs = signOffs.filter((so: { documentId: string }) => so.documentId === docId);
      const latest = docSignOffs[docSignOffs.length - 1];

      result = {
        currentRevId,
        signOffRevId: latest?.revisionId,
        hasChanged: currentRevId !== latest?.revisionId,
        signOffDate: latest?.createdAt,
      };

    } else if (type === 'DA_E2E_GET_DIFF') {
      const docId = e2eExtractDocId(window.location.href);
      if (!docId) throw new Error('Not on a Google Doc');

      const token = await bgMessage({ type: 'GET_AUTH_TOKEN' });
      if (!token?.token) throw new Error('No auth token');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signOffs: any[] = (await chromeStorageGet('local_signoffs')) || [];
      const docSignOffs = signOffs.filter((so: { documentId: string }) => so.documentId === docId);
      const latest = docSignOffs[docSignOffs.length - 1];
      if (!latest) throw new Error('No sign-off found for this doc');

      const snapshotKey = `snapshot_${docId}_${latest.revisionId}`;
      const oldText = await chromeStorageGet(snapshotKey);
      if (!oldText) throw new Error('No snapshot stored for this sign-off');

      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${token.token}` } },
      );
      if (!exportRes.ok) throw new Error(`Export failed: ${exportRes.status}`);
      const newText = await exportRes.text();

      result = { oldText, newText, hasChanged: oldText !== newText };

    } else if (type === 'DA_E2E_RELOAD') {
      await bgMessage({ type: 'RELOAD_EXTENSION' });
      result = { reloading: true };

    } else if (type === 'DA_E2E_SET_TIER') {
      const tier = event.data.tier;
      if (!['free', 'pro', 'enterprise'].includes(tier)) throw new Error(`Invalid tier: ${tier}`);
      await chromeStorageSet({ debug_tier_override: tier });
      result = { tier, note: 'Tier override set. Only applies when backend is unavailable.' };

    } else if (type === 'DA_E2E_GET_TIER') {
      const override = await chromeStorageGet('debug_tier_override');
      result = { tier: override || 'free (default)' };

    } else if (type === 'DA_E2E_CLEAR_DATA') {
      // Reset all local sign-off data for clean testing
      await chromeStorageSet({
        local_signoffs: [],
        local_docrefs: [],
        local_signoff_counter: 0,
      });
      result = { cleared: true };

    } else if (type === 'DA_E2E_STATUS') {
      const docId = e2eExtractDocId(window.location.href);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signOffs: any[] = (await chromeStorageGet('local_signoffs')) || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sigs: any[] = (await chromeStorageGet('local_signatures')) || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docRefs: any[] = (await chromeStorageGet('local_docrefs')) || [];
      result = { docId, signOffs: signOffs.length, signatures: sigs.length, docRefs: docRefs.length };
    }

    window.postMessage({ type: `${type}_RESULT`, success: true, result }, '*');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.postMessage({ type: `${type}_RESULT`, success: false, error: msg }, '*');
  }
});

function e2eExtractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? (match[1] ?? null) : null;
}

function bgMessage(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chromeStorageGet(key: string): Promise<any> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key]));
  });
}

function chromeStorageSet(data: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

console.log('[doc-align] E2E test interface loaded');
