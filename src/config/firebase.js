const admin = require('firebase-admin');
require('dotenv').config();

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
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
  return firebaseApp ? admin.messaging() : null;
};

module.exports = { initFirebase, getMessaging };
