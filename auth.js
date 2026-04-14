import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const body = document.body;
const shellSelectors = ["header", "main", "footer"];
const authState = {
  overlay: null,
  auth: null
};

function createOverlay() {
  if (authState.overlay) {
    return authState.overlay;
  }

  const overlay = document.createElement("div");
  overlay.className = "auth-overlay";
  overlay.innerHTML = `
    <div class="auth-card">
      <p class="auth-kicker">Pristup izdanju</p>
      <h2>Prijava za 365 Briševo</h2>
      <p class="auth-copy">Za pristup sadržaju prijavite se ili otvorite novi korisnički račun.</p>
      <div class="auth-tabs" role="tablist" aria-label="Odabir načina prijave">
        <button class="auth-tab is-active" type="button" data-auth-mode="login">Log in</button>
        <button class="auth-tab" type="button" data-auth-mode="signup">Sign up</button>
      </div>
      <form class="auth-form" data-auth-form>
        <label>
          E-mail
          <input type="email" name="email" autocomplete="email" placeholder="vas@email.com" required>
        </label>
        <label>
          Lozinka
          <input type="password" name="password" autocomplete="current-password" placeholder="Unesite lozinku" required>
        </label>
        <button class="button auth-submit" type="submit">Prijavi me</button>
      </form>
      <div class="auth-actions">
        <button class="auth-secondary" type="button" data-auth-reset>Zaboravljena lozinka?</button>
      </div>
      <p class="auth-note" data-auth-note aria-live="polite"></p>
    </div>
  `;

  document.body.appendChild(overlay);
  authState.overlay = overlay;
  return overlay;
}

function setLockedState(locked) {
  body.classList.toggle("auth-locked", locked);
  shellSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      node.classList.toggle("auth-shell-dimmed", locked);
    });
  });
}

function ensureLogoutButton(auth) {
  const nav = document.querySelector(".hero-nav");
  if (!nav || nav.querySelector(".hero-nav-auth")) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "hero-nav-auth";
  button.textContent = "Logout";
  button.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch {
      // noop
    }
  });
  nav.appendChild(button);
}

function updateAuthUi(mode) {
  const overlay = createOverlay();
  overlay.dataset.mode = mode;

  overlay.querySelectorAll(".auth-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authMode === mode);
  });

  const passwordInput = overlay.querySelector('input[name="password"]');
  const submit = overlay.querySelector(".auth-submit");
  const reset = overlay.querySelector("[data-auth-reset]");

  if (passwordInput) {
    passwordInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
    passwordInput.placeholder = mode === "signup" ? "Smislite lozinku" : "Unesite lozinku";
    passwordInput.minLength = mode === "signup" ? 6 : 0;
  }

  if (submit) {
    submit.textContent = mode === "signup" ? "Otvori račun" : "Prijavi me";
  }

  if (reset) {
    reset.hidden = mode === "signup";
  }
}

function setNote(message, state = "") {
  const note = authState.overlay?.querySelector("[data-auth-note]");
  if (!note) {
    return;
  }
  note.textContent = message;
  note.dataset.state = state;
}

function wireOverlay(auth) {
  const overlay = createOverlay();
  const form = overlay.querySelector("[data-auth-form]");

  overlay.querySelectorAll(".auth-tab").forEach((button) => {
    button.addEventListener("click", () => {
      updateAuthUi(button.dataset.authMode || "login");
      setNote("");
    });
  });

  overlay.querySelector("[data-auth-reset]")?.addEventListener("click", async () => {
    const emailInput = overlay.querySelector('input[name="email"]');
    const email = emailInput?.value.trim() || "";

    if (!email) {
      setNote("Upišite e-mail za reset lozinke.", "error");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setNote("Poslan je e-mail za reset lozinke.", "success");
    } catch (error) {
      setNote(mapAuthError(error), "error");
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = overlay.dataset.mode || "login";
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();

    if (!email || !password) {
      setNote("Upišite e-mail i lozinku.", "error");
      return;
    }

    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
        setNote("Račun je otvoren i prijava je uspješna.", "success");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        setNote("Prijava je uspješna.", "success");
      }
    } catch (error) {
      setNote(mapAuthError(error), "error");
    }
  });
}

function mapAuthError(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/invalid-email":
      return "E-mail nije ispravan.";
    case "auth/email-already-in-use":
      return "Taj e-mail već ima otvoren račun.";
    case "auth/user-not-found":
    case "auth/invalid-credential":
      return "Korisnik ili lozinka nisu ispravni.";
    case "auth/weak-password":
      return "Lozinka mora imati barem 6 znakova.";
    case "auth/too-many-requests":
      return "Previše pokušaja. Pričekajte pa pokušajte ponovno.";
    default:
      return "Prijava nije uspjela. Provjerite podatke i pokušajte ponovno.";
  }
}

function showConfigHelp() {
  const overlay = createOverlay();
  overlay.classList.add("is-setup");
  overlay.querySelector(".auth-card").innerHTML = `
    <p class="auth-kicker">Firebase setup</p>
    <h2>Dodaj Firebase konfiguraciju</h2>
    <p class="auth-copy">Za pravu prijavu trebaš zalijepiti svoj Firebase config u <code>firebase-config.js</code> i u Firebase konzoli uključiti Email/Password prijavu.</p>
    <ol class="auth-steps">
      <li>Otvori Firebase Console i odaberi svoj projekt.</li>
      <li>Idi na Authentication → Sign-in method i uključi Email/Password.</li>
      <li>Idi na Project settings → General → Your apps i kopiraj Web config.</li>
      <li>Zalijepi vrijednosti u <code>firebase-config.js</code>.</li>
    </ol>
    <p class="auth-note" data-auth-note data-state="error">Auth je pripremljen, ali još nema aktivnu Firebase konfiguraciju.</p>
  `;
  setLockedState(true);
}

async function initAuth() {
  body.classList.add("auth-ready");

  if (!isFirebaseConfigured()) {
    showConfigHelp();
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  authState.auth = auth;

  await setPersistence(auth, browserLocalPersistence);
  createOverlay();
  updateAuthUi("login");
  wireOverlay(auth);

  onAuthStateChanged(auth, (user) => {
    if (user) {
      setLockedState(false);
      authState.overlay?.classList.remove("is-visible");
      ensureLogoutButton(auth);
    } else {
      setLockedState(true);
      authState.overlay?.classList.add("is-visible");
    }
  });
}

initAuth().catch(() => {
  showConfigHelp();
});
