import { db } from '../config/firebase';
import type { Signature } from '@doc-align/shared';

const SIGNATURES = 'signatures';

export async function createSignature(
  userId: string,
  data: { name: string; title?: string; organization?: string; format: 'basic' | 'full'; drawingData: string },
): Promise<Signature> {
  const ref = db.collection(SIGNATURES).doc();
  const signature: Signature = {
    id: ref.id,
    userId,
    name: data.name,
    title: data.title,
    organization: data.organization,
    format: data.format,
    drawingData: data.drawingData,
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  await ref.set(signature);
  return signature;
}

export async function getSignatures(userId: string): Promise<Signature[]> {
  const snapshot = await db
    .collection(SIGNATURES)
    .where('userId', '==', userId)
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map((doc) => doc.data() as Signature);
}

export async function retireSignature(userId: string, signatureId: string): Promise<void> {
  const ref = db.collection(SIGNATURES).doc(signatureId);
  const doc = await ref.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error('Signature not found');
  }
  await ref.update({ status: 'retired' });
}
