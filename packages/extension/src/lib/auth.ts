// Re-export a minimal User type so consumers don't need firebase/auth
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
}

// --- Firebase implementation (lazy-loaded) ---

export async function signIn(): Promise<AuthUser> {
  const fb = await import('firebase/auth');
  const { getFirebaseAuth } = await import('./firebase-init');
  const auth = getFirebaseAuth();

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Failed to get auth token'));
        return;
      }
      try {
        const credential = fb.GoogleAuthProvider.credential(null, token);
        const result = await fb.signInWithCredential(auth, credential);
        resolve(result.user as unknown as AuthUser);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function signOut(): Promise<void> {
  const fb = await import('firebase/auth');
  const { getFirebaseAuth } = await import('./firebase-init');
  await fb.signOut(getFirebaseAuth());
  return new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => resolve());
  });
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  // Dynamic import to avoid loading Firebase at module level
  let unsubscribe: (() => void) | null = null;
  import('firebase/auth').then(async (fb) => {
    const { getFirebaseAuth } = await import('./firebase-init');
    unsubscribe = fb.onAuthStateChanged(getFirebaseAuth(), (user) => {
      callback(user as unknown as AuthUser | null);
    });
  });
  return () => { unsubscribe?.(); };
}

export async function getIdToken(): Promise<string | null> {
  const { getFirebaseAuth } = await import('./firebase-init');
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { getFirebaseAuth } = await import('./firebase-init');
  return getFirebaseAuth().currentUser as unknown as AuthUser | null;
}
