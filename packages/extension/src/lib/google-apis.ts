async function getGoogleToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error('Failed to get Google token'));
        return;
      }
      resolve(token);
    });
  });
}

export interface DocMetadata {
  id: string;
  title: string;
}

export interface Revision {
  id: string;
  modifiedTime: string;
}

export async function getDocMetadata(docId: string): Promise<DocMetadata> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}?fields=id,name`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Failed to get doc metadata');
  const data = await res.json();
  return { id: data.id, title: data.name };
}

export async function listRevisions(docId: string): Promise<Revision[]> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/revisions?fields=revisions(id,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`listRevisions failed: ${res.status}`, body);
    throw new Error(`Failed to list revisions: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.revisions || [];
}

export async function getLatestRevisionId(docId: string): Promise<string> {
  const revisions = await listRevisions(docId);
  if (revisions.length === 0) throw new Error('No revisions found');
  return revisions[revisions.length - 1]!.id;
}

export async function getRevisionContent(docId: string, revisionId: string): Promise<string> {
  // For 'head', export the current document as plain text
  if (revisionId === 'head') {
    return exportDocAsText(docId);
  }

  // Always try stored snapshot first (most reliable for Google Docs)
  const snapshot = await getStoredSnapshot(docId, revisionId);
  if (snapshot) return snapshot;

  // Fall back to Drive API (works for non-Google-Docs files)
  try {
    const token = await getGoogleToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docId}/revisions/${revisionId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) return res.text();
  } catch {
    // API failed — snapshot is the only option
  }

  throw new Error(`No snapshot found for this sign-off. Please re-sign-off on the document to enable diffs.`);
}

export async function exportDocAsText(docId: string): Promise<string> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to export document: ${res.status} ${body}`);
  }
  return res.text();
}

export async function storeSnapshot(docId: string, revisionId: string, text: string): Promise<void> {
  const key = `snapshot_${docId}_${revisionId}`;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: text }, resolve);
  });
}

export async function deleteSnapshot(docId: string, revisionId: string): Promise<void> {
  const key = `snapshot_${docId}_${revisionId}`;
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, resolve);
  });
}

async function getStoredSnapshot(docId: string, revisionId: string): Promise<string | null> {
  const key = `snapshot_${docId}_${revisionId}`;
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve((result[key] as string) ?? null);
    });
  });
}

export async function insertImageIntoDoc(docId: string, imageDataUrl: string): Promise<void> {
  const token = await getGoogleToken();

  const base64 = imageDataUrl.split(',')[1] || '';
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });

  const metadata = { name: 'doc-align-signature.png', mimeType: 'image/png' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  if (!uploadRes.ok) throw new Error('Failed to upload signature image');
  const uploadData = await uploadRes.json();
  const imageFileId = uploadData.id;

  const docRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertInlineImage: {
              uri: `https://drive.google.com/uc?id=${imageFileId}`,
              location: { index: 1 },
              objectSize: {
                width: { magnitude: 250, unit: 'PT' },
                height: { magnitude: 150, unit: 'PT' },
              },
            },
          },
        ],
      }),
    },
  );
  if (!docRes.ok) throw new Error('Failed to insert signature into document');
}
