export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: ""
};

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every((value) => typeof value === "string" && value.trim().length > 0);
}
