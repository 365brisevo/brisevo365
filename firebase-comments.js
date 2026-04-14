const STORAGE_KEY = "brisevo-article-engagement-v2";
const LEGACY_STORAGE_KEY = "brisevo-article-engagement-v1";
const USER_REACTION_KEY_PREFIX = "brisevo-reaction-";

const REACTION_OPTIONS = [
  { key: "angry", emoji: "😡", label: "Ljutito" },
  { key: "laugh", emoji: "😆", label: "Smijeh" },
  { key: "wow", emoji: "😮", label: "Iznenađenje" },
  { key: "like", emoji: "👍", label: "Sviđa mi se" }
];

function createEmptyEntry() {
  return {
    reactions: {
      angry: 0,
      laugh: 0,
      wow: 0,
      like: 0
    },
    comments: []
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
    normalized.comments = entry.comments;
  }

  return normalized;
}

function loadStore() {
  const candidateKeys = [STORAGE_KEY, LEGACY_STORAGE_KEY];

  for (const key of candidateKeys) {
    try {
      const raw = localStorage.getItem(key);
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
        localStorage.removeItem(key);
      }

      return store;
    } catch {
      continue;
    }
  }

  return {};
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getArticleEntry(articleId) {
  const store = loadStore();
  return normalizeEntry(store[articleId]);
}

function saveArticleEntry(articleId, entry) {
  const store = loadStore();
  store[articleId] = normalizeEntry(entry);
  saveStore(store);
}

function totalReactions(entry) {
  return REACTION_OPTIONS.reduce((sum, option) => sum + Number(entry.reactions[option.key] || 0), 0);
}

function getUserReaction(articleId) {
  return localStorage.getItem(`${USER_REACTION_KEY_PREFIX}${articleId}`) || "";
}

function setUserReaction(articleId, reactionKey) {
  if (reactionKey) {
    localStorage.setItem(`${USER_REACTION_KEY_PREFIX}${articleId}`, reactionKey);
  } else {
    localStorage.removeItem(`${USER_REACTION_KEY_PREFIX}${articleId}`);
  }
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

function syncHomepageCards() {
  document.querySelectorAll(".hero-panel-social[data-article-id]").forEach((card) => {
    const articleId = card.getAttribute("data-article-id");
    if (!articleId) {
      return;
    }

    const entry = getArticleEntry(articleId);
    updateHomepageCard(card, entry);

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

function applyReaction(articleId, reactionKey) {
  const entry = getArticleEntry(articleId);
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

  saveArticleEntry(articleId, entry);
}

function getShareUrl(relativeUrl) {
  return new URL(relativeUrl, window.location.href).toString();
}

async function shareArticle(relativeUrl, title, trigger) {
  const url = getShareUrl(relativeUrl);

  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return;
    }

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
    return;
  }

  window.prompt("Kopirajte poveznicu članka:", url);
}

function initHomepageInteractions() {
  document.querySelectorAll(".hero-panel-social[data-article-id]").forEach((card) => {
    if (card.dataset.bound === "1") {
      return;
    }

    const articleId = card.getAttribute("data-article-id");
    const shareUrl = card.getAttribute("data-share-url") || "";
    const shareTitle = card.getAttribute("data-share-title") || "365 Briševo";

    card.querySelectorAll(".hero-reaction-button").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!articleId || !button.dataset.reaction) {
          return;
        }

        applyReaction(articleId, button.dataset.reaction);
        syncHomepageCards();
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

  const update = () => {
    const entry = getArticleEntry(articleId);
    renderArticleReactionBox(section, articleId, entry);
    renderComments(commentList, entry.comments);
    syncHomepageCards();
  };

  if (!section.dataset.engagementBound) {
    section.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.matches(".reaction-button")) {
        const reactionKey = target.dataset.reaction || "";
        if (!reactionKey) {
          return;
        }
        applyReaction(articleId, reactionKey);
        update();
      }
    });

    commentForm?.addEventListener("submit", (event) => {
      event.preventDefault();

      const formData = new FormData(commentForm);
      const author = String(formData.get("author") || "").trim();
      const text = String(formData.get("text") || "").trim();

      if (!author || !text) {
        if (commentStatus) {
          commentStatus.dataset.state = "error";
          commentStatus.textContent = "Upišite ime i komentar.";
        }
        return;
      }

      const entry = getArticleEntry(articleId);
      entry.comments.push({
        author,
        text,
        createdAt: new Date().toISOString()
      });
      saveArticleEntry(articleId, entry);

      if (commentStatus) {
        commentStatus.dataset.state = "success";
        commentStatus.textContent = "Komentar je objavljen.";
      }

      commentForm.reset();
      update();
    });

    section.dataset.engagementBound = "1";
  }

  update();
}

window.addEventListener("storage", () => {
  syncHomepageCards();
  initArticlePage();
});

initHomepageInteractions();
syncHomepageCards();
initArticlePage();
