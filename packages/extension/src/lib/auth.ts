import { DEV_MODE, devFakeUser } from './dev-mode';

// Re-export a minimal User type so consumers don't need firebase/auth
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
}

// --- Dev mode implementation ---

let devAuthCallback: ((user: AuthUser | null) => void) | null = null;
let devSignedIn = false;

function devSignIn(): Promise<AuthUser> {
  devSignedIn = true;
  const user = devFakeUser as AuthUser;
  devAuthCallback?.(user);
  return Promise.resolve(user);
}

function devSignOut(): Promise<void> {
  devSignedIn = false;
  devAuthCallback?.(null);
  return Promise.resolve();
}

function devOnAuthChange(callback: (user: AuthUser | null) => void): () => void {
  devAuthCallback = callback;
  // Fire immediately with current state
  setTimeout(() => callback(devSignedIn ? (devFakeUser as AuthUser) : null), 0);
  return () => { devAuthCallback = null; };
}

function devGetIdToken(): Promise<string | null> {
  return Promise.resolve(devSignedIn ? 'dev-token' : null);
}

function devGetCurrentUser(): AuthUser | null {
  return devSignedIn ? (devFakeUser as AuthUser) : null;
}

// --- Real Firebase implementation (lazy-loaded) ---

async function realSignIn(): Promise<AuthUser> {
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

async function realSignOut(): Promise<void> {
  const fb = await import('firebase/auth');
  const { getFirebaseAuth } = await import('./firebase-init');
  await fb.signOut(getFirebaseAuth());
  return new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => resolve());
  });
}

function realOnAuthChange(callback: (user: AuthUser | null) => void): () => void {
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

async function realGetIdToken(): Promise<string | null> {
  const { getFirebaseAuth } = await import('./firebase-init');
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

async function realGetCurrentUser(): Promise<AuthUser | null> {
  const { getFirebaseAuth } = await import('./firebase-init');
  return getFirebaseAuth().currentUser as unknown as AuthUser | null;
}

// --- Exports: pick dev or real based on DEV_MODE ---

export const signIn = DEV_MODE ? devSignIn : realSignIn;
export const signOut = DEV_MODE ? devSignOut : realSignOut;
export const onAuthChange = DEV_MODE ? devOnAuthChange : realOnAuthChange;
export const getIdToken = DEV_MODE ? devGetIdToken : realGetIdToken;
export const getCurrentUser = DEV_MODE
  ? devGetCurrentUser
  : realGetCurrentUser;
