// @ts-check
/**
 * Domain model + validation. Pure functions, no DOM: shared by browser and server.
 * @typedef {{id:number,name:string,category:string,quantity:number,unit:string,expiry:string,created:number}} Product
 * @typedef {{id:number,name:string,done:boolean}} ShoppingItem
 * @typedef {{name:string,type:"used"|"discarded",date:string}} HistoryItem
 * @typedef {{id:number,name:string,category:string,unit:string,quantity:number,days:number}} Favorite
 * @typedef {{products:Product[],shopping:ShoppingItem[],history:HistoryItem[],favorites:Favorite[]}} State
 */
export const CATEGORIES = ["dairy", "vegetables", "fruits", "meat", "other"];
export const UNITS = { pcs: "unitPcs", kg: "unitKg", g: "unitG", l: "unitL", ml: "unitMl", pack: "unitPack" };
const LEGACY_UNITS = { "шт.": "pcs", "кг": "kg", "г": "g", "л": "l", "мл": "ml", "уп.": "pack" };

/** Quick-add presets: default category, unit and shelf life in days. */
export const PRESETS = [
  { key: "milk", category: "dairy", unit: "l", days: 7 },
  { key: "eggs", category: "dairy", unit: "pcs", days: 14 },
  { key: "bread", category: "other", unit: "pcs", days: 3 },
  { key: "tomato", category: "vegetables", unit: "kg", days: 5 },
  { key: "apple", category: "fruits", unit: "kg", days: 10 },
  { key: "cheese", category: "dairy", unit: "g", days: 14 }
];

const pad = n => String(n).padStart(2, "0");
const fmt = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export function dateOffset(n) { const d = startOfToday(); d.setDate(d.getDate() + n); return fmt(d); }
/** Whole days until a YYYY-MM-DD date (local time); null if no date. */
export function daysLeft(date) {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfToday().getTime()) / 86400000);
}
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8))) === s;

/** @returns {Product|null} normalized product or null if invalid */
export function validateProduct(p) {
  if (!p || typeof p !== "object") return null;
  const name = String(p.name ?? "").trim().slice(0, 60);
  const quantity = Number(p.quantity);
  const unit = LEGACY_UNITS[p.unit] || p.unit;
  if (!name || !isFinite(quantity) || quantity <= 0 || quantity > 9999 || !(unit in UNITS) || !isDate(p.expiry)) return null;
  return {
    id: Number(p.id) || Date.now(), name, quantity: Math.round(quantity * 100) / 100, unit,
    category: CATEGORIES.includes(p.category) ? p.category : "other", expiry: p.expiry, created: Number(p.created) || Date.now()
  };
}

export const MAX_FAVORITES = 12;

/** A saved product template ("favorite"): name, category, unit, usual quantity and shelf life in days. @returns {Favorite|null} */
export function validateFavorite(f) {
  if (!f || typeof f !== "object") return null;
  const name = String(f.name ?? "").trim().slice(0, 60);
  const unit = LEGACY_UNITS[f.unit] || f.unit;
  const quantity = Number(f.quantity ?? 1);
  const rawDays = Math.round(Number(f.days ?? 7));
  if (!name || !(unit in UNITS) || !isFinite(quantity) || quantity <= 0 || quantity > 9999) return null;
  return {
    id: Number(f.id) || Date.now() + Math.floor(Math.random() * 1000), name, unit,
    category: CATEGORIES.includes(f.category) ? f.category : "other",
    quantity: Math.round(quantity * 100) / 100,
    days: Math.min(Math.max(isFinite(rawDays) ? rawDays : 7, 1), 365)
  };
}

/** Defensive normalization of any stored/received state. @returns {State} */
export function sanitizeState(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const list = k => (Array.isArray(r[k]) ? r[k] : []);
  return {
    products: list("products").map(validateProduct).filter(Boolean),
    shopping: list("shopping").filter(x => x && String(x.name ?? "").trim())
      .map(x => ({ id: Number(x.id) || Date.now(), name: String(x.name).trim().slice(0, 60), done: !!x.done })),
    history: list("history").filter(x => x && (x.type === "used" || x.type === "discarded") && String(x.name ?? ""))
      .map(x => ({ name: String(x.name).slice(0, 60), type: x.type, date: String(x.date) })),
    favorites: list("favorites").map(validateFavorite).filter(Boolean)
      .filter((f, i, a) => a.findIndex(g => g.name.toLowerCase() === f.name.toLowerCase() && g.unit === f.unit) === i)
      .slice(0, MAX_FAVORITES)
  };
}
