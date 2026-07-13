export const firebaseConfig = {
  apiKey: "AIzaSyB5ACiNipB6JkX02WyGXPDCyiqjEQN54I8",
  authDomain: "handienstleister.firebaseapp.com",
  projectId: "handienstleister",
  storageBucket: "handienstleister.firebasestorage.app",
  messagingSenderId: "773596379234",
  appId: "1:773596379234:web:35f764c62c598c00b2793b"
};

export const appConfig = {
  companyId: "han-dienstleister",
  companyName: "HAN Dienstleister GmbH",
  domain: "https://han-dienstleister.de",
  functionsRegion: "europe-west3",
  adminEmail: "info@han-dienstleister.de",
  superAdminEmail: "admin@han-dienstleister.de",
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
