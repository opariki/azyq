// @ts-check
import { sanitizeState } from "./model.js";
/** @typedef {import("./model.js").State} State */

/** @type {State} */
export let state = { products: [], shopping: [], history: [], favorites: [] };

let remote = false;            // local node server (/api/state)
let familyCode = "";           // shared family (/api/family -> Supabase)
let version = 0;
let status = "local";          // "local" | "synced" | "offline"
let dirty = false, inflight = false, again = false;
let timer = 0, poller = 0;
/** @type {(kind:string)=>void} */
let onChange = () => {};

const KEY_FAMILY = "azyq_family", KEY_VER = "azyq_family_ver";
export const setHandler = fn => { onChange = fn; };
export const getFamily = () => familyCode;
export const getStatus = () => status;
export const normalizeCode = c => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = c => (c.length === 8 ? c.slice(0, 4) + "-" + c.slice(4) : c);

async function api(body) {
  const r = await fetch("/api/family", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {};
  try { data = (await r.json()) || {}; } catch (e) {}
  return { status: r.status, data };
}

function readLocal() {
  try {
    const raw = localStorage.getItem("azyq_state");
    if (raw) { state = sanitizeState(JSON.parse(raw)); return true; }
    const old = k => JSON.parse(localStorage.getItem("azyq_" + k) || "null");
    const legacy = { products: old("products"), shopping: old("shopping"), history: old("history") };
    if (legacy.products) { state = sanitizeState(legacy); return true; }
  } catch (e) {}
  return false;
}
function saveLocal() {
  try { localStorage.setItem("azyq_state", JSON.stringify(state)); localStorage.setItem(KEY_VER, String(version)); } catch (e) {}
}
function setFamily(code, v) {
  familyCode = code; version = v; status = "synced"; dirty = false;
  try { localStorage.setItem(KEY_FAMILY, code); } catch (e) {}
  saveLocal();
  startPolling();
}
function clearFamily() {
  familyCode = ""; version = 0; status = "local"; dirty = false;
  clearInterval(poller); poller = 0; clearTimeout(timer);
  try { localStorage.removeItem(KEY_FAMILY); localStorage.removeItem(KEY_VER); } catch (e) {}
}

/** Fetch the family's latest state. @returns {Promise<"updated"|"same"|"gone"|"offline">} */
async function pull() {
  try {
    const { status: s, data } = await api({ action: "get", code: familyCode, since: version });
    if (s === 200) {
      status = "synced";
      if (!data.unchanged && data.state) { state = sanitizeState(data.state); version = data.version; saveLocal(); return "updated"; }
      return "same";
    }
    if (s === 404 && data.error === "not_found") { clearFamily(); return "gone"; }
  } catch (e) {}
  status = "offline";
  return "offline";
}

async function flush() {
  if (!familyCode) return;
  if (inflight) { again = true; return; }
  inflight = true;
  const before = status;
  try {
    const { status: s, data } = await api({ action: "save", code: familyCode, baseVersion: version, state });
    if (s === 200) { version = data.version; dirty = false; status = "synced"; saveLocal(); }
    else if (s === 409 && data.state) {
      state = sanitizeState(data.state); version = data.version; dirty = false; status = "synced"; saveLocal();
      onChange("conflict");
    } else if (s === 404 && data.error === "not_found") { clearFamily(); onChange("gone"); }
    else status = "offline";
  } catch (e) { status = "offline"; }
  inflight = false;
  if (again) { again = false; await flush(); }
  else if (status !== before) onChange("status");
}

function startPolling() {
  if (poller) return;
  const tick = async () => {
    if (!familyCode || document.hidden || inflight) return;
    if (dirty) return flush();
    const before = status, r = await pull();
    if (r === "updated") onChange("remote");
    else if (r === "gone") onChange("gone");
    else if (status !== before) onChange("status");
  };
  poller = window.setInterval(tick, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

/** Load state: family (cloud) if joined, else local server API, else localStorage. @returns {Promise<boolean>} true if any data existed */
export async function init() {
  try { familyCode = localStorage.getItem(KEY_FAMILY) || ""; version = Number(localStorage.getItem(KEY_VER)) || 0; } catch (e) {}
  if (familyCode) {
    const had = readLocal();
    version = 0;                       // force a full fetch on start
    const r = await pull();
    if (familyCode) { startPolling(); return had || r === "updated" || r === "same"; }
    return had;                        // the family was deleted: keep the local copy
  }
  try {
    const r = await fetch("/api/state");
    if (r.ok) { state = sanitizeState(await r.json()); remote = true; return true; }
    remote = r.status === 404;
  } catch (e) { remote = false; }
  return readLocal();
}

/** Persist: localStorage always; family cloud (debounced) or local server API. */
export function commit() {
  saveLocal();
  if (familyCode) { dirty = true; clearTimeout(timer); timer = window.setTimeout(flush, 300); return; }
  if (remote) fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(() => {});
}

/** Create a family from the current data. @returns {Promise<string>} the code */
export async function createFamily() {
  const { status: s, data } = await api({ action: "create", state });
  if (s !== 200 || !data.code) throw new Error(data.error || "unavailable");
  setFamily(data.code, data.version);
  return data.code;
}
/** Join a family: this device's data is replaced by the family's. */
export async function joinFamily(raw) {
  const code = normalizeCode(raw);
  const { status: s, data } = await api({ action: "get", code, since: 0 });
  if (s === 200 && data.state) { state = sanitizeState(data.state); setFamily(code, data.version); return; }
  throw new Error(s === 404 || s === 400 ? "not_found" : "unavailable");
}
export function leaveFamily() { clearFamily(); }
