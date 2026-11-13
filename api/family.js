// Vercel serverless function: shared "family" state stored in Supabase (REST, no dependencies).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service key stays on the server, never sent to the browser).
import { randomInt } from "node:crypto";
import { sanitizeState } from "../model.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const MAX_ITEMS = 500;

const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const normCode = c => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function clean(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const cut = k => (Array.isArray(r[k]) ? r[k].slice(0, MAX_ITEMS) : []);
  return sanitizeState({ products: cut("products"), shopping: cut("shopping"), history: cut("history"), favorites: cut("favorites") });
}

async function db(method, path, body, prefer) {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
  // New secret keys (sb_secret_...) are not JWTs: send them in `apikey` only. Legacy service_role JWTs also go in Authorization.
  const auth = key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` };
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, ...auth, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, ok: res.ok, data };
}

export default async function handler(req, res) {
  const out = (status, obj) => { res.setHeader?.("Cache-Control", "no-store"); res.status(status).json(obj); };
  if (req.method !== "POST") return out(405, { error: "method_not_allowed" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return out(503, { error: "not_configured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") return out(400, { error: "bad_request" });

  try {
    if (body.action === "create") {
      const state = clean(body.state);
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const r = await db("POST", "families", { code, state, version: 1 }, "return=representation");
        if (r.ok) return out(200, { code, version: 1, state });
        if (r.status !== 409) return out(502, { error: "db_error" });
      }
      return out(502, { error: "db_error" });
    }

    const code = normCode(body.code);
    if (!CODE_RE.test(code)) return out(400, { error: "bad_code" });

    if (body.action === "get") {
      const r = await db("GET", `families?code=eq.${code}&select=state,version`);
      if (!r.ok) return out(502, { error: "db_error" });
      const row = Array.isArray(r.data) ? r.data[0] : null;
      if (!row) return out(404, { error: "not_found" });
      if (Number(body.since) === row.version) return out(200, { unchanged: true, version: row.version });
      return out(200, { state: clean(row.state), version: row.version });
    }

    if (body.action === "save") {
      const base = Number(body.baseVersion);
      if (!Number.isInteger(base) || base < 1) return out(400, { error: "bad_request" });
      const state = clean(body.state);
      const upd = await db("PATCH", `families?code=eq.${code}&version=eq.${base}`,
        { state, version: base + 1, updated_at: new Date().toISOString() }, "return=representation");
      if (!upd.ok) return out(502, { error: "db_error" });
      if (Array.isArray(upd.data) && upd.data.length) return out(200, { version: base + 1 });
      // nothing updated: someone saved first, or the family does not exist
      const cur = await db("GET", `families?code=eq.${code}&select=state,version`);
      const row = cur.ok && Array.isArray(cur.data) ? cur.data[0] : null;
      if (!row) return out(404, { error: "not_found" });
      return out(409, { error: "conflict", state: clean(row.state), version: row.version });
    }

    return out(400, { error: "bad_request" });
  } catch (e) {
    return out(502, { error: "db_error" });
  }
}
