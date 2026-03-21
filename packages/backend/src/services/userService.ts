import { db, admin } from '../config/firebase';
import type { UserProfile } from '@doc-align/shared';

const USERS = 'users';

export function shouldResetSignOffCount(resetAt: string): boolean {
  return new Date(resetAt).getTime() < Date.now();
}

function nextMonthReset(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

export async function getOrCreateUser(userId: string, email: string): Promise<UserProfile> {
  const ref = db.collection(USERS).doc(userId);
  const doc = await ref.get();

  if (doc.exists) {
    const data = doc.data() as UserProfile;
    if (shouldResetSignOffCount(data.signOffCountResetAt)) {
      await ref.update({ signOffCount: 0, signOffCountResetAt: nextMonthReset() });
      return { ...data, signOffCount: 0, signOffCountResetAt: nextMonthReset() };
    }
    return data;
  }

  const newUser: UserProfile = {
    id: userId,
    email,
    tier: 'free',
    signOffCount: 0,
    signOffCountResetAt: nextMonthReset(),
    createdAt: new Date().toISOString(),
  };
  await ref.set(newUser);
  return newUser;
}

export async function incrementSignOffCount(userId: string): Promise<void> {
  const ref = db.collection(USERS).doc(userId);
  await ref.update({
    signOffCount: admin.firestore.FieldValue.increment(1),
  });
}

export async function updateUserTier(userId: string, tier: string, stripeCustomerId: string): Promise<void> {
  await db.collection(USERS).doc(userId).update({ tier, stripeCustomerId });
}
