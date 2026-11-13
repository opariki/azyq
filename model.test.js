import test from "node:test";
import assert from "node:assert/strict";
import { validateProduct, sanitizeState, validateFavorite, MAX_FAVORITES, daysLeft, dateOffset } from "./model.js";

const ok = { name: "Молоко", quantity: 1, unit: "l", category: "dairy", expiry: dateOffset(3) };

test("valid product passes and is normalized", () => {
  const p = validateProduct({ ...ok, quantity: "1.234" });
  assert.equal(p.name, "Молоко");
  assert.equal(p.quantity, 1.23);
});
test("legacy Russian units are converted", () => {
  assert.equal(validateProduct({ ...ok, unit: "кг" }).unit, "kg");
});
test("garbage is rejected", () => {
  for (const bad of [null, {}, { ...ok, name: "  " }, { ...ok, quantity: -1 }, { ...ok, quantity: 99999 },
    { ...ok, unit: "xx" }, { ...ok, expiry: "2026-02-31" }, { ...ok, expiry: "завтра" }])
    assert.equal(validateProduct(bad), null);
});
test("unknown category falls back to other", () => {
  assert.equal(validateProduct({ ...ok, category: "zzz" }).category, "other");
});
test("sanitizeState drops invalid records and tolerates junk input", () => {
  const s = sanitizeState({ products: [ok, { name: "" }], shopping: [{ name: "Хлеб" }, {}], history: [{ name: "a", type: "bad" }] });
  assert.equal(s.products.length, 1);
  assert.equal(s.shopping.length, 1);
  assert.equal(s.history.length, 0);
  assert.deepEqual(sanitizeState(undefined), { products: [], shopping: [], history: [], favorites: [] });
});
test("daysLeft", () => {
  assert.equal(daysLeft(dateOffset(0)), 0);
  assert.equal(daysLeft(dateOffset(5)), 5);
  assert.equal(daysLeft(dateOffset(-2)), -2);
  assert.equal(daysLeft(""), null);
});

test("favorite: clamps shelf life, normalizes, rejects bad data", () => {
  assert.equal(validateFavorite({ name: "Молоко", unit: "l", days: 0 }).days, 1);
  assert.equal(validateFavorite({ name: "Рис", unit: "kg", days: 9999 }).days, 365);
  assert.equal(validateFavorite({ name: "  Сыр ", unit: "g", quantity: "200.456", category: "x" }).quantity, 200.46);
  assert.equal(validateFavorite({ name: "Сыр", unit: "g", category: "x" }).category, "other");
  assert.equal(validateFavorite({ name: "", unit: "g" }), null);
  assert.equal(validateFavorite({ name: "Сыр", unit: "bag" }), null);
  assert.equal(validateFavorite({ name: "Сыр", unit: "g", quantity: -1 }), null);
  assert.equal(validateFavorite(null), null);
});
test("state: favorites are kept, deduplicated and capped", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: "Продукт " + i, unit: "pcs" }));
  const s = sanitizeState({ favorites: [{ name: "Молоко", unit: "l" }, { name: "молоко", unit: "l" }, { name: "Молоко", unit: "pcs" }, ...many] });
  assert.equal(s.favorites.length, MAX_FAVORITES);
  assert.equal(s.favorites.filter(f => f.name.toLowerCase() === "молоко" && f.unit === "l").length, 1);
  assert.deepEqual(sanitizeState({ favorites: "oops" }).favorites, []);
});
