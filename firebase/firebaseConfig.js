export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "apex-dienstleister.firebaseapp.com",
  projectId: "apex-dienstleister-demo",
  storageBucket: "apex-dienstleister-demo.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:demo1234567890abcdef"
};

export const appConfig = {
  companyId: "apex-dienstleister",
  companyName: "Apex Dienstleister GmbH",
  domain: "https://apex-dienstleister-demo.de",
  functionsRegion: "europe-west3",
  adminEmail: "info@apex-dienstleister.de",
  superAdminEmail: "admin@apex-dienstleister.de",
  maxContactMessagesPerHour: 3,
  maxReviewSubmissionsPerDay: 2
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
}
