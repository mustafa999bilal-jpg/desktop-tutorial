/* ===========================================================
   نظام إدارة مخزون — معرض رواد الاعتماد للسيارات
   تطبيق يعمل بالكامل في المتصفح، والبيانات محفوظة في localStorage
   =========================================================== */
(() => {
"use strict";

const STORE_KEY = "rowaad_inventory_v1";
const PAGE_SIZE = 15;

/* ---------------- الاتصال بقاعدة البيانات ---------------- */
const CFG = window.ROWAAD_CONFIG || {};
const CLOUD_CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const CLOUD = CLOUD_CONFIGURED && !!(window.supabase && window.supabase.createClient);
const sb = CLOUD ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
const SYNC_TABLES = ["sales", "suppliers", "cars", "expenses"]; // ترتيب الإرسال (البيع أولًا لاكتشاف التعارض قبل أي تعديل)
const ADMIN_ACTIONS = new Set(["delete-car", "cancel-sale", "delete-expense", "delete-supplier", "remove-branch", "remove-seller", "backup", "demo", "wipe", "add-user", "edit-user", "reset-user-password"]);
let me = null;        // ملف الموظف الحالي
let profiles = [];    // كل الموظفين
let snap = {};        // آخر نسخة محفوظة على الخادم لكل سجل
let settingsSnap = "";
let syncChain = Promise.resolve();
let retryTimer = null;
let channel = null;
const isAdmin = () => !CLOUD || !!(me && me.active && me.role === "admin");

/* ---------------- ثوابت ---------------- */
const STATUS = {
  available:   { label: "متاحة للبيع", cls: "st-available", color: "#3fae6a" },
  reserved:    { label: "محجوزة",      cls: "st-reserved",  color: "#e8a33d" },
  maintenance: { label: "في الصيانة",  cls: "st-maintenance", color: "#e05a55" },
  transit:     { label: "في الطريق",   cls: "st-transit",   color: "#9b7be0" },
  sold:        { label: "مباعة",       cls: "st-sold",      color: "#4a9fe0" },
};
const IN_STOCK = ["available", "reserved", "maintenance", "transit"];

const MOVE = {
  purchase:  { label: "إضافة للمخزون", tone: "tone-green",  icon: "plus" },
  sale:      { label: "بيع",            tone: "tone-blue",   icon: "money" },
  reserve:   { label: "حجز",            tone: "tone-orange", icon: "lock" },
  unreserve: { label: "إلغاء حجز",      tone: "tone-orange", icon: "unlock" },
  transfer:  { label: "نقل بين الفروع", tone: "tone-purple", icon: "move" },
  maintenance:{ label: "إرسال للصيانة", tone: "tone-red",    icon: "tool" },
  ready:     { label: "جاهزة للبيع",    tone: "tone-green",  icon: "check" },
  price:     { label: "تعديل سعر",      tone: "tone-gold",   icon: "tag" },
  edit:      { label: "تعديل بيانات",   tone: "tone-gold",   icon: "edit" },
  expense:   { label: "مصروف",          tone: "tone-red",    icon: "tool" },
  return:    { label: "إلغاء بيع",      tone: "tone-red",    icon: "undo" },
  delete:    { label: "حذف سيارة",      tone: "tone-red",    icon: "trash" },
};

const EXPENSE_CATS = ["صيانة ميكانيكية", "قطع غيار", "سمكرة ودهان", "تلميع وتنظيف", "فحص دوري", "تسجيل ونقل ملكية", "شحن ونقل", "تأمين", "إطارات", "أخرى"];
const PAYMENT = { cash: "نقدي", transfer: "تحويل بنكي", finance: "تمويل بنكي", installment: "تقسيط مباشر" };
const BANKS = ["مصرف الراجحي", "البنك الأهلي السعودي", "مصرف الإنماء", "بنك البلاد", "بنك الرياض", "عبد اللطيف جميل", "أخرى"];
const BODY_TYPES = ["سيدان", "SUV", "بيك أب", "هاتشباك", "كوبيه", "فان"];
const FUELS = ["بنزين", "ديزل", "هايبرد", "كهربائي"];
const SUP_TYPES = ["وكيل معتمد", "مزاد", "معرض", "فرد", "استيراد"];
const COLORS = ["أبيض لؤلؤي", "أبيض", "أسود", "فضي", "رمادي", "أحمر", "أزرق كحلي", "بيج", "بني"];

/* ---------------- أيقونات ---------------- */
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
      vatNumber: "300000000000003",
      crNumber: "1010000000",
      address: "المملكة العربية السعودية — هاتف 920-000-000",
      vatRate: 15,
      agingDays: 90,
      minMargin: 5,
      currentUser: "مدير النظام",
      branches: ["الفرع الرئيسي - الرياض", "فرع جدة", "ساحة التخزين"],
      sellers: ["أحمد السبيعي", "خالد العتيبي", "فهد الدوسري"],
    },
    counters: { stock: 1000, invoice: 0 },
    cars: [], suppliers: [], expenses: [], sales: [], movements: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.cars)) return null;
    const base = defaultDB();
    return { ...base, ...data, settings: { ...base.settings, ...data.settings }, counters: { ...base.counters, ...data.counters } };
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

/* ---------------- منطق الأعمال ---------------- */
const carById = (id) => db.cars.find((c) => c.id === id);
const supplierById = (id) => db.suppliers.find((s) => s.id === id);
const saleByCar = (carId) => db.sales.find((s) => s.carId === carId);
const carName = (c) => c ? `${c.make} ${c.model} ${c.trim || ""} ${c.year}`.replace(/\s+/g, " ").trim() : "سيارة محذوفة";
const carExpenses = (carId) => db.expenses.filter((e) => e.carId === carId).reduce((s, e) => s + num(e.amount), 0);
const totalCost = (c) => num(c.costPrice) + carExpenses(c.id);
const daysInStock = (c) => daysBetween(c.purchaseDate || today(), c.status === "sold" && c.soldDate ? c.soldDate : today());
const marginPct = (price, cost) => price > 0 ? ((price - cost) / price) * 100 : 0;

async function nextStockNo() {
  if (CLOUD) { const { data, error } = await sb.rpc("next_stock_no"); if (error) throw error; return data; }
  db.counters.stock += 1;
  return `RW-${db.counters.stock}`;
}
async function nextInvoiceNo() {
  if (CLOUD) { const { data, error } = await sb.rpc("next_invoice_no"); if (error) throw error; return data; }
  db.counters.invoice += 1;
  return `INV-${new Date().getFullYear()}-${String(db.counters.invoice).padStart(4, "0")}`;
}

function logMove(type, car, detail = "", amount = null, ts = null) {
  db.movements.unshift({
    id: uid(),
    ts: ts || new Date().toISOString(),
    type,
    carId: car ? car.id : null,
    carLabel: car ? `${car.stockNo} · ${carName(car)}` : "",
    detail,
    amount,
    user: db.settings.currentUser || "—",
  });
  if (!CLOUD && db.movements.length > 5000) db.movements.length = 5000;
}

function getAlerts() {
  const s = db.settings;
  const out = [];
  db.cars.forEach((c) => {
    if (!IN_STOCK.includes(c.status)) return;
    const d = daysInStock(c);
    if (d > s.agingDays) out.push({ level: "bad", car: c, text: `متقادمة: ${d} يوم في المخزون`, hint: "راجع السعر أو اعرضها بعرض خاص" });
    if (c.status === "reserved" && c.reservation && c.reservation.until < today()) out.push({ level: "warn", car: c, text: `انتهى الحجز في ${fmtDate(c.reservation.until)}`, hint: `العميل: ${c.reservation.customer}` });
    const m = marginPct(num(c.salePrice), totalCost(c));
    if (m < s.minMargin) out.push({ level: m < 0 ? "bad" : "warn", car: c, text: `هامش منخفض: ${pct(m)}`, hint: "التكلفة بعد المصاريف قريبة من سعر البيع" });
    if (c.status === "maintenance" && c.maintenanceSince && daysBetween(c.maintenanceSince, today()) > 14) out.push({ level: "warn", car: c, text: `في الصيانة منذ ${daysBetween(c.maintenanceSince, today())} يوم`, hint: "تابع مع الورشة" });
  });
  return out.sort((a, b) => (a.level === "bad" ? -1 : 1) - (b.level === "bad" ? -1 : 1));
}

/* ---------------- بيانات تجريبية ---------------- */
function seedDemo() {
  let seed = 20261108;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => Math.round(a + rnd() * (b - a));
  const round = (n, step = 500) => Math.round(n / step) * step;
  const VIN_CH = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  const vin = () => Array.from({ length: 17 }, () => pick(VIN_CH)).join("");
  const PL = ["أ", "ب", "ح", "د", "ر", "س", "ص", "ط", "ع", "ق", "ك", "ل", "م", "ن", "هـ", "و", "ى"];

  const data = defaultDB();
  data.counters.stock = 1000;
  const S = data.settings;

  data.suppliers = [
    { id: uid(), name: "عبد اللطيف جميل للسيارات", type: "وكيل معتمد", phone: "0500000001", city: "جدة", note: "" },
    { id: uid(), name: "الشركة الوطنية للسيارات", type: "وكيل معتمد", phone: "0500000002", city: "الرياض", note: "" },
    { id: uid(), name: "مزاد السيارات الشامل", type: "مزاد", phone: "0500000003", city: "الرياض", note: "مزاد أسبوعي كل خميس" },
    { id: uid(), name: "معرض الخليج للسيارات المستعملة", type: "معرض", phone: "0500000004", city: "الدمام", note: "" },
    { id: uid(), name: "مؤسسة الوفاء للاستيراد", type: "استيراد", phone: "0500000005", city: "جدة", note: "استيراد خليجي" },
  ];
  const dealerSup = data.suppliers.slice(0, 2);
  const usedSup = data.suppliers.slice(2);

  const MODELS = [
    ["تويوتا", "كامري", "GLE", 98000, "سيدان", "بنزين"],
    ["تويوتا", "لاندكروزر", "GXR", 285000, "SUV", "بنزين"],
    ["تويوتا", "هايلكس", "غمارتين", 92000, "بيك أب", "ديزل"],
    ["تويوتا", "يارس", "Y", 58000, "سيدان", "بنزين"],
    ["تويوتا", "راف فور", "هايبرد", 132000, "SUV", "هايبرد"],
    ["هيونداي", "توسان", "Smart", 112000, "SUV", "بنزين"],
    ["هيونداي", "النترا", "Comfort", 74000, "سيدان", "بنزين"],
    ["هيونداي", "أكسنت", "Smart", 60000, "سيدان", "بنزين"],
    ["كيا", "سيراتو", "LX", 68000, "سيدان", "بنزين"],
    ["كيا", "سبورتاج", "GT-Line", 118000, "SUV", "بنزين"],
    ["نيسان", "باترول", "LE", 310000, "SUV", "بنزين"],
    ["نيسان", "صني", "SV", 55000, "سيدان", "بنزين"],
    ["لكزس", "ES", "350", 195000, "سيدان", "بنزين"],
    ["لكزس", "LX", "600", 520000, "SUV", "بنزين"],
    ["فورد", "F-150", "XLT", 160000, "بيك أب", "بنزين"],
    ["شيفروليه", "تاهو", "LT", 225000, "SUV", "بنزين"],
    ["جيلي", "كولراي", "Sport", 72000, "SUV", "بنزين"],
    ["شانجان", "CS85", "Black Edition", 88000, "SUV", "بنزين"],
    ["مرسيدس", "C200", "AMG Line", 235000, "سيدان", "بنزين"],
  ];

  const now = today();
  const events = []; // [تاريخ, دالة] تُنفَّذ بالترتيب الزمني
  const N = 46;
  for (let i = 0; i < N; i++) {
    const [make, model, trim, basePrice, body, fuel] = pick(MODELS);
    const used = rnd() < 0.42;
    const year = used ? between(2019, 2023) : pick([2024, 2025, 2025]);
    const ageFactor = used ? 1 - (2025 - year) * 0.09 - rnd() * 0.08 : 1;
    const cost = round(basePrice * ageFactor * (0.9 + rnd() * 0.04));
    const purchaseDate = addDays(now, -between(1, 230));
    const car = {
      id: uid(),
      stockNo: `RW-${++data.counters.stock}`,
      make, model, trim, year,
      color: pick(COLORS),
      condition: used ? "used" : "new",
      bodyType: body, fuel,
      transmission: rnd() < 0.95 ? "أوتوماتيك" : "عادي",
      mileage: used ? round(between(18000, 140000), 1000) : between(0, 40),
      vin: vin(),
      plate: used ? `${pick(PL)} ${pick(PL)} ${pick(PL)} ${between(1000, 9999)}` : "",
      branch: rnd() < 0.55 ? S.branches[0] : rnd() < 0.7 ? S.branches[1] : S.branches[2],
      supplierId: (used ? pick(usedSup) : pick(dealerSup)).id,
      purchaseDate,
      costPrice: cost,
      salePrice: round(cost * (1.07 + rnd() * 0.07), 1000),
      minPrice: 0,
      status: "available",
      reservation: null,
      notes: "",
      createdAt: purchaseDate,
      soldDate: null,
    };
    car.minPrice = round(cost * 1.03, 500);
    data.cars.push(car);
    events.push([purchaseDate + "T09:00", () => logMoveIn(data, "purchase", car, `شراء من ${supplierById2(data, car.supplierId).name}`, car.costPrice)]);

    // مصاريف للمستعمل
    if (used) {
      const count = between(1, 3);
      for (let k = 0; k < count; k++) {
        const cat = pick(["فحص دوري", "تلميع وتنظيف", "صيانة ميكانيكية", "سمكرة ودهان", "إطارات", "تسجيل ونقل ملكية"]);
        const amt = round({ "فحص دوري": 350, "تلميع وتنظيف": 600, "صيانة ميكانيكية": 2200, "سمكرة ودهان": 3500, "إطارات": 2400, "تسجيل ونقل ملكية": 450 }[cat] * (0.6 + rnd() * 0.8), 50);
        const d = addDays(purchaseDate, between(1, 6));
        if (d > now) continue;
        const exp = { id: uid(), carId: car.id, date: d, category: cat, amount: amt, note: "", user: S.currentUser };
        data.expenses.push(exp);
        events.push([d + "T12:00", () => logMoveIn(data, "expense", car, `${cat}`, amt)]);
      }
    }

    // تحديد الحالة
    const age = daysBetween(purchaseDate, now);
    const sellChance = age > 150 ? 0.85 : age > 60 ? 0.65 : age > 20 ? 0.35 : 0.05;
    if (rnd() < sellChance) {
      const soldDate = addDays(purchaseDate, between(Math.min(5, age), Math.max(5, Math.min(age, 110))));
      if (soldDate <= now) {
        const tc = car.costPrice + data.expenses.filter((e) => e.carId === car.id).reduce((s, e) => s + e.amount, 0);
        const price = round(Math.max(car.salePrice * (0.96 + rnd() * 0.04), tc * 1.02), 500);
        const method = pick(["cash", "finance", "finance", "transfer", "finance"]);
        const sale = {
          id: uid(), carId: car.id, invoiceNo: "", date: soldDate, price,
          vatRate: S.vatRate, paymentMethod: method,
          bank: method === "finance" ? pick(BANKS.slice(0, 6)) : "",
          downPayment: method === "finance" ? round(price * 0.1, 1000) : 0,
          customer: { name: pick(["محمد", "عبدالله", "سعود", "فيصل", "نورة", "ريم", "تركي", "ماجد", "عبدالعزيز", "هند"]) + " " + pick(["الشمري", "الحربي", "الغامدي", "الزهراني", "المطيري", "القحطاني", "العنزي", "السهلي"]), phone: "05" + between(10000000, 99999999), idNo: "1" + between(100000000, 999999999) },
          seller: pick(S.sellers), note: "",
        };
        car.status = "sold";
        car.soldDate = soldDate;
        data.sales.push(sale);
        events.push([soldDate + "T17:00", () => {
          sale.invoiceNo = `INV-${soldDate.slice(0, 4)}-${String(++data.counters.invoice).padStart(4, "0")}`;
          logMoveIn(data, "sale", car, `فاتورة ${sale.invoiceNo} — ${sale.customer.name}`, price);
        }]);
        continue;
      }
    }
    if (age < 6 && rnd() < 0.6) {
      car.status = "transit";
    } else {
      const r = rnd();
      if (r < 0.14) {
        car.status = "reserved";
        const rd = addDays(now, -between(0, 6));
        car.reservation = { customer: pick(["سلطان العمري", "بندر الحارثي", "مشاري الرشيد", "لمى الشهري"]), phone: "05" + between(10000000, 99999999), deposit: pick([2000, 3000, 5000]), date: rd, until: addDays(rd, 4), note: "" };
        events.push([rd + "T15:00", () => logMoveIn(data, "reserve", car, `حجز باسم ${car.reservation.customer}`, car.reservation.deposit)]);
      } else if (r < 0.22) {
        car.status = "maintenance";
        car.maintenanceSince = addDays(now, -between(2, 20));
        events.push([car.maintenanceSince + "T10:00", () => logMoveIn(data, "maintenance", car, "فحص وإصلاح قبل العرض")]);
      }
    }
  }

  events.sort((a, b) => a[0].localeCompare(b[0])).forEach(([, fn]) => fn());
  data.movements.forEach((m) => { m.user = m.type === "sale" ? (data.sales.find((s) => s.carId === m.carId) || {}).seller || S.currentUser : S.currentUser; });
  return data;

  function supplierById2(d, id) { return d.suppliers.find((s) => s.id === id) || { name: "—" }; }
  function logMoveIn(d, type, car, detail, amount = null) {
    d.movements.unshift({ id: uid(), ts: new Date().toISOString(), type, carId: car.id, carLabel: `${car.stockNo} · ${carName(car)}`, detail, amount, user: S.currentUser });
  }
}
// ضبط توقيت الحركات التجريبية على تواريخها الحقيقية
function seedDemoWithTimes() {
  const data = seedDemo();
  // الحركات أُضيفت بترتيب زمني، نعيد حساب الطوابع الزمنية من الأحداث المسجلة
  const byCar = {};
  data.cars.forEach((c) => (byCar[c.id] = c));
  data.movements.forEach((m) => {
    const c = byCar[m.carId];
    if (!c) return;
    let d = c.purchaseDate, h = 9;
    if (m.type === "sale") { d = c.soldDate; h = 17; }
    else if (m.type === "reserve") { d = c.reservation ? c.reservation.date : d; h = 15; }
    else if (m.type === "maintenance") { d = c.maintenanceSince || d; h = 10; }
    else if (m.type === "expense") {
      const e = data.expenses.find((x) => x.carId === c.id && x.category === m.detail && !x.__used);
      if (e) { d = e.date; e.__used = true; }
      h = 12;
    }
    const dt = parseDate(d); dt.setHours(h, Math.floor(Math.random() * 59));
    m.ts = dt.toISOString();
  });
  data.expenses.forEach((e) => delete e.__used);
  data.movements.sort((a, b) => b.ts.localeCompare(a.ts));
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
  const [cars, suppliers, expenses, sales, movements, st, profs] = await Promise.all([
    fetchAll("cars"), fetchAll("suppliers"), fetchAll("expenses"), fetchAll("sales"),
    fetchAll("movements", { newestFirst: true, limit: 3000 }),
    sb.from("app_settings").select("data").eq("id", 1).maybeSingle(),
    sb.from("profiles").select("*").order("created_at"),
  ]);
  if (st.error) throw st.error;
  if (profs.error) throw profs.error;
  profiles = profs.data || [];
  const base = defaultDB();
  const next = { ...base, settings: { ...base.settings, ...settingsForSync((st.data && st.data.data) || {}) } };
  const rows = { cars, suppliers, expenses, sales };
  snap = {};
  SYNC_TABLES.forEach((t) => {
    next[t] = rows[t].map((r) => ({ ...r.data, id: r.id }));
    snap[t] = new Map(next[t].map((o) => [o.id, JSON.stringify(o)]));
  });
  next.movements = movements.map((r) => ({ ...r.data, id: r.id, ts: r.data.ts || r.created_at })).sort((a, b) => b.ts.localeCompare(a.ts));
  snap.movements = new Set(next.movements.map((m) => m.id));
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
    const newMoves = db.movements.filter((m) => !snap.movements.has(m.id)).reverse();
    for (const part of chunks(newMoves, 400)) {
      const { error } = await sb.from("movements").insert(part.map((m) => ({ id: m.id, data: m })));
      if (error) throw error;
      part.forEach((m) => snap.movements.add(m.id));
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

// تحقق من الخادم مباشرة أن السيارة ما زالت متاحة (يمنع بيع/حجز سيارة غيّرها موظف آخر للتو)
async function stillAvailable(carId, allowed = ["available", "reserved"]) {
  if (!CLOUD) return true;
  const { data, error } = await sb.from("cars").select("data").eq("id", carId).maybeSingle();
  if (error) throw error;
  if (!data || !allowed.includes(data.data.status)) {
    toast("حالة السيارة تغيّرت من موظف آخر — تم تحديث البيانات", "error");
    closeModal();
    await reloadCloud();
    return false;
  }
  return true;
}

async function replaceCloudData(data) {
  await syncChain;
  setSyncState("saving");
  const { error } = await sb.rpc("wipe_inventory");
  if (error) throw error;
  for (const t of ["suppliers", "cars", "expenses", "sales", "movements"]) {
    const rows = (Array.isArray(data[t]) ? data[t] : []).map((o) => ({ id: o.id || uid(), data: o }));
    for (const part of chunks(rows, 400)) {
      const { error: e } = await sb.from(t).insert(part);
      if (e) throw e;
    }
  }
  const st = settingsForSync({ ...defaultDB().settings, ...(data.settings || {}) });
  const r1 = await sb.from("app_settings").upsert({ id: 1, data: st });
  if (r1.error) throw r1.error;
  const r2 = await sb.rpc("sync_counters");
  if (r2.error) throw r2.error;
  await reloadCloud();
}

/* ---------- التحديث اللحظي ---------- */
let renderTimer = null;
function renderNow() {
  if (!me && CLOUD) return;
  PAGES[currentPage].render();
  renderChrome();
  if ($("#drawerOverlay").classList.contains("open") && !$("#modalOverlay").classList.contains("open")) {
    if (drawerCarId && carById(drawerCarId)) {
      const body = $("#drawer .modal-body");
      const top = body ? body.scrollTop : 0;
      openCar(drawerCarId);
      const nb = $("#drawer .modal-body");
      if (nb) nb.scrollTop = top;
    } else closeDrawer();
  }
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
  if (t === "movements") {
    if (p.eventType === "INSERT" && p.new && !snap.movements.has(p.new.id) && !db.movements.some((m) => m.id === p.new.id)) {
      snap.movements.add(p.new.id);
      db.movements.unshift({ ...p.new.data, id: p.new.id, ts: p.new.data.ts || p.new.created_at });
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
    go(location.hash.slice(1) || "dashboard");
    renderChrome();
    if (isAdmin() && !db.cars.length && !db.sales.length) setTimeout(() => toast("قاعدة البيانات فارغة — ابدأ بإضافة السيارات، أو حمّل بيانات تجريبية من الإعدادات", "warn"), 400);
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
  db.sales.forEach((s) => (salesBy[s.seller] = (salesBy[s.seller] || 0) + 1));
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

/* ---------------- واجهة: تنقل ---------------- */
const PAGES = {
  dashboard: { title: "لوحة التحكم", render: renderDashboard },
  inventory: { title: "مخزون السيارات", render: renderInventory },
  sales: { title: "المبيعات", render: renderSales },
  expenses: { title: "المصاريف والصيانة", render: renderExpenses },
  movements: { title: "سجل الحركات", render: renderMovements },
  suppliers: { title: "الموردون", render: renderSuppliers },
  reports: { title: "التقارير", render: renderReports },
  users: { title: "الموظفون", render: renderUsers, admin: true },
  settings: { title: "الإعدادات", render: renderSettings, admin: true },
};
let currentPage = "dashboard";

function go(page) {
  if (!PAGES[page] || (PAGES[page].admin && !isAdmin()) || (page === "users" && !CLOUD)) page = "dashboard";
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
  const n = getAlerts().length;
  const b = $("#agingBadge");
  b.textContent = n;
  b.classList.toggle("hidden", n === 0);
  const pending = CLOUD ? profiles.filter((p) => !p.active).length : 0;
  $("#pendingBadge").textContent = pending;
  $("#pendingBadge").classList.toggle("hidden", !pending);
}

function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("open"); }

/* ---------------- لوحة التحكم ---------------- */
function kpi(label, value, foot, tone, ic) {
  return `<div class="kpi"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon ${tone}">${icon(ic)}</span></div><div class="kpi-value num">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

function renderDashboard() {
  const now = new Date();
  $("#todayLabel").textContent = `اليوم: ${fmtDate(today())}`;
  const stock = db.cars.filter((c) => IN_STOCK.includes(c.status));
  const stockCost = stock.reduce((s, c) => s + totalCost(c), 0);
  const stockValue = stock.reduce((s, c) => s + num(c.salePrice), 0);
  const ym = today().slice(0, 7);
  const monthSales = db.sales.filter((s) => s.date.slice(0, 7) === ym);
  const monthRev = monthSales.reduce((s, x) => s + num(x.price), 0);
  const monthProfit = monthSales.reduce((s, x) => { const c = carById(x.carId); return s + num(x.price) - (c ? totalCost(c) : 0); }, 0);
  const avgDays = stock.length ? Math.round(stock.reduce((s, c) => s + daysInStock(c), 0) / stock.length) : 0;
  const soldAll = db.sales.map((s) => carById(s.carId)).filter(Boolean);
  const avgSellDays = soldAll.length ? Math.round(soldAll.reduce((s, c) => s + daysInStock(c), 0) / soldAll.length) : 0;
  const count = (st) => stock.filter((c) => c.status === st).length;

  $("#kpiGrid").innerHTML = [
    kpi("سيارات في المخزون", fmt(stock.length), `${count("available")} متاحة · ${count("reserved")} محجوزة · ${count("maintenance") + count("transit")} غير جاهزة`, "tone-gold", "car"),
    kpi("قيمة المخزون (تكلفة)", money(stockCost), `القيمة البيعية ${moneyTxt(stockValue)}`, "tone-blue", "box"),
    kpi("الربح المتوقع", money(stockValue - stockCost), `هامش متوقع ${pct(marginPct(stockValue, stockCost))}`, "tone-green", "trend"),
    kpi(`مبيعات ${AR_MONTHS[now.getMonth()]}`, money(monthRev), `${monthSales.length} سيارة · ربح ${moneyTxt(monthProfit)}`, "tone-purple", "money"),
    kpi("متوسط عمر المخزون", `${avgDays} <small>يوم</small>`, `متوسط مدة البيع ${avgSellDays} يوم`, avgDays > db.settings.agingDays ? "tone-red" : "tone-orange", "clock"),
  ].join("");

  // مخطط المبيعات لآخر 6 أشهر
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: AR_MONTHS[d.getMonth()], rev: 0, profit: 0, n: 0 }); }
  db.sales.forEach((s) => {
    const m = months.find((x) => x.key === s.date.slice(0, 7));
    if (!m) return;
    const c = carById(s.carId);
    m.rev += num(s.price); m.profit += num(s.price) - (c ? totalCost(c) : 0); m.n++;
  });
  const max = Math.max(1, ...months.map((m) => m.rev));
  $("#salesChart").innerHTML = months.map((m) => {
    const profitH = Math.max(0, (m.profit / max) * 100);
    const revH = Math.max(0, ((m.rev - Math.max(0, m.profit)) / max) * 100);
    return `<div class="bar-col" title="${m.label}: ${m.n} سيارة — إيراد ${moneyTxt(m.rev)} — ربح ${moneyTxt(m.profit)}">
      <span class="bar-val">${m.rev ? (m.rev / 1000).toFixed(0) + "k" : ""}</span>
      <div class="bar-stack" style="height:${profitH + revH}%">
        <div class="bar" style="height:${profitH + revH ? (profitH / (profitH + revH)) * 100 : 0}%;background:var(--success)"></div>
        <div class="bar" style="flex:1;background:var(--gold)"></div>
      </div>
      <span class="bar-lbl">${m.label}</span>
    </div>`;
  }).join("");

  // دونات الحالة
  const counts = Object.keys(STATUS).filter((k) => k !== "sold").map((k) => ({ k, n: count(k) }));
  const total = counts.reduce((s, x) => s + x.n, 0);
  let acc = 0;
  const R = 15.915, C = 100;
  const segs = total ? counts.filter((x) => x.n).map((x) => {
    const len = (x.n / total) * C;
    const seg = `<circle r="${R}" cx="21" cy="21" fill="none" stroke="${STATUS[x.k].color}" stroke-width="5" stroke-dasharray="${len - 0.6} ${C - len + 0.6}" stroke-dashoffset="${-acc + 25}"/>`;
    acc += len;
    return seg;
  }).join("") : "";
  $("#statusDonut").innerHTML = `
    <svg class="donut" viewBox="0 0 42 42"><circle r="${R}" cx="21" cy="21" fill="none" stroke="var(--panel-2)" stroke-width="5"/>${segs}
      <text x="21" y="20.5" text-anchor="middle" fill="var(--text)" font-size="7" font-weight="800" font-family="Cairo">${total}</text>
      <text x="21" y="26.5" text-anchor="middle" fill="var(--muted)" font-size="3.2" font-family="Cairo">سيارة</text></svg>
    <div class="donut-legend">${counts.map((x) => `<button class="legend-row" style="background:none;border:none;cursor:pointer;color:inherit" data-filter-status="${x.k}"><i style="background:${STATUS[x.k].color}"></i>${STATUS[x.k].label}<b>${x.n}</b></button>`).join("")}</div>`;

  // تنبيهات
  const alerts = getAlerts();
  $("#alertsCount").textContent = alerts.length ? `${alerts.length} تنبيه` : "";
  $("#alertsList").innerHTML = alerts.length ? alerts.slice(0, 7).map((a) => `
    <div class="list-item" style="cursor:pointer" data-open-car="${a.car.id}">
      <span class="list-icon ${a.level === "bad" ? "tone-red" : "tone-orange"}">${icon("alert")}</span>
      <div class="list-body"><b>${esc(carName(a.car))}</b><small>${esc(a.text)} — ${esc(a.hint)}</small></div>
      <span class="list-side mono">${esc(a.car.stockNo)}</span>
    </div>`).join("") : `<div class="empty">${icon("check")}<div>لا توجد تنبيهات — المخزون في حالة ممتازة</div></div>`;

  $("#recentList").innerHTML = db.movements.length ? db.movements.slice(0, 7).map(moveListItem).join("") : `<div class="empty">لا توجد حركات بعد</div>`;
}

function moveListItem(m) {
  const t = MOVE[m.type] || MOVE.edit;
  return `<div class="list-item" ${m.carId && carById(m.carId) ? `style="cursor:pointer" data-open-car="${m.carId}"` : ""}>
    <span class="list-icon ${t.tone}">${icon(t.icon)}</span>
    <div class="list-body"><b>${t.label} — ${esc(m.carLabel)}</b><small>${esc(m.detail)}${m.user ? ` · ${esc(m.user)}` : ""}</small></div>
    <span class="list-side">${fmtDate(m.ts.slice(0, 10))}${m.amount ? `<br><span class="num">${moneyTxt(m.amount)}</span>` : ""}</span>
  </div>`;
}

/* ---------------- المخزون ---------------- */
const invState = { status: "stock", q: "", make: "", branch: "", condition: "", age: "", sort: "days", dir: -1, page: 1 };

function renderInventory() {
  // خيارات الفلاتر
  const makes = [...new Set(db.cars.map((c) => c.make))].sort((a, b) => a.localeCompare(b, "ar"));
  fillSelect($("#fMake"), makes, "كل الماركات", invState.make);
  fillSelect($("#fBranch"), db.settings.branches, "كل الفروع", invState.branch);
  $("#fCondition").value = invState.condition;
  $("#fAge").value = invState.age;
  if (document.activeElement !== $("#invSearch")) $("#invSearch").value = invState.q;

  const chipDefs = [["stock", "في المخزون", (c) => IN_STOCK.includes(c.status)], ...Object.keys(STATUS).map((k) => [k, STATUS[k].label, (c) => c.status === k]), ["all", "الكل", () => true]];
  $("#statusChips").innerHTML = chipDefs.map(([k, l, f]) => `<button class="chip ${invState.status === k ? "active" : ""}" data-chip="${k}">${l}<span>(${db.cars.filter(f).length})</span></button>`).join("");

  const q = invState.q.trim().toLowerCase();
  const [aMin, aMax] = invState.age ? invState.age.split("-").map(Number) : [null, null];
  let rows = db.cars.filter((c) => {
    if (invState.status === "stock" && !IN_STOCK.includes(c.status)) return false;
    if (!["stock", "all"].includes(invState.status) && c.status !== invState.status) return false;
    if (invState.make && c.make !== invState.make) return false;
    if (invState.branch && c.branch !== invState.branch) return false;
    if (invState.condition && c.condition !== invState.condition) return false;
    if (aMin !== null) { const d = daysInStock(c); if (d < aMin || d > aMax) return false; }
    if (q) {
      const hay = [c.stockNo, c.make, c.model, c.trim, c.year, c.color, c.vin, c.plate, c.branch, c.notes].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  }).map((c) => {
    const tc = totalCost(c);
    const sale = c.status === "sold" ? saleByCar(c.id) : null;
    const price = sale ? num(sale.price) : num(c.salePrice);
    return { c, tc, price, margin: marginPct(price, tc), days: daysInStock(c), name: carName(c) };
  });

  const key = invState.sort;
  rows.sort((a, b) => {
    let va, vb;
    switch (key) {
      case "name": va = a.name; vb = b.name; return va.localeCompare(vb, "ar") * invState.dir;
      case "stockNo": va = a.c.stockNo; vb = b.c.stockNo; return va.localeCompare(vb, "en", { numeric: true }) * invState.dir;
      case "status": va = a.c.status; vb = b.c.status; return va.localeCompare(vb) * invState.dir;
      case "totalCost": va = a.tc; vb = b.tc; break;
      case "salePrice": va = a.price; vb = b.price; break;
      case "margin": va = a.margin; vb = b.margin; break;
      case "mileage": va = num(a.c.mileage); vb = num(b.c.mileage); break;
      default: va = a.days; vb = b.days;
    }
    return (va - vb) * invState.dir;
  });

  $$("#invHead th.sortable").forEach((th) => {
    const ind = th.dataset.sort === key ? `<span class="sort-ind">${invState.dir > 0 ? "▲" : "▼"}</span>` : "";
    th.innerHTML = th.textContent.replace(/[▲▼]/g, "").trim() + ind;
  });

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  invState.page = Math.min(invState.page, pages);
  const slice = rows.slice((invState.page - 1) * PAGE_SIZE, invState.page * PAGE_SIZE);
  const aging = db.settings.agingDays;

  $("#invBody").innerHTML = slice.length ? slice.map(({ c, tc, price, margin, days }) => `
    <tr class="clickable" data-open-car="${c.id}">
      <td class="mono">${esc(c.stockNo)}</td>
      <td><div class="car-cell"><b>${esc(c.make)} ${esc(c.model)} ${esc(c.trim || "")}</b><small>${esc(c.year)} · ${esc(c.color || "")} · ${c.condition === "new" ? "جديد" : "مستعمل"}</small></div></td>
      <td class="mono muted">${esc(c.vin || "—")}</td>
      <td class="num">${c.condition === "new" && num(c.mileage) < 100 ? '<span class="muted">زيرو</span>' : fmt(c.mileage) + " كم"}</td>
      <td>${esc(c.branch || "—")}</td>
      <td class="num">${fmt(tc)}</td>
      <td class="num"><b>${fmt(price)}</b></td>
      <td class="num ${margin < 0 ? "profit-neg" : margin < db.settings.minMargin ? "age-warn" : "profit-pos"}">${fmt(price - tc)} <small class="muted">(${pct(margin)})</small></td>
      <td class="num ${c.status !== "sold" && days > aging ? "age-bad" : c.status !== "sold" && days > aging * 0.66 ? "age-warn" : ""}">${days}</td>
      <td><span class="badge ${STATUS[c.status].cls}">${STATUS[c.status].label}</span></td>
      <td class="actions"><button class="btn-icon" title="عرض التفاصيل" data-open-car="${c.id}">${icon("eye")}</button></td>
    </tr>`).join("") : `<tr><td colspan="11"><div class="empty">${icon("car")}<div>لا توجد سيارات مطابقة للبحث</div></div></td></tr>`;

  const sumCost = rows.reduce((s, r) => s + r.tc, 0);
  const sumPrice = rows.reduce((s, r) => s + r.price, 0);
  $("#invSummary").innerHTML = `${rows.length} سيارة · إجمالي التكلفة <b class="num">${moneyTxt(sumCost)}</b> · إجمالي البيع <b class="num">${moneyTxt(sumPrice)}</b>`;
  $("#invPager").innerHTML = pages > 1 ? `
    <button class="btn btn-sm btn-ghost" data-page-nav="-1" ${invState.page === 1 ? "disabled" : ""}>السابق</button>
    <span>صفحة ${invState.page} من ${pages}</span>
    <button class="btn btn-sm btn-ghost" data-page-nav="1" ${invState.page === pages ? "disabled" : ""}>التالي</button>` : "";
  invState.lastRows = rows;
}

function fillSelect(sel, items, allLabel, value) {
  sel.innerHTML = `<option value="">${allLabel}</option>` + items.map((i) => `<option value="${esc(i)}">${esc(i)}</option>`).join("");
  sel.value = value || "";
}

/* ---------------- تفاصيل السيارة ---------------- */
let drawerCarId = null;
function openCar(id) {
  const c = carById(id);
  if (!c) return;
  drawerCarId = id;
  const tc = totalCost(c);
  const exps = db.expenses.filter((e) => e.carId === id).sort((a, b) => b.date.localeCompare(a.date));
  const sale = saleByCar(id);
  const sup = supplierById(c.supplierId);
  const moves = db.movements.filter((m) => m.carId === id);
  const price = sale ? num(sale.price) : num(c.salePrice);
  const days = daysInStock(c);

  const actions = [];
  if (c.status === "available" || c.status === "reserved") actions.push(`<button class="btn btn-success btn-sm" data-action="sell" data-id="${id}">${icon("money")}بيع</button>`);
  if (c.status === "available") actions.push(`<button class="btn btn-ghost btn-sm" data-action="reserve" data-id="${id}">${icon("lock")}حجز</button>`);
  if (c.status === "reserved") actions.push(`<button class="btn btn-ghost btn-sm" data-action="unreserve" data-id="${id}">${icon("unlock")}إلغاء الحجز</button>`);
  if (c.status === "available") actions.push(`<button class="btn btn-ghost btn-sm" data-action="maintenance" data-id="${id}">${icon("tool")}للصيانة</button>`);
  if (c.status === "maintenance" || c.status === "transit") actions.push(`<button class="btn btn-ghost btn-sm" data-action="ready" data-id="${id}">${icon("check")}${c.status === "transit" ? "تم الاستلام" : "جاهزة للبيع"}</button>`);
  if (c.status !== "sold") actions.push(`<button class="btn btn-ghost btn-sm" data-action="transfer" data-id="${id}">${icon("move")}نقل</button>`);
  if (c.status !== "sold") actions.push(`<button class="btn btn-ghost btn-sm" data-action="add-expense" data-id="${id}">${icon("plus")}مصروف</button>`);
  if (sale) actions.push(`<button class="btn btn-ghost btn-sm" data-action="invoice" data-id="${sale.id}">${icon("print")}الفاتورة</button>`);
  actions.push(`<button class="btn btn-ghost btn-sm" data-action="edit-car" data-id="${id}">${icon("edit")}تعديل</button>`);
  actions.push(`<button class="btn btn-ghost btn-sm" data-action="print-card" data-id="${id}">${icon("print")}بطاقة السيارة</button>`);

  const spec = (l, v, cls = "") => `<div class="spec"><span>${l}</span><b class="${cls}">${v}</b></div>`;

  $("#drawer").innerHTML = `
    <div class="modal-head"><h3><span class="mono">${esc(c.stockNo)}</span></h3><button class="btn-icon" data-close>${icon("x")}</button></div>
    <div class="modal-body" style="padding:0">
      <div class="detail-hero">
        <span class="badge ${STATUS[c.status].cls}">${STATUS[c.status].label}</span>
        <h2 style="margin-top:8px">${esc(carName(c))}</h2>
        <div class="meta">${esc(c.color || "")} · ${c.condition === "new" ? "جديد" : "مستعمل"} · ${esc(c.branch || "")}</div>
        <div class="price num">${moneyTxt(price)}${sale ? ' <small class="muted" style="font-size:.8rem">سعر البيع الفعلي</small>' : ""}</div>
        <div class="detail-actions">${actions.join("")}</div>
      </div>
      <div style="padding:18px 22px 30px">
        ${c.status === "reserved" && c.reservation ? `<div class="alert warn">${icon("lock")}<div>محجوزة باسم <b>${esc(c.reservation.customer)}</b> (${esc(c.reservation.phone)}) — عربون ${moneyTxt(c.reservation.deposit)} — حتى ${fmtDate(c.reservation.until)}${c.reservation.until < today() ? " <b>(منتهي)</b>" : ""}</div></div>` : ""}
        ${sale ? `<div class="alert info">${icon("money")}<div>بيعت بتاريخ ${fmtDate(sale.date)} للعميل <b>${esc(sale.customer.name)}</b> — ${PAYMENT[sale.paymentMethod] || ""}${sale.bank ? ` (${esc(sale.bank)})` : ""} — فاتورة <span class="mono">${esc(sale.invoiceNo)}</span></div></div>` : ""}

        <div class="section-h">الملخص المالي</div>
        <div class="spec-grid">
          ${spec("سعر الشراء", moneyTxt(c.costPrice), "num")}
          ${spec("المصاريف المحمّلة", moneyTxt(tc - num(c.costPrice)), "num")}
          ${spec("إجمالي التكلفة", moneyTxt(tc), "num")}
          ${spec(sale ? "سعر البيع" : "سعر البيع المعلن", moneyTxt(price), "num")}
          ${spec(sale ? "صافي الربح" : "الربح المتوقع", `${moneyTxt(price - tc)} (${pct(marginPct(price, tc))})`, `num ${price - tc >= 0 ? "profit-pos" : "profit-neg"}`)}
          ${spec("أقل سعر مسموح", c.minPrice ? moneyTxt(c.minPrice) : "—", "num")}
        </div>

        <div class="section-h">المواصفات</div>
        <div class="spec-grid">
          ${spec("رقم الهيكل (VIN)", esc(c.vin || "—"), "mono")}
          ${spec("رقم اللوحة", esc(c.plate || "—"))}
          ${spec("الممشى", fmt(c.mileage) + " كم", "num")}
          ${spec("الفئة / الهيكل", esc(c.bodyType || "—"))}
          ${spec("الوقود", esc(c.fuel || "—"))}
          ${spec("ناقل الحركة", esc(c.transmission || "—"))}
          ${spec("المورد", esc(sup ? sup.name : "—"))}
          ${spec("تاريخ الشراء", fmtDate(c.purchaseDate))}
          ${spec(c.status === "sold" ? "مدة البيع" : "أيام في المخزون", `${days} يوم`, c.status !== "sold" && days > db.settings.agingDays ? "age-bad" : "")}
          ${spec("الفرع", esc(c.branch || "—"))}
        </div>
        ${c.notes ? `<div class="section-h">ملاحظات</div><p class="muted" style="white-space:pre-wrap">${esc(c.notes)}</p>` : ""}

        <div class="section-h">المصاريف (${exps.length})</div>
        ${exps.length ? `<div class="list">${exps.map((e) => `<div class="list-item"><span class="list-icon tone-red">${icon("tool")}</span><div class="list-body"><b>${esc(e.category)}</b><small>${fmtDate(e.date)}${e.note ? " · " + esc(e.note) : ""}</small></div><span class="list-side num">${moneyTxt(e.amount)}</span></div>`).join("")}</div>` : '<p class="muted" style="font-size:.85rem">لا توجد مصاريف مسجلة</p>'}

        <div class="section-h">السجل الزمني</div>
        <div class="timeline">${moves.map((m) => `<div class="tl-item"><b>${(MOVE[m.type] || MOVE.edit).label}</b> — ${esc(m.detail)}${m.amount ? ` <span class="num">(${moneyTxt(m.amount)})</span>` : ""}<small>${fmtDateTime(m.ts)} · ${esc(m.user)}</small></div>`).join("") || '<p class="muted">لا يوجد</p>'}</div>

        ${c.status !== "sold" ? `<div style="margin-top:24px" class="admin-only"><button class="btn btn-danger btn-sm" data-action="delete-car" data-id="${id}">${icon("trash")}حذف السيارة نهائيًا</button></div>` : ""}
      </div>
    </div>`;
  openOverlay("drawerOverlay");
}

/* ---------------- النوافذ ---------------- */
function openOverlay(id) { $(`#${id}`).classList.add("open"); document.body.style.overflow = "hidden"; }
function closeOverlay(id) { $(`#${id}`).classList.remove("open"); if (!$$(".overlay.open").length) document.body.style.overflow = ""; }
function closeModal() { closeOverlay("modalOverlay"); }
function closeDrawer() { closeOverlay("drawerOverlay"); }

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

/* ---------- نموذج السيارة ---------- */
function carForm(id) {
  const c = id ? carById(id) : null;
  const v = c || { condition: "new", year: new Date().getFullYear(), transmission: "أوتوماتيك", fuel: "بنزين", bodyType: "سيدان", purchaseDate: today(), branch: db.settings.branches[0], status: "available", mileage: 0 };
  const makes = [...new Set(db.cars.map((x) => x.make))];
  const years = []; for (let y = new Date().getFullYear() + 1; y >= 2005; y--) years.push(y);

  modal({
    title: c ? `تعديل ${esc(c.stockNo)}` : "إضافة سيارة للمخزون",
    submit: c ? "حفظ التعديلات" : "إضافة للمخزون",
    body: `
      <div class="form-section">بيانات السيارة</div>
      <div class="form-grid">
        ${field(req("الماركة"), `<input class="input" name="make" list="makesList" required value="${esc(v.make)}"><datalist id="makesList">${makes.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>`)}
        ${field(req("الموديل"), `<input class="input" name="model" required value="${esc(v.model)}">`)}
        ${field("الفئة", `<input class="input" name="trim" value="${esc(v.trim)}" placeholder="مثال: GLE، فل كامل">`)}
        ${field(req("سنة الصنع"), `<select class="select" name="year" required>${opts(years, v.year)}</select>`)}
        ${field("اللون", `<input class="input" name="color" list="colorsList" value="${esc(v.color)}"><datalist id="colorsList">${COLORS.map((m) => `<option value="${m}">`).join("")}</datalist>`)}
        ${field("الحالة", `<select class="select" name="condition">${opts([["new", "جديد (زيرو)"], ["used", "مستعمل"]], v.condition)}</select>`)}
        ${field("نوع الهيكل", `<select class="select" name="bodyType">${opts(BODY_TYPES, v.bodyType)}</select>`)}
        ${field("الوقود", `<select class="select" name="fuel">${opts(FUELS, v.fuel)}</select>`)}
        ${field("ناقل الحركة", `<select class="select" name="transmission">${opts(["أوتوماتيك", "عادي"], v.transmission)}</select>`)}
        ${field("رقم الهيكل (VIN)", `<input class="input mono" name="vin" maxlength="17" dir="ltr" value="${esc(v.vin)}" style="text-transform:uppercase">`, "span-2", "17 خانة — يمنع النظام تكرار نفس الرقم")}
        ${field("الممشى (كم)", `<input class="input" type="number" min="0" name="mileage" value="${esc(v.mileage)}">`)}
        ${field("رقم اللوحة", `<input class="input" name="plate" value="${esc(v.plate)}">`)}
        ${field("الفرع / الموقع", `<select class="select" name="branch">${opts(db.settings.branches, v.branch)}</select>`)}
        ${c ? "" : field("حالة الاستلام", `<select class="select" name="status">${opts([["available", "متاحة للبيع"], ["transit", "في الطريق (لم تُستلم)"], ["maintenance", "تحتاج صيانة"]], v.status)}</select>`)}
      </div>
      <div class="form-section">الشراء والتسعير</div>
      <div class="form-grid">
        ${field("المورد", `<select class="select" name="supplierId">${opts(db.suppliers.map((s) => [s.id, s.name]), v.supplierId, "— بدون —")}</select>`)}
        ${field(req("تاريخ الشراء"), `<input class="input" type="date" name="purchaseDate" required value="${esc(v.purchaseDate)}">`)}
        ${field(req("سعر الشراء (ر.س)"), `<input class="input" type="number" min="0" step="100" name="costPrice" required value="${esc(v.costPrice)}">`)}
        ${field(req("سعر البيع المعلن (ر.س)"), `<input class="input" type="number" min="0" step="100" name="salePrice" required value="${esc(v.salePrice)}">`)}
        ${field("أقل سعر مسموح للبيع", `<input class="input" type="number" min="0" step="100" name="minPrice" value="${esc(v.minPrice)}">`, "", "يتنبه البائع لو باع بأقل منه")}
        <div class="field"><label>&nbsp;</label><div id="marginPreview" class="summary-box" style="margin:0;padding:9px 12px"></div></div>
        ${field("ملاحظات", `<textarea class="input" name="notes" rows="2">${esc(v.notes)}</textarea>`, "span-3")}
      </div>`,
    onInput: (form) => {
      const cost = num(form.costPrice.value) + (c ? carExpenses(c.id) : 0);
      const price = num(form.salePrice.value);
      const m = marginPct(price, cost);
      $("#marginPreview").innerHTML = price ? `الهامش: <b class="${m < 0 ? "profit-neg" : m < db.settings.minMargin ? "age-warn" : "profit-pos"} num">${moneyTxt(price - cost)} (${pct(m)})</b>` : '<span class="muted">الهامش يظهر هنا</span>';
    },
    onSubmit: async (d, form) => {
      d.vin = (d.vin || "").trim().toUpperCase();
      if (d.vin && d.vin.length !== 17) { form.vin.closest(".field").classList.add("invalid"); toast("رقم الهيكل يجب أن يكون 17 خانة", "error"); return false; }
      if (d.vin && db.cars.some((x) => x.vin === d.vin && x.id !== id)) { form.vin.closest(".field").classList.add("invalid"); toast("رقم الهيكل مسجل مسبقًا لسيارة أخرى", "error"); return false; }
      if (num(d.salePrice) <= 0 || num(d.costPrice) <= 0) { toast("أدخل أسعار صحيحة", "error"); return false; }
      const clean = {
        make: d.make.trim(), model: d.model.trim(), trim: d.trim.trim(), year: Number(d.year), color: d.color.trim(),
        condition: d.condition, bodyType: d.bodyType, fuel: d.fuel, transmission: d.transmission, vin: d.vin,
        mileage: num(d.mileage), plate: d.plate.trim(), branch: d.branch, supplierId: d.supplierId || "",
        purchaseDate: d.purchaseDate, costPrice: num(d.costPrice), salePrice: num(d.salePrice), minPrice: num(d.minPrice), notes: d.notes.trim(),
      };
      if (c) {
        const changes = [];
        if (c.salePrice !== clean.salePrice) changes.push(["price", `من ${moneyTxt(c.salePrice)} إلى ${moneyTxt(clean.salePrice)}`, clean.salePrice]);
        if (c.branch !== clean.branch) changes.push(["transfer", `من ${c.branch} إلى ${clean.branch}`, null]);
        const fieldsChanged = Object.keys(clean).filter((k) => !["salePrice", "branch"].includes(k) && String(c[k] ?? "") !== String(clean[k] ?? ""));
        Object.assign(c, clean);
        changes.forEach(([t, txt, amt]) => logMove(t, c, txt, amt));
        if (fieldsChanged.length) logMove("edit", c, `تعديل ${fieldsChanged.length} حقل`);
        toast("تم حفظ التعديلات");
        refresh();
        openCar(c.id);
      } else {
        const car = { id: uid(), stockNo: await nextStockNo(), ...clean, status: d.status || "available", reservation: null, createdAt: today(), soldDate: null };
        if (car.status === "maintenance") car.maintenanceSince = today();
        db.cars.push(car);
        const sup = supplierById(car.supplierId);
        logMove("purchase", car, sup ? `شراء من ${sup.name}` : "إضافة للمخزون", car.costPrice);
        toast(`تمت إضافة السيارة برقم ${car.stockNo}`);
        refresh();
      }
    },
  });
}

/* ---------- نموذج البيع ---------- */
function sellForm(id) {
  const sellable = db.cars.filter((c) => c.status === "available" || c.status === "reserved");
  const sellers = [...new Set([...db.settings.sellers, ...(CLOUD ? profiles.filter((p) => p.active).map((p) => p.full_name).filter(Boolean) : [])])];
  const meName = CLOUD && me ? me.full_name : db.settings.currentUser;
  if (!sellable.length) { toast("لا توجد سيارات متاحة للبيع", "warn"); return; }
  const c = id ? carById(id) : null;
  const vat = num(db.settings.vatRate);

  modal({
    title: "تسجيل عملية بيع",
    submit: "إتمام البيع وإصدار الفاتورة",
    body: `
      <div class="form-section">السيارة</div>
      <div class="form-grid cols-2">
        ${field(req("السيارة"), `<select class="select" name="carId" required ${c ? "disabled" : ""}>${opts(sellable.map((x) => [x.id, `${x.stockNo} — ${carName(x)} — ${moneyTxt(x.salePrice)}${x.status === "reserved" ? " (محجوزة)" : ""}`]), c ? c.id : "", c ? "" : "— اختر السيارة —")}</select>${c ? `<input type="hidden" name="carId" value="${c.id}">` : ""}`, "span-2")}
        ${field(req("سعر البيع قبل الضريبة (ر.س)"), `<input class="input" type="number" min="0" step="100" name="price" required value="${c ? esc(c.salePrice) : ""}">`)}
        ${field(req("تاريخ البيع"), `<input class="input" type="date" name="date" required value="${today()}">`)}
      </div>
      <div class="form-section">العميل</div>
      <div class="form-grid">
        ${field(req("اسم العميل"), `<input class="input" name="customer" required value="${c && c.reservation ? esc(c.reservation.customer) : ""}">`)}
        ${field(req("الجوال"), `<input class="input" name="phone" dir="ltr" required value="${c && c.reservation ? esc(c.reservation.phone) : ""}">`)}
        ${field("رقم الهوية / الإقامة", `<input class="input" name="idNo" dir="ltr">`)}
      </div>
      <div class="form-section">الدفع</div>
      <div class="form-grid">
        ${field("طريقة الدفع", `<select class="select" name="paymentMethod">${opts(Object.entries(PAYMENT), "cash")}</select>`)}
        ${field("جهة التمويل", `<select class="select" name="bank">${opts(BANKS, "", "—")}</select>`, "bank-field")}
        ${field("الدفعة المقدمة", `<input class="input" type="number" min="0" step="100" name="downPayment" value="${c && c.reservation ? esc(c.reservation.deposit) : 0}">`, "bank-field", c && c.reservation ? "يشمل عربون الحجز" : "")}
        ${field("البائع", `<select class="select" name="seller">${opts(sellers, sellers.includes(meName) ? meName : sellers[0])}</select>`)}
        ${field("ملاحظات", `<input class="input" name="note">`, "span-2")}
      </div>
      <div id="saleSummary"></div>`,
    onInput: (form) => {
      const car = carById(form.carId.value || (c && c.id));
      const finance = ["finance", "installment"].includes(form.paymentMethod.value);
      $$(".bank-field", form).forEach((f) => (f.style.display = finance ? "" : "none"));
      if (!car) { $("#saleSummary").innerHTML = ""; return; }
      if (!c && form.__lastCar !== car.id) { form.price.value = car.salePrice; form.__lastCar = car.id; if (car.reservation) { form.customer.value = car.reservation.customer; form.phone.value = car.reservation.phone; } }
      const price = num(form.price.value);
      const tc = totalCost(car);
      const v = price * vat / 100;
      const below = car.minPrice && price < car.minPrice;
      $("#saleSummary").innerHTML = `
        ${below ? `<div class="alert warn" style="margin:14px 0 0">${icon("alert")}<div>السعر أقل من الحد الأدنى المسموح (${moneyTxt(car.minPrice)}) — تأكد من موافقة الإدارة</div></div>` : ""}
        <div class="summary-box">
          <div class="summary-row"><span>السعر قبل الضريبة</span><b class="num">${moneyTxt(price)}</b></div>
          <div class="summary-row"><span>ضريبة القيمة المضافة ${vat}%</span><b class="num">${moneyTxt(v)}</b></div>
          <div class="summary-row total"><span>الإجمالي شامل الضريبة</span><b class="num">${moneyTxt(price + v)}</b></div>
          <div class="summary-row muted"><span>إجمالي تكلفة السيارة</span><span class="num">${moneyTxt(tc)}</span></div>
          <div class="summary-row"><span>صافي الربح</span><b class="num ${price - tc >= 0 ? "profit-pos" : "profit-neg"}">${moneyTxt(price - tc)} (${pct(marginPct(price, tc))})</b></div>
        </div>`;
    },
    onSubmit: async (d) => {
      const car = carById(d.carId);
      if (!car || !["available", "reserved"].includes(car.status)) { toast("السيارة لم تعد متاحة — حالتها تغيّرت (ربما بيعت من موظف آخر)", "error"); closeModal(); return false; }
      if (!(await stillAvailable(car.id))) return false;
      const finance = ["finance", "installment"].includes(d.paymentMethod);
      const sale = {
        id: uid(), carId: car.id, invoiceNo: await nextInvoiceNo(), date: d.date, price: num(d.price), vatRate: vat,
        paymentMethod: d.paymentMethod, bank: finance ? d.bank : "", downPayment: finance ? num(d.downPayment) : 0,
        customer: { name: d.customer.trim(), phone: d.phone.trim(), idNo: (d.idNo || "").trim() },
        seller: d.seller, note: (d.note || "").trim(),
      };
      db.sales.push(sale);
      car.status = "sold";
      car.soldDate = d.date;
      car.reservation = null;
      logMove("sale", car, `فاتورة ${sale.invoiceNo} — ${sale.customer.name}`, sale.price);
      toast(`تم البيع — فاتورة ${sale.invoiceNo}`);
      closeDrawer();
      refresh();
      setTimeout(() => printInvoice(sale.id), 250);
    },
  });
}

/* ---------- حجز ---------- */
function reserveForm(id) {
  const c = carById(id);
  modal({
    title: `حجز ${esc(carName(c))}`, size: "sm", submit: "تأكيد الحجز",
    body: `<div class="form-grid cols-2">
      ${field(req("اسم العميل"), `<input class="input" name="customer" required>`, "span-2")}
      ${field(req("الجوال"), `<input class="input" name="phone" dir="ltr" required>`)}
      ${field("العربون (ر.س)", `<input class="input" type="number" min="0" step="100" name="deposit" value="0">`)}
      ${field(req("الحجز ساري حتى"), `<input class="input" type="date" name="until" required value="${addDays(today(), 3)}">`)}
      ${field("ملاحظة", `<input class="input" name="note">`)}
    </div>`,
    onSubmit: async (d) => {
      if (!(await stillAvailable(c.id, ["available"]))) return false;
      c.status = "reserved";
      c.reservation = { customer: d.customer.trim(), phone: d.phone.trim(), deposit: num(d.deposit), until: d.until, date: today(), note: d.note.trim() };
      logMove("reserve", c, `حجز باسم ${c.reservation.customer} حتى ${fmtDate(d.until)}`, c.reservation.deposit || null);
      toast("تم حجز السيارة");
      refresh(); openCar(id);
    },
  });
}

function transferForm(id) {
  const c = carById(id);
  const others = db.settings.branches.filter((b) => b !== c.branch);
  if (!others.length) { toast("أضف فروعًا أخرى من الإعدادات أولًا", "warn"); return; }
  modal({
    title: "نقل السيارة لفرع آخر", size: "sm", submit: "تأكيد النقل",
    body: `<p class="muted" style="margin-bottom:12px">الموقع الحالي: <b>${esc(c.branch)}</b></p>
      ${field(req("النقل إلى"), `<select class="select" name="branch" required>${opts(others, "")}</select>`)}
      <div style="height:12px"></div>${field("ملاحظة", `<input class="input" name="note">`)}`,
    onSubmit: (d) => {
      logMove("transfer", c, `من ${c.branch} إلى ${d.branch}${d.note ? " — " + d.note.trim() : ""}`);
      c.branch = d.branch;
      toast("تم نقل السيارة");
      refresh(); openCar(id);
    },
  });
}

function maintenanceForm(id) {
  const c = carById(id);
  modal({
    title: "إرسال للصيانة", size: "sm", submit: "تأكيد",
    body: `${field(req("سبب الصيانة / الورشة"), `<input class="input" name="note" required placeholder="مثال: تغيير فحمات + تلميع — ورشة النخبة">`)}
      <p class="hint muted" style="margin-top:10px;font-size:.8rem">السيارة ستُخفى من المتاح للبيع حتى تعيدها "جاهزة للبيع". سجّل تكلفة الصيانة كمصروف.</p>`,
    onSubmit: (d) => {
      c.status = "maintenance"; c.maintenanceSince = today();
      logMove("maintenance", c, d.note.trim());
      toast("تم تحويل السيارة للصيانة");
      refresh(); openCar(id);
    },
  });
}

/* ---------- مصروف ---------- */
function expenseForm(carId) {
  const cars = db.cars.filter((c) => c.status !== "sold");
  if (!cars.length) { toast("لا توجد سيارات في المخزون", "warn"); return; }
  modal({
    title: "تسجيل مصروف على سيارة", size: "sm", submit: "حفظ المصروف",
    body: `<div class="form-grid cols-2">
      ${field(req("السيارة"), `<select class="select" name="carId" required>${opts(cars.map((c) => [c.id, `${c.stockNo} — ${carName(c)}`]), carId || "", "— اختر —")}</select>`, "span-2")}
      ${field(req("البند"), `<select class="select" name="category" required>${opts(EXPENSE_CATS, "")}</select>`)}
      ${field(req("المبلغ (ر.س)"), `<input class="input" type="number" min="1" step="10" name="amount" required>`)}
      ${field(req("التاريخ"), `<input class="input" type="date" name="date" required value="${today()}">`)}
      ${field("الوصف", `<input class="input" name="note">`)}
    </div>`,
    onSubmit: (d) => {
      if (num(d.amount) <= 0) { toast("أدخل مبلغًا صحيحًا", "error"); return false; }
      const c = carById(d.carId);
      db.expenses.push({ id: uid(), carId: c.id, date: d.date, category: d.category, amount: num(d.amount), note: d.note.trim(), user: db.settings.currentUser });
      logMove("expense", c, `${d.category}${d.note ? " — " + d.note.trim() : ""}`, num(d.amount));
      toast("تم تسجيل المصروف وتحميله على تكلفة السيارة");
      refresh();
      if ($("#drawerOverlay").classList.contains("open")) openCar(c.id);
    },
  });
}

/* ---------- مورد ---------- */
function supplierForm(id) {
  const s = id ? supplierById(id) : {};
  modal({
    title: id ? "تعديل مورد" : "إضافة مورد", size: "sm",
    body: `<div class="form-grid cols-2">
      ${field(req("اسم المورد"), `<input class="input" name="name" required value="${esc(s.name)}">`, "span-2")}
      ${field("النوع", `<select class="select" name="type">${opts(SUP_TYPES, s.type)}</select>`)}
      ${field("الجوال", `<input class="input" name="phone" dir="ltr" value="${esc(s.phone)}">`)}
      ${field("المدينة", `<input class="input" name="city" value="${esc(s.city)}">`)}
      ${field("ملاحظات", `<input class="input" name="note" value="${esc(s.note)}">`)}
    </div>`,
    onSubmit: (d) => {
      const clean = { name: d.name.trim(), type: d.type, phone: d.phone.trim(), city: d.city.trim(), note: d.note.trim() };
      if (id) Object.assign(s, clean); else db.suppliers.push({ id: uid(), ...clean });
      toast("تم حفظ المورد");
      refresh();
    },
  });
}

/* ---------------- المبيعات ---------------- */
function salesInPeriod(period) {
  const t = today();
  return db.sales.filter((s) => {
    if (period === "month") return s.date.slice(0, 7) === t.slice(0, 7);
    if (period === "3m") return s.date >= addDays(t, -90);
    if (period === "year") return s.date.slice(0, 4) === t.slice(0, 4);
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.invoiceNo.localeCompare(a.invoiceNo));
}

function renderSales() {
  const list = salesInPeriod($("#salesPeriod").value);
  const rows = list.map((s) => { const c = carById(s.carId); const tc = c ? totalCost(c) : 0; return { s, c, tc, profit: num(s.price) - tc }; });
  const rev = rows.reduce((a, r) => a + num(r.s.price), 0);
  const profit = rows.reduce((a, r) => a + r.profit, 0);
  const fin = rows.filter((r) => r.s.paymentMethod === "finance").length;
  $("#salesKpis").innerHTML = [
    kpi("عدد السيارات المباعة", fmt(rows.length), "خلال الفترة المحددة", "tone-gold", "car"),
    kpi("إجمالي المبيعات", money(rev), `ضريبة مستحقة ${moneyTxt(rows.reduce((a, r) => a + num(r.s.price) * num(r.s.vatRate) / 100, 0))}`, "tone-blue", "money"),
    kpi("صافي الربح", money(profit), `متوسط الهامش ${pct(marginPct(rev, rev - profit))}`, "tone-green", "trend"),
    kpi("نسبة البيع بالتمويل", rows.length ? pct((fin / rows.length) * 100) : "—", `${fin} عملية عبر جهات تمويل`, "tone-purple", "wallet"),
  ].join("");
  $("#salesBody").innerHTML = rows.length ? rows.map(({ s, c, tc, profit }) => `
    <tr>
      <td class="mono">${esc(s.invoiceNo)}</td>
      <td>${fmtDate(s.date)}</td>
      <td>${c ? `<a href="#" data-open-car="${c.id}"><div class="car-cell"><b>${esc(carName(c))}</b><small class="mono">${esc(c.stockNo)}</small></div></a>` : "—"}</td>
      <td><div class="car-cell"><b>${esc(s.customer.name)}</b><small dir="ltr" style="text-align:right">${esc(s.customer.phone)}</small></div></td>
      <td>${PAYMENT[s.paymentMethod] || "—"}${s.bank ? `<br><small class="muted">${esc(s.bank)}</small>` : ""}</td>
      <td>${esc(s.seller || "—")}</td>
      <td class="num"><b>${fmt(s.price)}</b></td>
      <td class="num muted">${fmt(tc)}</td>
      <td class="num ${profit >= 0 ? "profit-pos" : "profit-neg"}">${fmt(profit)}</td>
      <td class="actions" style="display:flex;gap:2px">
        <button class="btn-icon" title="طباعة الفاتورة" data-action="invoice" data-id="${s.id}">${icon("print")}</button>
        <button class="btn-icon admin-only" title="إلغاء البيع (مرتجع)" data-action="cancel-sale" data-id="${s.id}">${icon("undo")}</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="10"><div class="empty">${icon("money")}<div>لا توجد مبيعات في هذه الفترة</div></div></td></tr>`;
}

/* ---------------- المصاريف ---------------- */
function renderExpenses() {
  const list = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date));
  const t = today();
  const month = list.filter((e) => e.date.slice(0, 7) === t.slice(0, 7));
  const byCat = {};
  list.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + num(e.amount)));
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const stockIds = new Set(db.cars.filter((c) => IN_STOCK.includes(c.status)).map((c) => c.id));
  const onStock = list.filter((e) => stockIds.has(e.carId)).reduce((s, e) => s + num(e.amount), 0);
  $("#expKpis").innerHTML = [
    kpi("مصاريف هذا الشهر", money(month.reduce((s, e) => s + num(e.amount), 0)), `${month.length} عملية`, "tone-red", "tool"),
    kpi("محمّلة على المخزون الحالي", money(onStock), "تُضاف لتكلفة السيارات غير المباعة", "tone-orange", "box"),
    kpi("أعلى بند صرف", topCat ? esc(topCat[0]) : "—", topCat ? moneyTxt(topCat[1]) + " إجمالًا" : "", "tone-gold", "trend"),
  ].join("");
  $("#expBody").innerHTML = list.length ? list.slice(0, 300).map((e) => {
    const c = carById(e.carId);
    return `<tr>
      <td>${fmtDate(e.date)}</td>
      <td>${c ? `<a href="#" data-open-car="${c.id}"><div class="car-cell"><b>${esc(carName(c))}</b><small class="mono">${esc(c.stockNo)}</small></div></a>` : "—"}</td>
      <td>${esc(e.category)}</td>
      <td class="muted">${esc(e.note || "—")}</td>
      <td class="num"><b>${fmt(e.amount)}</b></td>
      <td>${esc(e.user || "—")}</td>
      <td class="actions">${c && c.status !== "sold" ? `<button class="btn-icon admin-only" title="حذف" data-action="delete-expense" data-id="${e.id}">${icon("trash")}</button>` : ""}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="7"><div class="empty">${icon("tool")}<div>لا توجد مصاريف مسجلة</div></div></td></tr>`;
}

/* ---------------- الحركات ---------------- */
function renderMovements() {
  const sel = $("#movType");
  if (sel.options.length <= 1) sel.innerHTML += Object.entries(MOVE).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  const type = sel.value;
  const list = db.movements.filter((m) => !type || m.type === type).slice(0, 400);
  $("#movBody").innerHTML = list.length ? list.map((m) => {
    const t = MOVE[m.type] || MOVE.edit;
    const c = m.carId && carById(m.carId);
    return `<tr>
      <td class="num">${fmtDateTime(m.ts)}</td>
      <td><span class="badge no-dot ${t.tone}">${t.label}</span></td>
      <td>${c ? `<a href="#" data-open-car="${c.id}">${esc(m.carLabel)}</a>` : esc(m.carLabel)}</td>
      <td class="muted" style="white-space:normal;min-width:200px">${esc(m.detail)}</td>
      <td class="num">${m.amount ? fmt(m.amount) : "—"}</td>
      <td>${esc(m.user)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6"><div class="empty">لا توجد حركات</div></td></tr>`;
}

/* ---------------- الموردون ---------------- */
function renderSuppliers() {
  $("#supBody").innerHTML = db.suppliers.length ? db.suppliers.map((s) => {
    const cars = db.cars.filter((c) => c.supplierId === s.id);
    const total = cars.reduce((a, c) => a + num(c.costPrice), 0);
    const inStock = cars.filter((c) => IN_STOCK.includes(c.status)).length;
    return `<tr>
      <td><div class="car-cell"><b>${esc(s.name)}</b><small>${esc(s.note || "")}</small></div></td>
      <td><span class="badge no-dot tone-gold">${esc(s.type)}</span></td>
      <td class="mono" dir="ltr" style="text-align:right">${esc(s.phone || "—")}</td>
      <td>${esc(s.city || "—")}</td>
      <td class="num">${cars.length}</td>
      <td class="num">${moneyTxt(total)}</td>
      <td class="num">${inStock}</td>
      <td class="actions" style="display:flex;gap:2px">
        <button class="btn-icon" title="تعديل" data-action="edit-supplier" data-id="${s.id}">${icon("edit")}</button>
        <button class="btn-icon admin-only" title="حذف" data-action="delete-supplier" data-id="${s.id}">${icon("trash")}</button>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="8"><div class="empty">لا يوجد موردون — أضف أول مورد</div></td></tr>`;
}

/* ---------------- التقارير ---------------- */
function hbars(items, fmtVal, color) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return items.map((i) => `<div class="hbar-row"><span>${esc(i.l)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${(i.v / max) * 100}%;${color ? `background:${typeof color === "function" ? color(i) : color}` : ""}"></div></div><span class="num">${fmtVal(i)}</span></div>`).join("");
}

function renderReports() {
  const stock = db.cars.filter((c) => IN_STOCK.includes(c.status));
  const buckets = [["0 - 30 يوم", 0, 30, "var(--success)"], ["31 - 60 يوم", 31, 60, "var(--gold)"], ["61 - 90 يوم", 61, 90, "var(--warning)"], ["أكثر من 90", 91, 1e9, "var(--danger)"]];
  $("#agingReport").innerHTML = hbars(buckets.map(([l, a, b, col]) => { const cs = stock.filter((c) => { const d = daysInStock(c); return d >= a && d <= b; }); return { l, v: cs.length, cost: cs.reduce((s, c) => s + totalCost(c), 0), col }; }), (i) => `${i.v} · ${fmt(i.cost)}`, (i) => i.col);

  $("#branchReport").innerHTML = hbars(db.settings.branches.map((b) => { const cs = stock.filter((c) => c.branch === b); return { l: b, v: cs.reduce((s, c) => s + totalCost(c), 0), n: cs.length }; }), (i) => `${i.n} · ${fmt(i.v)}`);

  const makes = {};
  db.cars.forEach((c) => {
    const m = (makes[c.make] ||= { stock: 0, sold: 0, rev: 0, profit: 0, days: 0 });
    if (IN_STOCK.includes(c.status)) m.stock++;
    const s = c.status === "sold" && saleByCar(c.id);
    if (s) { m.sold++; m.rev += num(s.price); m.profit += num(s.price) - totalCost(c); m.days += daysInStock(c); }
  });
  $("#makeReport").innerHTML = Object.entries(makes).sort((a, b) => b[1].profit - a[1].profit).map(([k, m]) => `
    <tr><td><b>${esc(k)}</b></td><td class="num">${m.stock}</td><td class="num">${m.sold}</td><td class="num">${fmt(m.rev)}</td>
    <td class="num ${m.profit >= 0 ? "profit-pos" : "profit-neg"}">${fmt(m.profit)}</td><td class="num">${m.rev ? pct(marginPct(m.rev, m.rev - m.profit)) : "—"}</td><td class="num">${m.sold ? Math.round(m.days / m.sold) + " يوم" : "—"}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">لا توجد بيانات</td></tr>`;

  const sellers = {};
  db.sales.forEach((s) => { const c = carById(s.carId); const x = (sellers[s.seller || "—"] ||= { n: 0, rev: 0, profit: 0 }); x.n++; x.rev += num(s.price); x.profit += num(s.price) - (c ? totalCost(c) : 0); });
  $("#sellerReport").innerHTML = Object.entries(sellers).sort((a, b) => b[1].rev - a[1].rev).map(([k, x]) => `<tr><td><b>${esc(k)}</b></td><td class="num">${x.n}</td><td class="num">${fmt(x.rev)}</td><td class="num profit-pos">${fmt(x.profit)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">لا توجد مبيعات</td></tr>`;
}

/* ---------------- الإعدادات ---------------- */
function renderSettings() {
  const f = $("#settingsForm");
  ["companyName", "vatNumber", "crNumber", "vatRate", "agingDays", "minMargin", "currentUser", "address"].forEach((k) => (f[k].value = db.settings[k] ?? ""));
  if (CLOUD && me) f.currentUser.value = me.full_name || "";
  $("#branchTags").innerHTML = db.settings.branches.map((b) => `<span class="tag">${esc(b)}<button title="حذف" data-action="remove-branch" data-id="${esc(b)}">×</button></span>`).join("");
  $("#sellerTags").innerHTML = db.settings.sellers.map((b) => `<span class="tag">${esc(b)}<button title="حذف" data-action="remove-seller" data-id="${esc(b)}">×</button></span>`).join("");
  const size = new Blob([JSON.stringify(db)]).size;
  $("#storageInfo").textContent = `${CLOUD ? "قاعدة البيانات: " : ""}${db.cars.length} سيارة · ${db.sales.length} فاتورة · ${db.movements.length} حركة · حجم البيانات ${(size / 1024).toFixed(0)} KB`;
}

/* ---------------- طباعة ---------------- */
function printHTML(html) {
  $("#printArea").innerHTML = html;
  setTimeout(() => window.print(), 50);
}

function printInvoice(saleId) {
  const s = db.sales.find((x) => x.id === saleId);
  if (!s) return;
  const c = carById(s.carId) || {};
  const st = db.settings;
  const vat = num(s.price) * num(s.vatRate) / 100;
  printHTML(`<div class="inv">
    <div class="inv-head">
      <div><h1>${esc(st.companyName)}</h1><div>${esc(st.address)}</div><div>الرقم الضريبي: ${esc(st.vatNumber)} · س.ت: ${esc(st.crNumber)}</div></div>
      <div class="inv-title"><h2>فاتورة ضريبية</h2><div>رقم: <b>${esc(s.invoiceNo)}</b></div><div>التاريخ: ${fmtDate(s.date)}</div></div>
    </div>
    <div class="inv-grid">
      <div class="inv-box"><h4>بيانات العميل</h4><div><b>${esc(s.customer.name)}</b></div><div>الجوال: ${esc(s.customer.phone)}</div>${s.customer.idNo ? `<div>الهوية: ${esc(s.customer.idNo)}</div>` : ""}</div>
      <div class="inv-box"><h4>الدفع</h4><div>${PAYMENT[s.paymentMethod] || ""}${s.bank ? ` — ${esc(s.bank)}` : ""}</div>${s.downPayment ? `<div>الدفعة المقدمة: ${moneyTxt(s.downPayment)}</div>` : ""}<div>البائع: ${esc(s.seller || "")}</div></div>
    </div>
    <table>
      <thead><tr><th>الوصف</th><th>رقم الهيكل</th><th>اللون</th><th>الممشى</th><th>السعر</th></tr></thead>
      <tbody><tr><td><b>${esc(carName(c))}</b><br>${c.condition === "new" ? "جديد" : "مستعمل"} · رقم المخزون ${esc(c.stockNo || "")}${c.plate ? ` · لوحة ${esc(c.plate)}` : ""}</td><td>${esc(c.vin || "—")}</td><td>${esc(c.color || "")}</td><td>${fmt(c.mileage || 0)} كم</td><td>${moneyTxt(s.price)}</td></tr></tbody>
    </table>
    <table class="totals">
      <tr><td>المجموع قبل الضريبة</td><td>${moneyTxt(s.price)}</td></tr>
      <tr><td>ضريبة القيمة المضافة ${num(s.vatRate)}%</td><td>${moneyTxt(vat)}</td></tr>
      <tr><td>الإجمالي المستحق</td><td><b>${moneyTxt(num(s.price) + vat)}</b></td></tr>
    </table>
    ${s.note ? `<p>ملاحظات: ${esc(s.note)}</p>` : ""}
    <div class="sign"><div>توقيع العميل</div><div>ختم وتوقيع المعرض</div></div>
    <div class="foot-note">شكرًا لتعاملكم مع ${esc(st.companyName)}</div>
  </div>`);
}

function printCarCard(id) {
  const c = carById(id);
  const st = db.settings;
  printHTML(`<div class="inv" style="text-align:center">
    <div class="inv-head" style="justify-content:center"><h1>${esc(st.companyName)}</h1></div>
    <h1 style="font-size:34px;margin:20px 0 6px">${esc(c.make)} ${esc(c.model)}</h1>
    <h2 style="font-size:22px;color:#666">${esc(c.trim || "")} · ${esc(c.year)}</h2>
    <div style="font-size:46px;font-weight:800;color:#a87c1f;margin:28px 0">${moneyTxt(c.salePrice)}</div>
    <div style="font-size:13px;color:#666;margin-bottom:24px">السعر غير شامل ضريبة القيمة المضافة</div>
    <table style="max-width:520px;margin:0 auto 20px"><tbody>
      <tr><td>الحالة</td><td>${c.condition === "new" ? "جديد" : "مستعمل"}</td></tr>
      <tr><td>اللون</td><td>${esc(c.color || "—")}</td></tr>
      <tr><td>الممشى</td><td>${fmt(c.mileage)} كم</td></tr>
      <tr><td>ناقل الحركة</td><td>${esc(c.transmission || "—")}</td></tr>
      <tr><td>الوقود</td><td>${esc(c.fuel || "—")}</td></tr>
      <tr><td>رقم المخزون</td><td>${esc(c.stockNo)}</td></tr>
    </tbody></table>
    <div style="font-size:16px">التمويل متاح — اسأل فريق المبيعات</div>
  </div>`);
}

function printStockSheet() {
  const stock = db.cars.filter((c) => IN_STOCK.includes(c.status)).sort((a, b) => a.branch.localeCompare(b.branch, "ar") || a.stockNo.localeCompare(b.stockNo));
  const st = db.settings;
  printHTML(`<div class="inv">
    <div class="inv-head"><div><h1>${esc(st.companyName)}</h1><div>كشف جرد المخزون</div></div><div class="inv-title"><h2>${stock.length} سيارة</h2><div>${fmtDate(today())}</div></div></div>
    <table><thead><tr><th>#</th><th>رقم المخزون</th><th>السيارة</th><th>رقم الهيكل</th><th>الفرع</th><th>الحالة</th><th>أيام</th><th>التكلفة</th><th>سعر البيع</th><th>✓</th></tr></thead>
    <tbody>${stock.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.stockNo)}</td><td>${esc(carName(c))} — ${esc(c.color || "")}</td><td style="font-family:monospace">${esc(c.vin || "")}</td><td>${esc(c.branch)}</td><td>${STATUS[c.status].label}</td><td>${daysInStock(c)}</td><td>${fmt(totalCost(c))}</td><td>${fmt(c.salePrice)}</td><td></td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="7"><b>الإجمالي</b></td><td><b>${fmt(stock.reduce((s, c) => s + totalCost(c), 0))}</b></td><td><b>${fmt(stock.reduce((s, c) => s + num(c.salePrice), 0))}</b></td><td></td></tr></tfoot></table>
    <div class="sign"><div>أمين المخزون</div><div>المدير</div></div>
  </div>`);
}

/* ---------------- تصدير ---------------- */
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
function exportInventory() {
  const rows = (invState.lastRows || []).map(({ c, tc, price, margin, days }) => [c.stockNo, c.make, c.model, c.trim, c.year, c.color, c.condition === "new" ? "جديد" : "مستعمل", c.vin, c.plate, c.mileage, c.branch, (supplierById(c.supplierId) || {}).name || "", c.purchaseDate, c.costPrice, tc - c.costPrice, tc, price, Math.round(price - tc), margin.toFixed(1), days, STATUS[c.status].label]);
  downloadFile(`مخزون-رواد-الاعتماد-${today()}.csv`, toCSV(["رقم المخزون", "الماركة", "الموديل", "الفئة", "السنة", "اللون", "الحالة", "رقم الهيكل", "اللوحة", "الممشى", "الفرع", "المورد", "تاريخ الشراء", "سعر الشراء", "المصاريف", "إجمالي التكلفة", "سعر البيع", "الربح", "الهامش %", "أيام بالمخزون", "حالة السيارة"], rows), "text/csv;charset=utf-8");
  toast(`تم تصدير ${rows.length} سيارة`);
}
function exportSales() {
  const list = salesInPeriod($("#salesPeriod").value);
  const rows = list.map((s) => { const c = carById(s.carId) || {}; const tc = c.id ? totalCost(c) : 0; return [s.invoiceNo, s.date, c.stockNo, carName(c), c.vin, s.customer.name, s.customer.phone, s.customer.idNo, PAYMENT[s.paymentMethod], s.bank, s.seller, s.price, Math.round(s.price * s.vatRate / 100), Math.round(s.price * (1 + s.vatRate / 100)), tc, Math.round(s.price - tc)]; });
  downloadFile(`مبيعات-رواد-الاعتماد-${today()}.csv`, toCSV(["رقم الفاتورة", "التاريخ", "رقم المخزون", "السيارة", "رقم الهيكل", "العميل", "الجوال", "الهوية", "طريقة الدفع", "جهة التمويل", "البائع", "السعر قبل الضريبة", "الضريبة", "الإجمالي", "التكلفة", "صافي الربح"], rows), "text/csv;charset=utf-8");
  toast(`تم تصدير ${rows.length} عملية بيع`);
}

/* ---------------- Toast ---------------- */
function toast(msg, type = "ok") {
  const t = document.createElement("div");
  t.className = `toast ${type === "ok" ? "" : type}`;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 3200);
}

/* ---------------- الأحداث ---------------- */
const ACTIONS = {
  "add-car": () => carForm(),
  "edit-car": (id) => carForm(id),
  "delete-car": (id) => {
    const c = carById(id);
    confirmBox("حذف السيارة", `هل أنت متأكد من حذف <b>${esc(carName(c))}</b> (${esc(c.stockNo)}) نهائيًا مع مصاريفها؟ لا يمكن التراجع.`, () => {
      logMove("delete", c, "حذف نهائي من النظام", null);
      db.cars = db.cars.filter((x) => x.id !== id);
      db.expenses = db.expenses.filter((e) => e.carId !== id);
      closeDrawer(); toast("تم حذف السيارة"); refresh();
    }, "حذف نهائي");
  },
  sell: (id) => sellForm(id),
  "sell-quick": () => sellForm(),
  reserve: (id) => reserveForm(id),
  unreserve: (id) => {
    const c = carById(id);
    confirmBox("إلغاء الحجز", `إلغاء حجز <b>${esc(c.reservation?.customer || "")}</b> وإعادة السيارة للمتاح؟${c.reservation?.deposit ? `<br><span class="muted">تذكير: العربون ${moneyTxt(c.reservation.deposit)}</span>` : ""}`, () => {
      logMove("unreserve", c, `إلغاء حجز ${c.reservation?.customer || ""}`);
      c.status = "available"; c.reservation = null;
      toast("تم إلغاء الحجز"); refresh(); openCar(id);
    });
  },
  maintenance: (id) => maintenanceForm(id),
  ready: (id) => {
    const c = carById(id);
    logMove("ready", c, c.status === "transit" ? "تم استلام السيارة في المعرض" : `خرجت من الصيانة بعد ${daysBetween(c.maintenanceSince || today(), today())} يوم`);
    c.status = "available"; delete c.maintenanceSince;
    toast("السيارة متاحة للبيع الآن"); refresh(); openCar(id);
  },
  transfer: (id) => transferForm(id),
  "add-expense": (id) => expenseForm(id),
  "delete-expense": (id) => {
    const e = db.expenses.find((x) => x.id === id);
    confirmBox("حذف المصروف", `حذف مصروف "${esc(e.category)}" بمبلغ ${moneyTxt(e.amount)}؟`, () => {
      db.expenses = db.expenses.filter((x) => x.id !== id);
      const c = carById(e.carId);
      if (c) logMove("edit", c, `حذف مصروف ${e.category} (${moneyTxt(e.amount)})`);
      toast("تم حذف المصروف"); refresh();
    }, "حذف");
  },
  invoice: (id) => printInvoice(id),
  "cancel-sale": (id) => {
    const s = db.sales.find((x) => x.id === id);
    const c = carById(s.carId);
    confirmBox("إلغاء البيع / مرتجع", `سيتم إلغاء الفاتورة <b>${esc(s.invoiceNo)}</b> وإعادة السيارة للمخزون كمتاحة للبيع. متأكد؟`, () => {
      db.sales = db.sales.filter((x) => x.id !== id);
      if (c) { c.status = "available"; c.soldDate = null; logMove("return", c, `إلغاء الفاتورة ${s.invoiceNo} — ${s.customer.name}`, -num(s.price)); }
      toast("تم إلغاء البيع وإعادة السيارة للمخزون"); refresh();
    }, "إلغاء البيع");
  },
  "print-card": (id) => printCarCard(id),
  "print-stock": () => printStockSheet(),
  "add-supplier": () => supplierForm(),
  "edit-supplier": (id) => supplierForm(id),
  "delete-supplier": (id) => {
    const s = supplierById(id);
    const used = db.cars.some((c) => c.supplierId === id);
    confirmBox("حذف المورد", `حذف <b>${esc(s.name)}</b>؟${used ? "<br><span class='muted'>السيارات المرتبطة به ستبقى بدون مورد.</span>" : ""}`, () => {
      db.suppliers = db.suppliers.filter((x) => x.id !== id);
      db.cars.forEach((c) => { if (c.supplierId === id) c.supplierId = ""; });
      toast("تم حذف المورد"); refresh();
    }, "حذف");
  },
  "export-inventory": () => exportInventory(),
  "export-sales": () => exportSales(),
  "remove-branch": (name) => {
    if (db.cars.some((c) => c.branch === name && c.status !== "sold")) { toast("لا يمكن حذف فرع فيه سيارات — انقلها أولًا", "error"); return; }
    if (db.settings.branches.length <= 1) { toast("يجب وجود فرع واحد على الأقل", "error"); return; }
    db.settings.branches = db.settings.branches.filter((b) => b !== name); refresh();
  },
  "remove-seller": (name) => { db.settings.sellers = db.settings.sellers.filter((b) => b !== name); refresh(); },
  backup: () => { downloadFile(`نسخة-احتياطية-مخزون-${today()}.json`, JSON.stringify(db, null, 1), "application/json"); toast("تم تحميل النسخة الاحتياطية"); },
  demo: () => confirmBox("تحميل بيانات تجريبية", `سيتم <b>استبدال كل البيانات الحالية</b> ببيانات تجريبية${CLOUD ? " <b>لكل الموظفين</b>" : ""}. خذ نسخة احتياطية أولًا إذا كانت لديك بيانات حقيقية.`, async () => {
    const demo = seedDemoWithTimes();
    if (CLOUD) { demo.settings = { ...db.settings, branches: demo.settings.branches, sellers: demo.settings.sellers }; await replaceCloudData(demo); }
    else { db = demo; refresh(); }
    toast("تم تحميل البيانات التجريبية");
  }, "استبدال البيانات"),
  wipe: () => confirmBox("مسح كل البيانات", `سيتم مسح <b>كل السيارات والمبيعات والمصاريف والحركات</b> نهائيًا${CLOUD ? " من قاعدة البيانات لكل الموظفين" : ""} مع الإبقاء على الإعدادات. لا يمكن التراجع.`, async () => {
    if (CLOUD) { await syncChain; const { error } = await sb.rpc("wipe_inventory"); if (error) throw error; await reloadCloud(); }
    else { const s = db.settings; db = defaultDB(); db.settings = s; refresh(); }
    toast("تم مسح البيانات", "warn");
  }, "مسح نهائي"),
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
};

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-close-modal]")) return closeModal();
  if (t.closest("[data-close]")) return closeDrawer();
  if (t.id === "modalOverlay") return closeModal();
  if (t.id === "drawerOverlay") return closeDrawer();

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
  const goto = t.closest("[data-goto]");
  if (goto) return go(goto.dataset.goto);

  const fs = t.closest("[data-filter-status]");
  if (fs) { invState.status = fs.dataset.filterStatus; invState.page = 1; return go("inventory"); }

  const oc = t.closest("[data-open-car]");
  if (oc) { e.preventDefault(); return openCar(oc.dataset.openCar); }

  const chip = t.closest("[data-chip]");
  if (chip) { invState.status = chip.dataset.chip; invState.page = 1; return renderInventory(); }

  const th = t.closest("th.sortable");
  if (th) { const k = th.dataset.sort; invState.dir = invState.sort === k ? -invState.dir : (k === "name" || k === "stockNo" ? 1 : -1); invState.sort = k; return renderInventory(); }

  const pn = t.closest("[data-page-nav]");
  if (pn) { invState.page += Number(pn.dataset.pageNav); renderInventory(); $(".table-wrap", $("#page-inventory")).scrollIntoView({ behavior: "smooth" }); }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if ($("#modalOverlay").classList.contains("open")) closeModal(); else if ($("#drawerOverlay").classList.contains("open")) closeDrawer(); else closeSidebar(); }
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("#globalSearch").focus(); }
});

let searchTimer;
$("#invSearch").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { invState.q = e.target.value; invState.page = 1; renderInventory(); }, 150); });
$("#globalSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  invState.q = e.target.value; invState.status = "all"; invState.page = 1;
  go("inventory");
  const rows = invState.lastRows || [];
  if (rows.length === 1) openCar(rows[0].c.id);
});
[["#fMake", "make"], ["#fBranch", "branch"], ["#fCondition", "condition"], ["#fAge", "age"]].forEach(([sel, k]) => $(sel).addEventListener("change", (e) => { invState[k] = e.target.value; invState.page = 1; renderInventory(); }));
$("#salesPeriod").addEventListener("change", renderSales);
$("#movType").addEventListener("change", renderMovements);

$("#settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin()) return toast("هذه العملية متاحة للمدير فقط", "warn");
  const d = Object.fromEntries(new FormData(e.target).entries());
  Object.assign(db.settings, {
    companyName: d.companyName.trim() || db.settings.companyName,
    vatNumber: d.vatNumber.trim(), crNumber: d.crNumber.trim(), address: d.address.trim(),
    vatRate: num(d.vatRate), agingDays: Math.max(1, num(d.agingDays) || 90), minMargin: num(d.minMargin),
    currentUser: CLOUD ? db.settings.currentUser : d.currentUser.trim() || "مدير النظام",
  });
  toast("تم حفظ الإعدادات"); refresh();
});
$("#branchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin()) return;
  const v = e.target.branch.value.trim();
  if (!v || db.settings.branches.includes(v)) return toast("الفرع موجود مسبقًا", "warn");
  db.settings.branches.push(v); e.target.reset(); refresh();
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
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.cars) || !data.settings) throw new Error("bad");
      if (!isAdmin()) throw new Error("admin");
      confirmBox("استيراد نسخة احتياطية", `الملف يحتوي على <b>${data.cars.length}</b> سيارة و<b>${(data.sales || []).length}</b> فاتورة. سيتم استبدال البيانات الحالية بالكامل${CLOUD ? " لكل الموظفين" : ""}.`, async () => {
        if (CLOUD) { await replaceCloudData(data); toast("تم استيراد البيانات بنجاح"); return; }
        const base = defaultDB();
        db = { ...base, ...data, settings: { ...base.settings, ...data.settings }, counters: { ...base.counters, ...data.counters } };
        ["suppliers", "expenses", "sales", "movements"].forEach((k) => { if (!Array.isArray(db[k])) db[k] = []; });
        toast("تم استيراد البيانات بنجاح"); refresh();
      }, "استيراد");
    } catch (err) {
      toast("الملف غير صالح — اختر ملف نسخة احتياطية صحيح", "error");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});

$("#menuBtn").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("open"); });
$("#scrim").addEventListener("click", closeSidebar);
$("#userChip").addEventListener("click", () => (CLOUD ? accountMenu() : isAdmin() && go("settings")));
window.addEventListener("storage", (e) => { if (!CLOUD && e.key === STORE_KEY) { db = load() || db; PAGES[currentPage].render(); renderChrome(); } });

/* ---------------- تشغيل ---------------- */
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
  if (!db) { db = seedDemoWithTimes(); save(); setTimeout(() => toast("تم تحميل بيانات تجريبية للتجربة — امسحها من الإعدادات عند البدء الفعلي", "warn"), 400); }
  renderChrome();
  go(location.hash.slice(1) || "dashboard");
}

})();
