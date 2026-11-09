/* ===========================================================
   إدارة العملاء (CRM) — معرض رواد الاعتماد
   رحلة العميل: ليد جديد ← تواصل ← تأهيل ← حسبة ← أوراق ← بنك ← تفاوض ← بيع
   نظام مستقل — يعتمد على واجهة window.RW من core.js (التخزين، الدخول، والمزامنة)
   =========================================================== */
(() => {
"use strict";
const R = window.RW;
if (!R) return;
const { $, $$, esc, uid, num, fmt, moneyTxt, pct, pad, today, addDays, daysBetween, fmtDate, icon, kpi, hbars, field, req, opts, modal, closeModal, confirmBox, toast, isAdmin, AR_MONTHS } = R;
const DB = () => R.db;

/* ---------------- مراحل البيع ---------------- */
// path: all = كل العملاء، finance = عملاء التمويل فقط
const STAGES = [
  { k: "new",         label: "جديد",                phase: "تواصل",  color: "#e8a33d", path: "all",     tip: "لم يتم التواصل بعد — تواصل خلال دقائق" },
  { k: "contacted",   label: "تم التواصل",          phase: "تواصل",  color: "#e8a33d", path: "all",     tip: "اجمع: طريقة الشراء، الراتب، الالتزامات، القطاع، البنك" },
  { k: "qualified",   label: "مؤهل مبدئيًا",         phase: "تأهيل",  color: "#4a9fe0", path: "all",     tip: "أرسل الحسبة المبدئية" },
  { k: "quote",       label: "حسبة مبدئية مرسلة",    phase: "تأهيل",  color: "#4a9fe0", path: "all",     tip: "تابع الرد على الحسبة واطلب الأوراق" },
  { k: "docs_wait",   label: "بانتظار الأوراق",      phase: "تمويل",  color: "#9b7be0", path: "finance", tip: "ذكّر العميل بالأوراق الناقصة" },
  { k: "docs_ok",     label: "تم استلام الأوراق",    phase: "تمويل",  color: "#9b7be0", path: "finance", tip: "ارفع الطلب للبنك" },
  { k: "submitted",   label: "تم رفع الطلب للبنك",   phase: "تمويل",  color: "#9b7be0", path: "finance", tip: "تابع البنك لحين وصول الموافقة/الحسبة" },
  { k: "approved",    label: "وصلت موافقة البنك",    phase: "تمويل",  color: "#9b7be0", path: "finance", tip: "اعرض الحسبة النهائية وحدد موعد التوقيع" },
  { k: "negotiation", label: "تفاوض نهائي / حجز",    phase: "إغلاق",  color: "#d4a437", path: "all",     tip: "احجز السيارة وأغلق الصفقة" },
  { k: "won",         label: "تم البيع",             phase: "مغلق",   color: "#3fae6a", path: "all",     closed: true },
  { k: "lost",        label: "مغلق — لم يتم",        phase: "مغلق",   color: "#7d8a97", path: "all",     closed: true },
];
STAGES.forEach((s, i) => { s.i = i; });
const ST = Object.fromEntries(STAGES.map((s) => [s.k, s]));
const OPEN_STAGES = STAGES.filter((s) => !s.closed);

const ACT = {
  created:  { label: "عميل جديد",          icon: "plus",   tone: "tone-green" },
  call_ok:  { label: "مكالمة — رد",         icon: "phone",  tone: "tone-green" },
  call_no:  { label: "مكالمة — لم يرد",     icon: "phoneX", tone: "tone-red" },
  whatsapp: { label: "واتساب",              icon: "chat",   tone: "tone-green" },
  visit:    { label: "زيارة للمعرض",        icon: "pin",    tone: "tone-purple" },
  note:     { label: "ملاحظة",              icon: "edit",   tone: "tone-gold" },
  stage:    { label: "تغيير مرحلة",         icon: "move",   tone: "tone-blue" },
  assign:   { label: "تحويل لموظف",         icon: "user",   tone: "tone-blue" },
  quote:    { label: "حسبة مرسلة",          icon: "calc",   tone: "tone-blue" },
  docs:     { label: "الأوراق",             icon: "file",   tone: "tone-purple" },
  won:      { label: "تم البيع",            icon: "check",  tone: "tone-green" },
  lost:     { label: "إغلاق",               icon: "x",      tone: "tone-red" },
  reopen:   { label: "إعادة فتح",           icon: "undo",   tone: "tone-orange" },
  edit:     { label: "تعديل بيانات",        icon: "edit",   tone: "tone-gold" },
};
Object.assign(R.ICONS, {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  phoneX: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/><path d="M16 2l6 6M22 2l-6 6"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.6 1.3 2.8 2.5 2.8z"/>',
  board: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
});

/* ---------------- الإعدادات الافتراضية (مأخوذة من ملف الليدز الحالي) ---------------- */
const DEF = {
  sources: ["تيك توك", "سناب شات", "ميتا (فيسبوك/انستغرام)", "جوجل", "زيارة المعرض", "اتصال / واتساب مباشر", "توصية عميل", "أخرى"],
  methods: ["أقساط", "كاش", "نظام 50/50", "تأجير"],
  sectors: ["حكومي", "عسكري", "متقاعد", "قطاع خاص - شركة", "قطاع خاص - مؤسسة", "غير موظف"],
  lostReasons: [
    ["راتب أقل من الحد المطلوب", true], ["التزامات عالية", true], ["غير مسجل في التأمينات / غير موظف", true],
    ["إيقاف خدمات / تعثر / ضمان اجتماعي", true], ["مدة خدمة قصيرة", true], ["رقم أجنبي / خارج السعودية", true],
    ["خارج منطقة الخدمة", true], ["لم يرد", false], ["غير مهتم / غير جاد", false], ["يبحث عن سيارة مستعملة", false],
    ["السعر غير مناسب", false], ["اشترى من مكان آخر", false], ["أخرى", false],
  ],
  models: ["كامري", "كورولا", "يارس", "راف فور", "لاندكروزر", "هايلكس", "كريتا", "النترا", "أكسنت", "توسان", "سوناتا", "سيراتو", "سبورتاج", "K5", "صني", "باترول", "جيلي كولراي", "شانجان CS85"],
  docs: ["صورة الهوية / الإقامة", "تعريف بالراتب", "كشف حساب بنكي آخر 3 أشهر", "رخصة القيادة"],
  minSalary: 3500, qualifiedSalary: 4000, maxObligationsPct: 45,
  rate: 4.5, months: 60, slaMinutes: 15, maxAttempts: 5, autoAssign: false,
  templates: [
    { name: "ترحيب أول تواصل", text: "السلام عليكم {الاسم} 👋\nمعك {الموظف} من معرض رواد الاعتماد للسيارات، وصلنا طلبك بخصوص {السيارة}.\nحاب أساعدك: هل الشراء كاش أو أقساط؟ وكم راتبك الشهري والتزاماتك الحالية تقريبًا؟" },
    { name: "بعد عدم الرد", text: "السلام عليكم {الاسم}، حاولنا نتواصل معك بخصوص طلبك على {السيارة} من معرض رواد الاعتماد. متى يناسبك نتصل عليك؟" },
    { name: "طلب الأوراق", text: "أهلًا {الاسم}، عشان نرفع طلب التمويل نحتاج منك:\n{الأوراق}\nترسلها هنا على الواتساب وأنا أتابع مع البنك مباشرة ✅" },
    { name: "تذكير بالأوراق", text: "أهلًا {الاسم}، باقي عندنا من أوراقك:\n{الأوراق_الناقصة}\nأول ما توصلنا نرفع الطلب على طول 👍" },
  ],
};
const cfg = () => {
  const st = (DB() && DB().settings) || {};
  const c = { ...DEF, ...(st.crm || {}) };
  if (!Array.isArray(c.templates) || !c.templates.length) c.templates = DEF.templates;
  return c;
};

/* ---------------- أدوات ---------------- */
const nowLocal = () => { const d = new Date(); return `${R.toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const localOf = (date) => `${R.toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const toDate = (s) => { if (!s) return null; const d = new Date(s.length <= 10 ? s + "T00:00" : s); return isNaN(d) ? null : d; };
const minsBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 60000);
const timeTxt = (s) => { const d = toDate(s); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ""; };
const whenTxt = (s) => {
  if (!s) return "—";
  const d = s.slice(0, 10), t = today();
  const tm = s.length > 10 ? " " + timeTxt(s) : "";
  if (d === t) return "اليوم" + tm;
  if (d === addDays(t, 1)) return "غدًا" + tm;
  if (d === addDays(t, -1)) return "أمس" + tm;
  return fmtDate(d) + tm;
};
const agoTxt = (s) => {
  const m = minsBetween(s, nowLocal());
  if (m < 1) return "الآن";
  if (m < 60) return `منذ ${m} د`;
  if (m < 1440) return `منذ ${Math.floor(m / 60)} س`;
  return `منذ ${Math.floor(m / 1440)} يوم`;
};
const durTxt = (m) => (m == null ? "—" : m < 60 ? `${m} د` : m < 1440 ? `${(m / 60).toFixed(1)} س` : `${(m / 1440).toFixed(1)} يوم`);
const norm = (s) => String(s || "").trim().replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").toLowerCase();
const digits = (s) => String(s || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const toNum = (s) => { const n = parseFloat(digits(s).replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n : 0; };
function normPhone(p) {
  let d = digits(p).replace(/\D/g, "");
  if (d.startsWith("00966")) d = d.slice(5);
  else if (d.startsWith("966")) d = d.slice(3);
  if (d.length === 9 && d.startsWith("5")) d = "0" + d;
  return d;
}
const phoneView = (p) => { const d = normPhone(p); return /^05\d{8}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : p || ""; };
const waNumber = (p) => { const d = normPhone(p); return /^05\d{8}$/.test(d) ? "966" + d.slice(1) : d; };
const median = (arr) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };

function installment(principal, rate, months, balloon = 0) {
  const r = rate / 100 / 12;
  if (months <= 0) return 0;
  if (!r) return (principal - balloon) / months;
  const f = Math.pow(1 + r, months);
  return (r * (principal * f - balloon)) / (f - 1);
}
function maxPrice(maxInst, rate, months, down = 0) {
  const r = rate / 100 / 12;
  if (maxInst <= 0) return down;
  if (!r) return maxInst * months + down;
  const f = Math.pow(1 + r, months);
  return (maxInst * (f - 1)) / (r * f) + down;
}

/* ---------------- منطق العميل ---------------- */
const leads = () => DB().leads || (DB().leads = []);
const acts = () => DB().activities || (DB().activities = []);
const leadById = (id) => leads().find((l) => l.id === id);
const isOpen = (l) => !ST[l.stage] || !ST[l.stage].closed;
const isFinance = (l) => l.method !== "كاش";
const pathStages = (l) => STAGES.filter((s) => !s.closed && (s.path === "all" || isFinance(l)));
const leadActs = (id) => acts().filter((a) => a.leadId === id).sort((a, b) => b.ts.localeCompare(a.ts));
const assignees = () => [...new Set([...R.sellerNames(), ...leads().map((l) => l.assignee).filter(Boolean)])];
const me = () => R.userName();
function phoneIndex() {
  const m = {};
  leads().forEach((l) => { const p = normPhone(l.phone); if (p) (m[p] ||= []).push(l.id); });
  return m;
}

function lostReason(label) { return cfg().lostReasons.find(([r]) => norm(r) === norm(label)); }
function docsSent(l) {
  if (l.docsSent) return true;
  const list = cfg().docs;
  return list.length > 0 && list.every((d) => l.docs && l.docs[d]);
}
function missingDocs(l) { return cfg().docs.filter((d) => !(l.docs && l.docs[d])); }

// التصنيف بنفس قواعد ملف الإكسل الحالي
function tier(l) {
  const c = cfg();
  if (l.stage === "lost") {
    const r = lostReason(l.lostReason);
    return r && !r[1] ? { k: "other", label: "مرفوض لسبب آخر", cls: "tier-other" } : { k: "no", label: "غير مؤهل", cls: "tier-no" };
  }
  const sal = num(l.salary), obl = num(l.obligations);
  if (docsSent(l) && sal >= c.qualifiedSalary) return { k: "top", label: "مؤهل جدًا", cls: "tier-top" };
  if (docsSent(l) || l.method === "كاش") return { k: "yes", label: "مؤهل", cls: "tier-yes" };
  if (!sal) return { k: "na", label: "غير محدد", cls: "tier-na" };
  if (sal < c.minSalary || (obl / sal) * 100 > c.maxObligationsPct) return { k: "no", label: "غير مؤهل", cls: "tier-no" };
  if (sal >= c.qualifiedSalary) return { k: "yes", label: "مؤهل", cls: "tier-yes" };
  return { k: "edge", label: "على الحافة", cls: "tier-edge" };
}
const QUALIFIED = new Set(["top", "yes"]);

function affordability(l) {
  const c = cfg();
  const sal = num(l.salary), obl = num(l.obligations);
  if (!sal) return null;
  const maxInst = Math.max(0, sal * c.maxObligationsPct / 100 - obl);
  return { ratio: (obl / sal) * 100, maxInst, maxPrice: maxPrice(maxInst, c.rate, c.months, 0) };
}

// حالة المتابعة (نفس منطق عمود "حالة المتابعة" في الإكسل)
function follow(l) {
  if (l.stage === "won") return { k: "won", label: "تم البيع", cls: "fs-won" };
  if (l.stage === "lost") return { k: "lost", label: "مغلق", cls: "fs-lost" };
  const n = nowLocal();
  if (!l.firstContactAt && l.stage === "new") {
    const late = minsBetween(l.createdAt, n) > cfg().slaMinutes;
    return late ? { k: "new_late", label: "لم يتم التواصل — متأخر", cls: "fs-late" } : { k: "new", label: "لم يتم التواصل", cls: "fs-new" };
  }
  if (!l.nextAt) return { k: "none", label: "بلا موعد متابعة", cls: "fs-none" };
  if (l.nextAt < n) return { k: "late", label: "متأخر", cls: "fs-late" };
  if (l.nextAt.slice(0, 10) === today()) return { k: "today", label: "اليوم", cls: "fs-today" };
  return { k: "ok", label: "قيد المتابعة", cls: "fs-ok" };
}

function addAct(lead, type, text = "", extra = {}) {
  acts().push({ id: uid(), leadId: lead.id, ts: new Date().toISOString(), type, text, user: me(), ...extra });
}
function setStage(l, k, silent) {
  if (!ST[k] || l.stage === k) return;
  const from = l.stage;
  l.stage = k;
  l.reached = l.reached || {};
  if (!l.reached[k]) l.reached[k] = new Date().toISOString();
  if (!silent) addAct(l, "stage", `${ST[from] ? ST[from].label : "—"} ← ${ST[k].label}`, { from, to: k });
}
function markContact(l) {
  const ts = new Date().toISOString();
  if (!l.firstContactAt) l.firstContactAt = ts;
  l.lastContactAt = ts;
}
function autoAssignee() {
  const names = R.sellerNames();
  if (!names.length) return "";
  const last = {};
  leads().forEach((l) => { if (l.assignee && (!last[l.assignee] || l.createdAt > last[l.assignee])) last[l.assignee] = l.createdAt; });
  return [...names].sort((a, b) => (last[a] || "").localeCompare(last[b] || ""))[0];
}
function fillTemplate(text, l) {
  const car = l.car || "السيارة";
  return text
    .replace(/\{الاسم\}/g, (l.name || "").split(" ")[0] || "")
    .replace(/\{الموظف\}/g, me() || "")
    .replace(/\{السيارة\}/g, car)
    .replace(/\{الأوراق\}/g, cfg().docs.map((d) => "• " + d).join("\n"))
    .replace(/\{الأوراق_الناقصة\}/g, (missingDocs(l).length ? missingDocs(l) : cfg().docs).map((d) => "• " + d).join("\n"))
    .replace(/\{القسط\}/g, l.quote ? moneyTxt(l.quote.monthly) : "");
}

/* ---------------- عناصر واجهة مشتركة ---------------- */
const stageBadge = (l) => { const s = ST[l.stage] || ST.new; return `<span class="badge no-dot stage-badge" style="--c:${s.color}">${s.label}</span>`; };
const tierBadge = (l) => { const t = tier(l); return `<span class="badge no-dot ${t.cls}">${t.label}</span>`; };
const followBadge = (l) => { const f = follow(l); return `<span class="badge ${f.cls}">${f.label}</span>`; };

function followPicker(def = "tomorrow", current = "") {
  const choices = [["2h", "بعد ساعتين"], ["eve", "اليوم 7 م"], ["tomorrow", "غدًا 10 ص"], ["2d", "بعد يومين"], ["3d", "بعد 3 أيام"], ["week", "بعد أسبوع"], ["custom", "موعد محدد"], ["none", "بدون موعد"]];
  return `<div class="field span-3"><label>الموعد القادم للمتابعة</label>
    <div class="pick-row">${choices.map(([k, l]) => `<label class="pick"><input type="radio" name="nextPick" value="${k}" ${k === def ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
    <input class="input next-custom" type="datetime-local" name="nextCustom" value="${esc(current || "")}" style="margin-top:8px;${def === "custom" ? "" : "display:none"}">
  </div>`;
}
function wirePicker(form) {
  const upd = () => { const c = form.querySelector(".next-custom"); if (c) c.style.display = form.nextPick.value === "custom" ? "" : "none"; };
  form.addEventListener("change", upd);
  upd();
}
function pickToNext(d) {
  const n = new Date();
  const at = (days, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(h, m, 0, 0); return localOf(x); };
  switch (d.nextPick) {
    case "2h": n.setHours(n.getHours() + 2); return localOf(n);
    case "eve": return new Date().getHours() >= 19 ? at(1, 19) : at(0, 19);
    case "tomorrow": return at(1, 10);
    case "2d": return at(2, 10);
    case "3d": return at(3, 10);
    case "week": return at(7, 10);
    case "custom": return d.nextCustom || "";
    default: return "";
  }
}
// اقتراح الموعد التالي حسب عدد المحاولات بدون رد
const NO_ANSWER_CADENCE = ["2h", "tomorrow", "2d", "3d", "week"];

/* ---------------- الصفحة: مهام اليوم ---------------- */
const todayState = { scope: null };
function scopeLeads(scope) {
  return leads().filter((l) => scope === "all" || l.assignee === me());
}
function defaultScope() { return R.sellerNames().includes(me()) && !isAdmin() ? "mine" : (leads().some((l) => l.assignee === me()) ? "mine" : "all"); }

function leadRow(l, extra = "") {
  const f = follow(l);
  const lastAct = leadActs(l.id).find((a) => a.type !== "stage");
  const when = f.k.startsWith("new") ? `<b class="${f.k === "new_late" ? "age-bad" : "age-warn"}">${agoTxt(l.createdAt)}</b>` : l.nextAt ? `<b class="${f.k === "late" ? "age-bad" : ""}">${whenTxt(l.nextAt)}</b>` : "";
  return `<div class="lead-row" data-action="lead-open" data-id="${l.id}">
    <div class="lead-main">
      <div class="lead-title"><b>${esc(l.name || "بدون اسم")}</b>${stageBadge(l)}${tierBadge(l)}</div>
      <div class="lead-sub"><span dir="ltr">${esc(phoneView(l.phone))}</span>${l.car ? ` · ${esc(l.car)}` : ""}${l.source ? ` · ${esc(l.source)}` : ""}${l.assignee ? ` · <span class="muted">${esc(l.assignee)}</span>` : ""}</div>
      ${lastAct ? `<div class="lead-last">${(ACT[lastAct.type] || ACT.note).label}${lastAct.text ? ": " + esc(lastAct.text.slice(0, 90)) : ""} <span class="muted">— ${agoTxt(lastAct.ts.length > 16 ? localOf(new Date(lastAct.ts)) : lastAct.ts)}</span></div>` : ""}
      ${extra}
    </div>
    <div class="lead-side">
      <div class="lead-when">${when}</div>
      <div class="lead-btns">
        <button class="btn-icon call-btn" title="اتصال" data-action="lead-call" data-id="${l.id}">${icon("phone")}</button>
        <button class="btn-icon wa-btn" title="واتساب" data-action="lead-wa" data-id="${l.id}">${icon("chat")}</button>
        <button class="btn btn-sm btn-ghost" data-action="lead-log" data-id="${l.id}">سجّل نتيجة</button>
      </div>
    </div>
  </div>`;
}

function renderToday() {
  if (!todayState.scope) todayState.scope = defaultScope();
  const scope = todayState.scope;
  $("#todayScope").innerHTML = `<button class="chip ${scope === "mine" ? "active" : ""}" data-action="lead-scope" data-id="mine">عملائي</button><button class="chip ${scope === "all" ? "active" : ""}" data-action="lead-scope" data-id="all">كل الفريق</button>`;
  const L = scopeLeads(scope).filter(isOpen);
  const groups = { fresh: [], late: [], today: [], none: [] };
  L.forEach((l) => {
    const f = follow(l).k;
    if (f === "new" || f === "new_late") groups.fresh.push(l);
    else if (f === "late") groups.late.push(l);
    else if (f === "today") groups.today.push(l);
    else if (f === "none") groups.none.push(l);
  });
  groups.fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  groups.late.sort((a, b) => a.nextAt.localeCompare(b.nextAt));
  groups.today.sort((a, b) => a.nextAt.localeCompare(b.nextAt));
  groups.none.sort((a, b) => (a.lastContactAt || a.createdAt).localeCompare(b.lastContactAt || b.createdAt));
  const ym = today().slice(0, 7);
  const mineAll = scopeLeads(scope);
  const wonMonth = mineAll.filter((l) => l.stage === "won" && (l.wonAt || "").slice(0, 7) === ym).length;
  const newMonth = mineAll.filter((l) => l.createdAt.slice(0, 7) === ym).length;
  $("#todayKpis").innerHTML = [
    kpi("عملاء جدد بانتظار أول تواصل", fmt(groups.fresh.length), `هدف الرد خلال ${cfg().slaMinutes} دقيقة`, groups.fresh.length ? "tone-orange" : "tone-green", "fire"),
    kpi("متابعات متأخرة", fmt(groups.late.length), "عدّى موعدها — ابدأ بها", groups.late.length ? "tone-red" : "tone-green", "clock"),
    kpi("متابعات اليوم", fmt(groups.today.length), "مواعيد مجدولة لليوم", "tone-blue", "phone"),
    kpi("بلا موعد متابعة", fmt(groups.none.length), "عملاء مفتوحين ممكن يضيعوا", groups.none.length ? "tone-orange" : "tone-green", "alert"),
    kpi(`مبيعات ${AR_MONTHS[new Date().getMonth()]}`, fmt(wonMonth), `من ${newMonth} عميل جديد هذا الشهر`, "tone-green", "check"),
  ].join("");
  const sec = (title, tone, list, hint) => `<div class="card task-sec"><div class="card-head"><h3><span class="dot ${tone}"></span>${title} <span class="muted">(${list.length})</span></h3><span class="muted">${hint}</span></div>
    ${list.length ? `<div class="lead-list">${list.slice(0, 60).map((l) => leadRow(l)).join("")}</div>${list.length > 60 ? `<p class="muted" style="margin-top:8px">و ${list.length - 60} عميل آخر — افتحهم من صفحة العملاء</p>` : ""}` : `<div class="empty-sm">${icon("check")} لا يوجد</div>`}</div>`;
  $("#todayBody").innerHTML =
    sec("عملاء جدد — تواصل الآن", "d-orange", groups.fresh, "الأقدم أولًا · كل دقيقة تأخير تقلل فرصة البيع") +
    sec("متابعات متأخرة", "d-red", groups.late, "عدّى موعدها") +
    sec("متابعات اليوم", "d-blue", groups.today, "حسب الوقت") +
    sec("بلا موعد متابعة", "d-gray", groups.none, "حدّد لهم موعدًا أو أغلقهم");
}

/* ---------------- الصفحة: العملاء (لوحة المراحل + جدول) ---------------- */
const leadsState = { view: "board", q: "", assignee: "", source: "", tier: "", period: "", status: "open", page: 1, dupOnly: false };
function filteredLeads() {
  const s = leadsState, q = norm(s.q), qd = normPhone(s.q);
  const pi = s.dupOnly ? phoneIndex() : null;
  return leads().filter((l) => {
    if (s.status === "open" && !isOpen(l)) return false;
    if (s.status === "won" && l.stage !== "won") return false;
    if (s.status === "lost" && l.stage !== "lost") return false;
    if (s.assignee && (s.assignee === "__none" ? l.assignee : l.assignee !== s.assignee)) return false;
    if (s.source && l.source !== s.source) return false;
    if (s.tier && tier(l).k !== s.tier) return false;
    if (s.period && l.createdAt.slice(0, 7) !== s.period) return false;
    if (pi && (pi[normPhone(l.phone)] || []).length < 2) return false;
    if (q) {
      const hay = norm([l.name, l.car, l.source, l.assignee, l.notes, l.city].join(" "));
      if (!(hay.includes(q) || (qd.length >= 4 && normPhone(l.phone).includes(qd)))) return false;
    }
    return true;
  });
}
function monthsList() {
  const set = new Set(leads().map((l) => l.createdAt.slice(0, 7)));
  return [...set].sort().reverse().map((k) => [k, `${AR_MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}`]);
}

function renderLeads() {
  const s = leadsState;
  const fsel = (id, items, all, val) => { const el = $(id); el.innerHTML = `<option value="">${all}</option>` + items.map((i) => { const [v, l] = Array.isArray(i) ? i : [i, i]; return `<option value="${esc(v)}">${esc(l)}</option>`; }).join(""); el.value = val; };
  fsel("#lfAssignee", [...assignees(), ["__none", "بدون موظف"]], "كل الموظفين", s.assignee);
  fsel("#lfSource", [...new Set([...cfg().sources, ...leads().map((l) => l.source).filter(Boolean)])], "كل المصادر", s.source);
  fsel("#lfTier", [["top", "مؤهل جدًا"], ["yes", "مؤهل"], ["edge", "على الحافة"], ["no", "غير مؤهل"], ["na", "غير محدد"], ["other", "مرفوض لسبب آخر"]], "كل التصنيفات", s.tier);
  fsel("#lfPeriod", monthsList(), "كل الشهور", s.period);
  if (document.activeElement !== $("#lfSearch")) $("#lfSearch").value = s.q;
  const all = leads();
  const cnt = (f) => all.filter(f).length;
  $("#leadChips").innerHTML = [["open", "مفتوحة", (l) => isOpen(l)], ["won", "تم البيع", (l) => l.stage === "won"], ["lost", "مغلقة", (l) => l.stage === "lost"], ["all", "الكل", () => true]]
    .map(([k, l, f]) => `<button class="chip ${s.status === k ? "active" : ""}" data-action="lead-status" data-id="${k}">${l}<span>(${cnt(f)})</span></button>`).join("") +
    `<button class="chip ${s.dupOnly ? "active" : ""}" data-action="lead-dups">أرقام مكررة</button>`;
  $$(".view-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.id === s.view));
  const list = filteredLeads();
  if (s.view === "board" && s.status !== "won" && s.status !== "lost") renderBoard(list); else renderTable(list);
}

function renderBoard(list) {
  const cols = s => list.filter((l) => l.stage === s.k);
  const shown = OPEN_STAGES;
  $("#leadsBody").innerHTML = `<div class="board">${shown.map((s) => {
    const items = cols(s).sort((a, b) => (a.nextAt || "9").localeCompare(b.nextAt || "9"));
    return `<div class="col" data-stage="${s.k}">
      <div class="col-head" style="--c:${s.color}"><b>${s.label}</b><span>${items.length}</span></div>
      <div class="col-body" data-drop="${s.k}">${items.slice(0, 80).map(card).join("")}${items.length > 80 ? `<p class="muted" style="padding:6px">+${items.length - 80} — استخدم الجدول</p>` : ""}${!items.length ? `<div class="col-empty">${s.tip || ""}</div>` : ""}</div>
    </div>`;
  }).join("")}</div>
  <p class="muted board-hint">اسحب البطاقة لمرحلة أخرى — وأثناء السحب يظهر بالأسفل شريط "تم البيع" و"إغلاق بدون بيع".</p>`;
}
function card(l) {
  const f = follow(l);
  const due = f.k.startsWith("new") ? agoTxt(l.createdAt) : l.nextAt ? whenTxt(l.nextAt) : "بلا موعد";
  return `<div class="lcard ${f.cls}" draggable="true" data-lead="${l.id}" data-action="lead-open" data-id="${l.id}">
    <div class="lcard-top"><b>${esc(l.name || "بدون اسم")}</b>${tierBadge(l)}</div>
    <div class="lcard-sub">${esc(l.car || "—")}${l.source ? ` · ${esc(l.source)}` : ""}</div>
    <div class="lcard-foot"><span class="fdot"></span><span>${esc(due)}</span><span class="muted">${esc(l.assignee || "")}</span></div>
  </div>`;
}

function renderTable(list) {
  const s = leadsState;
  const PS = 25;
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(list.length / PS));
  s.page = Math.min(s.page, pages);
  const pi = phoneIndex();
  const rows = list.slice((s.page - 1) * PS, s.page * PS);
  $("#leadsBody").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>التاريخ</th><th>العميل</th><th>الجوال</th><th>المصدر</th><th>السيارة</th><th>الموظف</th><th>المرحلة</th><th>المتابعة</th><th>الموعد القادم</th><th>التصنيف</th><th>الراتب</th></tr></thead>
    <tbody>${rows.map((l) => `<tr class="clickable" data-action="lead-open" data-id="${l.id}">
      <td class="num">${fmtDate(l.createdAt.slice(0, 10))}</td>
      <td><b>${esc(l.name || "—")}</b>${(pi[normPhone(l.phone)] || []).length > 1 ? ' <span class="badge no-dot tone-orange" title="الرقم مسجل لأكثر من عميل">مكرر</span>' : ""}</td>
      <td class="mono" dir="ltr" style="text-align:right">${esc(phoneView(l.phone))}</td>
      <td>${esc(l.source || "—")}</td><td>${esc(l.car || "—")}</td><td>${esc(l.assignee || "—")}</td>
      <td>${stageBadge(l)}</td><td>${followBadge(l)}</td>
      <td class="num">${l.nextAt && isOpen(l) ? whenTxt(l.nextAt) : "—"}</td>
      <td>${tierBadge(l)}</td><td class="num">${l.salary ? fmt(l.salary) : "—"}</td>
    </tr>`).join("") || `<tr><td colspan="11"><div class="empty">لا يوجد عملاء مطابقون</div></td></tr>`}</tbody></table>
    <div class="table-foot"><span>${list.length} عميل</span><div class="pager">${pages > 1 ? `<button class="btn btn-sm btn-ghost" data-action="lead-page" data-id="-1" ${s.page === 1 ? "disabled" : ""}>السابق</button><span>صفحة ${s.page} من ${pages}</span><button class="btn btn-sm btn-ghost" data-action="lead-page" data-id="1" ${s.page === pages ? "disabled" : ""}>التالي</button>` : ""}</div></div></div>`;
}

/* ---------- السحب والإفلات بين المراحل ---------- */
document.addEventListener("dragstart", (e) => {
  const c = e.target.closest && e.target.closest(".lcard");
  if (!c) return;
  e.dataTransfer.setData("text/plain", c.dataset.lead);
  e.dataTransfer.effectAllowed = "move";
  c.classList.add("dragging");
  $("#dragBar").classList.add("show");
});
document.addEventListener("dragend", (e) => {
  const c = e.target.closest && e.target.closest(".lcard");
  if (c) c.classList.remove("dragging");
  $$(".drop-hover").forEach((x) => x.classList.remove("drop-hover"));
  $("#dragBar").classList.remove("show");
});
document.addEventListener("dragover", (e) => { const z = e.target.closest && e.target.closest("[data-drop]"); if (!z) return; e.preventDefault(); $$(".drop-hover").forEach((x) => x !== z && x.classList.remove("drop-hover")); z.classList.add("drop-hover"); });
// إخفاء شريط الإغلاق دائمًا بعد انتهاء السحب (حتى لو لم يُطلق المتصفح dragend)
const hideDragBar = () => { const bar = $("#dragBar"); if (bar) bar.classList.remove("show"); };
["drop", "mouseup", "pointerup", "click", "keydown"].forEach((ev) => document.addEventListener(ev, () => setTimeout(hideDragBar, 0), true));
document.addEventListener("drop", (e) => {
  const z = e.target.closest && e.target.closest("[data-drop]");
  if (!z) return;
  e.preventDefault();
  z.classList.remove("drop-hover");
  $("#dragBar").classList.remove("show");
  const l = leadById(e.dataTransfer.getData("text/plain"));
  if (!l) return;
  moveTo(l, z.dataset.drop);
});
function moveTo(l, k) {
  if (k === l.stage) return;
  if (k === "won") return wonForm(l.id);
  if (k === "lost") return lostForm(l.id);
  if (!isOpen(l)) addAct(l, "reopen", "إعادة فتح الصفقة");
  setStage(l, k);
  if (k !== "new" && !l.firstContactAt) markContact(l);
  toast(`تم نقل ${l.name || "العميل"} إلى: ${ST[k].label}`);
  R.refresh();
}

/* ---------------- ملف العميل ---------------- */
let openLeadId = null;
function openLead(id) {
  const l = leadById(id);
  if (!l) return;
  openLeadId = id;
  renderLeadDrawer();
  R.openOverlay("leadOverlay");
}
function closeLead() { openLeadId = null; R.closeOverlay("leadOverlay"); }

function renderLeadDrawer() {
  const l = leadById(openLeadId);
  if (!l) { closeLead(); return; }
  const body = $("#leadDrawer .modal-body");
  const top = body ? body.scrollTop : 0;
  const c = cfg();
  const f = follow(l), t = tier(l), aff = affordability(l);
  const path = pathStages(l);
  const curI = path.findIndex((s) => s.k === l.stage);
  const dupes = (phoneIndex()[normPhone(l.phone)] || []).filter((x) => x !== l.id);
  const spec = (k, v, cls = "") => `<div class="spec"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const open = isOpen(l);
  const timeline = leadActs(l.id);

  $("#leadDrawer").innerHTML = `
    <div class="modal-head"><h3>${esc(l.name || "عميل")}</h3><button class="btn-icon" data-close-lead>${icon("x")}</button></div>
    <div class="modal-body" style="padding:0">
      <div class="detail-hero">
        <div class="lead-badges">${stageBadge(l)} ${tierBadge(l)} ${followBadge(l)}</div>
        <div class="lead-phone" dir="ltr">${esc(phoneView(l.phone))}</div>
        <div class="meta">${esc(l.source || "—")}${l.campaign ? " · " + esc(l.campaign) : ""} · وصل ${whenTxt(l.createdAt.length > 16 ? localOf(new Date(l.createdAt)) : l.createdAt)} · المسؤول: <b>${esc(l.assignee || "—")}</b></div>
        <div class="detail-actions">
          <a class="btn btn-success btn-sm" href="tel:${esc(normPhone(l.phone))}" data-action="lead-call" data-id="${l.id}">${icon("phone")}اتصال</a>
          <button class="btn btn-ghost btn-sm wa-btn-txt" data-action="lead-wa" data-id="${l.id}">${icon("chat")}واتساب</button>
          <button class="btn btn-primary btn-sm" data-action="lead-log" data-id="${l.id}">${icon("edit")}سجّل نتيجة التواصل</button>
          <button class="btn btn-ghost btn-sm" data-action="lead-edit" data-id="${l.id}">تعديل البيانات</button>
          <button class="btn btn-ghost btn-sm admin-only" data-action="lead-delete" data-id="${l.id}">${icon("trash")}</button>
        </div>
      </div>
      <div style="padding:16px 22px 30px">
        ${dupes.length ? `<div class="alert warn">${icon("alert")}<div>هذا الرقم مسجل لعميل آخر: ${dupes.map((d) => `<a href="#" data-action="lead-open" data-id="${d}"><b>${esc((leadById(d) || {}).name || "عميل")}</b> (${esc(ST[(leadById(d) || {}).stage]?.label || "")})</a>`).join("، ")}</div></div>` : ""}
        ${l.stage === "won" ? `<div class="alert info">${icon("check")}<div>تم البيع ${l.wonAt ? "بتاريخ " + fmtDate(l.wonAt.slice(0, 10)) : ""}${l.car ? " — <b>" + esc(l.car) + "</b>" : ""}${l.wonPrice ? ` — ${moneyTxt(l.wonPrice)}` : ""}${l.wonPayment ? ` — ${esc(l.wonPayment)}` : ""}${l.wonBank ? ` (${esc(l.wonBank)})` : ""}</div></div>` : ""}
        ${l.stage === "lost" ? `<div class="alert warn">${icon("x")}<div>مغلق: <b>${esc(l.lostReason || "بدون سبب")}</b>${l.lostNote ? " — " + esc(l.lostNote) : ""} <button class="link-btn" data-action="lead-reopen" data-id="${l.id}">إعادة فتح</button></div></div>` : ""}

        ${open ? `
        <div class="section-h">مرحلة البيع <span class="muted" style="font-weight:600;font-size:.78rem">— ${isFinance(l) ? "مسار التمويل" : "مسار الكاش"}</span></div>
        <div class="stepper">${path.map((s, i) => `<button class="step ${i < curI ? "done" : i === curI ? "cur" : ""}" data-action="lead-stage" data-id="${l.id}|${s.k}" title="${esc(s.tip || "")}"><i>${i < curI ? "✓" : i + 1}</i><span>${s.label}</span></button>`).join("")}</div>
        <p class="step-tip">${icon("alert")} ${esc((ST[l.stage] || {}).tip || "")}</p>
        <div class="close-row">
          <button class="btn btn-success btn-sm" data-action="lead-won" data-id="${l.id}">${icon("check")}تم البيع</button>
          <button class="btn btn-danger btn-sm" data-action="lead-lost" data-id="${l.id}">إغلاق بدون بيع</button>
        </div>

        <div class="next-box ${f.cls}">
          <div><span class="muted">الموعد القادم</span><b>${l.nextAt ? whenTxt(l.nextAt) : "لا يوجد موعد"}</b>${l.nextType ? `<small>${esc(l.nextType)}</small>` : ""}</div>
          <button class="btn btn-ghost btn-sm" data-action="lead-next" data-id="${l.id}">تغيير الموعد</button>
        </div>` : ""}

        <div class="section-h">التأهيل المالي</div>
        <div class="spec-grid">
          ${spec("طريقة الشراء", esc(l.method || "—"))}
          ${spec("الراتب", l.salary ? moneyTxt(l.salary) : "—", "num")}
          ${spec("الالتزامات الشهرية", l.obligations ? moneyTxt(l.obligations) : l.salary ? "لا يوجد" : "—", "num")}
          ${spec("نسبة الالتزامات", aff ? pct(aff.ratio) : "—", `num ${aff && aff.ratio > c.maxObligationsPct ? "age-bad" : ""}`)}
          ${spec("القطاع", esc(l.sector || "—"))}
          ${spec("البنك", esc(l.bank || "—"))}
          ${spec("القسط الأقصى التقديري", aff ? moneyTxt(aff.maxInst) : "—", "num profit-pos")}
          ${spec(`أقصى سعر سيارة (${c.months} شهر بدون دفعة)`, aff ? moneyTxt(Math.max(0, aff.maxPrice)) : "—", "num")}
        </div>
        <p class="muted" style="font-size:.76rem;margin-top:6px">التصنيف: <b>${t.label}</b> — حسب الراتب (الحد الأدنى ${fmt(c.minSalary)}، المؤهل ${fmt(c.qualifiedSalary)})، الالتزامات (حتى ${c.maxObligationsPct}%)، الأوراق، وطريقة الشراء. القسط تقديري ويخضع لموافقة البنك.</p>
        ${!l.salary && isFinance(l) ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="lead-edit" data-id="${l.id}">+ أضف الراتب والالتزامات</button>` : ""}

        <div class="section-h">السيارة المطلوبة</div>
        <div class="car-pick">
          <div><b>${esc(l.car || "لم تُحدد")}</b>${l.city ? `<br><span class="muted">المدينة: ${esc(l.city)}</span>` : ""}</div>
        </div>

        ${open ? `
        <div class="section-h">الحسبة المبدئية</div>
        ${l.quote ? `<div class="summary-box" style="margin-top:0">
          <div class="summary-row"><span>سعر السيارة</span><b class="num">${moneyTxt(l.quote.price)}</b></div>
          <div class="summary-row"><span>الدفعة المقدمة · المدة</span><b class="num">${moneyTxt(l.quote.down)} · ${l.quote.months} شهر</b></div>
          ${l.quote.balloon ? `<div class="summary-row"><span>الدفعة الأخيرة</span><b class="num">${moneyTxt(l.quote.balloon)}</b></div>` : ""}
          <div class="summary-row total"><span>القسط الشهري التقديري</span><b class="num">${moneyTxt(l.quote.monthly)}</b></div>
          <div class="summary-row muted"><span>أُرسلت</span><span>${whenTxt(localOf(new Date(l.quote.ts)))}</span></div>
        </div>` : ""}
        <button class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="lead-quote" data-id="${l.id}">${icon("calc")}${l.quote ? "حسبة جديدة" : "اعمل حسبة وأرسلها"}</button>

        ${isFinance(l) ? `<div class="section-h">أوراق التمويل <span class="muted" style="font-weight:600;font-size:.78rem">(${cfg().docs.length - missingDocs(l).length}/${cfg().docs.length})</span></div>
        <div class="docs-list">${cfg().docs.map((d) => `<label class="doc ${l.docs && l.docs[d] ? "ok" : ""}"><input type="checkbox" data-lead-doc="${l.id}" value="${esc(d)}" ${l.docs && l.docs[d] ? "checked" : ""}><span>${esc(d)}</span></label>`).join("")}</div>
        ${missingDocs(l).length && missingDocs(l).length < cfg().docs.length ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="lead-wa" data-id="${l.id}|تذكير بالأوراق">${icon("chat")}ذكّره بالأوراق الناقصة</button>` : ""}` : ""}
        ` : ""}

        ${l.notes ? `<div class="section-h">ملاحظات</div><p class="muted" style="white-space:pre-wrap">${esc(l.notes)}</p>` : ""}

        <div class="section-h">سجل التواصل (${timeline.length})</div>
        <form class="quick-note" data-lead-note="${l.id}"><input class="input" name="note" placeholder="اكتب ملاحظة سريعة واضغط Enter…"><button class="btn btn-ghost btn-sm" type="submit">إضافة</button></form>
        <div class="timeline">${timeline.map((a) => { const A = ACT[a.type] || ACT.note; return `<div class="tl-item"><b>${A.label}</b>${a.text ? ` — ${esc(a.text)}` : ""}<small>${R.fmtDateTime(a.ts)} · ${esc(a.user || "")}</small></div>`; }).join("") || '<p class="muted">لا يوجد</p>'}</div>
      </div>
    </div>`;
  const nb = $("#leadDrawer .modal-body");
  if (nb) nb.scrollTop = top;
}

// تحديث ملف العميل المفتوح عند أي تغيير (من نفس الجهاز أو من موظف آخر)
R.hooks.modalClosed.push(() => {
  if (openLeadId && $("#leadOverlay").classList.contains("open")) renderLeadDrawer();
});
R.hooks.chrome.push(() => {
  if (openLeadId && $("#leadOverlay").classList.contains("open") && !$("#modalOverlay").classList.contains("open")) renderLeadDrawer();
  const L = leads().filter(isOpen);
  const mine = L.filter((l) => l.assignee === me() || !R.sellerNames().includes(me()));
  const n = mine.filter((l) => ["new", "new_late", "late"].includes(follow(l).k)).length;
  const b = $("#todayBadge");
  if (b) { b.textContent = n; b.classList.toggle("hidden", !n); }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.leadDoc !== undefined) {
    const l = leadById(t.dataset.leadDoc);
    if (!l) return;
    l.docs = { ...(l.docs || {}), [t.value]: t.checked };
    addAct(l, "docs", `${t.checked ? "استلام" : "إلغاء استلام"}: ${t.value}`);
    if (!missingDocs(l).length) {
      l.docsSent = true;
      if (ST[l.stage].i < ST.docs_ok.i) { setStage(l, "docs_ok"); toast("اكتملت الأوراق — نُقل العميل إلى: تم استلام الأوراق"); }
    } else if (t.checked && ST[l.stage].i < ST.docs_wait.i) setStage(l, "docs_wait");
    R.refresh();
  }
});
document.addEventListener("submit", (e) => {
  const f = e.target;
  if (f.dataset.leadNote === undefined) return;
  e.preventDefault();
  const l = leadById(f.dataset.leadNote);
  const v = f.note.value.trim();
  if (!l || !v) return;
  addAct(l, "note", v);
  R.refresh();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-lead]") || e.target.id === "leadOverlay") closeLead();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#leadOverlay").classList.contains("open") && !$("#modalOverlay").classList.contains("open")) closeLead();
});

/* ---------------- نماذج ---------------- */
function leadForm(id) {
  const l = id ? leadById(id) : null;
  const c = cfg();
  const v = l || { source: c.sources[0], method: "أقساط", assignee: c.autoAssign ? "" : (R.sellerNames().includes(me()) ? me() : "") };
  const models = [...new Set([...c.models, ...leads().map((x) => x.car).filter(Boolean)])].slice(0, 300);
  modal({
    title: l ? `تعديل بيانات ${esc(l.name)}` : "عميل جديد",
    submit: l ? "حفظ" : "إضافة العميل",
    body: `
      <div class="form-section">بيانات العميل</div>
      <div class="form-grid">
        ${field(req("اسم العميل"), `<input class="input" name="name" required value="${esc(v.name)}">`)}
        ${field(req("رقم الجوال"), `<input class="input" name="phone" dir="ltr" required placeholder="05xxxxxxxx" value="${esc(v.phone)}">`, "", '<span id="dupHint"></span>')}
        ${field("المدينة", `<input class="input" name="city" value="${esc(v.city)}">`)}
        ${field("مصدر العميل", `<select class="select" name="source">${opts([...new Set([...c.sources, v.source].filter(Boolean))], v.source)}</select>`)}
        ${field("الحملة / الإعلان", `<input class="input" name="campaign" value="${esc(v.campaign)}">`)}
        ${field("الموظف المسؤول", `<select class="select" name="assignee">${opts(assignees(), v.assignee, c.autoAssign && !l ? "توزيع تلقائي" : "— بدون —")}</select>`)}
        ${field("السيارة / الموديل المطلوب", `<input class="input" name="car" list="carModels" value="${esc(v.car)}"><datalist id="carModels">${models.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>`, "span-2")}
        ${field("طريقة الشراء", `<select class="select" name="method">${opts(c.methods, v.method)}</select>`)}
      </div>
      <div class="form-section">التأهيل (اختياري الآن — يُكمل بعد أول مكالمة)</div>
      <div class="form-grid">
        ${field("الراتب الشهري", `<input class="input" type="number" min="0" step="100" name="salary" value="${esc(v.salary || "")}">`)}
        ${field("الالتزامات الشهرية", `<input class="input" type="number" min="0" step="50" name="obligations" value="${esc(v.obligations || "")}">`)}
        ${field("القطاع", `<select class="select" name="sector">${opts(c.sectors, v.sector, "—")}</select>`)}
        ${field("البنك (الراتب)", `<select class="select" name="bank">${opts([...new Set([...R.BANKS, v.bank].filter(Boolean))], v.bank, "—")}</select>`)}
        ${field("الجنسية", `<select class="select" name="nationality">${opts(["مواطن", "مقيم"], v.nationality, "—")}</select>`)}
        <div class="field"><label>&nbsp;</label><div id="affPreview" class="summary-box" style="margin:0;padding:9px 12px"></div></div>
        ${field(l ? "ملاحظات عامة" : "ملاحظة أولى", `<textarea class="input" name="notes" rows="2">${esc(l ? l.notes : "")}</textarea>`, "span-3")}
      </div>`,
    onInput: (form) => {
      const p = normPhone(form.phone.value);
      const d = p.length >= 9 ? leads().filter((x) => x.id !== id && normPhone(x.phone) === p) : [];
      $("#dupHint").innerHTML = d.length ? `<span class="age-warn">⚠ الرقم مسجل: ${d.map((x) => `<a href="#" data-action="lead-open" data-id="${x.id}">${esc(x.name)}</a>`).join("، ")}</span>` : p && !/^05\d{8}$/.test(p) ? '<span class="muted">تأكد من صيغة الرقم 05xxxxxxxx</span>' : "";
      const tmp = { ...(l || {}), salary: num(form.salary.value), obligations: num(form.obligations.value), method: form.method.value, stage: (l && l.stage) || "new" };
      const t = tier(tmp), a = affordability(tmp);
      $("#affPreview").innerHTML = `التصنيف: <b>${t.label}</b>${a ? `<br><span class="muted">القسط الأقصى ≈ <b class="num">${moneyTxt(a.maxInst)}</b></span>` : ""}`;
    },
    onSubmit: (d) => {
      const clean = {
        name: d.name.trim(), phone: normPhone(d.phone) || d.phone.trim(), city: d.city.trim(), source: d.source, campaign: d.campaign.trim(),
        car: d.car.trim(), method: d.method, salary: num(d.salary), obligations: num(d.obligations), sector: d.sector, bank: d.bank, nationality: d.nationality,
      };
      if (l) {
        const changed = Object.keys(clean).filter((k) => String(l[k] ?? "") !== String(clean[k] ?? ""));
        if (d.assignee !== (l.assignee || "")) { addAct(l, "assign", `${l.assignee || "بدون"} ← ${d.assignee || "بدون"}`); l.assignee = d.assignee; }
        Object.assign(l, clean, { notes: d.notes.trim() });
        if (changed.length) addAct(l, "edit", `تحديث: ${changed.length} حقل`);
        toast("تم حفظ بيانات العميل");
      } else {
        const n = {
          id: uid(), ...clean, notes: "", assignee: d.assignee || (c.autoAssign ? autoAssignee() : ""),
          stage: "new", createdAt: localOf(new Date()), nextAt: localOf(new Date()), docs: {}, attempts: 0, reached: { new: new Date().toISOString() },
        };
        leads().push(n);
        addAct(n, "created", `${n.source}${n.assignee ? " — للموظف " + n.assignee : ""}`);
        if (d.notes.trim()) addAct(n, "note", d.notes.trim());
        toast("تمت إضافة العميل — تواصل معه الآن");
        setTimeout(() => openLead(n.id), 100);
      }
      R.refresh();
    },
  });
}

// النموذج الأساسي: تسجيل نتيجة التواصل + الموعد القادم (حلقة العمل اليومية)
function logForm(id, preset) {
  const l = leadById(id);
  if (!l) return;
  const c = cfg();
  const attempts = l.attempts || 0;
  const path = pathStages(l);
  modal({
    title: `نتيجة التواصل — ${esc(l.name)}`, size: "sm", submit: "حفظ",
    body: `<div class="form-grid cols-2">
      <div class="field span-3"><label>ماذا حدث؟</label><div class="pick-row outcome">
        ${[["call_ok", "رد على المكالمة"], ["call_no", "لم يرد"], ["whatsapp", "تواصل واتساب"], ["visit", "زار المعرض"], ["note", "ملاحظة فقط"]].map(([k, t]) => `<label class="pick"><input type="radio" name="type" value="${k}" ${k === (preset || "call_ok") ? "checked" : ""}><span>${t}</span></label>`).join("")}
      </div></div>
      ${field("ملخص المكالمة / الملاحظة", `<textarea class="input" name="text" rows="3" placeholder="مثال: راتبه 7000 حكومي، التزام 1500، يبي كامري أقساط"></textarea>`, "span-3")}
      ${field("تحديث المرحلة", `<select class="select" name="stage">${opts(path.map((s) => [s.k, s.label]), l.stage)}</select>`, "span-2 stage-f")}
      <div class="field span-3 noans-hint hidden"><div class="alert warn" style="margin:0">${icon("alert")}<div>محاولة رقم <b>${attempts + 1}</b> بدون رد.${attempts + 1 >= c.maxAttempts ? ` وصل للحد (${c.maxAttempts}) — <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" name="closeNoAnswer"> أغلقه بسبب "لم يرد"</label>` : " النظام اقترح موعد المحاولة التالية."}</div></div></div>
      ${followPicker(attempts ? NO_ANSWER_CADENCE[Math.min(attempts, 4)] : "tomorrow", l.nextAt)}
    </div>`,
    onInput: (form) => {
      const t = form.type.value;
      form.querySelector(".noans-hint").classList.toggle("hidden", t !== "call_no");
      if (form.__lastType !== t) {
        form.__lastType = t;
        if (t === "call_no") form.querySelector(`input[name=nextPick][value="${NO_ANSWER_CADENCE[Math.min(attempts, 4)]}"]`).checked = true;
        if (t === "call_ok" && l.stage === "new") form.stage.value = "contacted";
        if (t === "call_no") form.stage.value = l.stage;
        wirePickerOnce(form);
      }
    },
    onSubmit: (d) => {
      const type = d.type;
      if (type !== "note") markContact(l);
      if (type === "call_no") l.attempts = (l.attempts || 0) + 1;
      if (type === "call_ok" || type === "visit") l.attempts = 0;
      addAct(l, type, d.text.trim());
      if (d.closeNoAnswer) {
        l.stage = "lost"; l.lostReason = "لم يرد"; l.lostAt = new Date().toISOString(); l.nextAt = "";
        addAct(l, "lost", `لم يرد بعد ${l.attempts} محاولات`);
        toast("تم إغلاق العميل — لم يرد");
        return R.refresh();
      }
      if (d.stage && d.stage !== l.stage) setStage(l, d.stage);
      l.nextAt = pickToNext(d);
      l.nextType = l.nextAt ? "اتصال" : "";
      toast(l.nextAt ? `تم الحفظ — المتابعة القادمة: ${whenTxt(l.nextAt)}` : "تم الحفظ");
      R.refresh();
    },
  });
  wirePickerOnce($("#mform"));
}
function wirePickerOnce(form) { if (!form.__picker) { form.__picker = true; wirePicker(form); } }

function nextForm(id) {
  const l = leadById(id);
  modal({
    title: "تغيير موعد المتابعة", size: "sm", submit: "حفظ",
    body: `<div class="form-grid cols-2">${followPicker("tomorrow", l.nextAt)}</div>`,
    onSubmit: (d) => { l.nextAt = pickToNext(d); addAct(l, "note", l.nextAt ? `موعد متابعة: ${whenTxt(l.nextAt)}` : "إلغاء موعد المتابعة"); R.refresh(); },
  });
  wirePickerOnce($("#mform"));
}

function waForm(arg) {
  const [id, tplName] = String(arg).split("|");
  const l = leadById(id);
  if (!l) return;
  const T = cfg().templates;
  const first = tplName ? T.find((t) => t.name === tplName) || T[0] : (l.firstContactAt ? T[1] || T[0] : T[0]);
  modal({
    title: `واتساب — ${esc(l.name)}`, size: "sm", submit: "فتح واتساب وإرسال",
    body: `<div class="form-grid cols-2">
      ${field("القالب", `<select class="select" name="tpl">${opts(T.map((t) => t.name), first.name)}</select>`, "span-2")}
      ${field("الرسالة", `<textarea class="input" name="text" rows="7">${esc(fillTemplate(first.text, l))}</textarea>`, "span-3", "عدّل الرسالة كما تريد قبل الإرسال")}
      ${followPicker(l.firstContactAt ? "tomorrow" : "2h", l.nextAt)}
    </div>`,
    onInput: (form) => {
      if (form.__tpl !== form.tpl.value) { if (form.__tpl) { const t = T.find((x) => x.name === form.tpl.value); if (t) form.text.value = fillTemplate(t.text, l); } form.__tpl = form.tpl.value; }
    },
    onSubmit: (d) => {
      window.open(`https://wa.me/${waNumber(l.phone)}?text=${encodeURIComponent(d.text)}`, "_blank", "noopener");
      markContact(l);
      addAct(l, "whatsapp", `${d.tpl}: ${d.text.slice(0, 120)}`);
      l.nextAt = pickToNext(d);
      R.refresh();
    },
  });
  wirePickerOnce($("#mform"));
}

function quoteForm(id) {
  const l = leadById(id);
  const c = cfg();
  const q = l.quote || { price: "", down: 0, months: c.months, rate: c.rate, balloonPct: 0 };
  modal({
    title: `حسبة مبدئية — ${esc(l.name)}`, size: "sm", submit: "حفظ وإرسال واتساب",
    body: `<div class="form-grid cols-2">
      ${field(req("سعر السيارة شامل الضريبة"), `<input class="input" type="number" min="0" step="500" name="price" required value="${esc(q.price)}">`)}
      ${field("الدفعة المقدمة", `<input class="input" type="number" min="0" step="500" name="down" value="${esc(q.down)}">`)}
      ${field("المدة (شهر)", `<select class="select" name="months">${opts([12, 24, 36, 48, 60, 72], q.months)}</select>`)}
      ${field("نسبة الربح السنوية %", `<input class="input" type="number" min="0" step="0.1" name="rate" value="${esc(q.rate)}">`)}
      ${field("الدفعة الأخيرة % (اختياري)", `<input class="input" type="number" min="0" max="60" step="1" name="balloonPct" value="${esc(q.balloonPct || 0)}">`, "span-2")}
      <div class="field span-3"><div id="quoteOut" class="summary-box" style="margin:0"></div></div>
      <label class="field span-3" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" name="send" checked> افتح واتساب برسالة الحسبة بعد الحفظ</label>
    </div>`,
    onInput: (form) => {
      const p = num(form.price.value), dn = num(form.down.value), m = +form.months.value, r = num(form.rate.value), b = p * num(form.balloonPct.value) / 100;
      const inst = installment(Math.max(0, p - dn), r, m, b);
      const a = affordability(l);
      $("#quoteOut").innerHTML = `<div class="summary-row total"><span>القسط الشهري التقديري</span><b class="num">${moneyTxt(inst)}</b></div>
        ${b ? `<div class="summary-row"><span>الدفعة الأخيرة</span><b class="num">${moneyTxt(b)}</b></div>` : ""}
        <div class="summary-row muted"><span>إجمالي المدفوع</span><span class="num">${moneyTxt(inst * m + b + dn)}</span></div>
        ${a ? `<div class="summary-row"><span>القسط الأقصى حسب راتبه</span><b class="num ${inst > a.maxInst ? "profit-neg" : "profit-pos"}">${moneyTxt(a.maxInst)} ${inst > a.maxInst ? "— أعلى من قدرته ✗" : "— مناسب ✓"}</b></div>` : ""}`;
    },
    onSubmit: (d) => {
      const p = num(d.price), dn = num(d.down), m = +d.months, r = num(d.rate), b = p * num(d.balloonPct) / 100;
      const monthly = Math.round(installment(Math.max(0, p - dn), r, m, b));
      l.quote = { price: p, down: dn, months: m, rate: r, balloonPct: num(d.balloonPct), balloon: Math.round(b), monthly, ts: new Date().toISOString() };
      addAct(l, "quote", `${moneyTxt(p)} · مقدم ${moneyTxt(dn)} · ${m} شهر ← قسط ${moneyTxt(monthly)}`);
      if (ST[l.stage].i < ST.quote.i) setStage(l, "quote");
      if (d.send) {
        const txt = `أهلًا ${(l.name || "").split(" ")[0]} 👋\nالحسبة المبدئية لـ ${l.car || "السيارة"}:\n• السعر: ${moneyTxt(p)}\n• الدفعة المقدمة: ${moneyTxt(dn)}\n• المدة: ${m} شهر\n${b ? `• الدفعة الأخيرة: ${moneyTxt(b)}\n` : ""}• القسط الشهري التقريبي: ${moneyTxt(monthly)}\n\n* الحسبة تقديرية وتخضع لموافقة جهة التمويل.\nإذا مناسبة لك نبدأ بإجراءات الطلب ✅`;
        window.open(`https://wa.me/${waNumber(l.phone)}?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
        markContact(l);
      }
      l.nextAt = l.nextAt && l.nextAt > nowLocal() ? l.nextAt : pickToNext({ nextPick: "tomorrow" });
      toast("تم حفظ الحسبة");
      R.refresh();
    },
  });
}

function wonForm(id) {
  const l = leadById(id);
  modal({
    title: `🎉 تم البيع — ${esc(l.name)}`, size: "sm", submit: "تسجيل البيع",
    body: `<div class="form-grid cols-2">
      ${field(req("السيارة المباعة"), `<input class="input" name="car" required list="wonModels" value="${esc(l.car)}"><datalist id="wonModels">${cfg().models.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>`, "span-2")}
      ${field("سعر البيع", `<input class="input" type="number" min="0" step="500" name="price" value="${esc(l.quote ? l.quote.price : "")}">`)}
      ${field("طريقة الدفع", `<select class="select" name="payment">${opts(cfg().methods, l.method || "أقساط")}</select>`)}
      ${field("جهة التمويل", `<select class="select" name="bank">${opts([...new Set([...R.BANKS, l.bank].filter(Boolean))], l.bank, "—")}</select>`)}
      ${field("ملاحظة", `<input class="input" name="note">`)}
    </div>`,
    onSubmit: (d) => {
      closeWon(l, { car: d.car.trim(), price: num(d.price), payment: d.payment, bank: d.payment === "كاش" ? "" : d.bank, note: d.note.trim() });
      toast("مبروك! تم تسجيل البيع 🎉");
      R.refresh();
    },
  });
}
function closeWon(l, info) {
  setStage(l, "won", true);
  l.wonAt = new Date().toISOString();
  l.nextAt = "";
  if (info.car) l.car = info.car;
  l.wonPrice = info.price || 0;
  l.wonPayment = info.payment || "";
  l.wonBank = info.bank || "";
  addAct(l, "won", `${info.car || ""}${info.price ? " — " + moneyTxt(info.price) : ""}${info.payment ? " — " + info.payment : ""}${info.note ? " — " + info.note : ""}`);
}

function lostForm(id) {
  const l = leadById(id);
  modal({
    title: `إغلاق بدون بيع — ${esc(l.name)}`, size: "sm", submit: "إغلاق", danger: true,
    body: `<div class="form-grid cols-2">
      ${field(req("السبب"), `<select class="select" name="reason" required>${opts(cfg().lostReasons.map(([r, q]) => [r, r + (q ? " (غير مؤهل)" : "")]), "", "— اختر —")}</select>`, "span-2", "الأسباب تظهر في التقارير وتوضح هل الإعلانات تحتاج تعديل استهداف")}
      ${field("ملاحظة", `<input class="input" name="note">`, "span-2")}
    </div>`,
    onSubmit: (d) => {
      setStage(l, "lost", true);
      l.lostReason = d.reason; l.lostNote = d.note.trim(); l.lostAt = new Date().toISOString(); l.nextAt = "";
      addAct(l, "lost", d.reason + (d.note.trim() ? " — " + d.note.trim() : ""));
      toast("تم إغلاق العميل");
      R.refresh();
    },
  });
}

/* ---------------- تقارير العملاء ---------------- */
const repState = { period: "" };
function renderCrmReports() {
  const ms = monthsList();
  const sel = $("#crPeriod");
  sel.innerHTML = `<option value="">كل الفترات</option>` + ms.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  sel.value = repState.period;
  const L = leads().filter((l) => !repState.period || l.createdAt.slice(0, 7) === repState.period);
  const c = cfg();
  const won = L.filter((l) => l.stage === "won");
  const lost = L.filter((l) => l.stage === "lost");
  const contacted = L.filter((l) => l.firstContactAt);
  const resp = contacted.map((l) => minsBetween(l.createdAt.length > 16 ? localOf(new Date(l.createdAt)) : l.createdAt, localOf(new Date(l.firstContactAt)))).filter((m) => m >= 0);
  const inSla = resp.filter((m) => m <= c.slaMinutes).length;
  const qual = L.filter((l) => QUALIFIED.has(tier(l).k));
  $("#crKpis").innerHTML = [
    kpi("إجمالي العملاء", fmt(L.length), `${L.filter(isOpen).length} مفتوح`, "tone-gold", "user"),
    kpi("سرعة الرد (الوسيط)", durTxt(median(resp)), `${resp.length ? pct((inSla / resp.length) * 100) : "—"} خلال ${c.slaMinutes} دقيقة`, "tone-orange", "clock"),
    kpi("عملاء مؤهلين", fmt(qual.length), L.length ? pct((qual.length / L.length) * 100) + " من الإجمالي" : "", "tone-blue", "check"),
    kpi("تم البيع", fmt(won.length), `معدل التحويل ${L.length ? pct((won.length / L.length) * 100) : "—"}`, "tone-green", "money"),
    kpi("مغلق بدون بيع", fmt(lost.length), L.length ? pct((lost.length / L.length) * 100) : "", "tone-red", "x"),
  ].join("");

  // قمع المبيعات: كم عميل وصل لكل مرحلة
  const reachedIdx = (l) => {
    if (l.stage === "won") return ST.won.i;
    let m = ST[l.stage] && l.stage !== "lost" ? ST[l.stage].i : 0;
    Object.keys(l.reached || {}).forEach((k) => { if (ST[k] && k !== "lost") m = Math.max(m, ST[k].i); });
    return m;
  };
  const funnel = STAGES.filter((s) => s.k !== "lost").map((s) => ({ l: s.label, v: L.filter((l) => reachedIdx(l) >= s.i && (s.path === "all" || isFinance(l) || l.stage === "won")).length }));
  $("#crFunnel").innerHTML = hbars(funnel, (i) => `${i.v} · ${L.length ? pct((i.v / L.length) * 100) : "0%"}`);

  const group = (keyFn) => {
    const g = {};
    L.forEach((l) => { const k = keyFn(l) || "—"; (g[k] ||= []).push(l); });
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
  };
  $("#crSources").innerHTML = group((l) => l.source).map(([k, arr]) => {
    const q = arr.filter((l) => QUALIFIED.has(tier(l).k)).length, w = arr.filter((l) => l.stage === "won").length;
    return `<tr><td><b>${esc(k)}</b></td><td class="num">${arr.length}</td><td class="num">${q} <small class="muted">(${pct((q / arr.length) * 100)})</small></td><td class="num">${w}</td><td class="num"><b>${pct((w / arr.length) * 100)}</b></td></tr>`;
  }).join("") || '<tr><td colspan="5" class="empty">لا توجد بيانات</td></tr>';

  $("#crReps").innerHTML = group((l) => l.assignee).map(([k, arr]) => {
    const r = arr.filter((l) => l.firstContactAt).map((l) => minsBetween(l.createdAt.length > 16 ? localOf(new Date(l.createdAt)) : l.createdAt, localOf(new Date(l.firstContactAt)))).filter((m) => m >= 0);
    const late = arr.filter((l) => ["late", "new_late"].includes(follow(l).k)).length;
    const w = arr.filter((l) => l.stage === "won").length;
    return `<tr><td><b>${esc(k)}</b></td><td class="num">${arr.length}</td><td class="num">${arr.filter(isOpen).length}</td><td class="num">${durTxt(median(r))}</td><td class="num ${late ? "age-bad" : ""}">${late}</td><td class="num">${w}</td><td class="num"><b>${pct((w / arr.length) * 100)}</b></td></tr>`;
  }).join("") || '<tr><td colspan="7" class="empty">لا توجد بيانات</td></tr>';

  const reasons = {};
  lost.forEach((l) => (reasons[l.lostReason || "بدون سبب"] = (reasons[l.lostReason || "بدون سبب"] || 0) + 1));
  $("#crReasons").innerHTML = hbars(Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ l: k, v })), (i) => `${i.v} · ${pct((i.v / Math.max(1, lost.length)) * 100)}`, (i) => (lostReason(i.l) && lostReason(i.l)[1] ? "var(--danger)" : "var(--warning)"));

  const tiers = {};
  L.forEach((l) => { const t = tier(l).label; tiers[t] = (tiers[t] || 0) + 1; });
  $("#crTiers").innerHTML = hbars(Object.entries(tiers).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ l: k, v })), (i) => `${i.v} · ${pct((i.v / Math.max(1, L.length)) * 100)}`);

  const months = {};
  leads().forEach((l) => { const k = l.createdAt.slice(0, 7); const m = (months[k] ||= { n: 0, q: 0, w: 0, x: 0, o: 0 }); m.n++; if (QUALIFIED.has(tier(l).k)) m.q++; if (l.stage === "won") m.w++; else if (l.stage === "lost") m.x++; else m.o++; });
  $("#crMonths").innerHTML = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([k, m]) => `<tr><td><b>${AR_MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}</b></td><td class="num">${m.n}</td><td class="num">${m.o}</td><td class="num">${m.q} <small class="muted">(${pct((m.q / m.n) * 100)})</small></td><td class="num">${m.w}</td><td class="num">${m.x}</td><td class="num"><b>${pct((m.w / m.n) * 100)}</b></td></tr>`).join("") || '<tr><td colspan="7" class="empty">لا توجد بيانات</td></tr>';
}

/* ---------------- إعدادات العملاء ---------------- */
function crmSettingsForm() {
  const c = cfg();
  const lines = (a) => a.join("\n");
  modal({
    title: "إعدادات إدارة العملاء",
    body: `
      <div class="form-section">التأهيل والحسابات</div>
      <div class="form-grid">
        ${field("الحد الأدنى للراتب", `<input class="input" type="number" name="minSalary" value="${c.minSalary}">`)}
        ${field("راتب العميل المؤهل", `<input class="input" type="number" name="qualifiedSalary" value="${c.qualifiedSalary}">`)}
        ${field("أعلى نسبة التزامات من الراتب %", `<input class="input" type="number" name="maxObligationsPct" value="${c.maxObligationsPct}">`, "", "تُستخدم أيضًا لحساب القسط الأقصى")}
        ${field("نسبة الربح الافتراضية %", `<input class="input" type="number" step="0.1" name="rate" value="${c.rate}">`)}
        ${field("المدة الافتراضية (شهر)", `<input class="input" type="number" name="months" value="${c.months}">`)}
        ${field("هدف سرعة الرد (دقيقة)", `<input class="input" type="number" name="slaMinutes" value="${c.slaMinutes}">`)}
        ${field("محاولات بدون رد قبل اقتراح الإغلاق", `<input class="input" type="number" name="maxAttempts" value="${c.maxAttempts}">`)}
        ${field("توزيع العملاء الجدد", `<select class="select" name="autoAssign">${opts([["0", "يدوي"], ["1", "تلقائي بالتناوب"]], c.autoAssign ? "1" : "0")}</select>`)}
      </div>
      <div class="form-section">القوائم (عنصر في كل سطر)</div>
      <div class="form-grid cols-2">
        ${field("مصادر العملاء", `<textarea class="input" name="sources" rows="6">${esc(lines(c.sources))}</textarea>`)}
        ${field("أوراق التمويل المطلوبة", `<textarea class="input" name="docs" rows="6">${esc(lines(c.docs))}</textarea>`)}
        ${field("أسباب الإغلاق", `<textarea class="input" name="lostReasons" rows="8">${esc(lines(c.lostReasons.map(([r, q]) => r + (q ? " | غير مؤهل" : ""))))}</textarea>`, "", 'أضف " | غير مؤهل" للأسباب اللي معناها إن العميل غير مؤهل')}
        ${field("القطاعات", `<textarea class="input" name="sectors" rows="8">${esc(lines(c.sectors))}</textarea>`)}
        ${field("الموديلات المتوفرة (تظهر كاقتراحات)", `<textarea class="input" name="models" rows="6">${esc(lines(c.models))}</textarea>`, "span-2")}
      </div>
      <div class="form-section">قوالب الواتساب</div>
      <p class="muted" style="font-size:.8rem;margin-bottom:8px">المتغيرات: {الاسم} {الموظف} {السيارة} {الأوراق} {الأوراق_الناقصة} — افصل بين القوالب بسطر فيه === واكتب اسم القالب في أول سطر.</p>
      <textarea class="input" name="templates" rows="12">${esc(c.templates.map((t) => t.name + "\n" + t.text).join("\n===\n"))}</textarea>`,
    onSubmit: (d) => {
      const list = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
      DB().settings.crm = {
        ...(DB().settings.crm || {}),
        minSalary: num(d.minSalary), qualifiedSalary: num(d.qualifiedSalary), maxObligationsPct: num(d.maxObligationsPct) || 45,
        rate: num(d.rate), months: num(d.months) || 60, slaMinutes: num(d.slaMinutes) || 15, maxAttempts: num(d.maxAttempts) || 5, autoAssign: d.autoAssign === "1",
        sources: list(d.sources), docs: list(d.docs), sectors: list(d.sectors), models: list(d.models),
        lostReasons: list(d.lostReasons).map((x) => { const [r, q] = x.split("|").map((y) => y.trim()); return [r, !!q]; }),
        templates: d.templates.split(/\n\s*===\s*\n/).map((b) => { const [name, ...rest] = b.trim().split("\n"); return { name: (name || "").trim(), text: rest.join("\n").trim() }; }).filter((t) => t.name && t.text),
      };
      toast("تم حفظ إعدادات العملاء");
      R.refresh();
    },
  });
}

/* ---------------- استيراد من ملف Google Sheets (CSV) ---------------- */
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const STAGE_MAP = {
  "جديد": "new", "تم التواصل": "contacted", "جاري المتابعه": "contacted", "مؤهل مبدئيا": "qualified", "حسبه مبدئيه مرسله": "quote",
  "بانتظار الاوراق": "docs_wait", "تم استلام الاوراق": "docs_ok", "تم رفع الطلب": "submitted", "بانتظار الحسبه": "submitted",
  "وصلت الحسبه": "approved", "تفاوض نهائي": "negotiation", "مغلق - بيع": "won", "مغلق - رفض": "lost",
};
function parseDateCell(s) {
  s = digits(s).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { const a = +m[1], b = +m[2]; const [d, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]; return `${m[3]}-${pad(mo)}-${pad(d)}`; }
  const d = new Date(s);
  return isNaN(d) ? "" : R.toISODate(d);
}
function importSheet(text) {
  const rows = parseCSV(text);
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm("اسم العميل")) && r.some((c) => norm(c).includes(norm("الجوال"))));
  if (hi < 0) { toast("لم أجد صف العناوين — تأكد أنك صدّرت ورقة (سجل الليدز)", "error"); return; }
  const H = rows[hi].map(norm);
  const col = (...names) => { for (const n of names) { const i = H.findIndex((h) => h.startsWith(norm(n))); if (i >= 0) return i; } return -1; };
  const C = {
    date: col("تاريخ استلام"), name: col("اسم العميل"), phone: col("رقم الجوال", "الجوال"), source: col("مصدر"), car: col("السيارة"),
    assignee: col("المندوب", "الموظف"), stage: col("حالة الليد", "مرحلة البيع", "المرحله"), last: col("تاريخ آخر متابعة"), next: col("الموعد القادم"),
    notes: col("ملاحظات"), method: col("طريقة الشراء"), salary: col("الراتب"), obl: col("الالتزامات"), sector: col("القطاع"), bank: col("البنك"),
    reason: col("سبب الرفض"), docs: col("أرسل أوراقه"),
  };
  const get = (r, k) => (C[k] >= 0 ? String(r[C[k]] || "").trim() : "");
  const existing = new Set(leads().map((l) => normPhone(l.phone) + "|" + l.createdAt.slice(0, 10)));
  const out = []; let skipped = 0, dup = 0;
  const unknownStages = {};
  rows.slice(hi + 1).forEach((r) => {
    const name = get(r, "name"), phone = normPhone(get(r, "phone"));
    if (!name && !phone) { skipped++; return; }
    const date = parseDateCell(get(r, "date")) || today();
    if (existing.has(phone + "|" + date)) { dup++; return; }
    existing.add(phone + "|" + date);
    const stRaw = get(r, "stage");
    let stage = STAGE_MAP[norm(stRaw)] || "";
    if (!stage) { if (stRaw) unknownStages[stRaw] = (unknownStages[stRaw] || 0) + 1; stage = stRaw ? "contacted" : "new"; }
    const reached = {};
    STAGES.forEach((s) => { if (stage !== "lost" && s.i <= ST[stage].i && !s.closed) reached[s.k] = date + "T09:00"; });
    if (stage === "won") reached.won = date + "T09:00";
    const last = parseDateCell(get(r, "last")), next = parseDateCell(get(r, "next"));
    const reasonRaw = get(r, "reason");
    const rs = reasonRaw ? (lostReason(reasonRaw) || ["أخرى"])[0] : "";
    const l = {
      id: uid(), name, phone: phone || get(r, "phone"), source: get(r, "source"), car: get(r, "car"), assignee: get(r, "assignee"),
      stage, createdAt: date + "T09:00", method: get(r, "method"), salary: toNum(get(r, "salary")), obligations: toNum(get(r, "obl")),
      sector: get(r, "sector"), bank: get(r, "bank"), notes: get(r, "notes"), docs: {}, docsSent: /نعم|yes|✓|true/i.test(get(r, "docs")),
      nextAt: isOpen({ stage }) && next ? next + "T10:00" : "", attempts: 0, reached, imported: true,
    };
    if (stage !== "new" || last) { l.firstContactAt = null; l.lastContactAt = last ? last + "T12:00" : null; }
    if (stage === "lost") { l.lostReason = rs || "أخرى"; if (reasonRaw && rs !== reasonRaw) l.lostNote = reasonRaw; l.lostAt = (last || date) + "T12:00"; }
    if (stage === "won") l.wonAt = (last || date) + "T12:00";
    out.push(l);
  });
  if (!out.length) { toast(`لا يوجد عملاء جدد للاستيراد${dup ? ` (${dup} مستورد مسبقًا)` : ""}`, "warn"); return; }
  const byStage = {};
  out.forEach((l) => (byStage[l.stage] = (byStage[l.stage] || 0) + 1));
  confirmBox("استيراد العملاء", `
    سيتم استيراد <b>${out.length}</b> عميل${dup ? ` (وتخطي ${dup} موجود مسبقًا)` : ""}.<br><br>
    ${Object.entries(byStage).map(([k, v]) => `${ST[k].label}: <b>${v}</b>`).join(" · ")}
    ${Object.keys(unknownStages).length ? `<br><br><span class="age-warn">مراحل غير معروفة اعتُبرت "تم التواصل": ${Object.entries(unknownStages).map(([k, v]) => esc(k) + " (" + v + ")").join("، ")}</span>` : ""}
    <br><br><span class="muted">الملاحظات تُحفظ في سجل كل عميل. أعمدة (مساعد) و(تلقائي) يتم تجاهلها لأن النظام يحسبها بنفسه.</span>`, () => {
    out.forEach((l) => {
      leads().push(l);
      acts().push({ id: uid(), leadId: l.id, ts: new Date(l.createdAt).toISOString(), type: "created", text: `مستورد من ملف الإكسل — ${l.source || ""}`, user: me() });
      if (l.notes) acts().push({ id: uid(), leadId: l.id, ts: new Date((l.lastContactAt || l.createdAt)).toISOString(), type: "note", text: l.notes, user: l.assignee || me() });
    });
    toast(`تم استيراد ${out.length} عميل`);
    R.refresh();
  }, "استيراد");
}

function exportLeads() {
  const list = filteredLeads();
  const rows = list.map((l) => [l.createdAt.slice(0, 10), l.name, phoneView(l.phone), l.source, l.car, l.assignee, (ST[l.stage] || {}).label, follow(l).label, l.nextAt ? l.nextAt.replace("T", " ") : "", l.method, l.salary || "", l.obligations || "", l.sector, l.bank, tier(l).label, docsSent(l) ? "نعم" : "", l.lostReason || "", l.notes || ""]);
  R.downloadFile(`عملاء-رواد-الاعتماد-${today()}.csv`, R.toCSV(["تاريخ الاستلام", "اسم العميل", "الجوال", "المصدر", "السيارة", "الموظف", "المرحلة", "حالة المتابعة", "الموعد القادم", "طريقة الشراء", "الراتب", "الالتزامات", "القطاع", "البنك", "التصنيف", "أرسل أوراقه", "سبب الإغلاق", "ملاحظات"], rows), "text/csv;charset=utf-8");
  toast(`تم تصدير ${rows.length} عميل`);
}

/* ---------------- بيانات تجريبية ---------------- */
R.hooks.seed.push((data) => {
  let s = 7341;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => Math.round(a + rnd() * (b - a));
  const F = ["محمد", "عبدالله", "فهد", "سعود", "خالد", "نورة", "ريم", "تركي", "ماجد", "هند", "سلطان", "عبدالعزيز", "أمل", "بندر", "يوسف", "منيرة", "ناصر", "عمر"];
  const L2 = ["الشمري", "الحربي", "الغامدي", "الزهراني", "المطيري", "القحطاني", "العنزي", "السهلي", "الدوسري", "العتيبي", "الشهري", "البقمي"];
  const cars = ["كامري 2025", "كريتا 2026", "النترا 2025", "سوناتا 2025", "توسان 2025", "يارس 2025", "سيراتو 2025", "هايلكس 2025", "أكسنت 2025", "لاندكروزر 2025"];
  const srcW = ["تيك توك", "تيك توك", "تيك توك", "تيك توك", "تيك توك", "تيك توك", "سناب شات", "سناب شات", "ميتا (فيسبوك/انستغرام)", "زيارة المعرض", "توصية عميل", "اتصال / واتساب مباشر"];
  const sellers = data.settings.sellers;
  const reasonsW = ["التزامات عالية", "التزامات عالية", "لم يرد", "لم يرد", "غير مهتم / غير جاد", "غير مسجل في التأمينات / غير موظف", "راتب أقل من الحد المطلوب", "إيقاف خدمات / تعثر / ضمان اجتماعي", "السعر غير مناسب", "يبحث عن سيارة مستعملة"];
  const iso = (d) => d.toISOString();
  const now = new Date();
  data.leads = []; data.activities = [];
  const add = (l, type, text, d, user) => data.activities.push({ id: uid(), leadId: l.id, ts: iso(d), type, text, user: user || l.assignee });
  for (let i = 0; i < 90; i++) {
    const ageDays = Math.floor(Math.pow(rnd(), 1.4) * 75);
    const created = new Date(now); created.setDate(created.getDate() - ageDays); created.setHours(between(8, 23), between(0, 59), 0, 0);
    if (created > now) created.setTime(now.getTime() - 20 * 60000);
    const method = rnd() < 0.82 ? "أقساط" : pick(["كاش", "نظام 50/50"]);
    const sal = rnd() < 0.7 ? Math.round(between(3000, 16000) / 500) * 500 : 0;
    const l = {
      id: uid(), name: pick(F) + " " + pick(L2), phone: "05" + between(10000000, 99999999), source: pick(srcW), car: pick(cars),
      assignee: pick(sellers), method, salary: sal, obligations: sal ? Math.round(sal * rnd() * 0.6 / 50) * 50 : 0,
      sector: sal ? pick(["حكومي", "عسكري", "قطاع خاص - شركة", "متقاعد", "قطاع خاص - مؤسسة"]) : "", bank: sal ? pick(R.BANKS.slice(0, 5)) : "",
      createdAt: localOf(created), stage: "new", docs: {}, attempts: 0, reached: { new: iso(created) }, notes: "",
    };
    add(l, "created", l.source, created, "النظام");
    const t = tier(l).k;
    // مسار واقعي حسب العمر والتأهيل
    let target;
    if (ageDays === 0 && rnd() < 0.6) target = "new";
    else if (t === "no" && rnd() < 0.8) target = "lost";
    else { const r = rnd(); target = r < 0.25 ? "lost" : r < 0.42 ? "contacted" : r < 0.55 ? "qualified" : r < 0.66 ? "quote" : r < 0.74 ? "docs_wait" : r < 0.79 ? "docs_ok" : r < 0.84 ? "submitted" : r < 0.88 ? "approved" : r < 0.92 ? "negotiation" : "won"; }
    if (method === "كاش" && ["docs_wait", "docs_ok", "submitted", "approved"].includes(target)) target = "negotiation";
    if (target === "won" && ageDays < 7) target = "negotiation";
    if (target !== "new") {
      const respMin = rnd() < 0.45 ? between(2, 15) : rnd() < 0.7 ? between(16, 120) : between(121, 1500);
      const fc = new Date(created.getTime() + respMin * 60000);
      if (fc < now) {
        l.firstContactAt = iso(fc); l.lastContactAt = iso(fc);
        const answered = rnd() < 0.75;
        add(l, answered ? "call_ok" : "call_no", answered ? (sal ? `راتبه ${sal} ${l.sector}، التزامات ${l.obligations}` : "مهتم، طلب يفكر") : "", fc);
        const path = STAGES.filter((s) => !s.closed && (s.path === "all" || method !== "كاش"));
        const goal = target === "lost" ? ST[pick(["contacted", "contacted", "qualified", "quote"])].i : target === "won" ? ST.negotiation.i : ST[target].i;
        let d = new Date(fc);
        path.filter((s) => s.i > 0 && s.i <= goal).forEach((s) => {
          d = new Date(d.getTime() + between(2, 60) * 3600000); if (d > now) d = new Date(now.getTime() - between(5, 120) * 60000);
          l.reached[s.k] = iso(d); add(l, "stage", `← ${s.label}`, d); l.stage = s.k;
          if (s.k === "quote") { const p = between(60, 160) * 1000; l.quote = { price: p, down: 0, months: 60, rate: 4.5, balloonPct: 0, balloon: 0, monthly: Math.round(installment(p, 4.5, 60)), ts: iso(d) }; add(l, "quote", `قسط ${moneyTxt(l.quote.monthly)}`, d); }
          if (s.k === "docs_ok") { DEF.docs.forEach((x) => (l.docs[x] = true)); l.docsSent = true; }
          if (s.k === "docs_wait") { l.docs[DEF.docs[0]] = true; }
          l.lastContactAt = iso(d);
        });
        if (target === "won") {
          l.wonPrice = l.quote ? l.quote.price : between(70, 180) * 1000; l.wonPayment = method; l.wonBank = method === "كاش" ? "" : l.bank;
          l.stage = "won"; l.reached.won = iso(d); l.wonAt = iso(d); add(l, "won", l.car, d);
        } else if (target === "lost") {
          l.stage = "lost"; l.lostReason = t === "no" ? pick(["التزامات عالية", "راتب أقل من الحد المطلوب", "التزامات عالية"]) : pick(reasonsW); l.lostAt = iso(d); add(l, "lost", l.lostReason, d);
        } else {
          const r = rnd();
          const nx = new Date(now);
          if (r < 0.22) nx.setHours(nx.getHours() - between(3, 70)); // متأخر
          else if (r < 0.5) nx.setHours(Math.min(22, nx.getHours() + between(1, 6)), between(0, 59)); // اليوم
          else if (r < 0.88) { nx.setDate(nx.getDate() + between(1, 5)); nx.setHours(10, 0); }
          else nx.setTime(0); // بلا موعد
          l.nextAt = nx.getTime() ? localOf(nx) : "";
        }
      }
    }
    data.leads.push(l);
  }
});

/* ---------------- تسجيل الصفحات والأوامر ---------------- */
R.PAGES.today = { title: "مهام اليوم", render: renderToday };
R.PAGES.leads = { title: "العملاء", render: renderLeads };
R.PAGES["crm-reports"] = { title: "تقارير العملاء", render: renderCrmReports };
R.ADMIN_ACTIONS.add("lead-delete");
R.ADMIN_ACTIONS.add("lead-settings");
R.ADMIN_ACTIONS.add("lead-import");

Object.assign(R.ACTIONS, {
  "lead-new": () => leadForm(),
  "lead-open": (id) => openLead(id),
  "lead-edit": (id) => leadForm(id),
  "lead-log": (id) => logForm(id),
  "lead-call": (id) => {
    const l = leadById(id);
    if (!l) return;
    const a = document.createElement("a"); a.href = "tel:" + normPhone(l.phone); a.click();
    setTimeout(() => logForm(id, "call_ok"), 400);
  },
  "lead-wa": (arg) => waForm(arg),
  "lead-quote": (id) => quoteForm(id),
  "lead-next": (id) => nextForm(id),
  "lead-won": (id) => wonForm(id),
  "lead-lost": (id) => lostForm(id),
  "lead-reopen": (id) => { const l = leadById(id); setStage(l, l.reached && l.reached.contacted ? "contacted" : "new", true); addAct(l, "reopen", "إعادة فتح"); l.lostReason = ""; l.nextAt = localOf(new Date()); R.refresh(); },
  "lead-stage": (arg) => { const [id, k] = arg.split("|"); moveTo(leadById(id), k); },
  "lead-delete": (id) => {
    const l = leadById(id);
    confirmBox("حذف العميل", `حذف <b>${esc(l.name)}</b> نهائيًا؟ يُفضّل "إغلاق بدون بيع" بدل الحذف للحفاظ على التقارير.`, () => {
      const i = leads().indexOf(l); leads().splice(i, 1); closeLead(); toast("تم حذف العميل"); R.refresh();
    }, "حذف نهائي");
  },
  "lead-scope": (k) => { todayState.scope = k; renderToday(); },
  "lead-status": (k) => { leadsState.status = k; leadsState.page = 1; renderLeads(); },
  "lead-dups": () => { leadsState.dupOnly = !leadsState.dupOnly; leadsState.view = "table"; renderLeads(); },
  "lead-view": (k) => { leadsState.view = k; renderLeads(); },
  "lead-page": (d) => { leadsState.page += +d; renderLeads(); },
  "lead-settings": () => crmSettingsForm(),
  "lead-import": () => $("#leadImportFile").click(),
  "lead-export": () => exportLeads(),
});

// فلاتر صفحة العملاء
let qTimer;
$("#lfSearch").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { leadsState.q = e.target.value; leadsState.page = 1; renderLeads(); }, 150); });
[["#lfAssignee", "assignee"], ["#lfSource", "source"], ["#lfTier", "tier"], ["#lfPeriod", "period"]].forEach(([sel, k]) => $(sel).addEventListener("change", (e) => { leadsState[k] = e.target.value; leadsState.page = 1; renderLeads(); }));
$("#crPeriod").addEventListener("change", (e) => { repState.period = e.target.value; renderCrmReports(); });
$("#leadImportFile").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { importSheet(String(rd.result)); e.target.value = ""; };
  rd.readAsText(f, "utf-8");
});

// للاختبارات والتكامل
R.crm = { leads, tier, follow, normPhone, importSheet, openLead, STAGES };
})();
