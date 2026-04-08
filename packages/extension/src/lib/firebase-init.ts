import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

// Always use production Firebase for auth — the manifest's OAuth client_id is
// registered in the production project. Staging only changes the API_BASE
// (backend URL), not the auth provider.
const firebaseConfig = {
  apiKey: 'AIzaSyBMkCQe1R_YALthMKtE8xXZRY0CQK1jeVE',
  authDomain: 'doc-align.firebaseapp.com',
  projectId: 'doc-align',
  storageBucket: 'doc-align.firebasestorage.app',
  messagingSenderId: '255634835670',
  appId: '1:255634835670:web:509f1fd1ede69a53f1e177',
};

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
