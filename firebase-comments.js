import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const STORAGE_KEY = "brisevo-article-engagement-v2";
const LEGACY_STORAGE_KEY = "brisevo-article-engagement-v1";
const USER_REACTION_KEY_PREFIX = "brisevo-reaction-";
const COMMENT_RATE_LIMIT_KEY_PREFIX = "brisevo-comment-rate-";
const REACTION_RATE_LIMIT_KEY_PREFIX = "brisevo-reaction-rate-";
const memoryStorage = new Map();
const COMMENT_COOLDOWN_MS = 30_000;
const REACTION_COOLDOWN_MS = 800;
const DUPLICATE_COMMENT_WINDOW_MS = 5 * 60_000;

const REACTION_OPTIONS = [
  { key: "angry", emoji: "\u{1F621}", label: "Ljutito" },
  { key: "laugh", emoji: "\u{1F606}", label: "Smijeh" },
  { key: "like", emoji: "\u{1F44D}", label: "Sviđa mi se" }
];

const state = {
  mode: isFirebaseConfigured() ? "remote" : "local",
  db: null,
  app: null,
  entries: new Map(),
  listeners: new Map(),
  subscriptions: new Map()
};

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return;
  } catch {
    memoryStorage.set(key, value);
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
    return;
  } catch {
    memoryStorage.delete(key);
  }
}

function createEmptyEntry() {
  return {
    reactions: {
      angry: 0,
      laugh: 0,
      like: 0
    },
    comments: []
  };
}

function normalizeComment(comment) {
  const author = String(comment?.author || "").trim();
  const text = String(comment?.text || "").trim();

  let createdAt = "";

  if (typeof comment?.createdAt === "string") {
    createdAt = comment.createdAt;
  } else if (typeof comment?.createdAtMs === "number" && Number.isFinite(comment.createdAtMs)) {
    createdAt = new Date(comment.createdAtMs).toISOString();
  } else if (comment?.createdAt?.toDate instanceof Function) {
    createdAt = comment.createdAt.toDate().toISOString();
  } else if (comment?.createdAt?.seconds) {
    createdAt = new Date(comment.createdAt.seconds * 1000).toISOString();
  }

  return {
    author,
    text,
    createdAt,
    createdAtMs:
      typeof comment?.createdAtMs === "number" && Number.isFinite(comment.createdAtMs)
        ? comment.createdAtMs
        : Date.now()
  };
}

function normalizeEntry(entry) {
  const normalized = createEmptyEntry();

  if (entry?.reactions && typeof entry.reactions === "object") {
    for (const option of REACTION_OPTIONS) {
      normalized.reactions[option.key] = Number(entry.reactions[option.key] || 0);
    }
  }

  if (Number(entry?.likes || 0) > 0 && totalReactions(normalized) === 0) {
    normalized.reactions.like = Number(entry.likes || 0);
  }

  if (Array.isArray(entry?.comments)) {
    normalized.comments = entry.comments
      .map((comment) => normalizeComment(comment))
      .filter((comment) => comment.author || comment.text)
      .sort((left, right) => left.createdAtMs - right.createdAtMs);
  }

  return normalized;
}

function loadStore() {
  const candidateKeys = [STORAGE_KEY, LEGACY_STORAGE_KEY];

  for (const key of candidateKeys) {
    try {
      const raw = storageGet(key);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw);
      const store = {};

      Object.entries(parsed).forEach(([articleId, entry]) => {
        store[articleId] = normalizeEntry(entry);
      });

      if (key !== STORAGE_KEY) {
        saveStore(store);
        storageRemove(key);
      }

      return store;
    } catch {
      continue;
    }
  }

  return {};
}

function saveStore(store) {
  storageSet(STORAGE_KEY, JSON.stringify(store));
}

function getLocalArticleEntry(articleId) {
  const store = loadStore();
  return normalizeEntry(store[articleId]);
}

function saveLocalArticleEntry(articleId, entry) {
  const store = loadStore();
  store[articleId] = normalizeEntry(entry);
  saveStore(store);
}

function totalReactions(entry) {
  return REACTION_OPTIONS.reduce((sum, option) => sum + Number(entry.reactions[option.key] || 0), 0);
}

function getUserReaction(articleId) {
  return storageGet(`${USER_REACTION_KEY_PREFIX}${articleId}`) || "";
}

function setUserReaction(articleId, reactionKey) {
  if (reactionKey) {
    storageSet(`${USER_REACTION_KEY_PREFIX}${articleId}`, reactionKey);
  } else {
    storageRemove(`${USER_REACTION_KEY_PREFIX}${articleId}`);
  }
}

function getClientRateState(prefix, articleId) {
  try {
    const raw = storageGet(`${prefix}${articleId}`);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setClientRateState(prefix, articleId, value) {
  storageSet(`${prefix}${articleId}`, JSON.stringify(value));
}

function getRemainingCooldownMessage(remainingMs) {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return `Pričekajte ${seconds}s prije ponovnog slanja.`;
}

function validateReactionAttempt(articleId) {
  const rateState = getClientRateState(REACTION_RATE_LIMIT_KEY_PREFIX, articleId);
  const now = Date.now();

  if (rateState?.lastAttemptAt && now - rateState.lastAttemptAt < REACTION_COOLDOWN_MS) {
    return {
      ok: false,
      message: getRemainingCooldownMessage(REACTION_COOLDOWN_MS - (now - rateState.lastAttemptAt))
    };
  }

  setClientRateState(REACTION_RATE_LIMIT_KEY_PREFIX, articleId, { lastAttemptAt: now });
  return { ok: true };
}

function validateCommentAttempt(articleId, author, text, honeypotValue) {
  if (honeypotValue) {
    return {
      ok: false,
      message: "Poruka nije prihvaćena. Pokušajte ponovno."
    };
  }

  const now = Date.now();
  const rateState = getClientRateState(COMMENT_RATE_LIMIT_KEY_PREFIX, articleId);

  if (rateState?.lastAttemptAt && now - rateState.lastAttemptAt < COMMENT_COOLDOWN_MS) {
    return {
      ok: false,
      message: getRemainingCooldownMessage(COMMENT_COOLDOWN_MS - (now - rateState.lastAttemptAt))
    };
  }

  const normalizedAuthor = author.trim().toLowerCase();
  const normalizedText = text.trim().replace(/\s+/g, " ").toLowerCase();

  if (
    rateState?.lastAuthor === normalizedAuthor &&
    rateState?.lastText === normalizedText &&
    rateState?.lastAttemptAt &&
    now - rateState.lastAttemptAt < DUPLICATE_COMMENT_WINDOW_MS
  ) {
    return {
      ok: false,
      message: "Isti komentar je već nedavno poslan."
    };
  }

  setClientRateState(COMMENT_RATE_LIMIT_KEY_PREFIX, articleId, {
    lastAttemptAt: now,
    lastAuthor: normalizedAuthor,
    lastText: normalizedText
  });

  return { ok: true };
}

function formatTimestamp(iso) {
  try {
    return new Intl.DateTimeFormat("hr-HR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderComments(list, comments) {
  if (!list) {
    return;
  }

  if (!comments.length) {
    list.innerHTML = '<li class="comments-empty">Još nema komentara. Budite prvi koji će ostaviti trag ispod članka.</li>';
    return;
  }

  list.innerHTML = comments
    .slice()
    .reverse()
    .map((comment) => {
      const author = escapeHtml(comment.author || "Čitatelj");
      const text = escapeHtml(comment.text || "");
      const createdAt = formatTimestamp(comment.createdAt);

      return `
        <li class="comment-card">
          <div class="comment-card-meta">
            <strong>${author}</strong>
            <span>${createdAt}</span>
          </div>
          <p>${text.replace(/\n/g, "<br>")}</p>
        </li>
      `;
    })
    .join("");
}

function updateHomepageCard(card, entry) {
  const likes = card.querySelector(".hero-social-count-likes");
  const comments = card.querySelector(".hero-social-count-comments");
  const articleId = card.getAttribute("data-article-id");
  const preview = articleId
    ? document.querySelector(`.hero-panel-comment-preview[data-article-id="${articleId}"]`)
    : null;

  if (likes) {
    likes.textContent = String(totalReactions(entry));
  }

  if (comments) {
    comments.textContent = String(entry.comments.length);
  }

  if (preview) {
    const latestComment = entry.comments[entry.comments.length - 1];
    if (latestComment?.text) {
      preview.textContent = `${latestComment.author || "Čitatelj"}: ${latestComment.text}`;
      preview.classList.add("is-visible");
    } else {
      preview.textContent = "";
      preview.classList.remove("is-visible");
    }
  }
}

function getCachedEntry(articleId) {
  return normalizeEntry(state.entries.get(articleId) || getLocalArticleEntry(articleId));
}

function emitEntry(articleId, entry) {
  const normalized = normalizeEntry(entry);
  state.entries.set(articleId, normalized);

  const listeners = state.listeners.get(articleId);
  if (!listeners) {
    return;
  }

  listeners.forEach((listener) => {
    listener(normalized);
  });
}

function subscribeToEntry(articleId, listener) {
  const listeners = state.listeners.get(articleId) || new Set();
  listeners.add(listener);
  state.listeners.set(articleId, listeners);

  listener(getCachedEntry(articleId));

  if (state.mode === "remote") {
    ensureRemoteSubscription(articleId);
  }

  return () => {
    const current = state.listeners.get(articleId);
    if (!current) {
      return;
    }

    current.delete(listener);

    if (!current.size) {
      state.listeners.delete(articleId);
      const unsubscribe = state.subscriptions.get(articleId);
      if (unsubscribe) {
        unsubscribe();
        state.subscriptions.delete(articleId);
      }
    }
  };
}

function initRemote() {
  if (state.db || state.mode !== "remote") {
    return state.db;
  }

  try {
    state.app = initializeApp(firebaseConfig);
    state.db = getFirestore(state.app);
  } catch (error) {
    console.warn("Firebase comments fallback to local storage.", error);
    state.mode = "local";
    state.db = null;
  }

  return state.db;
}

function ensureRemoteSubscription(articleId) {
  if (state.subscriptions.has(articleId)) {
    return;
  }

  const db = initRemote();
  if (!db) {
    return;
  }

  const articleRef = doc(db, "articles", articleId);
  const commentsRef = collection(db, "articles", articleId, "comments");
  const commentsQuery = query(commentsRef, orderBy("createdAtMs", "asc"));
  const liveEntry = getCachedEntry(articleId);

  const publish = () => {
    emitEntry(articleId, liveEntry);
  };

  const unsubscribeArticle = onSnapshot(
    articleRef,
    (snapshot) => {
      const data = snapshot.data() || {};
      liveEntry.reactions = normalizeEntry({ reactions: data.reactions }).reactions;
      publish();
    },
    (error) => {
      console.warn(`Realtime reactions failed for ${articleId}.`, error);
    }
  );

  const unsubscribeComments = onSnapshot(
    commentsQuery,
    (snapshot) => {
      liveEntry.comments = snapshot.docs
        .map((commentDoc) => normalizeComment(commentDoc.data()))
        .sort((left, right) => left.createdAtMs - right.createdAtMs);
      publish();
    },
    (error) => {
      console.warn(`Realtime comments failed for ${articleId}.`, error);
    }
  );

  state.subscriptions.set(articleId, () => {
    unsubscribeArticle();
    unsubscribeComments();
  });
}

async function applyReaction(articleId, reactionKey) {
  const rateCheck = validateReactionAttempt(articleId);
  if (!rateCheck.ok) {
    throw new Error(rateCheck.message);
  }

  if (state.mode !== "remote") {
    const entry = getLocalArticleEntry(articleId);
    const previousReaction = getUserReaction(articleId);

    if (previousReaction === reactionKey) {
      if (entry.reactions[reactionKey] > 0) {
        entry.reactions[reactionKey] -= 1;
      }
      setUserReaction(articleId, "");
    } else {
      if (previousReaction && entry.reactions[previousReaction] > 0) {
        entry.reactions[previousReaction] -= 1;
      }
      entry.reactions[reactionKey] += 1;
      setUserReaction(articleId, reactionKey);
    }

    saveLocalArticleEntry(articleId, entry);
    emitEntry(articleId, entry);
    return;
  }

  const db = initRemote();
  if (!db) {
    return applyReaction(articleId, reactionKey);
  }

  const previousReaction = getUserReaction(articleId);
  const nextReaction = previousReaction === reactionKey ? "" : reactionKey;
  const articleRef = doc(db, "articles", articleId);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(articleRef);
    const current = normalizeEntry({ reactions: snapshot.data()?.reactions });
    const reactions = { ...current.reactions };

    if (previousReaction && reactions[previousReaction] > 0) {
      reactions[previousReaction] -= 1;
    }

    if (nextReaction) {
      reactions[nextReaction] += 1;
    }

    transaction.set(
      articleRef,
      {
        reactions: {
          ...reactions,
          wow: deleteField()
        },
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  setUserReaction(articleId, nextReaction);
}

async function submitComment(articleId, author, text) {
  if (state.mode !== "remote") {
    const entry = getLocalArticleEntry(articleId);
    entry.comments.push({
      author,
      text,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now()
    });
    saveLocalArticleEntry(articleId, entry);
    emitEntry(articleId, entry);
    return;
  }

  const db = initRemote();
  if (!db) {
    return submitComment(articleId, author, text);
  }

  const articleRef = doc(db, "articles", articleId);

  await setDoc(
    articleRef,
    {
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await addDoc(collection(db, "articles", articleId, "comments"), {
    author,
    text,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now()
  });
}

function ensureCommentHoneypot(form) {
  if (!form || form.querySelector('input[name="website"]')) {
    return;
  }

  const trap = document.createElement("div");
  trap.hidden = true;
  trap.setAttribute("aria-hidden", "true");
  trap.innerHTML = `
    <label>
      Website
      <input type="text" name="website" tabindex="-1" autocomplete="off">
    </label>
  `;
  form.appendChild(trap);
}

function getShareUrl(relativeUrl) {
  return new URL(relativeUrl, window.location.href).toString();
}

async function shareArticle(relativeUrl, title, trigger) {
  const url = getShareUrl(relativeUrl);

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      if (trigger) {
        const previous = trigger.textContent;
        trigger.textContent = "✓";
        window.setTimeout(() => {
          trigger.textContent = previous;
        }, 1400);
      }
      return;
    }
  } catch {
    // Fall through to manual copy prompt when clipboard access fails.
  }

  window.prompt("Kopirajte poveznicu članka:", url);
}

function syncHomepageCards() {
  document.querySelectorAll(".hero-panel-social[data-article-id]").forEach((card) => {
    const articleId = card.getAttribute("data-article-id");
    if (!articleId) {
      return;
    }

    updateHomepageCard(card, getCachedEntry(articleId));

    const userReaction = getUserReaction(articleId);
    card.querySelectorAll(".hero-reaction-button").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.reaction === userReaction);
    });
  });
}

function renderArticleReactionBox(section, articleId, entry) {
  const likeBox = section.querySelector(".like-box");
  if (!likeBox) {
    return;
  }

  const userReaction = getUserReaction(articleId);

  likeBox.innerHTML = `
    <div class="reaction-picker" aria-label="Odaberite reakciju">
      ${REACTION_OPTIONS.map((option) => `
        <button
          type="button"
          class="reaction-button${userReaction === option.key ? " is-selected" : ""}"
          data-reaction="${option.key}"
          aria-label="${option.label}"
        >${option.emoji}</button>
      `).join("")}
    </div>
    <p class="like-meta"><span class="like-count">${totalReactions(entry)}</span> reakcija</p>
  `;
}

function initHomepageInteractions() {
  document.querySelectorAll(".hero-panel-social[data-article-id]").forEach((card) => {
    if (card.dataset.bound === "1") {
      return;
    }

    const articleId = card.getAttribute("data-article-id");
    const shareUrl = card.getAttribute("data-share-url") || "";
    const shareTitle = card.getAttribute("data-share-title") || "365 Briševo";

    if (articleId) {
      subscribeToEntry(articleId, (entry) => {
        updateHomepageCard(card, entry);

        const userReaction = getUserReaction(articleId);
        card.querySelectorAll(".hero-reaction-button").forEach((button) => {
          button.classList.toggle("is-selected", button.dataset.reaction === userReaction);
        });
      });
    }

    card.querySelectorAll(".hero-reaction-button").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!articleId || !button.dataset.reaction) {
          return;
        }

        try {
          await applyReaction(articleId, button.dataset.reaction);
        } catch (error) {
          console.warn(`Reaction update failed for ${articleId}.`, error);
        }
      });
    });

    const shareButton = card.querySelector(".hero-social-share");
    shareButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!shareUrl) {
        return;
      }
      await shareArticle(shareUrl, shareTitle, shareButton);
    });

    card.dataset.bound = "1";
  });
}

function initArticlePage() {
  const section = document.querySelector(".engagement-section[data-article-id]");
  if (!section) {
    return;
  }

  const articleId = section.getAttribute("data-article-id");
  if (!articleId) {
    return;
  }

  const commentForm = section.querySelector(".comment-form");
  const commentListWrap = section.querySelector(".comment-list-wrap");
  const commentList = section.querySelector(".comment-list");
  const commentStatus = section.querySelector(".comment-status");

  if (commentListWrap) {
    commentListWrap.id = `comments-${articleId}`;
  }

  ensureCommentHoneypot(commentForm);

  if (section.dataset.entryBound !== "1") {
    subscribeToEntry(articleId, (entry) => {
      renderArticleReactionBox(section, articleId, entry);
      renderComments(commentList, entry.comments);
    });
    section.dataset.entryBound = "1";
  }

  if (!section.dataset.engagementBound) {
    section.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.matches(".reaction-button")) {
        const reactionKey = target.dataset.reaction || "";
        if (!reactionKey) {
          return;
        }

        try {
          await applyReaction(articleId, reactionKey);
          if (commentStatus) {
            commentStatus.textContent = "";
            commentStatus.dataset.state = "";
          }
        } catch (error) {
          if (commentStatus) {
            commentStatus.dataset.state = "error";
            commentStatus.textContent = error instanceof Error ? error.message : "Reakcija nije spremljena. Pokušajte ponovno.";
          }
          console.warn(`Reaction update failed for ${articleId}.`, error);
        }
      }
    });

    commentForm?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(commentForm);
      const author = String(formData.get("author") || "").trim();
      const text = String(formData.get("text") || "").trim();
      const website = String(formData.get("website") || "").trim();

      if (!author || !text) {
        if (commentStatus) {
          commentStatus.dataset.state = "error";
          commentStatus.textContent = "Upišite ime i komentar.";
        }
        return;
      }

      const validation = validateCommentAttempt(articleId, author, text, website);
      if (!validation.ok) {
        if (commentStatus) {
          commentStatus.dataset.state = "error";
          commentStatus.textContent = validation.message;
        }
        return;
      }

      try {
        await submitComment(articleId, author, text);
        if (commentStatus) {
          commentStatus.dataset.state = "success";
          commentStatus.textContent = "Komentar je objavljen.";
        }
        commentForm.reset();
      } catch (error) {
        if (commentStatus) {
          commentStatus.dataset.state = "error";
          commentStatus.textContent = "Komentar nije spremljen. Provjerite Firebase postavke.";
        }
        console.warn(`Comment submit failed for ${articleId}.`, error);
      }
    });

    section.dataset.engagementBound = "1";
  }
}

window.addEventListener("storage", () => {
  if (state.mode === "local") {
    syncHomepageCards();
    initArticlePage();
  }
});

initHomepageInteractions();
syncHomepageCards();
initArticlePage();
