import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const cfg = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export let db = null;
export let isFirebaseReady = false;

if (cfg.apiKey && cfg.projectId) {
  try {
    const app = initializeApp(cfg);
    db = getFirestore(app);
    isFirebaseReady = true;
  } catch (e) {
    console.warn('Firebase init error:', e.message);
  }
}
