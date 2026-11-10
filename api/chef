// Vercel serverless function: AI chef. The prompt is built on the server (chef.js), the key stays in env.
import { handleChef } from "../chef-server.js";

export default async function handler(req, res) {
  const out = (status, obj) => { res.setHeader?.("Cache-Control", "no-store"); res.status(status).json(obj); };
  if (req.method !== "POST") return out(405, { error: "method_not_allowed" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object") return out(400, { error: "bad_request" });
  const ip = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const r = await handleChef(body, process.env, ip);
  out(r.status, r.body);
}
