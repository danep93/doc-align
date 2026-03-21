import { db } from '../config/firebase';
import type { SignOff, DocReference } from '@doc-align/shared';

const SIGNOFFS = 'signoffs';
const DOC_REFS = 'docReferences';

export async function createSignOff(
  userId: string,
  data: { signatureId: string; documentId: string; revisionId: string; imageHash: string; documentTitle: string },
): Promise<SignOff> {
  const ref = db.collection(SIGNOFFS).doc();
  const signOff: SignOff = {
    id: ref.id,
    userId,
    signatureId: data.signatureId,
    documentId: data.documentId,
    revisionId: data.revisionId,
    imageHash: data.imageHash,
    createdAt: new Date().toISOString(),
  };

  const batch = db.batch();
  batch.set(ref, signOff);

  // Upsert doc reference for this user
  const docRefId = `${userId}_${data.documentId}`;
  const docRef: DocReference = {
    id: data.documentId,
    userId,
    title: data.documentTitle,
    lastKnownRevisionId: data.revisionId,
    updatedAt: new Date().toISOString(),
  };
  batch.set(db.collection(DOC_REFS).doc(docRefId), docRef);

  await batch.commit();
  return signOff;
}

export async function getMySignOffs(userId: string): Promise<SignOff[]> {
  const snapshot = await db
    .collection(SIGNOFFS)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map((doc) => doc.data() as SignOff);
}

export async function getMyDocReferences(userId: string): Promise<DocReference[]> {
  const snapshot = await db
    .collection(DOC_REFS)
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .get();
  return snapshot.docs.map((doc) => doc.data() as DocReference);
}

export async function getCoSigners(
  documentId: string,
  revisionId: string,
): Promise<{ count: number; userIds: string[] }> {
  const snapshot = await db
    .collection(SIGNOFFS)
    .where('documentId', '==', documentId)
    .where('revisionId', '==', revisionId)
    .get();
  const userIds = [...new Set(snapshot.docs.map((doc) => doc.data().userId as string))];
  return { count: userIds.length, userIds };
}
