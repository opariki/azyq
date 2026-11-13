// @ts-check
import { t, setLang, getLang, translations } from "./i18n.js";
import { UNITS, PRESETS, MAX_FAVORITES, dateOffset, daysLeft, validateProduct, validateFavorite } from "./model.js";
import * as store from "./store.js";
import { WISHES, applyCook } from "./chef.js";
import { icon } from "./icons.js";

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const val = id => /** @type {HTMLInputElement} */ ($(id)).value;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const unitLabel = u => t(UNITS[u] || "unitPcs");
const qty = n => String(+n.toFixed(2));
let page = "overview";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animated number: counts from the previous value to the new one. */
function countTo(el, n) {
  const from = Number(el.dataset.v ?? el.textContent) || 0;
  el.dataset.v = String(n);
  if (from === n || reduced()) { el.textContent = String(n); return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 450);
    el.textContent = String(Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1 && el.dataset.v === String(n)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

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
        <button type="button" class="icon-btn" title="${t("usedAction")}" aria-label="${t("usedAction")}" data-action="use" data-id="${p.id}">${icon("check")}</button>
        <button type="button" class="icon-btn" title="${t("discardAction")}" aria-label="${t("discardAction")}" data-action="discard" data-id="${p.id}">${icon("x")}</button>
      </div></div></div></article>`;
}
const empty = (k, sub) => `<div class="empty"><strong>${t(k)}</strong>${sub ? t(sub) : ""}</div>`;

function renderOverview() {
  const { products } = store.state;
  countTo($("totalCount"), products.length);
  countTo($("attentionCount"), due().length);

  const attention = due().sort((a, b) => daysLeft(a.expiry) - daysLeft(b.expiry)).slice(0, 5);
  $("attentionList").innerHTML = attention.length ? attention.map(p => {
    const s = statusOf(p);
    return `<div class="expiry-item"><div class="food-info"><strong>${esc(p.name)}</strong><small>${qty(p.quantity)} ${esc(unitLabel(p.unit))}</small></div><span class="status ${s.cls}">${s.text}</span></div>`;
  }).join("") : empty("noAttention");

  // the banner only appears when it offers something to do (enable notifications)
  const n = due().length, box = $("reminder");
  const canAsk = "Notification" in window && Notification.permission === "default";
  box.hidden = !(n && canAsk);
  box.innerHTML = box.hidden ? "" : `<span>${esc(t("remindBanner", { n }))}</span><button type="button" class="secondary" data-action="notify">${t("remindEnable")}</button>`;
}

/** Favorites (saved by the user) first, then the built-in quick picks. */
function renderPresets() {
  const favs = store.state.favorites || [];
  const favHtml = favs.length ? `<div class="chips-label">${t("favTitle")}</div><div class="chips">` + favs.map(f =>
    `<span class="chip fav"><button type="button" class="chip-main" data-action="fav-use" data-id="${f.id}">${esc(f.name)}</button><button type="button" class="chip-x" data-action="fav-del" data-id="${f.id}" aria-label="${esc(t("favRemove"))}" title="${esc(t("favRemove"))}">${icon("x")}</button></span>`).join("") + `</div>` : "";
  $("presets").innerHTML = favHtml + `<div class="chips-label">${t("presetsTitle")}</div><div class="chips">` +
    PRESETS.map(p => `<button type="button" class="chip" data-action="preset" data-key="${p.key}">${esc(t("ing_" + p.key))}</button>`).join("") + `</div>`;
}

function saveFavorite(p) {
  const f = validateFavorite({ name: p.name, category: p.category, unit: p.unit, quantity: p.quantity, days: Math.max(1, daysLeft(p.expiry) ?? 7) });
  if (!f) return;
  const list = store.state.favorites, i = list.findIndex(x => x.name.toLowerCase() === f.name.toLowerCase() && x.unit === f.unit);
  if (i >= 0) list[i] = { ...f, id: list[i].id }; else list.unshift(f);
  store.state.favorites = list.slice(0, MAX_FAVORITES);
}

function fillForm(v) {
  /** @type {HTMLInputElement} */ ($("productName")).value = v.name;
  /** @type {HTMLInputElement} */ ($("productCategory")).value = v.category;
  /** @type {HTMLInputElement} */ ($("productUnit")).value = v.unit;
  /** @type {HTMLInputElement} */ ($("productExpiry")).value = dateOffset(v.days);
  if (v.quantity) /** @type {HTMLInputElement} */ ($("productQuantity")).value = String(v.quantity);
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
     <span>${esc(x.name)}</span><button type="button" class="icon-btn" aria-label="${t("remove")}" data-action="delete-shop" data-id="${x.id}">${icon("x")}</button></div>`
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

document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = icon(/** @type {HTMLElement} */ (el).dataset.icon || ""); });

function render() {
  renderOverview(); renderPantry(); renderShopping(); renderWaste(); renderChef(); renderPresets();
  $("breadcrumb").textContent = t(page);
}
const update = () => { store.commit(); render(); };

/* ---------- actions ---------- */
function finish(id, type) {
  const run = () => {
    const { state } = store, p = state.products.find(x => x.id === id);
    if (!p) return;
    state.history.unshift({ name: p.name, type, date: new Date().toISOString() });
    state.products = state.products.filter(x => x.id !== id);
    update();
    toast(t(type === "used" ? "allUsed" : "discardedReason"));
  };
  const cards = [...document.querySelectorAll(`[data-action="use"][data-id="${id}"]`)].map(b => b.closest(".product-card")).filter(Boolean);
  if (cards.length && !reduced()) { cards.forEach(c => c.classList.add("leaving")); setTimeout(run, 230); } else run();
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
  const fav = /** @type {HTMLInputElement} */ ($("productFav")).checked;
  if (fav) saveFavorite(p);
  /** @type {HTMLFormElement} */ (e.target).reset();
  $("modal").classList.remove("open");
  update(); navigate("pantry"); toast(t(fav ? "favAdded" : "added"));
}

function navigate(name) {
  if (!document.getElementById(name)) return;
  page = name;
  document.querySelectorAll(".page").forEach(x => x.classList.toggle("active", x.id === name));
  document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", /** @type {HTMLElement} */ (x).dataset.page === name));
  $("breadcrumb").textContent = t(name);
  const pg = $(name); pg.classList.add("entering"); setTimeout(() => pg.classList.remove("entering"), 900);
  window.scrollTo(0, 0);
}

function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  $("productExpiry").lang = lang;
  document.querySelectorAll("[data-t]").forEach(el => { const k = /** @type {HTMLElement} */ (el).dataset.t; if (translations[lang][k]) el.textContent = translations[lang][k]; });
  document.querySelectorAll("[data-ph]").forEach(el => { const k = /** @type {HTMLElement} */ (el).dataset.ph; if (translations[lang][k]) /** @type {HTMLInputElement} */ (el).placeholder = translations[lang][k]; });
  render(); renderFamily();
}

/* ---------- AI chef: the browser sends only structured data; the prompt is built on the server ---------- */
const chef = { sel: new Map(), seen: new Set(), wishes: new Set(), busy: false, items: [], dish: null, reply: "", msgs: [], error: "", draft: "" };

const chefProducts = () => store.state.products
  .filter(p => { const d = daysLeft(p.expiry); return d !== null && d >= 0; })
  .sort((a, b) => daysLeft(a.expiry) - daysLeft(b.expiry));

function renderChefItems(force) {
  const box = $("chefItems");
  if (!force && box.contains(document.activeElement)) return;
  const list = chefProducts();
  box.innerHTML = list.length ? list.map(p => {
    const on = chef.sel.has(p.id), take = on ? chef.sel.get(p.id) : p.quantity, s = statusOf(p);
    return `<div class="chef-item ${on ? "" : "off"}">
      <input type="checkbox" ${on ? "checked" : ""} data-action="chef-toggle" data-id="${p.id}" aria-label="${esc(p.name)}">
      <div class="chef-name">${esc(p.name)}<small>${s.text}</small></div>
      <div class="chef-amount"><input type="number" min="0.01" max="${p.quantity}" step="any" value="${qty(take)}" ${on ? "" : "disabled"} data-action="chef-take" data-id="${p.id}" aria-label="${esc(t("quantityLabel"))}">
      ${esc(t("chefOf"))} ${qty(p.quantity)} ${esc(unitLabel(p.unit))}</div></div>`;
  }).join("") : empty("chefNoItems", "chefNoItemsSub");
}

function renderChef() {
  const list = chefProducts(), byId = new Map(list.map(p => [p.id, p]));
  for (const [id, take] of chef.sel) {
    const p = byId.get(id);
    if (!p) chef.sel.delete(id); else if (take > p.quantity) chef.sel.set(id, p.quantity);
  }
  for (const p of list) {            // products that are about to expire are selected by default, once
    if (chef.seen.has(p.id)) continue;
    chef.seen.add(p.id);
    if (daysLeft(p.expiry) <= 3) chef.sel.set(p.id, p.quantity);
  }
  $("chefWishes").innerHTML = WISHES.map(k =>
    `<button type="button" class="chip ${chef.wishes.has(k) ? "on" : ""}" aria-pressed="${chef.wishes.has(k)}" data-action="chef-wish" data-key="${k}">${esc(t("wish_" + k))}</button>`).join("");
  renderChefItems(false);
  renderChefResult(false);
}

function renderChefResult(force) {
  const box = $("chefResult");
  /** @type {HTMLButtonElement} */ ($("chefCook")).disabled = chef.busy;
  if (!force && box.contains(document.activeElement)) return;
  const d = chef.dish;
  if (!d) {
    box.innerHTML = chef.busy ? `<div class="chef-busy"><span class="spinner" aria-hidden="true"></span>${t("chefCooking")}</div>`
      : chef.error ? `<div class="empty">${esc(chef.error)}</div>`
      : chef.reply ? `<div class="empty"><strong>${t("chefNoDish")}</strong>${esc(chef.reply)}</div>` : "";
    return;
  }
  const uses = d.uses.map(u => {
    const it = chef.items.find(x => x.id === u.id);
    return it ? `<li>${esc(it.name)} — ${qty(u.amount)} ${esc(unitLabel(it.unit))}</li>` : "";
  }).join("");
  const talk = chef.msgs.map(m => `<div class="chef-msg ${m.role}"><b>${t(m.role === "user" ? "chefYou" : "chefChef")}:</b> ${esc(m.text)}</div>`).join("");
  box.innerHTML = `<article class="chef-card">
    <h2>${esc(d.title)}</h2>
    <div class="chef-meta">${t("chefMin", { n: d.timeMin })} · ${t("chefServ", { n: d.servings })}</div>
    ${chef.reply ? `<p>${esc(chef.reply)}</p>` : ""}
    <h3>${t("chefUses")}</h3><ul>${uses}</ul>
    ${d.staples.length ? `<h3>${t("chefStaples")}</h3><p>${esc(d.staples.join(", "))}</p>` : ""}
    ${d.missing.length ? `<h3>${t("chefMissing")}</h3><div class="chef-missing"><span>${esc(d.missing.join(", "))}</span><button type="button" class="secondary" data-action="chef-shop">${t("chefAddShop")}</button></div>` : ""}
    <h3>${t("chefSteps")}</h3><ol>${d.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
    ${d.tip ? `<div class="chef-tip">${esc(d.tip)}</div>` : ""}
    <div class="chef-actions"><button type="button" class="primary" data-action="chef-done">${t("chefDone")}</button></div>
    <p class="chef-note">${t("chefCheck")}</p>
    <div class="chef-chat">${talk}${chef.busy ? `<div class="chef-busy"><span class="spinner" aria-hidden="true"></span>${t("chefCooking")}</div>` : ""}
      <div class="chef-input"><input id="chefMsg" maxlength="500" autocomplete="off" placeholder="${esc(t("chefChatPh"))}" value="${esc(chef.draft)}" ${chef.busy ? "disabled" : ""}>
      <button type="button" class="secondary" data-action="chef-send" ${chef.busy ? "disabled" : ""}>${t("chefSend")}</button></div></div>
  </article>`;
}

async function chefRequest(body) {
  let r;
  try { r = await fetch("/api/chef", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { throw new Error("net"); }
  let data = {};
  try { data = (await r.json()) || {}; } catch (e) {}
  if (!r.ok) throw Object.assign(new Error(r.status === 404 ? "not_configured" : data.error || "ai_error"), { code: data.code || "http" + r.status });
  return data;
}
const chefErr = e => {
  const m = e instanceof Error ? e.message : "";
  const text = t(({ net: "chefErrNet", not_configured: "chefErrConfig", rate_limited: "chefErrLimit" })[m] || "chefErrAi");
  return e?.code && m !== "net" && m !== "not_configured" && m !== "rate_limited" ? text + " (" + e.code + ")" : text;
};

async function chefCook() {
  if (chef.busy) return;
  const items = chefProducts().filter(p => chef.sel.has(p.id)).map(p => ({
    id: p.id, name: p.name, unit: p.unit, have: p.quantity, take: Math.min(chef.sel.get(p.id), p.quantity), days: daysLeft(p.expiry)
  }));
  if (!items.length) return toast(t("chefPickOne"));
  Object.assign(chef, { busy: true, error: "", dish: null, msgs: [], reply: "", items, draft: "" });
  renderChefResult(true);
  try {
    const a = await chefRequest({ action: "cook", lang: getLang(), items, wishes: [...chef.wishes] });
    chef.dish = a.dish || null; chef.reply = a.reply || "";
    if (!a.dish && !a.reply) chef.error = t("chefNoDish");
  } catch (e) { chef.error = chefErr(e); }
  chef.busy = false;
  renderChefResult(true);
}

async function chefSend() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("chefMsg"));
  const text = input ? input.value.trim().slice(0, 500) : "";
  if (!text || chef.busy || !chef.dish) return;
  chef.msgs.push({ role: "user", text }); chef.draft = ""; chef.busy = true;
  renderChefResult(true);
  try {
    const a = await chefRequest({ action: "chat", lang: getLang(), items: chef.items, wishes: [...chef.wishes], dish: chef.dish, messages: chef.msgs });
    chef.msgs.push({ role: "assistant", text: a.reply || "…" });
    if (a.dish) chef.dish = a.dish;
  } catch (e) { chef.msgs.pop(); chef.draft = text; toast(chefErr(e)); }
  chef.busy = false;
  renderChefResult(true);
}

function chefDone() {
  if (!chef.dish) return;
  const n = applyCook(store.state, chef.dish.uses);
  Object.assign(chef, { dish: null, msgs: [], reply: "", items: [], draft: "", error: "" });
  update(); renderChefItems(true); renderChefResult(true);
  toast(t("chefDoneToast", { n }));
}

/* ---------- family (shared cloud state) ---------- */
function renderFamily() {
  const code = store.getFamily(), st = store.getStatus();
  $("familyBtn").classList.toggle("on", !!code);
  $("familyOut").hidden = !code;
  $("familyIn").hidden = !!code;
  if (!code) return;
  $("familyCode").textContent = store.formatCode(code);
  $("familyStatus").textContent = t(st === "offline" ? "familyOffline" : "familySynced");
  $("familyStatus").className = "family-status " + st;
}
store.setHandler(kind => {
  if (kind === "remote" || kind === "conflict") { render(); toast(t(kind === "conflict" ? "familyConflict" : "familyUpdated")); }
  else if (kind === "gone") { toast(t("familyGone")); }
  renderFamily();
});
async function doCreate(btn) {
  btn.disabled = true;
  try { await store.createFamily(); renderFamily(); toast(t("familyCreated")); }
  catch (e) { toast(t("familyUnavailable")); }
  btn.disabled = false;
}
async function doJoin(btn) {
  const code = store.normalizeCode(/** @type {HTMLInputElement} */ ($("familyJoinInput")).value);
  if (code.length !== 8) return toast(t("familyNotFound"));
  if (!(await ask(t("familyJoinConfirm")))) return;
  btn.disabled = true;
  try { await store.joinFamily(code); render(); renderFamily(); toast(t("familyJoined")); }
  catch (e) { toast(t(e instanceof Error && e.message === "not_found" ? "familyNotFound" : "familyUnavailable")); }
  btn.disabled = false;
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
  else if (action === "chef-cook") chefCook();
  else if (action === "chef-send") chefSend();
  else if (action === "chef-done") chefDone();
  else if (action === "chef-shop") { if (chef.dish) { addToShopping(chef.dish.missing); toast(t("chefAddedShop")); } }
  else if (action === "chef-wish") { if (key) { chef.wishes.has(key) ? chef.wishes.delete(key) : chef.wishes.add(key); renderChef(); } }
  else if (action === "delete-shop") { store.state.shopping = store.state.shopping.filter(x => x.id !== num); update(); }
  else if (action === "preset") {
    const p = PRESETS.find(x => x.key === key); if (!p) return;
    fillForm({ name: t("ing_" + p.key), category: p.category, unit: p.unit, days: p.days });
  } else if (action === "fav-use") {
    const f = store.state.favorites.find(x => x.id === num); if (f) fillForm(f);
  } else if (action === "fav-del") {
    store.state.favorites = store.state.favorites.filter(x => x.id !== num); update();
  } else if (action === "open-family") { renderFamily(); $("familyModal").classList.add("open"); }
  else if (action === "close-family") $("familyModal").classList.remove("open");
  else if (action === "create-family") doCreate(/** @type {HTMLButtonElement} */ (btn));
  else if (action === "join-family") doJoin(/** @type {HTMLButtonElement} */ (btn));
  else if (action === "leave-family") ask(t("familyLeaveConfirm")).then(ok => { if (ok) { store.leaveFamily(); renderFamily(); toast(t("familyLeft")); } });
  else if (action === "copy-family") {
    const c = store.formatCode(store.getFamily());
    (navigator.clipboard ? navigator.clipboard.writeText(c).then(() => toast(t("familyCopied"))) : Promise.reject()).catch(() => toast(c));
  } else if (action === "notify") Notification.requestPermission().then(r => { render(); if (r === "granted") { toast(t("remindOn")); notifyDue(); } });
});
document.addEventListener("change", e => {
  const el = /** @type {HTMLElement} */ (e.target);
  if (el.dataset.action === "chef-toggle") {
    const p = store.state.products.find(x => x.id === Number(el.dataset.id));
    if (p) { /** @type {HTMLInputElement} */ (el).checked ? chef.sel.set(p.id, p.quantity) : chef.sel.delete(p.id); renderChefItems(true); }
    return;
  }
  if (el.dataset.action === "chef-take") {
    const p = store.state.products.find(x => x.id === Number(el.dataset.id)), inp = /** @type {HTMLInputElement} */ (el);
    if (p && chef.sel.has(p.id)) {
      const v = Math.round(Math.min(Math.max(Number(inp.value) || p.quantity, 0.01), p.quantity) * 100) / 100;
      chef.sel.set(p.id, v); inp.value = qty(v);
    }
    return;
  }
  if (el.dataset.action === "toggle-shop") { const x = store.state.shopping.find(s => s.id === Number(el.dataset.id)); if (x) { x.done = !x.done; update(); } }
});
function addShop() {
  const input = /** @type {HTMLInputElement} */ ($("shoppingInput")), name = input.value.trim().slice(0, 60);
  if (!name) return;
  input.value = ""; addToShopping([name]);
}
$("productForm").addEventListener("submit", submitProduct);
$("familyModal").addEventListener("click", e => { if (/** @type {HTMLElement} */ (e.target).id === "familyModal") $("familyModal").classList.remove("open"); });
$("modal").addEventListener("click", e => { if (/** @type {HTMLElement} */ (e.target).id === "modal") $("modal").classList.remove("open"); });
["search", "categoryFilter", "sortFilter"].forEach(id => $(id).addEventListener(id === "search" ? "input" : "change", renderPantry));
document.addEventListener("keydown", e => { if (e.key === "Enter" && /** @type {HTMLElement} */ (e.target).id === "chefMsg") { e.preventDefault(); chefSend(); } });
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
  let seen = false;
  try { seen = !!localStorage.getItem("azyq_home_seen"); } catch (e) {}
  if (!seen) { navigate("home"); try { localStorage.setItem("azyq_home_seen", "1"); } catch (e) {} }
  notifyDue();
})();