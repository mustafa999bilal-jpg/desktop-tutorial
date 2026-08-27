/* ============================================================
   CRM Data Layer
   State is persisted in the browser (localStorage) — no backend.
   ============================================================ */
const CRM = (function () {
  const STORAGE_KEY = "crm_state_v2";

  const STATUS_LABELS = {
    new: "جديد",
    contacted: "تم التواصل",
    qualified: "مؤهل",
    proposal: "عرض سعر",
    negotiation: "تفاوض",
    won: "صفقة ناجحة",
    lost: "خسارة",
  };
  const STATUS_ORDER = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
  const OPEN_STATUSES = ["new", "contacted", "qualified", "proposal", "negotiation"];

  const DEFAULT_SOURCES = ["فيسبوك", "انستغرام", "جوجل", "تيك توك", "سناب شات", "واتساب", "إحالة", "أخرى"];
  const REP_COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#4d7c0f"];

  let state = null;

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function defaultSettings() {
    return { firstResponseSlaMinutes: 60, followUpSlaHours: 24, adSources: DEFAULT_SOURCES.slice() };
  }

  /* ---------------- persistence ---------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        if (!state.settings) state.settings = defaultSettings();
        if (!state.settings.adSources) state.settings.adSources = DEFAULT_SOURCES.slice();
        return state;
      }
    } catch (e) {
      console.warn("CRM: failed to read saved data, reseeding.", e);
    }
    state = seed();
    save();
    return state;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetDemo() {
    state = seed();
    save();
    return state;
  }

  function wipeAll() {
    state = { leads: [], reps: [], settings: defaultSettings() };
    save();
    return state;
  }

  /* ---------------- seed demo data ---------------- */
  function seed() {
    const now = Date.now();
    const H = 3600 * 1000;
    const reps = [
      { id: "rep_1", name: "أحمد سالم", phone: "0100000001", email: "ahmed@example.com", active: true, color: REP_COLORS[0] },
      { id: "rep_2", name: "منى عبد الله", phone: "0100000002", email: "mona@example.com", active: true, color: REP_COLORS[1] },
      { id: "rep_3", name: "خالد حسن", phone: "0100000003", email: "khaled@example.com", active: true, color: REP_COLORS[2] },
      { id: "rep_4", name: "سارة يوسف", phone: "0100000004", email: "sara@example.com", active: true, color: REP_COLORS[3] },
    ];

    const sources = DEFAULT_SOURCES;
    const names = ["محمد علي", "فاطمة أحمد", "عمر خالد", "ليلى إبراهيم", "يوسف محمود", "نور حسين", "كريم عادل", "هدى سمير", "طارق فؤاد", "ريم ناصر", "إسلام رفعت", "دينا وليد", "حسام مجدي", "آية شريف", "بلال عبد الرحمن", "ياسمين طه"];

    const leads = [];
    names.forEach((name, i) => {
      const daysAgo = Math.floor(Math.random() * 12);
      const createdAt = now - daysAgo * 24 * H - Math.floor(Math.random() * 20) * H;
      const rep = Math.random() > 0.15 ? reps[i % reps.length] : null;
      const assignedAt = rep ? createdAt + Math.floor(Math.random() * 2) * H : null;

      let status = STATUS_ORDER[Math.min(Math.floor(Math.random() * 7), 6)];
      if (!rep) status = "new";

      let firstContactAt = null;
      let lastContactAt = null;
      const notes = [];
      const history = [{ ts: createdAt, type: "created", text: "تم استلام الليد" }];

      if (rep) {
        history.push({ ts: assignedAt, type: "assigned", text: `تم التوزيع على ${rep.name}` });
        // some reps respond fast, some slow/never, to make SLA data meaningful
        const respondsAt = Math.random() > 0.25 ? assignedAt + Math.floor(Math.random() * 5 * H) : null;
        if (respondsAt && respondsAt < now && status !== "new") {
          firstContactAt = respondsAt;
          lastContactAt = respondsAt + Math.floor(Math.random() * 3) * H;
          if (lastContactAt > now) lastContactAt = respondsAt;
          history.push({ ts: firstContactAt, type: "contact", text: "أول تواصل مع العميل" });
          notes.push({ ts: firstContactAt, text: "تم الاتصال بالعميل ومناقشة احتياجاته.", repId: rep.id });
        }
      }

      if (status === "won" || status === "lost") {
        history.push({ ts: now - Math.floor(Math.random() * daysAgo) * H, type: "status", text: `الحالة: ${STATUS_LABELS[status]}` });
      }

      leads.push({
        id: uid("lead"),
        name,
        phone: "01" + Math.floor(100000000 + Math.random() * 899999999),
        source: sources[Math.floor(Math.random() * sources.length)],
        campaign: "حملة " + sources[Math.floor(Math.random() * sources.length)] + " " + (Math.floor(Math.random() * 3) + 1),
        createdAt,
        assignedRepId: rep ? rep.id : null,
        assignedAt,
        status,
        firstContactAt,
        lastContactAt,
        nextFollowUpAt: null,
        value: Math.floor(Math.random() * 15 + 2) * 1000,
        lostReason: status === "lost" ? "لم يتم الرد / غير مهتم" : null,
        notes,
        history,
      });
    });

    return { leads, reps, settings: defaultSettings() };
  }

  /* ---------------- getters ---------------- */
  function getState() { return state; }
  function getLeads() { return state.leads; }
  function getLead(id) { return state.leads.find((l) => l.id === id); }
  function getReps() { return state.reps; }
  function getActiveReps() { return state.reps.filter((r) => r.active); }
  function getRep(id) { return state.reps.find((r) => r.id === id); }
  function getSettings() { return state.settings; }

  /* ---------------- leads CRUD ---------------- */
  function addLead(data) {
    const now = Date.now();
    const lead = {
      id: uid("lead"),
      name: data.name.trim(),
      phone: (data.phone || "").trim(),
      source: data.source || "أخرى",
      campaign: (data.campaign || "").trim(),
      createdAt: now,
      assignedRepId: data.assignedRepId || null,
      assignedAt: data.assignedRepId ? now : null,
      status: "new",
      firstContactAt: null,
      lastContactAt: null,
      nextFollowUpAt: null,
      value: Number(data.value) || 0,
      lostReason: null,
      notes: [],
      history: [{ ts: now, type: "created", text: "تم استلام الليد" }],
    };
    if (lead.assignedRepId) {
      const rep = getRep(lead.assignedRepId);
      lead.history.push({ ts: now, type: "assigned", text: `تم التوزيع على ${rep ? rep.name : ""}` });
    }
    state.leads.unshift(lead);
    save();
    return lead;
  }

  function updateLead(id, patch) {
    const lead = getLead(id);
    if (!lead) return null;
    Object.assign(lead, patch);
    save();
    return lead;
  }

  function deleteLead(id) {
    state.leads = state.leads.filter((l) => l.id !== id);
    save();
  }

  function assignLead(id, repId) {
    const lead = getLead(id);
    if (!lead) return;
    const rep = getRep(repId);
    lead.assignedRepId = repId || null;
    lead.assignedAt = repId ? Date.now() : null;
    lead.history.push({ ts: Date.now(), type: "assigned", text: repId ? `تم التوزيع على ${rep ? rep.name : ""}` : "تم إلغاء التوزيع" });
    save();
    return lead;
  }

  function autoDistribute() {
    const reps = getActiveReps();
    if (!reps.length) return 0;
    // balance by current open-lead count per rep
    const load = {};
    reps.forEach((r) => (load[r.id] = 0));
    state.leads.forEach((l) => {
      if (l.assignedRepId && OPEN_STATUSES.includes(l.status) && load.hasOwnProperty(l.assignedRepId)) {
        load[l.assignedRepId]++;
      }
    });
    const unassigned = state.leads.filter((l) => !l.assignedRepId);
    let count = 0;
    unassigned.forEach((lead) => {
      // pick the rep with least current load
      let pick = reps[0];
      reps.forEach((r) => { if (load[r.id] < load[pick.id]) pick = r; });
      lead.assignedRepId = pick.id;
      lead.assignedAt = Date.now();
      lead.history.push({ ts: Date.now(), type: "assigned", text: `توزيع تلقائي على ${pick.name}` });
      load[pick.id]++;
      count++;
    });
    if (count) save();
    return count;
  }

  function changeStatus(id, status, extra) {
    const lead = getLead(id);
    if (!lead) return;
    lead.status = status;
    if (status === "lost") lead.lostReason = (extra && extra.lostReason) || lead.lostReason;
    lead.history.push({ ts: Date.now(), type: "status", text: `تغيير الحالة إلى: ${STATUS_LABELS[status]}` });
    save();
    return lead;
  }

  function logContact(id, note) {
    const lead = getLead(id);
    if (!lead) return;
    const now = Date.now();
    if (!lead.firstContactAt) lead.firstContactAt = now;
    lead.lastContactAt = now;
    if (lead.status === "new") lead.status = "contacted";
    if (note && note.trim()) {
      lead.notes.push({ ts: now, text: note.trim(), repId: lead.assignedRepId });
    }
    lead.history.push({ ts: now, type: "contact", text: note && note.trim() ? "تسجيل تواصل: " + note.trim() : "تسجيل تواصل مع العميل" });
    save();
    return lead;
  }

  function setFollowUp(id, ts) {
    const lead = getLead(id);
    if (!lead) return;
    lead.nextFollowUpAt = ts || null;
    save();
    return lead;
  }

  /* ---------------- reps CRUD ---------------- */
  function addRep(data) {
    const rep = {
      id: uid("rep"),
      name: data.name.trim(),
      phone: (data.phone || "").trim(),
      email: (data.email || "").trim(),
      active: true,
      color: REP_COLORS[state.reps.length % REP_COLORS.length],
    };
    state.reps.push(rep);
    save();
    return rep;
  }

  function updateRep(id, patch) {
    const rep = getRep(id);
    if (!rep) return;
    Object.assign(rep, patch);
    save();
    return rep;
  }

  function toggleRepActive(id) {
    const rep = getRep(id);
    if (!rep) return;
    rep.active = !rep.active;
    save();
    return rep;
  }

  /* ---------------- settings ---------------- */
  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    save();
    return state.settings;
  }

  function addSource(name) {
    name = (name || "").trim();
    if (!name) return;
    if (!state.settings.adSources.includes(name)) {
      state.settings.adSources.push(name);
      save();
    }
  }

  /* ---------------- SLA engine ---------------- */
  // returns { stage: 'response'|'followup'|'closed'|'none', state:'ok'|'warning'|'breach', elapsedMs, thresholdMs, dueTs }
  function slaStatus(lead, now) {
    now = now || Date.now();
    const s = state.settings;
    if (lead.status === "won" || lead.status === "lost") {
      return { stage: "closed", state: "closed" };
    }
    if (!lead.firstContactAt) {
      if (!lead.assignedRepId) return { stage: "unassigned", state: "warning" };
      const base = lead.assignedAt || lead.createdAt;
      const thresholdMs = s.firstResponseSlaMinutes * 60 * 1000;
      const elapsedMs = now - base;
      const remaining = thresholdMs - elapsedMs;
      const st = remaining <= 0 ? "breach" : remaining <= thresholdMs * 0.25 ? "warning" : "ok";
      return { stage: "response", state: st, elapsedMs, thresholdMs, dueTs: base + thresholdMs };
    }
    const base = lead.lastContactAt || lead.firstContactAt;
    const thresholdMs = s.followUpSlaHours * 3600 * 1000;
    const elapsedMs = now - base;
    const remaining = thresholdMs - elapsedMs;
    const st = remaining <= 0 ? "breach" : remaining <= thresholdMs * 0.25 ? "warning" : "ok";
    return { stage: "followup", state: st, elapsedMs, thresholdMs, dueTs: base + thresholdMs };
  }

  function formatDuration(ms) {
    if (ms == null) return "-";
    const abs = Math.abs(ms);
    const mins = Math.round(abs / 60000);
    if (mins < 60) return mins + " دقيقة";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " ساعة" + (mins % 60 ? " و" + (mins % 60) + " د" : "");
    const days = Math.floor(hours / 24);
    return days + " يوم" + (hours % 24 ? " و" + (hours % 24) + " س" : "");
  }

  /* ---------------- reporting helpers ---------------- */
  function leadsInRange(fromTs, toTs) {
    return state.leads.filter((l) => l.createdAt >= fromTs && l.createdAt <= toTs);
  }

  function repStats(repId, fromTs, toTs) {
    const leads = state.leads.filter((l) => l.assignedRepId === repId && l.createdAt >= fromTs && l.createdAt <= toTs);
    const responded = leads.filter((l) => l.firstContactAt);
    const won = leads.filter((l) => l.status === "won");
    const lost = leads.filter((l) => l.status === "lost");
    const open = leads.filter((l) => OPEN_STATUSES.includes(l.status));
    const breaches = leads.filter((l) => { const s = slaStatus(l); return s.state === "breach" && s.stage !== "closed"; });
    const avgResponseMs = responded.length
      ? responded.reduce((sum, l) => sum + (l.firstContactAt - (l.assignedAt || l.createdAt)), 0) / responded.length
      : null;
    const slaMet = leads.filter((l) => {
      if (!l.firstContactAt) return false;
      const thresholdMs = state.settings.firstResponseSlaMinutes * 60 * 1000;
      return l.firstContactAt - (l.assignedAt || l.createdAt) <= thresholdMs;
    });
    return {
      total: leads.length,
      responded: responded.length,
      won: won.length,
      lost: lost.length,
      open: open.length,
      breaches: breaches.length,
      avgResponseMs,
      slaComplianceRate: leads.length ? Math.round((slaMet.length / leads.length) * 100) : null,
    };
  }

  return {
    STATUS_LABELS, STATUS_ORDER, OPEN_STATUSES, REP_COLORS,
    load, save, resetDemo, wipeAll,
    getState, getLeads, getLead, getReps, getActiveReps, getRep, getSettings,
    addLead, updateLead, deleteLead, assignLead, autoDistribute, changeStatus, logContact, setFollowUp,
    addRep, updateRep, toggleRepActive,
    updateSettings, addSource,
    slaStatus, formatDuration,
    leadsInRange, repStats,
  };
})();
