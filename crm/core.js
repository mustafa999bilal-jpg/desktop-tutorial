/* ===========================================================
   نظام إدارة العملاء — معرض رواد الاعتماد للسيارات
   النواة: التخزين، تسجيل الدخول، المزامنة، والواجهة العامة
   =========================================================== */
(() => {
"use strict";

const STORE_KEY = "rowaad_crm_v1";

/* ---------------- الاتصال بقاعدة البيانات ---------------- */
const CFG = window.ROWAAD_CRM_CONFIG || {};
const CLOUD_CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const CLOUD = CLOUD_CONFIGURED && !!(window.supabase && window.supabase.createClient);
const sb = CLOUD ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
const SYNC_TABLES = ["leads"];
const ADMIN_ACTIONS = new Set(["remove-seller", "backup", "demo", "wipe", "add-user", "edit-user", "reset-user-password"]);
let me = null;        // ملف الموظف الحالي
let profiles = [];    // كل الموظفين
let snap = {};        // آخر نسخة محفوظة على الخادم لكل سجل
let settingsSnap = "";
let syncChain = Promise.resolve();
let retryTimer = null;
let channel = null;
const isAdmin = () => !CLOUD || !!(me && me.active && me.role === "admin");
const hooks = { seed: [], chrome: [], modalClosed: [] };
const BANKS = ["مصرف الراجحي", "البنك الأهلي السعودي", "مصرف الإنماء", "بنك البلاد", "بنك الرياض", "البنك العربي الوطني", "بنك الجزيرة", "البنك السعودي الفرنسي", "ساب", "عبد اللطيف جميل", "أخرى"];

/* ---------------- أيقونات وأدوات ---------------- */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  money: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  move: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  car: '<path d="M5 17h14M6 17l1.5-6h9L18 17M7.5 11 9 7h6l1.5 4"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  trend: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;

/* ---------------- أدوات مساعدة ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const money = (n) => `${fmt(n)} <small>ر.س</small>`;
const moneyTxt = (n) => `${fmt(n)} ر.س`;
const pct = (n) => `${(Math.round(n * 10) / 10).toLocaleString("en-US")}%`;

const pad = (n) => String(n).padStart(2, "0");
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toISODate(new Date());
const parseDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toISODate(d); };
const daysBetween = (a, b) => Math.max(0, Math.round((parseDate(b) - parseDate(a)) / 86400000));
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const fmtDate = (s) => { if (!s) return "—"; const d = parseDate(s); return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDateTime = (iso) => { const d = new Date(iso); return `${fmtDate(toISODate(d))} — ${pad(d.getHours())}:${pad(d.getMinutes())}`; };


/* ---------------- التخزين ---------------- */
let db;

function defaultDB() {
  return {
    version: 1,
    settings: {
      companyName: "معرض رواد الاعتماد للسيارات",
      currentUser: "مدير النظام",
      sellers: ["عبدالواسع", "RW"],
      crm: {},
    },
    leads: [], activities: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.leads)) return null;
    const base = defaultDB();
    return { ...base, ...data, settings: { ...base.settings, ...data.settings }, activities: Array.isArray(data.activities) ? data.activities : [] };
  } catch (e) {
    return null;
  }
}

function save() {
  if (CLOUD) { queueSync(); return; }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast("تعذّر حفظ البيانات في المتصفح — خذ نسخة احتياطية فورًا", "error");
  }
}

function seedDemo() {
  const data = defaultDB();
  hooks.seed.forEach((fn) => fn(data));
  return data;
}

/* ===========================================================
   التزامن مع قاعدة البيانات (Supabase)
   =========================================================== */
const appUrl = () => location.origin + location.pathname;
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const settingsForSync = (st) => { const { currentUser, ...rest } = st; return rest; };
const isNetworkError = (err) => err && !err.code && /fetch|network|Failed|timeout/i.test(String(err.message || err));

function friendlyError(err) {
  const msg = String((err && err.message) || err || "");
  if (isNetworkError(err)) return "تعذّر الاتصال بالخادم — تحقق من الإنترنت";
  if (err && err.code === "23505") {
    if (msg.includes("sales_car_key")) return "هذه السيارة تم بيعها بالفعل من موظف آخر";
    if (msg.includes("cars_vin_key")) return "رقم الهيكل مسجل لسيارة أخرى";
    return "هذا السجل موجود مسبقًا";
  }
  if (err && (err.code === "42501" || /row-level security|permission denied|غير مصرح/i.test(msg))) return "ليس لديك صلاحية لهذه العملية";
  if (/Invalid login credentials/i.test(msg)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
  if (/Email not confirmed/i.test(msg)) return "لم يتم تأكيد البريد الإلكتروني بعد — راجع بريدك";
  if (/already registered|already been registered|already exists/i.test(msg)) return "هذا البريد مسجل مسبقًا";
  if (/Password should be|at least 6|weak/i.test(msg)) return "كلمة المرور ضعيفة — استخدم 8 أحرف على الأقل مع أرقام";
  if (/rate limit|too many/i.test(msg)) return "محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة";
  if (/[؀-ۿ]/.test(msg)) return msg; // رسائل عربية قادمة من قاعدة البيانات
  return "حدث خطأ: " + msg;
}

function setSyncState(state) {
  const el = $("#syncStatus");
  if (!el) return;
  el.className = `sync-pill cloud-only ${state}`;
  el.textContent = { saved: "✓ محفوظ", saving: "جاري الحفظ…", offline: "⚠ غير متصل — سيُعاد الحفظ" }[state] || "";
}

async function fetchAll(table, { newestFirst = false, limit = Infinity } = {}) {
  const out = [];
  for (let from = 0; out.length < limit; from += 1000) {
    let q = sb.from(table).select("id,data,created_at");
    q = newestFirst ? q.order("created_at", { ascending: false }) : q.order("id");
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function loadCloud() {
  const [leads, activities, st, profs] = await Promise.all([
    fetchAll("leads"),
    fetchAll("activities", { newestFirst: true, limit: 50000 }),
    sb.from("app_settings").select("data").eq("id", 1).maybeSingle(),
    sb.from("profiles").select("*").order("created_at"),
  ]);
  if (st.error) throw st.error;
  if (profs.error) throw profs.error;
  profiles = profs.data || [];
  const base = defaultDB();
  const next = { ...base, settings: { ...base.settings, ...settingsForSync((st.data && st.data.data) || {}) } };
  const rows = { leads };
  snap = {};
  SYNC_TABLES.forEach((t) => {
    next[t] = rows[t].map((r) => ({ ...r.data, id: r.id }));
    snap[t] = new Map(next[t].map((o) => [o.id, JSON.stringify(o)]));
  });
  next.activities = activities.map((r) => ({ ...r.data, id: r.id, ts: r.data.ts || r.created_at }));
  snap.activities = new Set(next.activities.map((m) => m.id));
  next.settings.currentUser = me.full_name || me.email;
  // إذا لم تُحفظ الإعدادات بعد، يرسلها المدير في أول مزامنة
  settingsSnap = st.data ? JSON.stringify(settingsForSync(next.settings)) : "";
  db = next;
}

async function reloadCloud() {
  try {
    await loadCloud();
    setSyncState("saved");
  } catch (err) {
    setSyncState("offline");
    toast(friendlyError(err), "error");
  }
  renderNow();
}

function queueSync() {
  setSyncState("saving");
  syncChain = syncChain.then(syncNow);
  return syncChain;
}

async function syncNow() {
  if (!CLOUD || !me) return;
  clearTimeout(retryTimer);
  try {
    for (const t of SYNC_TABLES) {
      const ups = [];
      db[t].forEach((o) => { const j = JSON.stringify(o); if (snap[t].get(o.id) !== j) ups.push([o.id, j]); });
      for (const part of chunks(ups, 400)) {
        const { error } = await sb.from(t).upsert(part.map(([id, j]) => ({ id, data: JSON.parse(j) })));
        if (error) throw error;
        part.forEach(([id, j]) => snap[t].set(id, j));
      }
    }
    for (const t of [...SYNC_TABLES].reverse()) {
      const live = new Set(db[t].map((o) => o.id));
      const dels = [...snap[t].keys()].filter((id) => !live.has(id));
      for (const part of chunks(dels, 200)) {
        const { error } = await sb.from(t).delete().in("id", part);
        if (error) throw error;
        part.forEach((id) => snap[t].delete(id));
      }
    }
    const newActs = db.activities.filter((m) => !snap.activities.has(m.id));
    for (const part of chunks(newActs, 400)) {
      const { error } = await sb.from("activities").insert(part.map((m) => ({ id: m.id, data: m })));
      if (error) throw error;
      part.forEach((m) => snap.activities.add(m.id));
    }
    if (isAdmin()) {
      const j = JSON.stringify(settingsForSync(db.settings));
      if (j !== settingsSnap) {
        const { error } = await sb.from("app_settings").upsert({ id: 1, data: JSON.parse(j) });
        if (error) throw error;
        settingsSnap = j;
      }
    }
    setSyncState("saved");
  } catch (err) {
    if (isNetworkError(err)) {
      setSyncState("offline");
      retryTimer = setTimeout(queueSync, 8000);
      return;
    }
    toast(friendlyError(err) + " — تم تحديث البيانات من الخادم", "error");
    closeModal();
    await reloadCloud();
  }
}

async function replaceCloudData(data) {
  await syncChain;
  setSyncState("saving");
  const { error } = await sb.rpc("wipe_crm");
  if (error) throw error;
  for (const t of ["leads", "activities"]) {
    const rows = (Array.isArray(data[t]) ? data[t] : []).map((o) => ({ id: o.id || uid(), data: o }));
    for (const part of chunks(rows, 400)) {
      const { error: e } = await sb.from(t).insert(part);
      if (e) throw e;
    }
  }
  const st = settingsForSync({ ...defaultDB().settings, ...(data.settings || {}) });
  const r1 = await sb.from("app_settings").upsert({ id: 1, data: st });
  if (r1.error) throw r1.error;
  await reloadCloud();
}

/* ---------- التحديث اللحظي ---------- */
let renderTimer = null;
function renderNow() {
  if (!me && CLOUD) return;
  PAGES[currentPage].render();
  renderChrome();
}
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderNow, 150); }

function onRealtime(p) {
  const t = p.table;
  if (t === "profiles") {
    const row = p.new && p.new.id ? p.new : null;
    if (row) {
      const i = profiles.findIndex((x) => x.id === row.id);
      if (i >= 0) profiles[i] = row; else profiles.push(row);
      if (me && row.id === me.id) {
        me = row;
        db.settings.currentUser = me.full_name || me.email;
        if (!me.active) { teardown(); showAuth("inactive", "تم إيقاف حسابك من المدير."); return; }
        applyRole();
      }
    }
    return scheduleRender();
  }
  if (t === "app_settings") {
    if (p.new && p.new.data && JSON.stringify(settingsForSync(db.settings)) === settingsSnap) {
      db.settings = { ...defaultDB().settings, ...settingsForSync(p.new.data), currentUser: db.settings.currentUser };
      settingsSnap = JSON.stringify(settingsForSync(db.settings));
      scheduleRender();
    }
    return;
  }
  if (t === "activities") {
    if (p.eventType === "INSERT" && p.new && !snap.activities.has(p.new.id) && !db.activities.some((m) => m.id === p.new.id)) {
      snap.activities.add(p.new.id);
      db.activities.push({ ...p.new.data, id: p.new.id, ts: p.new.data.ts || p.new.created_at });
      scheduleRender();
    }
    return;
  }
  if (!SYNC_TABLES.includes(t)) return;
  if (p.eventType === "DELETE") {
    const id = p.old && p.old.id;
    if (!id || !snap[t].has(id)) return;
    const local = db[t].find((o) => o.id === id);
    if (local && JSON.stringify(local) !== snap[t].get(id)) return; // لدينا تعديل محلي لم يُحفظ بعد
    db[t] = db[t].filter((o) => o.id !== id);
    snap[t].delete(id);
  } else {
    const id = p.new.id;
    const rec = { ...p.new.data, id };
    const local = db[t].find((o) => o.id === id);
    if (local) {
      if (JSON.stringify(local) !== snap[t].get(id)) return;
      Object.keys(local).forEach((k) => delete local[k]);
      Object.assign(local, rec);
      snap[t].set(id, JSON.stringify(local));
    } else {
      db[t].push(rec);
      snap[t].set(id, JSON.stringify(rec));
    }
  }
  scheduleRender();
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("rowaad-inventory")
    .on("postgres_changes", { event: "*", schema: "public" }, onRealtime)
    .subscribe((status) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSyncState("offline"); });
}

/* ---------- تسجيل الدخول ---------- */
function showAuth(state, msg) {
  $("#authScreen").classList.remove("hidden");
  ["authLoading", "loginForm", "authInactive", "authError"].forEach((id) => $(`#${id}`).classList.add("hidden"));
  const map = { loading: "authLoading", login: "loginForm", inactive: "authInactive", error: "authError" };
  $(`#${map[state]}`).classList.remove("hidden");
  if (state === "login") { const m = $("#loginMsg"); m.textContent = msg || ""; m.className = "auth-msg"; setTimeout(() => $("#loginForm").email.focus(), 50); }
  if (state === "inactive" && msg) $("#inactiveMsg").textContent = msg;
  if (state === "error") $("#authErrorMsg").textContent = msg || "";
}
function hideAuth() { $("#authScreen").classList.add("hidden"); }

function applyRole() {
  document.body.classList.toggle("is-admin", isAdmin());
  if (PAGES[currentPage].admin && !isAdmin()) go("dashboard");
}

function teardown() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  clearTimeout(retryTimer);
  me = null; profiles = []; snap = {}; db = defaultDB();
  document.body.classList.remove("is-admin");
  closeModal(); closeDrawer();
}

async function startSession(user) {
  showAuth("loading");
  try {
    const { data: prof, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (!prof || !prof.active) { showAuth("inactive"); return; }
    me = prof;
    await loadCloud();
    subscribe();
    hideAuth();
    applyRole();
    setSyncState("saved");
    go(location.hash.slice(1) || "today");
    renderChrome();
    if (isAdmin() && !db.leads.length) setTimeout(() => toast("لا يوجد عملاء بعد — أضف أول عميل، أو استورد ملف الإكسل من صفحة العملاء", "warn"), 400);
  } catch (err) {
    me = null;
    showAuth("error", friendlyError(err));
  }
}

async function bootCloud() {
  showAuth("loading");
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") setTimeout(() => passwordForm(true), 600);
    if (event === "SIGNED_OUT") { teardown(); showAuth("login"); }
  });
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await startSession(data.session.user);
    else showAuth("login");
  } catch (err) {
    showAuth("error", friendlyError(err));
  }
}

async function logout() {
  await syncChain;
  await sb.auth.signOut();
  teardown();
  showAuth("login");
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const email = f.email.value.trim(), password = f.password.value;
  const msg = $("#loginMsg");
  if (!email || !password) { msg.textContent = "أدخل البريد الإلكتروني وكلمة المرور"; return; }
  const btn = $("button[type=submit]", f);
  btn.disabled = true; msg.textContent = "";
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) { msg.className = "auth-msg"; msg.textContent = friendlyError(error); return; }
  f.password.value = "";
  await startSession(data.user);
});

$("#forgotBtn").addEventListener("click", async () => {
  const f = $("#loginForm"), msg = $("#loginMsg");
  const email = f.email.value.trim();
  if (!email) { msg.className = "auth-msg"; msg.textContent = "اكتب بريدك الإلكتروني أولًا ثم اضغط \"نسيت كلمة المرور\""; f.email.focus(); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  msg.className = error ? "auth-msg" : "auth-msg ok";
  msg.textContent = error ? friendlyError(error) : "إذا كان البريد مسجلًا، سيصلك رابط لتعيين كلمة مرور جديدة";
});

/* ---------- حسابي ---------- */
function accountMenu() {
  if (!me) return;
  modal({
    title: "حسابي", size: "sm", submit: "تغيير كلمة المرور",
    body: `<div class="spec-grid">
        <div class="spec"><span>الاسم</span><b>${esc(me.full_name || "—")}</b></div>
        <div class="spec"><span>الصلاحية</span><b>${me.role === "admin" ? "مدير" : "موظف"}</b></div>
        <div class="spec" style="grid-column:1/-1"><span>البريد الإلكتروني</span><b dir="ltr" style="display:block;text-align:right">${esc(me.email || "")}</b></div>
      </div>
      <button class="btn btn-danger btn-block" type="button" data-action="logout" style="margin-top:16px">تسجيل الخروج</button>`,
    onSubmit: () => { setTimeout(() => passwordForm(false), 60); },
  });
}

function passwordForm(recovery) {
  if (!CLOUD) return;
  modal({
    title: recovery ? "تعيين كلمة مرور جديدة" : "تغيير كلمة المرور", size: "sm", submit: "حفظ كلمة المرور",
    body: `<div class="form-grid cols-2">
      ${field(req("كلمة المرور الجديدة"), `<input class="input" type="password" name="p1" dir="ltr" autocomplete="new-password" required>`, "span-2", "8 أحرف على الأقل")}
      ${field(req("تأكيد كلمة المرور"), `<input class="input" type="password" name="p2" dir="ltr" autocomplete="new-password" required>`, "span-2")}
    </div>`,
    onSubmit: async (d) => {
      if (d.p1.length < 8) { toast("كلمة المرور يجب أن تكون 8 أحرف على الأقل", "error"); return false; }
      if (d.p1 !== d.p2) { toast("كلمتا المرور غير متطابقتين", "error"); return false; }
      const { error } = await sb.auth.updateUser({ password: d.p1 });
      if (error) throw error;
      toast("تم تغيير كلمة المرور");
    },
  });
}

/* ---------- الموظفون ---------- */
function renderUsers() {
  if (!CLOUD) return;
  const salesBy = {};
  db.leads.filter((l) => l.stage === "won").forEach((l) => (salesBy[l.assignee] = (salesBy[l.assignee] || 0) + 1));
  const list = [...profiles].sort((a, b) => (a.active === b.active ? a.created_at.localeCompare(b.created_at) : a.active ? 1 : -1));
  $("#usersBody").innerHTML = list.map((p) => `
    <tr>
      <td><div class="car-cell"><b>${esc(p.full_name || "—")}</b><small>${me && p.id === me.id ? "أنت" : ""}</small></div></td>
      <td class="mono" dir="ltr" style="text-align:right">${esc(p.email || "")}</td>
      <td><span class="badge no-dot ${p.role === "admin" ? "tone-gold" : "tone-blue"}">${p.role === "admin" ? "مدير" : "موظف"}</span></td>
      <td>${p.active ? '<span class="badge st-available">مفعّل</span>' : '<span class="badge st-reserved">موقوف / بانتظار التفعيل</span>'}</td>
      <td>${fmtDate((p.created_at || "").slice(0, 10))}</td>
      <td class="num">${salesBy[p.full_name] || 0}</td>
      <td class="actions" style="display:flex;gap:2px">
        <button class="btn-icon" title="تعديل الصلاحية" data-action="edit-user" data-id="${p.id}">${icon("edit")}</button>
        <button class="btn-icon" title="إرسال رابط تعيين كلمة المرور" data-action="reset-user-password" data-id="${p.id}">${icon("lock")}</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="7"><div class="empty">لا يوجد موظفون</div></td></tr>`;
}

function userForm(id) {
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  modal({
    title: `تعديل ${esc(p.full_name || p.email)}`, size: "sm",
    body: `<div class="form-grid cols-2">
      ${field(req("الاسم"), `<input class="input" name="full_name" required value="${esc(p.full_name)}">`, "span-2", "يظهر في سجل الحركات وفواتير البيع")}
      ${field("الصلاحية", `<select class="select" name="role">${opts([["staff", "موظف"], ["admin", "مدير"]], p.role)}</select>`)}
      ${field("الحالة", `<select class="select" name="active">${opts([["1", "مفعّل"], ["0", "موقوف"]], p.active ? "1" : "0")}</select>`)}
    </div>
    ${p.id === me.id ? '<p class="muted" style="font-size:.8rem;margin-top:12px">تنبيه: هذا حسابك — لو ألغيت صلاحية المدير ستفقد الوصول لهذه الصفحة.</p>' : ""}`,
    onSubmit: async (d) => {
      const { data, error } = await sb.from("profiles").update({ full_name: d.full_name.trim(), role: d.role, active: d.active === "1" }).eq("id", id).select().single();
      if (error) throw error;
      Object.assign(p, data);
      if (p.id === me.id) { me = { ...p }; db.settings.currentUser = me.full_name; applyRole(); }
      toast("تم حفظ بيانات الموظف");
      renderNow();
    },
  });
}

function addUserForm() {
  modal({
    title: "إضافة موظف جديد", size: "sm", submit: "إنشاء الحساب",
    body: `<div class="form-grid cols-2">
      ${field(req("اسم الموظف"), `<input class="input" name="name" required>`, "span-2")}
      ${field(req("البريد الإلكتروني"), `<input class="input" type="email" name="email" dir="ltr" required>`, "span-2", "يستخدمه الموظف لتسجيل الدخول")}
      ${field(req("كلمة مرور مبدئية"), `<input class="input" type="text" name="password" dir="ltr" required autocomplete="off">`, "", "8 أحرف على الأقل — أعطها للموظف وليغيّرها")}
      ${field("الصلاحية", `<select class="select" name="role">${opts([["staff", "موظف"], ["admin", "مدير"]], "staff")}</select>`)}
    </div>`,
    onSubmit: async (d) => {
      const email = d.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("البريد الإلكتروني غير صحيح", "error"); return false; }
      if (d.password.length < 8) { toast("كلمة المرور يجب أن تكون 8 أحرف على الأقل", "error"); return false; }
      // عميل منفصل لا يحفظ الجلسة، حتى لا يخرج المدير من حسابه
      const tmp = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "rowaad-signup-" + uid() } });
      const { data, error } = await tmp.auth.signUp({ email, password: d.password, options: { data: { full_name: d.name.trim() }, emailRedirectTo: appUrl() } });
      if (error) throw error;
      if (!data.user || (Array.isArray(data.user.identities) && data.user.identities.length === 0)) { toast("هذا البريد مسجل مسبقًا", "error"); return false; }
      const upd = await sb.from("profiles").update({ full_name: d.name.trim(), role: d.role, active: true }).eq("id", data.user.id).select().single();
      if (upd.error) throw upd.error;
      const i = profiles.findIndex((x) => x.id === upd.data.id);
      if (i >= 0) profiles[i] = upd.data; else profiles.push(upd.data);
      toast(data.session ? "تم إنشاء حساب الموظف — يقدر يدخل الآن" : "تم إنشاء الحساب — سيصل للموظف بريد تأكيد قبل أول دخول");
      renderNow();
    },
  });
}


/* ---------------- النوافذ ---------------- */
function openOverlay(id) { $(`#${id}`).classList.add("open"); document.body.style.overflow = "hidden"; }
function closeOverlay(id) { $(`#${id}`).classList.remove("open"); if (!$$(".overlay.open").length) document.body.style.overflow = ""; }
function closeModal() {
  const wasOpen = $("#modalOverlay").classList.contains("open");
  closeOverlay("modalOverlay");
  if (wasOpen) hooks.modalClosed.forEach((fn) => fn());
}
function closeDrawer() { closeOverlay("leadOverlay"); }

function modal({ title, body, submit = "حفظ", size = "", onSubmit, onInput, danger = false }) {
  const m = $("#modal");
  m.className = `modal ${size}`;
  m.innerHTML = `
    <div class="modal-head"><h3>${title}</h3><button class="btn-icon" type="button" data-close-modal>${icon("x")}</button></div>
    <form id="mform" novalidate>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="submit">${submit}</button>
        <button class="btn btn-ghost" type="button" data-close-modal>إلغاء</button>
      </div>
    </form>`;
  const form = $("#mform");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    $$(".field.invalid", form).forEach((f) => f.classList.remove("invalid"));
    const missing = $$("[required]", form).filter((el) => !String(el.value).trim());
    if (missing.length) {
      missing.forEach((el) => el.closest(".field")?.classList.add("invalid"));
      missing[0].focus();
      toast("يرجى تعبئة الحقول المطلوبة", "error");
      return;
    }
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      if ((await onSubmit(data, form)) !== false) closeModal();
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      btn.disabled = false;
    }
  });
  if (onInput) { form.addEventListener("input", () => onInput(form)); form.addEventListener("change", () => onInput(form)); onInput(form); }
  openOverlay("modalOverlay");
  setTimeout(() => { const f = $("input:not([type=hidden]), select", form); if (f && window.innerWidth > 700 && !form.contains(document.activeElement)) f.focus(); }, 50);
}

function confirmBox(title, message, onOk, okLabel = "تأكيد") {
  modal({ title, size: "sm", danger: true, submit: okLabel, body: `<p>${message}</p>`, onSubmit: async () => { await onOk(); } });
}

const field = (label, input, cls = "", hint = "") => `<div class="field ${cls}"><label>${label}</label>${input}${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
const req = (l) => `${l} <span class="req">*</span>`;
const opts = (items, val, placeholder) => (placeholder ? `<option value="">${placeholder}</option>` : "") + items.map((i) => { const [v, l] = Array.isArray(i) ? i : [i, i]; return `<option value="${esc(v)}" ${String(v) === String(val ?? "") ? "selected" : ""}>${esc(l)}</option>`; }).join("");

/* ---------------- أدوات الواجهة ---------------- */
function kpi(label, value, foot, tone, ic) {
  return `<div class="kpi"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon ${tone}">${icon(ic)}</span></div><div class="kpi-value num">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}


function hbars(items, fmtVal, color) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return items.map((i) => `<div class="hbar-row"><span>${esc(i.l)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${(i.v / max) * 100}%;${color ? `background:${typeof color === "function" ? color(i) : color}` : ""}"></div></div><span class="num">${fmtVal(i)}</span></div>`).join("");
}


function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function toCSV(headers, rows) {
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

function toast(msg, type = "ok") {
  const t = document.createElement("div");
  t.className = `toast ${type === "ok" ? "" : type}`;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 3200);
}


/* ---------------- التنقل ---------------- */
const PAGES = {
  users: { title: "الموظفون", render: renderUsers, admin: true },
  settings: { title: "الإعدادات", render: renderSettings, admin: true },
};
let currentPage = "today";

function go(page) {
  if (!PAGES[page] || (PAGES[page].admin && !isAdmin()) || (page === "users" && !CLOUD)) page = "today";
  currentPage = page;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
  $("#pageTitle").textContent = PAGES[page].title;
  if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
  closeSidebar();
  PAGES[page].render();
  window.scrollTo({ top: 0 });
}

function refresh() {
  save();
  PAGES[currentPage].render();
  renderChrome();
}

function renderChrome() {
  const u = (CLOUD && me ? me.full_name || me.email : db.settings.currentUser) || "—";
  $("#userName").textContent = u;
  $("#userAvatar").textContent = u.trim().charAt(0) || "؟";
  const pending = CLOUD ? profiles.filter((p) => !p.active).length : 0;
  $("#pendingBadge").textContent = pending;
  $("#pendingBadge").classList.toggle("hidden", !pending);
  hooks.chrome.forEach((fn) => fn());
}

function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("open"); }

const sellerNames = () => [...new Set([...db.settings.sellers, ...(CLOUD ? profiles.filter((p) => p.active).map((p) => p.full_name).filter(Boolean) : [])])];
const userName = () => (CLOUD && me ? me.full_name || me.email : db.settings.currentUser);

/* ---------------- الإعدادات ---------------- */
function renderSettings() {
  const f = $("#settingsForm");
  f.companyName.value = db.settings.companyName || "";
  f.currentUser.value = CLOUD && me ? me.full_name || "" : db.settings.currentUser || "";
  $("#sellerTags").innerHTML = db.settings.sellers.map((b) => `<span class="tag">${esc(b)}<button title="حذف" data-action="remove-seller" data-id="${esc(b)}">×</button></span>`).join("") || '<span class="muted">لا يوجد</span>';
  const size = new Blob([JSON.stringify(db)]).size;
  $("#storageInfo").textContent = `${CLOUD ? "قاعدة البيانات: " : ""}${db.leads.length} عميل · ${db.activities.length} نشاط مسجل · حجم البيانات ${(size / 1024).toFixed(0)} KB`;
}

/* ---------------- الأوامر ---------------- */
const ACTIONS = {
  logout: () => logout(),
  account: () => accountMenu(),
  "change-password": () => passwordForm(false),
  "add-user": () => addUserForm(),
  "edit-user": (id) => userForm(id),
  "reset-user-password": (id) => {
    const p = profiles.find((x) => x.id === id);
    confirmBox("إعادة تعيين كلمة المرور", `سيتم إرسال رابط لتعيين كلمة مرور جديدة إلى <b dir="ltr">${esc(p.email)}</b>.`, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(p.email, { redirectTo: appUrl() });
      if (error) throw error;
      toast("تم إرسال الرابط إلى بريد الموظف");
    }, "إرسال الرابط");
  },
  "remove-seller": (name) => { db.settings.sellers = db.settings.sellers.filter((b) => b !== name); refresh(); },
  backup: () => { downloadFile(`نسخة-احتياطية-العملاء-${today()}.json`, JSON.stringify(db, null, 1), "application/json"); toast("تم تحميل النسخة الاحتياطية"); },
  demo: () => confirmBox("تحميل بيانات تجريبية", `سيتم <b>استبدال كل العملاء الحاليين</b> ببيانات تجريبية${CLOUD ? " <b>لكل الموظفين</b>" : ""}. خذ نسخة احتياطية أولًا إذا كانت لديك بيانات حقيقية.`, async () => {
    const demo = seedDemo();
    demo.settings = { ...db.settings, sellers: db.settings.sellers.length ? db.settings.sellers : demo.settings.sellers };
    if (CLOUD) await replaceCloudData(demo);
    else { db = demo; refresh(); }
    toast("تم تحميل البيانات التجريبية");
  }, "استبدال البيانات"),
  wipe: () => confirmBox("مسح كل البيانات", `سيتم مسح <b>كل العملاء وسجل التواصل</b> نهائيًا${CLOUD ? " من قاعدة البيانات لكل الموظفين" : ""} مع الإبقاء على الإعدادات. لا يمكن التراجع.`, async () => {
    if (CLOUD) { await syncChain; const { error } = await sb.rpc("wipe_crm"); if (error) throw error; await reloadCloud(); }
    else { const s = db.settings; db = defaultDB(); db.settings = s; refresh(); }
    toast("تم مسح البيانات", "warn");
  }, "مسح نهائي"),
};

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-close-modal]")) return closeModal();
  if (t.id === "modalOverlay") return closeModal();

  const act = t.closest("[data-action]");
  if (act) {
    e.preventDefault(); e.stopPropagation();
    const name = act.dataset.action;
    if (ADMIN_ACTIONS.has(name) && !isAdmin()) return toast("هذه العملية متاحة للمدير فقط", "warn");
    const fn = ACTIONS[name];
    if (fn) Promise.resolve(fn(act.dataset.id)).catch((err) => toast(friendlyError(err), "error"));
    return;
  }
  const nav = t.closest("[data-page]");
  if (nav) return go(nav.dataset.page);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if ($("#modalOverlay").classList.contains("open")) closeModal(); else closeSidebar(); }
});

$("#settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin()) return toast("هذه العملية متاحة للمدير فقط", "warn");
  const d = Object.fromEntries(new FormData(e.target).entries());
  db.settings.companyName = d.companyName.trim() || db.settings.companyName;
  if (!CLOUD) db.settings.currentUser = d.currentUser.trim() || "مدير النظام";
  toast("تم حفظ الإعدادات"); refresh();
});
$("#sellerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin()) return;
  const v = e.target.seller.value.trim();
  if (!v || db.settings.sellers.includes(v)) return;
  db.settings.sellers.push(v); e.target.reset(); refresh();
});
$("#importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.leads) || !data.settings) throw new Error("bad");
    } catch (err) {
      toast("الملف غير صالح — اختر ملف نسخة احتياطية صحيح", "error");
      e.target.value = "";
      return;
    }
    confirmBox("استيراد نسخة احتياطية", `الملف يحتوي على <b>${data.leads.length}</b> عميل. سيتم استبدال البيانات الحالية بالكامل${CLOUD ? " لكل الموظفين" : ""}.`, async () => {
      if (CLOUD) { await replaceCloudData(data); toast("تم استيراد البيانات بنجاح"); return; }
      const base = defaultDB();
      db = { ...base, ...data, settings: { ...base.settings, ...data.settings }, activities: Array.isArray(data.activities) ? data.activities : [] };
      toast("تم استيراد البيانات بنجاح"); refresh();
    }, "استيراد");
    e.target.value = "";
  };
  reader.readAsText(file);
});

$("#menuBtn").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("open"); });
$("#scrim").addEventListener("click", closeSidebar);
$("#userChip").addEventListener("click", () => (CLOUD ? accountMenu() : isAdmin() && go("settings")));
window.addEventListener("storage", (e) => { if (!CLOUD && e.key === STORE_KEY) { db = load() || db; PAGES[currentPage].render(); renderChrome(); } });

/* ---------------- واجهة للوحدة (crm.js) ---------------- */
window.RW = {
  get db() { return db; }, get me() { return me; }, get profiles() { return profiles; }, get currentPage() { return currentPage; },
  CLOUD, PAGES, ACTIONS, ADMIN_ACTIONS, hooks, BANKS, AR_MONTHS, ICONS,
  $, $$, esc, uid, num, fmt, money, moneyTxt, pct, pad, toISODate, today, parseDate, addDays, daysBetween, fmtDate, fmtDateTime,
  icon, kpi, hbars, field, req, opts, modal, closeModal, confirmBox, openOverlay, closeOverlay, toast, go, refresh, renderChrome,
  isAdmin, downloadFile, toCSV, sellerNames, userName,
};

/* ---------------- تشغيل ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.toggle("cloud", CLOUD);
  if (CLOUD_CONFIGURED && !CLOUD) {
    db = defaultDB();
    showAuth("error", "تعذّر تحميل مكتبة الاتصال بقاعدة البيانات. تأكد من اتصال الإنترنت ثم أعد المحاولة.");
  } else if (CLOUD) {
    db = defaultDB();
    bootCloud();
  } else {
    document.body.classList.add("is-admin");
    db = load();
    if (!db) { db = seedDemo(); save(); setTimeout(() => toast("تم تحميل بيانات تجريبية للتجربة — امسحها من الإعدادات عند البدء الفعلي", "warn"), 400); }
    renderChrome();
    go(location.hash.slice(1) || "today");
  }
});

})();
