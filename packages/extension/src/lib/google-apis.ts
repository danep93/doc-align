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
  if (!res.ok) throw new Error('Failed to list revisions');
  const data = await res.json();
  return data.revisions || [];
}

export async function getLatestRevisionId(docId: string): Promise<string> {
  const revisions = await listRevisions(docId);
  if (revisions.length === 0) throw new Error('No revisions found');
  return revisions[revisions.length - 1]!.id;
}

export async function getRevisionContent(docId: string, revisionId: string): Promise<string> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/revisions/${revisionId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Failed to get revision content');
  return res.text();
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
