const messagesElement = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const inputElement = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const errorBanner = document.querySelector("#error-banner");
const clearButton = document.querySelector("#clear-button");
const preferenceForm = document.querySelector("#preference-form");
const favoriteGenreInput = document.querySelector("#favorite-genre");

const storageKeys = {
  conversation: "movie-chatbot-conversation",
};

let conversationId = localStorage.getItem(storageKeys.conversation);
let busy = false;

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.textContent = "";
  errorBanner.hidden = true;
}

function addMessage(role, text) {
  const article = document.createElement("article");
  article.className = `message ${role}-message`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${role === "user" ? "user-avatar" : "assistant-avatar"}`;
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "Y" : "M";

  const body = document.createElement("div");
  body.className = "message-body";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  body.append(paragraph);
  article.append(avatar, body);
  messagesElement.append(article);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return body;
}

function addTypingIndicator() {
  const body = addMessage("assistant", "");
  const paragraph = body.querySelector("p");
  paragraph.className = "typing";
  paragraph.setAttribute("aria-label", "Assistant is thinking");
  paragraph.innerHTML = "<span></span><span></span><span></span>";
  return body.closest(".message");
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function renderTable(data, args, card) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";
  function makeTable(result) {
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const column of result.columns ?? []) {
      const th = document.createElement("th");
      th.textContent = column.label;
      headerRow.append(th);
    }
    head.append(headerRow);
    const body = document.createElement("tbody");
    for (const row of result.rows ?? []) {
      const tr = document.createElement("tr");
      for (const column of result.columns ?? []) {
        const td = document.createElement("td");
        td.textContent = displayValue(row[column.key]);
        tr.append(td);
      }
      body.append(tr);
    }
    if (!result.rows?.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = Math.max(1, result.columns?.length ?? 1);
      td.textContent = "No matching records.";
      tr.append(td);
      body.append(tr);
    }
    table.append(head, body);
    return table;
  }
  wrapper.append(makeTable(data));
  card.append(wrapper);

  if (Number.isInteger(data.page) && Number.isInteger(data.pageSize)) {
    const pagination = document.createElement("div");
    pagination.className = "pagination";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "Previous";
    const status = document.createElement("span");
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    let currentPage = data.page;
    let currentData = data;
    const updateControls = () => {
      const pageCount = Math.max(1, Math.ceil(currentData.total / currentData.pageSize));
      status.textContent = `Page ${currentData.page} of ${pageCount} · ${currentData.total} results`;
      previous.disabled = currentPage <= 1;
      next.disabled = currentPage >= pageCount;
    };
    const changePage = async (page, button) => {
      button.disabled = true;
      try {
        const result = await postJson("/api/database", { ...args, page });
        currentData = result;
        currentPage = result.page;
        wrapper.replaceChildren(makeTable(result));
        updateControls();
      } catch (error) {
        showError(error.message);
      } finally {
        updateControls();
      }
    };
    previous.addEventListener("click", () => changePage(currentPage - 1, previous));
    next.addEventListener("click", () => changePage(currentPage + 1, next));
    pagination.append(previous, status, next);
    card.append(pagination);
    updateControls();
  }
}

function renderMovies(data, card) {
  if (!data.movies?.length) {
    const empty = document.createElement("p");
    empty.className = "empty-result";
    empty.textContent = data.message || "No movies found.";
    card.append(empty);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "movie-grid";
  for (const movie of data.movies) {
    const movieCard = document.createElement("article");
    movieCard.className = "movie-card";
    const poster = document.createElement("img");
    poster.className = "movie-poster";
    poster.loading = "lazy";
    poster.alt = `${movie.title} poster`;
    poster.src = movie.poster || "/poster-placeholder.svg";
    poster.addEventListener("error", () => {
      poster.src = "/poster-placeholder.svg";
    }, { once: true });

    const info = document.createElement("div");
    info.className = "movie-info";
    const title = document.createElement("h3");
    title.textContent = movie.title;
    const meta = document.createElement("p");
    meta.className = "movie-meta";
    meta.textContent = `${movie.year} · ${movie.genre}${movie.rating ? ` · ★ ${movie.rating}` : ""}`;
    const description = document.createElement("p");
    description.textContent = movie.description || "No plot summary provided.";
    const details = document.createElement("p");
    const ratings = movie.omdbRatings?.map((rating) => `${rating.Source}: ${rating.Value}`).join(", ");
    details.textContent = [
      movie.runtime,
      movie.director && `Dir. ${movie.director}`,
      movie.cast?.length && `Cast: ${movie.cast.join(", ")}`,
      ratings && `Ratings: ${ratings}`,
    ].filter(Boolean).join(" · ");
    info.append(title, meta, description, details);
    movieCard.append(poster, info);
    grid.append(movieCard);
  }
  card.append(grid);
  if (data.message) {
    const note = document.createElement("p");
    note.className = "result-note";
    note.textContent = data.message;
    card.prepend(note);
  }
}

function renderJokes(data, card) {
  if (!data.jokes?.length) {
    const empty = document.createElement("p");
    empty.className = "empty-result";
    empty.textContent = data.message || "No jokes found.";
    card.append(empty);
    return;
  }
  for (const joke of data.jokes) {
    const jokeCard = document.createElement("article");
    jokeCard.className = "joke-card";
    const category = document.createElement("span");
    category.className = "joke-category";
    category.textContent = `${joke.category} joke${joke.source ? ` · ${joke.source}` : ""}`;
    const text = document.createElement("p");
    text.className = "joke-text";
    text.textContent = joke.text;
    const actions = document.createElement("div");
    actions.className = "joke-actions";
    for (const vote of ["up", "down"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vote-button";
      button.textContent = vote === "up" ? "👍 Like" : "👎 Dislike";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const response = await fetch(`/api/jokes/${encodeURIComponent(joke.id)}/vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vote }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Could not save your vote.");
          counts.textContent = `👍 ${result.joke.votes.up} · 👎 ${result.joke.votes.down}`;
        } catch (error) {
          showError(error.message);
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
    const counts = document.createElement("span");
    counts.className = "vote-count";
    counts.textContent = `👍 ${joke.votes?.up ?? 0} · 👎 ${joke.votes?.down ?? 0}`;
    actions.append(counts);
    jokeCard.append(category, text, actions);
    card.append(jokeCard);
  }
  if (data.message) {
    const note = document.createElement("p");
    note.className = "result-note";
    note.textContent = data.message;
    card.prepend(note);
  }
}

function renderToolResults(parent, results) {
  if (!results?.length) return;
  const container = document.createElement("div");
  container.className = "tool-results";
  for (const result of results) {
    const card = document.createElement("section");
    card.className = "tool-card";
    const heading = document.createElement("div");
    heading.className = "tool-card-heading";
    const title = document.createElement("span");
    title.textContent = {
      database_query: "Database results",
      movie_lookup: "Movie details",
      jokes: "Joke",
    }[result.tool] || "Tool result";
    heading.append(title);
    card.append(heading);

    if (result.data?.kind === "error") {
      const error = document.createElement("div");
      error.className = "error-card";
      error.textContent = result.data.message;
      card.append(error);
    } else if (result.data?.kind === "table") {
      renderTable(result.data, result.args ?? {}, card);
    } else if (result.data?.kind === "movies") {
      renderMovies(result.data, card);
    } else if (result.data?.kind === "jokes") {
      renderJokes(result.data, card);
    } else {
      const empty = document.createElement("p");
      empty.className = "empty-result";
      empty.textContent = "The tool returned no displayable results.";
      card.append(empty);
    }
    container.append(card);
  }
  parent.append(container);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  inputElement.disabled = value;
  sendButton.setAttribute("aria-label", value ? "Sending message" : "Send message");
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const message = inputElement.value.trim();
  if (!message) return;
  clearError();
  addMessage("user", message);
  inputElement.value = "";
  inputElement.style.height = "auto";
  const typing = addTypingIndicator();
  setBusy(true);

  try {
    const result = await postJson("/api/chat", { message, conversationId });
    conversationId = result.conversationId;
    localStorage.setItem(storageKeys.conversation, conversationId);
    typing.remove();
    const body = addMessage("assistant", result.reply);
    renderToolResults(body, result.toolResults);
  } catch (error) {
    typing.remove();
    showError(error.message);
    addMessage("assistant", "I couldn't complete that request. Please check the error above and try again.");
  } finally {
    setBusy(false);
    inputElement.focus();
  }
});

inputElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

inputElement.addEventListener("input", () => {
  inputElement.style.height = "auto";
  inputElement.style.height = `${Math.min(inputElement.scrollHeight, 140)}px`;
});

clearButton.addEventListener("click", async () => {
  clearError();
  if (conversationId) {
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not clear the conversation.");
    } catch (error) {
      showError(error.message);
      return;
    }
  }
  conversationId = null;
  localStorage.removeItem(storageKeys.conversation);
  messagesElement.replaceChildren();
  addMessage("assistant", "Chat cleared. What would you like to explore?");
});

preferenceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  try {
    const response = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favoriteGenre: favoriteGenreInput.value.trim() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save your preference.");
    favoriteGenreInput.value = result.favoriteGenre;
  } catch (error) {
    showError(error.message);
  }
});

async function loadPreference() {
  try {
    const response = await fetch("/api/preferences");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load preferences.");
    favoriteGenreInput.value = result.favoriteGenre ?? "";
  } catch (error) {
    showError(error.message);
  }
}

async function loadConversation() {
  await loadPreference();
  if (!conversationId) return;
  try {
    const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load conversation history.");
    if (result.messages?.length) {
      messagesElement.replaceChildren();
      for (const message of result.messages) addMessage(message.role, message.content);
    }
  } catch (error) {
    showError(error.message);
  }
}

loadConversation();
