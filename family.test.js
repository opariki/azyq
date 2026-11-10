import test from "node:test";
import assert from "node:assert/strict";
import handler from "./api/family.js";

/** In-memory stand-in for the Supabase REST endpoint (PostgREST subset used by the function). */
function fakeSupabase() {
  const rows = new Map();
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url), q = Object.fromEntries(u.searchParams);
    const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (opts.method === "POST") {
      const row = JSON.parse(opts.body);
      if (rows.has(row.code)) return json(409, { code: "23505" });
      rows.set(row.code, row); return json(201, [row]);
    }
    const code = (q.code || "").replace("eq.", ""), row = rows.get(code);
    if (opts.method === "GET") return json(200, row ? [{ state: row.state, version: row.version }] : []);
    if (opts.method === "PATCH") {
      if (!row || row.version !== Number(q.version.replace("eq.", ""))) return json(200, []);
      Object.assign(row, JSON.parse(opts.body)); return json(200, [row]);
    }
    return json(500, {});
  };
  return rows;
}
const call = async body => {
  let result;
  const res = { setHeader() {}, status(s) { this.s = s; return this; }, json(o) { result = { status: this.s, body: o }; } };
  await handler({ method: "POST", body }, res);
  return result;
};
const item = { name: "Сыр", quantity: 2, unit: "pack", category: "dairy", expiry: "2030-01-01" };
const empty = { products: [], shopping: [], history: [] };

test.beforeEach(() => { process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.SUPABASE_SERVICE_KEY = "k"; fakeSupabase(); });

test("not configured -> 503, wrong method -> 405", async () => {
  delete process.env.SUPABASE_URL;
  assert.equal((await call({ action: "get", code: "ABCDEFGH" })).status, 503);
  process.env.SUPABASE_URL = "https://x.supabase.co";
  let r; await handler({ method: "GET" }, { setHeader() {}, status(s) { r = s; return this; }, json() {} });
  assert.equal(r, 405);
});
test("secret keys (sb_secret_) are sent only in the apikey header", async () => {
  process.env.SUPABASE_SERVICE_KEY = "sb_secret_abc";
  process.env.SUPABASE_URL = "https://x.supabase.co/rest/v1/";
  const inner = globalThis.fetch; let seen;
  globalThis.fetch = async (url, o) => { seen = { url, headers: o.headers }; return inner(url, o); };
  await call({ action: "create", state: { products: [], shopping: [], history: [] } });
  assert.equal(seen.url, "https://x.supabase.co/rest/v1/families");
  assert.equal(seen.headers.apikey, "sb_secret_abc");
  assert.equal(seen.headers.Authorization, undefined);
});
test("create returns an 8-char code and sanitized state", async () => {
  const r = await call({ action: "create", state: { products: [item, { name: "" }] } });
  assert.equal(r.status, 200);
  assert.match(r.body.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(r.body.state.products.length, 1);
  assert.equal(r.body.version, 1);
});
test("get by code (case/dash tolerant), unchanged shortcut, 404, 400", async () => {
  const { body: { code } } = await call({ action: "create", state: empty });
  const dashed = code.slice(0, 4).toLowerCase() + "-" + code.slice(4);
  const g = await call({ action: "get", code: dashed });
  assert.equal(g.status, 200); assert.equal(g.body.version, 1);
  assert.equal((await call({ action: "get", code, since: 1 })).body.unchanged, true);
  assert.equal((await call({ action: "get", code: "ZZZZZZZZ" })).status, 404);
  assert.equal((await call({ action: "get", code: "abc" })).status, 400);
});
test("save bumps version; a stale save gets 409 with the latest state", async () => {
  const { body: { code } } = await call({ action: "create", state: empty });
  const a = await call({ action: "save", code, baseVersion: 1, state: { ...empty, products: [item] } });
  assert.deepEqual([a.status, a.body.version], [200, 2]);
  const stale = await call({ action: "save", code, baseVersion: 1, state: empty });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.version, 2);
  assert.equal(stale.body.state.products.length, 1);
  assert.equal((await call({ action: "save", code: "ZZZZZZZZ", baseVersion: 1, state: empty })).status, 404);
  assert.equal((await call({ action: "save", code, baseVersion: "x", state: empty })).status, 400);
});
test("oversized lists are truncated", async () => {
  const many = Array.from({ length: 800 }, (_, i) => ({ name: "a" + i, done: false }));
  const r = await call({ action: "create", state: { shopping: many } });
  assert.equal(r.body.state.shopping.length, 500);
});
