import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 3999, base = `http://localhost:${PORT}`;
let srv, backup;
test.before(async () => {
  backup = fs.existsSync("data/state.json") ? fs.readFileSync("data/state.json") : null;
  srv = spawn("node", ["server.js"], { env: { ...process.env, PORT: String(PORT) } });
  await new Promise(r => srv.stdout.once("data", r));
});
test.after(() => {
  srv.kill();
  if (backup) fs.writeFileSync("data/state.json", backup); else fs.rmSync("data/state.json", { force: true });
});

test("serves the page and modules", async () => {
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/main.js")).status, 200);
});
test("blocks path traversal and private files", async () => {
  for (const u of ["/server.js", "/package.json", "/data/state.json", "/..%2Fserver.js", "/./server.js"])
    assert.notEqual((await fetch(base + u)).status, 200, u);
});
test("PUT sanitizes, GET returns it", async () => {
  const body = { products: [{ name: "Сыр", quantity: 2, unit: "pack", category: "dairy", expiry: "2030-01-01" }, { name: "" }], shopping: [], history: [] };
  const put = await fetch(base + "/api/state", { method: "PUT", body: JSON.stringify(body) });
  assert.equal(put.status, 200);
  const got = await (await fetch(base + "/api/state")).json();
  assert.equal(got.products.length, 1);
});
test("bad JSON gives 400", async () => {
  assert.equal((await fetch(base + "/api/state", { method: "PUT", body: "{oops" })).status, 400);
});
