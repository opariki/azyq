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
test("every data-icon in index.html exists in icons.js", async () => {
  const { iconNames } = await import("./icons.js");
  const used = [...fs.readFileSync("index.html", "utf8").matchAll(/data-icon="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(used.filter(n => !iconNames.includes(n)), []);
});
test("ASPAZ is the section name in every language", () => {
  for (const l of ["ru", "kk", "en"]) assert.equal(translations[l].chef, "ASPAZ");
});
test("every data-page in index.html points to an existing page", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const targets = [...html.matchAll(/data-page="([\w-]+)"/g)].map(m => m[1]);
  assert.ok(targets.includes("home"));
  assert.deepEqual(targets.filter(x => !ids.has(x)), []);
});
test("main.js only uses element ids that exist in index.html", () => {
  const html = fs.readFileSync("index.html", "utf8"), js = fs.readFileSync("main.js", "utf8");
  const ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const used = [...js.matchAll(/\$\("([\w-]+)"\)/g)].map(m => m[1]);
  const dynamic = new Set(["chefMsg"]);
  assert.deepEqual([...new Set(used)].filter(x => !ids.has(x) && !dynamic.has(x)), []);
});
test("home page and favorites texts exist in all languages", () => {
  for (const k of ["home", "homeTitle", "homeStart", "favTitle", "favSave", "favAdded", "overviewAsk", "presetsTitle"])
    for (const l of ["ru", "kk", "en"]) assert.ok(translations[l][k], l + "." + k);
});
