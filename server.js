// Minimal API + static server: GET/PUT /api/state with the same validation as the client.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeState } from "./model.js";
import { handleChef } from "./chef-server.js";

const base = path.dirname(fileURLToPath(import.meta.url));
const root = base;
const file = path.join(base, "data", "state.json");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const PUBLIC = ["index.html", "styles.css", "main.js", "model.js", "store.js", "i18n.js", "chef.js"];

http.createServer(async (req, res) => {
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type }); res.end(body); };
  try {
    if (req.url === "/api/state") {
      if (req.method === "GET") {
        try { return send(200, JSON.stringify(sanitizeState(JSON.parse(await fs.readFile(file, "utf8"))))); }
        catch { return send(404, "{}"); }
      }
      if (req.method === "PUT") {
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 1e6) return send(413, "{}"); }
        const state = sanitizeState(JSON.parse(body));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(state));
        return send(200, JSON.stringify(state));
      }
      return send(405, "{}");
    }
    if (req.url === "/api/chef") {
      if (req.method !== "POST") return send(405, '{"error":"method_not_allowed"}');
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 1e5) return send(413, "{}"); }
      const r = await handleChef(JSON.parse(body), process.env, String(req.socket.remoteAddress || ""));
      return send(r.status, JSON.stringify(r.body));
    }
    const rel = (req.url ?? "/").split("?")[0];
    const target = path.normalize(path.join(root, rel === "/" ? "index.html" : rel));
    const top = path.relative(root, target).split(path.sep)[0];
    if (!target.startsWith(root) || !PUBLIC.includes(top)) return send(404, "Not found", "text/plain");
    send(200, await fs.readFile(target), types[path.extname(target)] || "application/octet-stream");
  } catch (e) {
    send(e instanceof SyntaxError ? 400 : 500, '{"error":"failed"}');
  }
}).listen(process.env.PORT || 3000, () => console.log("AZYQ on http://localhost:" + (process.env.PORT || 3000)));
