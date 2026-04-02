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
    apiKey: 'STAGING_API_KEY',
    authDomain: 'doc-align-staging.firebaseapp.com',
    projectId: 'doc-align-staging',
    storageBucket: 'doc-align-staging.firebasestorage.app',
    messagingSenderId: 'STAGING_SENDER_ID',
    appId: 'STAGING_APP_ID',
  },
};

const firebaseConfig = configs[projectId] || configs['doc-align']!;

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
