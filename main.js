// @ts-check
import { t, setLang, getLang, translations } from "./i18n.js";
import { UNITS, PRESETS, dateOffset, daysLeft, validateProduct } from "./model.js";
import * as store from "./store.js";

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const val = id => /** @type {HTMLInputElement} */ ($(id)).value;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const unitLabel = u => t(UNITS[u] || "unitPcs");
const qty = n => String(+n.toFixed(2));
let page = "overview";

/* ---------- feedback: toast + confirm dialog (no alert/confirm) ---------- */
let toastTimer = 0;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $("toast").classList.remove("show"), 2200);
}
/** @returns {Promise<boolean>} */
function ask(msg) {
  const dlg = /** @type {HTMLDialogElement} */ ($("confirmDlg"));
  $("confirmText").textContent = msg;
  return new Promise(resolve => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "yes"), { once: true });
    dlg.showModal();
  });
}

/* ---------- status ---------- */
function statusOf(p) {
  const d = daysLeft(p.expiry);
  if (d === null) return { cls: "safe", text: t("noDate") };
  if (d < 0) return { cls: "danger", text: t("expiredStatus") };
  if (d <= 3) return { cls: "warning", text: d === 0 ? t("today") : d === 1 ? t("tomorrow") : d + " " + t("days") };
  return { cls: "safe", text: t("safe") };
}
const due = () => store.state.products.filter(p => { const d = daysLeft(p.expiry); return d !== null && d <= 3; });

/* ---------- views ---------- */
function card(p) {
  const s = statusOf(p);
  return `<article class="product-card cat-${p.category}"><div class="product-body">
    <h3>${esc(p.name)}</h3>
    <div class="product-meta">${esc(t(p.category))} · ${qty(p.quantity)} ${esc(unitLabel(p.unit))}</div>
    <div class="product-bottom"><span class="status ${s.cls}">${s.text}</span>
      <div class="product-actions">
        <button type="button" class="icon-btn" title="${t("usedAction")}" aria-label="${t("usedAction")}" data-action="use" data-id="${p.id}">✓</button>
        <button type="button" class="icon-btn" title="${t("discardAction")}" aria-label="${t("discardAction")}" data-action="discard" data-id="${p.id}">×</button>
      </div></div></div></article>`;
}
const empty = (k, sub) => `<div class="empty"><strong>${t(k)}</strong>${sub ? t(sub) : ""}</div>`;

function renderOverview() {
  const { products, history } = store.state;
  const days = products.map(p => daysLeft(p.expiry));
  $("totalCount").textContent = String(products.length);
  $("expiringCount").textContent = String(days.filter(d => d !== null && d >= 0 && d <= 3).length);
  $("expiredCount").textContent = String(days.filter(d => d !== null && d < 0).length);
  $("usedCount").textContent = String(history.filter(x => x.type === "used").length);

  const attention = due().sort((a, b) => daysLeft(a.expiry) - daysLeft(b.expiry)).slice(0, 5);
  $("attentionList").innerHTML = attention.length ? attention.map(p => {
    const s = statusOf(p);
    return `<div class="expiry-item"><div class="food-info"><strong>${esc(p.name)}</strong><small>${qty(p.quantity)} ${esc(unitLabel(p.unit))}</small></div><span class="status ${s.cls}">${s.text}</span></div>`;
  }).join("") : empty("noAttention");
  const recent = [...products].sort((a, b) => b.created - a.created).slice(0, 3);
  $("recentProducts").innerHTML = recent.length ? recent.map(card).join("") : empty("noProducts", "noProductsSub");

  const n = due().length, box = $("reminder");
  const canAsk = "Notification" in window && Notification.permission === "default";
  box.hidden = !n;
  box.innerHTML = n ? `<span>${esc(t("remindBanner", { n }))}</span>` +
    (canAsk ? `<button type="button" class="secondary" data-action="notify">${t("remindEnable")}</button>` : "") : "";
}

function renderPantry() {
  const q = val("search").trim().toLowerCase(), cat = val("categoryFilter"), sort = val("sortFilter");
  const list = store.state.products.filter(p => p.name.toLowerCase().includes(q) && (cat === "all" || p.category === cat));
  if (sort === "date") list.sort((a, b) => daysLeft(a.expiry) - daysLeft(b.expiry));
  if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "new") list.sort((a, b) => b.created - a.created);
  $("pantryProducts").innerHTML = list.length ? list.map(card).join("") : empty(q ? "noResults" : "noProducts", "noProductsSub");
}

function renderShopping() {
  const { shopping } = store.state;
  $("shoppingList").innerHTML = shopping.length ? shopping.map(x =>
    `<div class="shopping-item ${x.done ? "done" : ""}"><input type="checkbox" ${x.done ? "checked" : ""} data-action="toggle-shop" data-id="${x.id}">
     <span>${esc(x.name)}</span><button type="button" class="icon-btn" aria-label="${t("remove")}" data-action="delete-shop" data-id="${x.id}">×</button></div>`
  ).join("") : `<div class="empty">${t("emptyShopping")}</div>`;
}

function renderWaste() {
  const { history } = store.state;
  $("wasteUsed").textContent = String(history.filter(x => x.type === "used").length);
  $("wasteDiscarded").textContent = String(history.filter(x => x.type === "discarded").length);
  const locale = { kk: "kk-KZ", en: "en-US", ru: "ru-RU" }[getLang()];
  $("historyList").innerHTML = history.length ? history.map(x => {
    const used = x.type === "used";
    return `<div class="expiry-item"><div class="food-info"><strong>${esc(x.name)}</strong><small>${new Date(x.date).toLocaleDateString(locale)}</small></div>
      <span class="status ${used ? "safe" : "danger"}">${used ? t("usedHistory") : t("discardedHistory")}</span></div>`;
  }).join("") : `<div class="empty">${t("emptyHistory")}</div>`;
}

function render() {
  renderOverview(); renderPantry(); renderShopping(); renderWaste();
  $("breadcrumb").textContent = t(page);
}
const update = () => { store.commit(); render(); };

/* ---------- actions ---------- */
function finish(id, type) {
  const { state } = store, p = state.products.find(x => x.id === id);
  if (!p) return;
  state.history.unshift({ name: p.name, type, date: new Date().toISOString() });
  state.products = state.products.filter(x => x.id !== id);
  update();
  toast(t(type === "used" ? "allUsed" : "discardedReason"));
}

function addToShopping(names) {
  const { shopping } = store.state;
  names.forEach((name, i) => {
    if (!shopping.some(x => x.name.toLowerCase() === name.toLowerCase())) shopping.push({ id: Date.now() + i, name, done: false });
  });
  update();
}

function submitProduct(e) {
  e.preventDefault();
  const p = validateProduct({
    name: val("productName"), category: val("productCategory"), quantity: val("productQuantity"),
    unit: val("productUnit"), expiry: val("productExpiry")
  });
  if (!p) return toast(t("invalid"));
  if (p.expiry < dateOffset(0)) return toast(t("pastDate"));
  const dup = store.state.products.find(x => x.name.toLowerCase() === p.name.toLowerCase() && x.unit === p.unit && x.expiry === p.expiry);
  if (dup) dup.quantity = Math.round((dup.quantity + p.quantity) * 100) / 100;
  else store.state.products.unshift(p);
  /** @type {HTMLFormElement} */ (e.target).reset();
  $("modal").classList.remove("open");
  update(); navigate("pantry"); toast(t("added"));
}

function navigate(name) {
  if (!document.getElementById(name)) return;
  page = name;
  document.querySelectorAll(".page").forEach(x => x.classList.toggle("active", x.id === name));
  document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", /** @type {HTMLElement} */ (x).dataset.page === name));
  $("breadcrumb").textContent = t(name);
  window.scrollTo(0, 0);
}

function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  $("productExpiry").lang = lang;
  document.querySelectorAll("[data-t]").forEach(el => { const k = /** @type {HTMLElement} */ (el).dataset.t; if (translations[lang][k]) el.textContent = translations[lang][k]; });
  document.querySelectorAll("[data-ph]").forEach(el => { const k = /** @type {HTMLElement} */ (el).dataset.ph; if (translations[lang][k]) /** @type {HTMLInputElement} */ (el).placeholder = translations[lang][k]; });
  $("presets").innerHTML = PRESETS.map(p => `<button type="button" class="chip" data-action="preset" data-key="${p.key}">${esc(t("ing_" + p.key))}</button>`).join("");
  render();
}

/* ---------- reminders (Notification API, once per day) ---------- */
function notifyDue() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const n = due().length, today = dateOffset(0);
  if (!n || localStorage.getItem("azyq_notified") === today) return;
  localStorage.setItem("azyq_notified", today);
  new Notification("AZYQ", { body: t("remindBanner", { n }) });
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const el = /** @type {HTMLElement} */ (e.target);
  const nav = el.closest("[data-page]"); if (nav) return navigate(/** @type {HTMLElement} */ (nav).dataset.page);
  const btn = /** @type {HTMLElement|null} */ (el.closest("[data-action]")); if (!btn) return;
  const { action, id, key } = btn.dataset, num = Number(id);
  if (action === "open-modal") { $("modal").classList.add("open"); /** @type {HTMLInputElement} */ ($("productExpiry")).min = dateOffset(0); }
  else if (action === "close-modal") $("modal").classList.remove("open");
  else if (action === "use") finish(num, "used");
  else if (action === "discard") ask(t("confirmDiscard")).then(ok => ok && finish(num, "discarded"));
  else if (action === "add-shopping") addShop();
  else if (action === "delete-shop") { store.state.shopping = store.state.shopping.filter(x => x.id !== num); update(); }
  else if (action === "preset") {
    const p = PRESETS.find(x => x.key === key); if (!p) return;
    /** @type {HTMLInputElement} */ ($("productName")).value = t("ing_" + p.key);
    /** @type {HTMLInputElement} */ ($("productCategory")).value = p.category;
    /** @type {HTMLInputElement} */ ($("productUnit")).value = p.unit;
    /** @type {HTMLInputElement} */ ($("productExpiry")).value = dateOffset(p.days);
  } else if (action === "notify") Notification.requestPermission().then(r => { render(); if (r === "granted") { toast(t("remindOn")); notifyDue(); } });
});
document.addEventListener("change", e => {
  const el = /** @type {HTMLElement} */ (e.target);
  if (el.dataset.action === "toggle-shop") { const x = store.state.shopping.find(s => s.id === Number(el.dataset.id)); if (x) { x.done = !x.done; update(); } }
});
function addShop() {
  const input = /** @type {HTMLInputElement} */ ($("shoppingInput")), name = input.value.trim().slice(0, 60);
  if (!name) return;
  input.value = ""; addToShopping([name]);
}
$("productForm").addEventListener("submit", submitProduct);
$("modal").addEventListener("click", e => { if (/** @type {HTMLElement} */ (e.target).id === "modal") $("modal").classList.remove("open"); });
["search", "categoryFilter", "sortFilter"].forEach(id => $(id).addEventListener(id === "search" ? "input" : "change", renderPantry));
$("shoppingInput").addEventListener("keydown", e => { if (e.key === "Enter") addShop(); });
$("language").addEventListener("change", e => { setLang(/** @type {HTMLSelectElement} */ (e.target).value); applyLang(); });

/* ---------- boot ---------- */
(async () => {
  $("language").value = getLang();
  const had = await store.init();
  if (!had) {
    const demo = [["milk", 1, 1], ["eggs", 5, 10], ["tomato", 3, 1], ["apple", 8, 1], ["bread", -1, 1]];
    store.state.products = demo.map(([k, days, q], i) => {
      const pr = PRESETS.find(x => x.key === k);
      return validateProduct({ id: i + 1, name: t("ing_" + k), category: pr.category, quantity: q, unit: pr.unit, expiry: dateOffset(days), created: i + 1 });
    }).filter(Boolean);
    store.commit();
  }
  applyLang();
  notifyDue();
})();
