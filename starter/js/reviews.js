import { request, getJSON, postJSON, HttpError, describe } from "./api.js";
import { state } from "./state.js";
import { render } from "./render.js";

const MINE_KEY = "harbour-my-reviews";

const dialog = document.querySelector(".reviews-dialog");
const title = dialog.querySelector("#reviews-title");
const summary = dialog.querySelector(".reviews-summary");
const statusLine = dialog.querySelector(".reviews-status");
const errorMessage = dialog.querySelector(".reviews-error-message");
const retry = dialog.querySelector(".reviews-retry");
const list = dialog.querySelector(".reviews-list");
const form = dialog.querySelector(".review-form");
const submit = form.querySelector(".review-submit");
const formError = form.querySelector(".review-form-error");

const when = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const view = {
  stallId: null,
  status: "idle",
  reviews: [],
  error: null,
  notice: "",
  posting: false,
  deleting: new Set(),
};
let loading = null;

function mine() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MINE_KEY)) ?? []);
  } catch {
    return new Set();
  }
}

function remember(id, keep) {
  const ids = mine();
  if (keep) ids.add(id);
  else ids.delete(id);
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify([...ids]));
  } catch {
  }
}

const stallOf = (id) => state.stalls.find((stall) => stall.id === id);

function ago(iso) {
  const seconds = (new Date(iso) - Date.now()) / 1000;
  const steps = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return when.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function item(review, ownIds) {
  const li = document.createElement("li");
  li.className = "review";
  li.dataset.id = review.id;

  const head = document.createElement("p");
  head.className = "review-head";
  const author = document.createElement("strong");
  author.textContent = review.author;
  const stars = document.createElement("span");
  stars.className = "review-rating";
  stars.textContent = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  stars.setAttribute("role", "img");
  stars.setAttribute("aria-label", `${review.rating} out of 5`);
  const time = document.createElement("time");
  time.dateTime = review.createdAt;
  time.textContent = ago(review.createdAt);
  time.title = new Date(review.createdAt).toLocaleString();
  head.append(author, " ", stars, " ", time);

  const text = document.createElement("p");
  text.className = "review-text";
  text.textContent = review.text;
  li.append(head, text);

  if (ownIds.has(review.id)) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "review-delete";
    remove.textContent = view.deleting.has(review.id) ? "Deleting…" : "Delete";
    remove.disabled = view.deleting.has(review.id);
    remove.setAttribute("aria-label", `Delete your review from ${new Date(review.createdAt).toLocaleString()}`);
    li.append(remove);
  }
  return li;
}

function draw() {
  const stall = stallOf(view.stallId);
  const name = stall?.name ?? "this stall";
  title.textContent = `Reviews · ${name}`;
  summary.textContent = stall?.reviewCount
    ? `★ ${stall.rating.toFixed(1)} from ${stall.reviewCount} ${stall.reviewCount === 1 ? "review" : "reviews"}`
    : "";

  list.setAttribute("aria-busy", String(view.status === "loading"));
  if (view.status === "loading") {
    statusLine.textContent = "Loading the reviews…";
    list.replaceChildren();
  } else if (view.status === "error") {
    statusLine.textContent = "";
    list.replaceChildren();
  } else if (view.reviews.length === 0) {
    statusLine.textContent = "No reviews yet: be the first";
    list.replaceChildren();
  } else {
    statusLine.textContent = `${view.reviews.length} ${view.reviews.length === 1 ? "review" : "reviews"}, newest first`;
    const ownIds = mine();
    list.replaceChildren(...view.reviews.map((review) => item(review, ownIds)));
  }

  if (view.status === "error") {
    errorMessage.textContent = `Couldn't load the reviews: ${describe(view.error)}.`;
  } else {
    errorMessage.textContent = view.notice;
  }
  retry.hidden = view.status !== "error";
  retry.disabled = view.posting;

  submit.disabled = view.posting;
  submit.textContent = view.posting ? "Posting…" : "Post review";
  form.setAttribute("aria-busy", String(view.posting));
}

const fieldInputs = {
  author: () => [form.elements.author],
  rating: () => [...form.querySelectorAll('[name="rating"]')],
  text: () => [form.elements.text],
};

function clearFieldErrors() {
  for (const [field, inputs] of Object.entries(fieldInputs)) {
    form.querySelector(`#review-${field}-error`).textContent = "";
    for (const input of inputs()) input.removeAttribute("aria-invalid");
  }
  formError.textContent = "";
}

function showFieldErrors(fields) {
  let first = null;
  for (const [field, message] of Object.entries(fields)) {
    const box = form.querySelector(`#review-${field}-error`);
    if (!box) continue;
    box.textContent = message;
    for (const input of fieldInputs[field]()) input.setAttribute("aria-invalid", "true");
    first ??= fieldInputs[field]().find((input) => input.checked) ?? fieldInputs[field]()[0];
  }
  first?.focus();
}

async function loadReviews() {
  loading?.abort();
  const controller = new AbortController();
  loading = controller;
  const stallId = view.stallId;

  view.status = "loading";
  view.error = null;
  view.notice = "";
  view.reviews = [];
  draw();
  try {
    const reviews = await getJSON(`/stalls/${encodeURIComponent(stallId)}/reviews`, { signal: controller.signal });
    if (view.stallId !== stallId || controller.signal.aborted) return;
    view.reviews = reviews;
    view.status = "ready";
  } catch (error) {
    if (error.name === "AbortError" || view.stallId !== stallId) return;
    console.error("Loading the reviews failed:", error);
    view.error = error;
    view.status = "error";
  } finally {
    if (loading === controller) loading = null;
  }
  draw();
}

async function refreshStall(stallId) {
  const stall = stallOf(stallId);
  if (!stall) return;
  try {
    Object.assign(stall, await getJSON(`/stalls/${encodeURIComponent(stallId)}`));
  } catch (error) {
    console.warn("Refreshing the stall failed, counting locally:", error);
    if (view.stallId === stallId && view.status === "ready") {
      const ratings = view.reviews.map((review) => review.rating);
      stall.reviewCount = ratings.length;
      stall.rating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
    }
  }
  render();
  if (view.stallId === stallId) draw();
}

async function postReview() {
  if (view.posting) return;
  const stallId = view.stallId;
  const data = new FormData(form);
  const review = {
    author: String(data.get("author") ?? "").trim(),
    rating: Number(data.get("rating")),
    text: String(data.get("text") ?? "").trim(),
  };

  clearFieldErrors();
  const interrupted = loading !== null;
  loading?.abort();
  view.posting = true;
  draw();
  try {
    const created = await postJSON(`/stalls/${encodeURIComponent(stallId)}/reviews`, review);
    remember(created.id, true);
    view.posting = false;
    if (view.stallId === stallId) {
      form.reset();
      if (interrupted) {
        loadReviews();
      } else {
        view.reviews = [created, ...view.reviews.filter((r) => r.id !== created.id)];
        if (view.status !== "ready") view.status = "ready";
        draw();
      }
    } else {
      draw();
    }
    await refreshStall(stallId);
  } catch (error) {
    view.posting = false;
    draw();
    console.error("Posting the review failed:", error);
    if (error instanceof HttpError && error.status === 422 && error.body?.fields) {
      showFieldErrors(error.body.fields);
    } else {
      formError.textContent = `Couldn't post your review: ${describe(error)}. Your text is still here: try again.`;
    }
    if (interrupted && view.stallId === stallId) loadReviews();
  }
}

async function deleteReview(id) {
  if (view.deleting.has(id)) return;
  const stallId = view.stallId;
  view.deleting.add(id);
  view.notice = "";
  draw();
  try {
    await request("DELETE", `/reviews/${encodeURIComponent(id)}`);
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) {
      console.error("Deleting the review failed:", error);
      view.deleting.delete(id);
      view.notice = `Couldn't delete your review: ${describe(error)}. Try again.`;
      draw();
      return;
    }
  }
  view.deleting.delete(id);
  remember(id, false);
  view.reviews = view.reviews.filter((review) => review.id !== id);
  draw();
  dialog.querySelector(".review-form [name=author]")?.focus();
  await refreshStall(stallId);
}

function open(stallId) {
  if (view.stallId !== stallId) {
    form.reset();
    clearFieldErrors();
  }
  view.stallId = stallId;
  view.deleting.clear();
  draw();
  if (!dialog.open) dialog.showModal();
  loadReviews();
}

export function setupReviews() {
  document.querySelector(".vendor-list").addEventListener("click", (event) => {
    const button = event.target.closest(".reviews-button");
    if (!button) return;
    open(button.closest(".stall").dataset.id);
  });

  dialog.querySelector(".reviews-close").addEventListener("click", () => dialog.close());

  dialog.addEventListener("close", () => {
    loading?.abort();
    const stallId = view.stallId;
    view.stallId = null;
    view.status = "idle";
    document.querySelector(`.stall[data-id="${CSS.escape(stallId ?? "")}"] .reviews-button`)?.focus();
  });

  retry.addEventListener("click", () => {
    statusLine.focus();
    loadReviews();
  });

  list.addEventListener("click", (event) => {
    const button = event.target.closest(".review-delete");
    if (button) deleteReview(button.closest(".review").dataset.id);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    postReview();
  });
}