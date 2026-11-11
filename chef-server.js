// Server side of the AI chef: validates the request, builds the prompt, calls the model, validates the answer.
// Used by the Vercel function (api/chef.js) and by the local server (server.js). The API key never reaches the browser.
// Env: ANTHROPIC_API_KEY (default model claude-haiku-5-5) OR GEMINI_API_KEY (default models gemini-flash-lite-latest, then gemini-flash-latest); CHEF_MODEL overrides the model (comma-separated list = fallback order).
import { sanitizeRequest, buildSystem, buildPrompt, parseAnswer } from "./chef.js";

const WINDOW_MS = 10 * 60 * 1000, MAX_HITS = 20;
const hits = new Map();   // ip -> timestamps. Best effort: on serverless it is per instance.

function limited(ip, now = Date.now()) {
  const list = (hits.get(ip) || []).filter(ts => now - ts < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(ts => now - ts < WINDOW_MS)) hits.delete(k);
  return list.length > MAX_HITS;
}

const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpError = async r => Object.assign(new Error("upstream " + r.status + " " + (await r.text().catch(() => "")).slice(0, 300)), { code: String(r.status), status: r.status });

/** fetch with retries for temporary failures (overload, 5xx, network). A timeout is NOT retried (the caller may try another model). */
async function post(url, headers, body, end, delays = [800]) {
  let last;
  for (let i = 0; i <= delays.length; i++) {
    const left = end - Date.now();
    if (left < 4000) break;
    try {
      const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(Math.min(left, 25000)) });
      if (r.ok || !RETRY.has(r.status) || i === delays.length) return r;
      last = await httpError(r);
    } catch (e) { if (e?.name === "TimeoutError") throw e; last = e; }
    if (i < delays.length) await sleep(delays[i]);
  }
  throw last || Object.assign(new Error("timeout"), { name: "TimeoutError" });
}

/** One Gemini model. Thinking is minimized: budget 0 on 2.5, level "low" on newer ones (dropped if the model rejects it). */
async function askGemini(env, model, system, prompt, end) {
  const legacy = /^gemini-2\.5/.test(model);
  const call = async think => {
    const generationConfig = { responseMimeType: "application/json", maxOutputTokens: legacy ? 4096 : 8192 };
    if (think) generationConfig.thinkingConfig = legacy ? { thinkingBudget: 0 } : { thinkingLevel: "low" };
    return post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
      JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
      end, env.CHEF_RETRY_MS);
  };
  let r = await call(true);
  if (r.status === 400) {                       // maybe the thinking setting is not supported by this model: retry without it
    const msg = await r.text().catch(() => "");
    if (/think/i.test(msg)) r = await call(false); else throw Object.assign(new Error("upstream 400 " + msg.slice(0, 300)), { code: "400" });
  }
  if (!r.ok) throw await httpError(r);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  if (!text) throw Object.assign(new Error("empty answer, finishReason=" + data.candidates?.[0]?.finishReason + ", blocked=" + (data.promptFeedback?.blockReason || "no")), { code: "empty" });
  return text;
}

/** @returns {Promise<string>} the model's raw text; throws on any upstream failure */
async function askModel(env, system, prompt) {
  const end = Date.now() + 55000;
  if (env.ANTHROPIC_API_KEY) {
    const r = await post("https://api.anthropic.com/v1/messages",
      { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      JSON.stringify({ model: env.CHEF_MODEL || "claude-haiku-5-5", max_tokens: 1200, system, messages: [{ role: "user", content: prompt }] }), end, env.CHEF_RETRY_MS);
    if (!r.ok) throw await httpError(r);
    const data = await r.json();
    return (data.content || []).map(b => b.text || "").join("");
  }
  // CHEF_MODEL may be a comma-separated list: the next model is tried when the previous one fails.
  const models = String(env.CHEF_MODEL || "gemini-flash-lite-latest,gemini-flash-latest").split(",").map(x => x.trim()).filter(Boolean);
  let last;
  for (const m of models) {
    // the first (fast) model gets 12 s; if it is slow or fails, the next model takes over right away
    const until = m === models[models.length - 1] ? end : Math.min(end, Date.now() + 12000);
    try { return await askGemini(env, m, system, prompt, until); }
    catch (e) { last = e; console.error("chef model " + m + " failed:", e?.message || e); if (end - Date.now() < 4000) break; }
  }
  throw last;
}

/** @returns {Promise<{status:number,body:object}>} */
export async function handleChef(body, env = process.env, ip = "") {
  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) return { status: 503, body: { error: "not_configured" } };
  const req = sanitizeRequest(body);
  if (!req) return { status: 400, body: { error: "bad_request" } };
  if (limited(ip || "unknown")) return { status: 429, body: { error: "rate_limited" } };
  let text;
  try { text = await askModel(env, buildSystem(req.lang, req.action), buildPrompt(req)); }
  catch (e) {
    console.error("chef upstream:", e?.message || e);
    const code = e?.code || (e?.name === "TimeoutError" ? "timeout" : "net");   // short public hint, no secrets
    return { status: 502, body: { error: "ai_error", code } };
  }
  const answer = parseAnswer(text, req.items);
  if (!answer) { console.error("chef bad answer:", String(text).slice(0, 300)); return { status: 502, body: { error: "bad_answer", code: "format" } }; }
  return { status: 200, body: answer };
}