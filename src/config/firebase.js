const admin = require('firebase-admin');
require('dotenv').config();

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    // Support both firebase-admin API styles: admin.credential.cert (older)
    // and top-level admin.cert (newer modular builds).
    const certFn = (admin.credential && admin.credential.cert) ? admin.credential.cert : admin.cert;

    firebaseApp = admin.initializeApp({
      credential: certFn({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.warn('⚠️  Firebase initialization skipped:', error.message);
  }

  return firebaseApp;
};

const getMessaging = () => {
  if (!firebaseApp) initFirebase();
  if (!firebaseApp) return null;

  // Older API: admin.messaging() is a function.
  if (typeof admin.messaging === 'function') {
    return admin.messaging();
  }

  // Newer modular API: getMessaging(app) from firebase-admin/messaging.
  try {
    const { getMessaging: modularGetMessaging } = require('firebase-admin/messaging');
    return modularGetMessaging(firebaseApp);
  } catch (e) {
    console.warn('⚠️  Firebase messaging unavailable:', e.message);
    return null;
  }
};

module.exports = { initFirebase, getMessaging };
