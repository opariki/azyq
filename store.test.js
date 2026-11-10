import test from "node:test";
import assert from "node:assert/strict";
import handler from "./api/family.js";

// --- browser stubs ---
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.window = { setInterval: () => 1, setTimeout: (f, ms) => setTimeout(f, ms) };
globalThis.document = { hidden: false, addEventListener() {} };

// --- fake Supabase + routed fetch ---
const rows = new Map();
const supa = async (url, o) => {
  const u = new URL(url), q = Object.fromEntries(u.searchParams), j = (s, d) => ({ ok: s < 300, status: s, json: async () => d });
  if (o.method === "POST") { const r = JSON.parse(o.body); rows.set(r.code, r); return j(201, [r]); }
  const row = rows.get((q.code || "").replace("eq.", ""));
  if (o.method === "GET") return j(200, row ? [{ state: row.state, version: row.version }] : []);
  if (!row || row.version !== Number(q.version.replace("eq.", ""))) return j(200, []);
  Object.assign(row, JSON.parse(o.body)); return j(200, [row]);
};
globalThis.fetch = async (url, o = {}) => {
  if (url === "/api/family") {
    const realFetch = globalThis.fetch; globalThis.fetch = supa;
    let out; await handler({ method: "POST", body: JSON.parse(o.body) }, { setHeader() {}, status(s) { this.s = s; return this; }, json(d) { out = { status: this.s, json: async () => d }; } });
    globalThis.fetch = realFetch; return { ok: out.status < 300, status: out.status, json: out.json };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.SUPABASE_SERVICE_KEY = "k";

const store = await import("./store.js");
const wait = ms => new Promise(r => setTimeout(r, ms));
const milk = { id: 1, name: "Молоко", quantity: 1, unit: "l", category: "dairy", expiry: "2030-01-01", created: 1 };
const events = []; store.setHandler(k => events.push(k));

test("create a family from local data, then commit syncs to the server", async () => {
  store.state.products.push(milk);
  const code = await store.createFamily();
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal(store.getFamily(), code);
  store.state.products.push({ ...milk, id: 2, name: "Сыр" });
  store.commit(); await wait(450);
  assert.equal(rows.get(code).version, 2);
  assert.equal(rows.get(code).state.products.length, 2);
  assert.equal(store.getStatus(), "synced");
});

test("a stale save adopts the other device's data and reports a conflict", async () => {
  const code = store.getFamily(), row = rows.get(code);
  row.state = { ...row.state, shopping: [{ id: 9, name: "Хлеб", done: false }] }; row.version = 7; // other device saved
  store.state.products.push({ ...milk, id: 3, name: "Яйца" });
  store.commit(); await wait(450);
  assert.ok(events.includes("conflict"));
  assert.equal(store.state.shopping[0].name, "Хлеб");
  assert.equal(rows.get(code).version, 7);
});

test("join replaces local data; unknown code is rejected; leave keeps a local copy", async () => {
  const code = store.getFamily();
  store.leaveFamily(); assert.equal(store.getFamily(), "");
  assert.equal(JSON.parse(mem.get("azyq_state")).shopping.length, 1);
  await assert.rejects(store.joinFamily("ZZZZ-ZZZZ"), /not_found/);
  store.state.products.length = 0;
  await store.joinFamily(code.slice(0, 4).toLowerCase() + "-" + code.slice(4));
  assert.equal(store.getFamily(), code);
  assert.ok(store.state.products.length >= 2);
});
