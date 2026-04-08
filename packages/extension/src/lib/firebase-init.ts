import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

declare const process: { env: { FIREBASE_PROJECT_ID?: string } };

const projectId = process.env.FIREBASE_PROJECT_ID || 'doc-align';

const configs: Record<string, {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}> = {
  'doc-align': {
    apiKey: 'AIzaSyBMkCQe1R_YALthMKtE8xXZRY0CQK1jeVE',
    authDomain: 'doc-align.firebaseapp.com',
    projectId: 'doc-align',
    storageBucket: 'doc-align.firebasestorage.app',
    messagingSenderId: '255634835670',
    appId: '1:255634835670:web:509f1fd1ede69a53f1e177',
  },
  'doc-align-staging': {
    apiKey: 'AIzaSyDJ9Uk3wbRhiLr4s5QV1JBWMGbMxuWAFM8',
    authDomain: 'doc-align-staging.firebaseapp.com',
    projectId: 'doc-align-staging',
    storageBucket: 'doc-align-staging.firebasestorage.app',
    messagingSenderId: '601691463369',
    appId: '1:601691463369:web:9f6a489d930a042dd0b718',
  },
};

// Always use production Firebase for auth — the manifest's OAuth client_id is
// registered in the production project. Staging only changes the API_BASE
// (backend URL), not the auth provider.
const firebaseConfig = configs['doc-align']!;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!app) {
    app = initializeApp(firebaseConfig);
  }
  if (!auth) {
    auth = getAuth(app);
  }
  return auth;
}
