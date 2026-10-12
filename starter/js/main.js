// The only file the HTML loads. It wires events to state and starts the page.
import { state, toggleSaved } from "./state.js";
import { save, load } from "./storage.js";
import { render } from "./render.js";
import { getJSON } from "./api.js";
import { setupMenu } from "./menu.js";
import { setupTickets } from "./tickets.js";

const filters = document.querySelector(".filters");
const list = document.querySelector(".vendor-list");
const statusLine = document.querySelector(".status");
const retry = document.querySelector(".retry");

// Every change goes through here: draw, then remember
function update() {
  render();
  save();
}

let inFlight = false;

async function loadStalls() {
  if (inFlight) return;
  inFlight = true;
  state.status = "loading";
  state.error = null;
  render();
  try {
    state.stalls = await getJSON("/stalls");
    state.status = "ready";
  } catch (error) {
    console.error("Loading the stalls failed:", error);
    state.error = error;
    state.status = "error";
  } finally {
    inFlight = false;
  }
  render();
}

filters.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.tag = button.dataset.filter;
  update();
});

document.querySelector("#vendor-search").addEventListener("input", (event) => {
  state.query = event.target.value;
  update();
});

// The cards are redrawn all the time: one listener on the list hears every ♡
list.addEventListener("click", (event) => {
  const button = event.target.closest(".save");
  if (!button) return;
  toggleSaved(button.closest(".stall").dataset.id);
  update();
});

retry.addEventListener("click", () => {
  statusLine.focus();
  loadStalls();
});

setupMenu();
setupTickets();
load();
await loadStalls();
