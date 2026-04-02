import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

// The default app uses ADC credentials — connects to whatever project
// is set via GOOGLE_CLOUD_PROJECT (staging Firestore for local dev).
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

// Firestore: uses the current project (staging locally, prod in production)
export const db: Firestore = admin.firestore();

// Auth: always verify tokens against the production Firebase project.
// The Chrome extension always authenticates via the production OAuth client,
// regardless of which Firestore the backend talks to.
const AUTH_PROJECT_ID = process.env.FIREBASE_AUTH_PROJECT_ID || 'doc-align';

let authApp: admin.app.App;
if (AUTH_PROJECT_ID === (process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId)) {
  // Same project — reuse the default app
  authApp = admin.app();
} else {
  // Different project — create a secondary app for auth verification
  authApp = admin.apps.find(a => a?.name === 'auth-app') ||
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: AUTH_PROJECT_ID,
    }, 'auth-app');
}

export const auth: Auth = authApp.auth();
export { admin };
