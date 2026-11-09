import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { translations } = await import("./i18n.js");

test("all languages have the same keys", () => {
  const [ru, ...rest] = ["ru", "kk", "en"].map(l => Object.keys(translations[l]).sort());
  for (const k of rest) assert.deepEqual(k, ru);
});
test("every data-t key used in index.html exists", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const keys = [...html.matchAll(/data-t(?:-\w+)?="(\w+)"/g)].map(m => m[1]);
  const missing = keys.filter(k => !(k in translations.ru));
  assert.deepEqual(missing, []);
});
