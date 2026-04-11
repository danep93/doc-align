import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

// The GOOGLE_CLOUD_PROJECT env var determines which Firestore to use.
// FIREBASE_AUTH_PROJECT_ID determines which project's tokens to verify
// (defaults to 'doc-align' since the extension always authenticates there).
const FIRESTORE_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'doc-align';
const AUTH_PROJECT = process.env.FIREBASE_AUTH_PROJECT_ID || 'doc-align';

// Initialize the main app for Firestore
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: FIRESTORE_PROJECT,
  });
}

export const db: Firestore = admin.firestore();

// If auth and firestore use different projects, create a separate app for auth
let authInstance: Auth;
if (AUTH_PROJECT === FIRESTORE_PROJECT) {
  authInstance = admin.auth();
} else {
  const authApp = admin.apps.find(a => a?.name === 'auth') ||
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: AUTH_PROJECT,
    }, 'auth');
  authInstance = authApp.auth();
}

export const auth: Auth = authInstance;
export { admin };
