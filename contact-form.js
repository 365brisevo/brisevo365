import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  addDoc,
  collection,
  getFirestore,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const form = document.querySelector(".contact-form");
const formNote = document.querySelector("#form-note");
const SUBMISSION_COOLDOWN_MS = 30_000;
const RATE_LIMIT_KEY = "brisevo-contact-submit-last";

function setStatus(message, isError = false) {
  if (!formNote) return;
  formNote.textContent = message;
  formNote.classList.toggle("is-error", isError);
}

function canSubmitNow() {
  const lastSubmit = Number(window.localStorage.getItem(RATE_LIMIT_KEY) || 0);
  return Date.now() - lastSubmit >= SUBMISSION_COOLDOWN_MS;
}

function markSubmitted() {
  window.localStorage.setItem(RATE_LIMIT_KEY, String(Date.now()));
}

if (form && formNote) {
  if (!isFirebaseConfigured()) {
    setStatus("Obrazac trenutno nije aktivan jer Firebase nije podešen.", true);
  }

  const app = isFirebaseConfigured() ? initializeApp(firebaseConfig) : null;
  const db = app ? getFirestore(app) : null;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!db) {
      setStatus("Obrazac trenutno nije aktivan. Pokušajte kasnije.", true);
      return;
    }

    if (!canSubmitNow()) {
      setStatus("Pričekajte malo prije slanja nove dojave.", true);
      return;
    }

    const formData = new FormData(form);
    const honeypot = String(formData.get("website") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const topic = String(formData.get("topic") || "").trim();
    const message = String(formData.get("message") || "").trim();

    if (honeypot) {
      form.reset();
      setStatus("Dojava je zaprimljena. Hvala.");
      return;
    }

    if (!name || !topic || !message) {
      setStatus("Ispunite ime, naslov teme i opis dojave.", true);
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton?.setAttribute("disabled", "disabled");
    setStatus("Šaljem dojavu...");

    try {
      await addDoc(collection(db, "contactSubmissions"), {
        name,
        topic,
        message,
        source: "kontakt",
        createdAt: serverTimestamp(),
        createdAtMs: Date.now()
      });

      markSubmitted();
      form.reset();
      setStatus("Dojava je zaprimljena. Hvala.");
    } catch (error) {
      console.error("Contact submission failed", error);
      setStatus("Dojava nije spremljena. Pokušajte ponovno kasnije.", true);
    } finally {
      submitButton?.removeAttribute("disabled");
    }
  });
}
