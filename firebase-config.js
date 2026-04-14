export const firebaseConfig = {
  apiKey: "AIzaSyBjAsm9wOOMlflRBYzm9TqhW2TWDkaJFoQ",
  authDomain: "brisevo-93197.firebaseapp.com",
  projectId: "brisevo-93197",
  storageBucket: "brisevo-93197.firebasestorage.app",
  messagingSenderId: "104318529129",
  appId: "1:104318529129:web:2be6175be0fed9b15b7cf8",
  measurementId: "G-56WJB11517"
};

export function isFirebaseConfigured() {
  const requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
  return requiredKeys.every((key) => typeof firebaseConfig[key] === "string" && firebaseConfig[key].trim().length > 0);
}
