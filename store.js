// @ts-check
import { sanitizeState } from "./model.js";
/** @typedef {import("./model.js").State} State */

/** @type {State} */
export let state = { products: [], shopping: [], history: [] };
let remote = false;

/** Load from the API (server mode) or localStorage (static mode, incl. v1 data). @returns {Promise<boolean>} true if any data existed */
export async function init() {
  try {
    const r = await fetch("/api/state");
    if (r.ok) { state = sanitizeState(await r.json()); remote = true; return true; }
    remote = r.status === 404;
  } catch (e) { remote = false; }
  try {
    const raw = localStorage.getItem("azyq_state");
    if (raw) { state = sanitizeState(JSON.parse(raw)); return true; }
    const old = k => JSON.parse(localStorage.getItem("azyq_" + k) || "null");
    const legacy = { products: old("products"), shopping: old("shopping"), history: old("history") };
    if (legacy.products) { state = sanitizeState(legacy); return true; }
  } catch (e) {}
  return false;
}

/** Persist: localStorage always, API when the server is reachable. */
export function commit() {
  try { localStorage.setItem("azyq_state", JSON.stringify(state)); } catch (e) {}
  if (remote) {
    fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(() => {});
  }
}
