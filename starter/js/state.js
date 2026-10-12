// Everything that can change, and nothing you can work out from it.
// Other modules can't reassign an imported const, but they can change its keys.
export const state = {
  status: "loading",
  error: null,
  stalls: [],
  tag: "all",
  query: "",
  saved: new Set(),
};

// Derived, never stored: what should be on screen right now?
export function visibleStalls() {
  const q = state.query.trim().toLowerCase();
  return state.stalls
    .filter((stall) => state.tag === "all" || stall.tag === state.tag)
    .filter((stall) => stall.name.toLowerCase().includes(q));
}

export function toggleSaved(id) {
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
}
