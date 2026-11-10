// Server side of the AI chef: validates the request, builds the prompt, calls the model, validates the answer.
// Used by the Vercel function (api/chef.js) and by the local server (server.js). The API key never reaches the browser.
// Env: ANTHROPIC_API_KEY (default model claude-haiku-5-5) OR GEMINI_API_KEY (default model gemini-3.8-flash); CHEF_MODEL overrides the model.
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
/** fetch with up to 3 attempts for temporary upstream failures (overload, 5xx, network). Total time stays under ~27 s (Vercel limit is 30). */
async function post(url, headers, body, delays = [800, 1800]) {
  const end = Date.now() + 27000;
  let last;
  for (let i = 0; i <= delays.length; i++) {
    const left = end - Date.now();
    if (left < 3000) break;
    try {
      const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(Math.min(left, 20000)) });
      if (r.ok || !RETRY.has(r.status) || i === delays.length) return r;
      last = new Error("upstream " + r.status + " " + (await r.text()).slice(0, 300));
    } catch (e) { last = e; }
    if (i < delays.length) await sleep(delays[i]);
  }
  throw last || new Error("timeout");
}
 
/** @returns {Promise<string>} the model's raw text; throws on any upstream failure */
async function askModel(env, system, prompt) {
  if (env.ANTHROPIC_API_KEY) {
    const r = await post("https://api.anthropic.com/v1/messages",
      { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      JSON.stringify({ model: env.CHEF_MODEL || "claude-haiku-5-5", max_tokens: 1200, system, messages: [{ role: "user", content: prompt }] }), env.CHEF_RETRY_MS);
    if (!r.ok) throw new Error("upstream " + r.status + " " + (await r.text()).slice(0, 300));
    const data = await r.json();
    return (data.content || []).map(b => b.text || "").join("");
  }
  const model = env.CHEF_MODEL || "gemini-3.8-flash";
  const legacy = /^gemini-2\.5/.test(model);   // thinkingBudget exists only in the 2.5 family
  const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: legacy ? 4096 : 8192, ...(legacy ? { thinkingConfig: { thinkingBudget: 0 } } : {}) }
    }), env.CHEF_RETRY_MS);
  if (!r.ok) throw new Error("upstream " + r.status + " " + (await r.text()).slice(0, 300));
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  if (!text) throw new Error("empty answer, finishReason=" + data.candidates?.[0]?.finishReason + ", blocked=" + (data.promptFeedback?.blockReason || "no"));
  return text;
}
 
/** @returns {Promise<{status:number,body:object}>} */
export async function handleChef(body, env = process.env, ip = "") {
  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) return { status: 503, body: { error: "not_configured" } };
  const req = sanitizeRequest(body);
  if (!req) return { status: 400, body: { error: "bad_request" } };
  if (limited(ip || "unknown")) return { status: 429, body: { error: "rate_limited" } };
  let text;
  try { text = await askModel(env, buildSystem(req.lang, req.action), buildPrompt(req)); }
  catch (e) { console.error("chef upstream:", e?.message || e); return { status: 502, body: { error: "ai_error" } }; }
  const answer = parseAnswer(text, req.items);
  if (!answer) { console.error("chef bad answer:", String(text).slice(0, 300)); return { status: 502, body: { error: "bad_answer" } }; }
  return { status: 200, body: answer };
}