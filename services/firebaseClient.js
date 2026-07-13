import { appConfig, firebaseConfig, isFirebaseConfigured } from "../firebase/firebaseConfig.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getStorage
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

let services;

export function getFirebaseServices() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase ist noch nicht konfiguriert. Bitte firebase/firebaseConfig.js ausfuellen.");
  }

  if (!services) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    services = {
      app,
      auth: getAuth(app),
      db: getFirestore(app),
      storage: getStorage(app),
      functions: getFunctions(app, appConfig.functionsRegion)
    };
  }

  return services;
}

export function callFunction(name, payload = {}) {
  const { functions } = getFirebaseServices();
  return httpsCallable(functions, name)(payload);
}

export {
  appConfig,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  where
};
