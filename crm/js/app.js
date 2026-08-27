/* ============================================================
   CRM UI Layer
   ============================================================ */
(function () {
  CRM.load();

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmtMoney = (n) => (Number(n) || 0).toLocaleString("ar-EG") + " ج.م";
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "-");
  const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString("ar-EG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

  const SLA_STATE_LABEL = { ok: "ضمن الوقت", warning: "قريب من الانتهاء", breach: "متأخر", closed: "مغلق", unassigned: "غير موزع" };
  const charts = {};

  /* ---------------- toast ---------------- */
  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    $("#toastHost").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2600);
  }

  /* ---------------- modal ---------------- */
  function openModal(title, bodyHtml, opts) {
    opts = opts || {};
    const host = $("#modalHost");
    host.innerHTML = `
      <div class="modal-overlay" id="modalOverlay">
        <div class="modal ${opts.wide ? "modal-wide" : ""}">
          <div class="modal-head">
            <h3>${title}</h3>
            <button class="icon-btn" id="modalClose" aria-label="إغلاق">✕</button>
          </div>
          <div class="modal-body">${bodyHtml}</div>
        </div>
      </div>`;
    $("#modalOverlay").addEventListener("click", (e) => { if (e.target.id === "modalOverlay") closeModal(); });
    $("#modalClose").addEventListener("click", closeModal);
    return host;
  }
  function closeModal() { $("#modalHost").innerHTML = ""; }

  /* ---------------- router / tabs ---------------- */
  const TABS = ["dashboard", "leads", "pipeline", "reps", "sla", "reports", "settings"];
  function go(tab) {
    if (!TABS.includes(tab)) tab = "dashboard";
    location.hash = tab;
  }
  function renderCurrentTab() {
    const tab = (location.hash || "#dashboard").slice(1);
    $$(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    $("#pageTitle").textContent = {
      dashboard: "لوحة التحكم", leads: "الليدز", pipeline: "مخطط المبيعات",
      reps: "مناديب المبيعات", sla: "متابعة SLA", reports: "التقارير", settings: "الإعدادات",
    }[tab] || "لوحة التحكم";
    const renderers = { dashboard: renderDashboard, leads: renderLeads, pipeline: renderPipeline, reps: renderReps, sla: renderSla, reports: renderReports, settings: renderSettings };
    (renderers[tab] || renderDashboard)();
    $("#app").className = "view-" + tab;
    $$(".sidebar").forEach((s) => s.classList.remove("open"));
  }
  window.addEventListener("hashchange", renderCurrentTab);

  /* ============================================================
     DASHBOARD
  ============================================================ */
  function renderDashboard() {
    const leads = CRM.getLeads();
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const leadsToday = leads.filter((l) => l.createdAt >= todayStart.getTime()).length;
    const unassigned = leads.filter((l) => !l.assignedRepId).length;
    const breaches = leads.filter((l) => CRM.slaStatus(l, now).state === "breach").length;
    const closed = leads.filter((l) => l.status === "won" || l.status === "lost");
    const won = leads.filter((l) => l.status === "won");
    const conv = closed.length ? Math.round((won.length / closed.length) * 100) : 0;
    const responded = leads.filter((l) => l.firstContactAt);
    const avgResp = responded.length
      ? responded.reduce((s, l) => s + (l.firstContactAt - (l.assignedAt || l.createdAt)), 0) / responded.length
      : null;

    $("#view").innerHTML = `
      <div class="kpi-grid">
        ${kpiCard("📥", leads.length, "إجمالي الليدز")}
        ${kpiCard("🆕", leadsToday, "ليدز اليوم")}
        ${kpiCard("👤", unassigned, "بدون توزيع", unassigned ? "warn" : "")}
        ${kpiCard("⏰", breaches, "متأخرة عن SLA", breaches ? "danger" : "")}
        ${kpiCard("🎯", conv + "%", "معدل التحويل")}
        ${kpiCard("⚡", avgResp != null ? CRM.formatDuration(avgResp) : "-", "متوسط زمن أول رد")}
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">الليدز حسب المصدر</h3>
          <canvas id="chartSource" height="220"></canvas>
        </div>
        <div class="card">
          <h3 class="card-title">الليدز حسب المندوب</h3>
          <canvas id="chartRep" height="220"></canvas>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">قمع المبيعات</h3>
          <canvas id="chartFunnel" height="220"></canvas>
        </div>
        <div class="card">
          <h3 class="card-title">الليدز الجديدة خلال آخر 14 يوم</h3>
          <canvas id="chartTrend" height="220"></canvas>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">⚠️ ليدز متأخرة تحتاج متابعة فورية</h3>
        <div id="urgentList"></div>
      </div>
    `;

    drawSourceChart(leads);
    drawRepChart(leads);
    drawFunnelChart(leads);
    drawTrendChart(leads);
    renderUrgentList();
  }

  function kpiCard(icon, value, label, tone) {
    return `<div class="kpi ${tone || ""}"><span class="kpi-icon">${icon}</span><div><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div></div>`;
  }

  function renderUrgentList() {
    const now = Date.now();
    const items = CRM.getLeads()
      .map((l) => ({ l, s: CRM.slaStatus(l, now) }))
      .filter((x) => x.s.state === "breach")
      .sort((a, b) => (b.s.elapsedMs || 0) - (a.s.elapsedMs || 0))
      .slice(0, 8);
    const host = $("#urgentList");
    if (!items.length) { host.innerHTML = `<p class="empty">لا توجد ليدز متأخرة حاليًا 🎉</p>`; return; }
    host.innerHTML = `<table class="table"><thead><tr><th>العميل</th><th>المندوب</th><th>المرحلة</th><th>متأخر منذ</th><th></th></tr></thead><tbody>
      ${items.map(({ l, s }) => {
        const rep = CRM.getRep(l.assignedRepId);
        return `<tr>
          <td>${esc(l.name)}</td>
          <td>${rep ? esc(rep.name) : "غير موزع"}</td>
          <td>${s.stage === "response" ? "أول رد" : "متابعة"}</td>
          <td><span class="badge breach">${CRM.formatDuration(s.elapsedMs - s.thresholdMs)}</span></td>
          <td><button class="btn btn-sm" data-open-lead="${l.id}">تفاصيل</button></td>
        </tr>`;
      }).join("")}
    </tbody></table>`;
  }

  function drawSourceChart(leads) {
    const counts = {};
    leads.forEach((l) => (counts[l.source] = (counts[l.source] || 0) + 1));
    const labels = Object.keys(counts);
    mkChart("chartSource", "doughnut", {
      labels,
      datasets: [{ data: labels.map((k) => counts[k]), backgroundColor: palette(labels.length) }],
    }, { plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } });
  }

  function drawRepChart(leads) {
    const reps = CRM.getReps();
    const data = reps.map((r) => leads.filter((l) => l.assignedRepId === r.id).length);
    mkChart("chartRep", "bar", {
      labels: reps.map((r) => r.name),
      datasets: [{ label: "عدد الليدز", data, backgroundColor: reps.map((r) => r.color) }],
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });
  }

  function drawFunnelChart(leads) {
    const order = CRM.STATUS_ORDER;
    const counts = order.map((s) => leads.filter((l) => l.status === s).length);
    mkChart("chartFunnel", "bar", {
      labels: order.map((s) => CRM.STATUS_LABELS[s]),
      datasets: [{ label: "عدد الليدز", data: counts, backgroundColor: "#2563eb" }],
    }, { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } });
  }

  function drawTrendChart(leads) {
    const days = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) days.push(new Date(now.getTime() - i * 86400000));
    const counts = days.map((d) => {
      const start = d.getTime(), end = start + 86400000;
      return leads.filter((l) => l.createdAt >= start && l.createdAt < end).length;
    });
    mkChart("chartTrend", "line", {
      labels: days.map((d) => d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" })),
      datasets: [{ label: "ليدز جديدة", data: counts, borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.15)", fill: true, tension: 0.3 }],
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });
  }

  function palette(n) {
    const base = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#4d7c0f"];
    const out = [];
    for (let i = 0; i < n; i++) out.push(base[i % base.length]);
    return out;
  }

  function mkChart(id, type, data, options) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, { type, data, options: Object.assign({ responsive: true, maintainAspectRatio: false }, options || {}) });
  }

  /* ============================================================
     LEADS
  ============================================================ */
  let leadFilters = { q: "", status: "", rep: "", source: "", sla: "" };

  function renderLeads() {
    const reps = CRM.getReps();
    const sources = CRM.getSettings().adSources;
    $("#view").innerHTML = `
      <div class="toolbar">
        <input type="search" id="fltSearch" placeholder="ابحث بالاسم أو الهاتف..." value="${esc(leadFilters.q)}">
        <select id="fltStatus"><option value="">كل الحالات</option>${CRM.STATUS_ORDER.map((s) => `<option value="${s}" ${leadFilters.status === s ? "selected" : ""}>${CRM.STATUS_LABELS[s]}</option>`).join("")}</select>
        <select id="fltRep"><option value="">كل المناديب</option><option value="__none" ${leadFilters.rep === "__none" ? "selected" : ""}>غير موزع</option>${reps.map((r) => `<option value="${r.id}" ${leadFilters.rep === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
        <select id="fltSource"><option value="">كل المصادر</option>${sources.map((s) => `<option value="${esc(s)}" ${leadFilters.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <select id="fltSla"><option value="">كل حالات SLA</option><option value="breach" ${leadFilters.sla === "breach" ? "selected" : ""}>متأخر</option><option value="warning" ${leadFilters.sla === "warning" ? "selected" : ""}>قريب من الانتهاء</option><option value="ok" ${leadFilters.sla === "ok" ? "selected" : ""}>ضمن الوقت</option></select>
        <div class="spacer"></div>
        <button class="btn" id="btnAutoDistribute">🔀 توزيع تلقائي</button>
        <button class="btn btn-primary" id="btnAddLead">+ إضافة ليد</button>
      </div>
      <div class="card table-card">
        <div id="leadsTableHost"></div>
      </div>
    `;
    renderLeadsTable();

    $("#fltSearch").addEventListener("input", (e) => { leadFilters.q = e.target.value; renderLeadsTable(); });
    $("#fltStatus").addEventListener("change", (e) => { leadFilters.status = e.target.value; renderLeadsTable(); });
    $("#fltRep").addEventListener("change", (e) => { leadFilters.rep = e.target.value; renderLeadsTable(); });
    $("#fltSource").addEventListener("change", (e) => { leadFilters.source = e.target.value; renderLeadsTable(); });
    $("#fltSla").addEventListener("change", (e) => { leadFilters.sla = e.target.value; renderLeadsTable(); });
    $("#btnAddLead").addEventListener("click", openAddLeadModal);
    $("#btnAutoDistribute").addEventListener("click", () => {
      const n = CRM.autoDistribute();
      toast(n ? `تم توزيع ${n} ليد على المناديب` : "لا توجد ليدز غير موزعة");
      renderLeadsTable();
    });
  }

  function filteredLeads() {
    const now = Date.now();
    return CRM.getLeads().filter((l) => {
      if (leadFilters.q) {
        const q = leadFilters.q.trim();
        if (!(l.name.includes(q) || l.phone.includes(q))) return false;
      }
      if (leadFilters.status && l.status !== leadFilters.status) return false;
      if (leadFilters.rep === "__none" && l.assignedRepId) return false;
      if (leadFilters.rep && leadFilters.rep !== "__none" && l.assignedRepId !== leadFilters.rep) return false;
      if (leadFilters.source && l.source !== leadFilters.source) return false;
      if (leadFilters.sla) {
        const st = CRM.slaStatus(l, now).state;
        if (st !== leadFilters.sla) return false;
      }
      return true;
    });
  }

  function renderLeadsTable() {
    const leads = filteredLeads().sort((a, b) => b.createdAt - a.createdAt);
    const host = $("#leadsTableHost");
    if (!leads.length) { host.innerHTML = `<p class="empty">لا توجد ليدز مطابقة</p>`; return; }
    host.innerHTML = `<table class="table">
      <thead><tr><th>العميل</th><th>المصدر</th><th>المندوب</th><th>الحالة</th><th>SLA</th><th>تاريخ الاستلام</th><th>القيمة</th><th></th></tr></thead>
      <tbody>
        ${leads.map((l) => {
          const rep = CRM.getRep(l.assignedRepId);
          const s = CRM.slaStatus(l);
          return `<tr class="row-click" data-open-lead="${l.id}">
            <td><div class="cell-title">${esc(l.name)}</div><div class="cell-sub">${esc(l.phone)}</div></td>
            <td><span class="badge src">${esc(l.source)}</span></td>
            <td>${rep ? repChip(rep) : `<span class="muted">غير موزع</span>`}</td>
            <td><span class="badge status-${l.status}">${CRM.STATUS_LABELS[l.status]}</span></td>
            <td><span class="badge ${s.state}">${SLA_STATE_LABEL[s.state]}</span></td>
            <td>${fmtDate(l.createdAt)}</td>
            <td>${fmtMoney(l.value)}</td>
            <td><button class="btn btn-sm" data-open-lead="${l.id}">تفاصيل</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  }

  function repChip(rep) {
    return `<span class="rep-chip"><span class="dot" style="background:${rep.color}"></span>${esc(rep.name)}</span>`;
  }

  function openAddLeadModal() {
    const reps = CRM.getActiveReps();
    const sources = CRM.getSettings().adSources;
    openModal("إضافة ليد جديد", `
      <form id="addLeadForm" class="form">
        <label>اسم العميل <input required name="name" type="text"></label>
        <label>رقم الهاتف <input required name="phone" type="tel" dir="ltr"></label>
        <div class="form-row">
          <label>المصدر <select name="source">${sources.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
          <label>القيمة المتوقعة <input name="value" type="number" min="0" step="100"></label>
        </div>
        <label>اسم الحملة الإعلانية (اختياري) <input name="campaign" type="text"></label>
        <label>توزيع على المندوب <select name="assignedRepId"><option value="">بدون توزيع الآن</option>${reps.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select></label>
        <div class="modal-actions"><button type="submit" class="btn btn-primary">إضافة الليد</button></div>
      </form>
    `);
    $("#addLeadForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const lead = CRM.addLead({
        name: f.get("name"), phone: f.get("phone"), source: f.get("source"),
        value: f.get("value"), campaign: f.get("campaign"), assignedRepId: f.get("assignedRepId"),
      });
      closeModal();
      toast("تمت إضافة الليد بنجاح");
      renderCurrentTab();
      openLeadModal(lead.id);
    });
  }

  function openLeadModal(id) {
    const l = CRM.getLead(id);
    if (!l) return;
    const rep = CRM.getRep(l.assignedRepId);
    const s = CRM.slaStatus(l);
    const reps = CRM.getActiveReps();
    openModal(esc(l.name), `
      <div class="lead-detail">
        <div class="lead-meta">
          <div><b>الهاتف</b><span dir="ltr">${esc(l.phone)}</span></div>
          <div><b>المصدر</b><span>${esc(l.source)}${l.campaign ? " — " + esc(l.campaign) : ""}</span></div>
          <div><b>تاريخ الاستلام</b><span>${fmtDateTime(l.createdAt)}</span></div>
          <div><b>القيمة المتوقعة</b><span>${fmtMoney(l.value)}</span></div>
          <div><b>حالة SLA</b><span class="badge ${s.state}">${SLA_STATE_LABEL[s.state]}${s.dueTs ? " — " + (s.state === "breach" ? "متأخر " + CRM.formatDuration(Math.abs(s.elapsedMs - s.thresholdMs)) : "متبقي " + CRM.formatDuration(s.thresholdMs - s.elapsedMs)) : ""}</span></div>
        </div>

        <div class="form-row">
          <label>المندوب المسؤول
            <select id="leadRepSelect"><option value="">بدون توزيع</option>${reps.map((r) => `<option value="${r.id}" ${l.assignedRepId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
          </label>
          <label>الحالة
            <select id="leadStatusSelect">${CRM.STATUS_ORDER.map((st) => `<option value="${st}" ${l.status === st ? "selected" : ""}>${CRM.STATUS_LABELS[st]}</option>`).join("")}</select>
          </label>
        </div>

        <div class="contact-log">
          <textarea id="contactNote" placeholder="اكتب ملاحظة عن المكالمة/التواصل (اختياري)..." rows="2"></textarea>
          <button class="btn btn-primary" id="btnLogContact">📞 تسجيل تواصل الآن</button>
        </div>

        <h4>السجل الزمني</h4>
        <div class="timeline">
          ${l.history.slice().reverse().map((h) => `<div class="tl-item"><span class="tl-dot tl-${h.type}"></span><div><div class="tl-text">${esc(h.text)}</div><div class="tl-ts">${fmtDateTime(h.ts)}</div></div></div>`).join("") || `<p class="empty">لا يوجد سجل بعد</p>`}
        </div>

        <div class="modal-actions between">
          <button class="btn btn-danger-outline" id="btnDeleteLead">حذف الليد</button>
        </div>
      </div>
    `, { wide: true });

    $("#leadRepSelect").addEventListener("change", (e) => { CRM.assignLead(id, e.target.value || null); toast("تم تحديث التوزيع"); openLeadModal(id); renderCurrentTab(); });
    $("#leadStatusSelect").addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "lost") {
        const reason = prompt("سبب الخسارة (اختياري):") || "";
        CRM.changeStatus(id, val, { lostReason: reason });
      } else {
        CRM.changeStatus(id, val);
      }
      toast("تم تحديث الحالة");
      openLeadModal(id);
      renderCurrentTab();
    });
    $("#btnLogContact").addEventListener("click", () => {
      CRM.logContact(id, $("#contactNote").value);
      toast("تم تسجيل التواصل");
      openLeadModal(id);
      renderCurrentTab();
    });
    $("#btnDeleteLead").addEventListener("click", () => {
      if (confirm("هل أنت متأكد من حذف هذا الليد نهائيًا؟")) {
        CRM.deleteLead(id);
        closeModal();
        toast("تم حذف الليد");
        renderCurrentTab();
      }
    });
  }

  /* ============================================================
     PIPELINE (Kanban)
  ============================================================ */
  function renderPipeline() {
    const leads = CRM.getLeads();
    const cols = CRM.STATUS_ORDER;
    $("#view").innerHTML = `<div class="kanban">
      ${cols.map((st) => {
        const items = leads.filter((l) => l.status === st);
        const value = items.reduce((s, l) => s + (Number(l.value) || 0), 0);
        return `<div class="kanban-col" data-status="${st}">
          <div class="kanban-head">
            <span>${CRM.STATUS_LABELS[st]}</span>
            <span class="kanban-count">${items.length}</span>
          </div>
          <div class="kanban-value">${fmtMoney(value)}</div>
          <div class="kanban-cards" data-dropzone="${st}">
            ${items.map((l) => {
              const rep = CRM.getRep(l.assignedRepId);
              const s = CRM.slaStatus(l);
              return `<div class="kcard" draggable="true" data-lead="${l.id}" data-open-lead="${l.id}">
                <div class="kcard-top"><span class="sla-dot ${s.state}"></span><span class="kcard-name">${esc(l.name)}</span></div>
                <div class="kcard-row"><span class="badge src sm">${esc(l.source)}</span>${rep ? repChip(rep) : `<span class="muted sm">غير موزع</span>`}</div>
                <div class="kcard-value">${fmtMoney(l.value)}</div>
              </div>`;
            }).join("")}
          </div>
        </div>`;
      }).join("")}
    </div>`;
    setupDragDrop();
  }

  function setupDragDrop() {
    let draggedId = null;
    $$(".kcard").forEach((card) => {
      card.addEventListener("dragstart", (e) => { draggedId = card.dataset.lead; card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
    });
    $$(".kanban-cards").forEach((zone) => {
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("drag-over");
        if (!draggedId) return;
        const newStatus = zone.dataset.dropzone;
        CRM.changeStatus(draggedId, newStatus);
        toast("تم نقل الليد إلى: " + CRM.STATUS_LABELS[newStatus]);
        renderPipeline();
      });
    });
  }

  /* ============================================================
     REPS
  ============================================================ */
  function renderReps() {
    const reps = CRM.getReps();
    const now = Date.now();
    const fromTs = 0, toTs = now;
    $("#view").innerHTML = `
      <div class="toolbar"><div class="spacer"></div><button class="btn btn-primary" id="btnAddRep">+ إضافة مندوب</button></div>
      <div class="rep-grid">
        ${reps.map((r) => {
          const stats = CRM.repStats(r.id, fromTs, toTs);
          return `<div class="card rep-card ${r.active ? "" : "inactive"}">
            <div class="rep-card-head">
              <span class="dot lg" style="background:${r.color}"></span>
              <div><div class="rep-name">${esc(r.name)}</div><div class="cell-sub" dir="ltr">${esc(r.phone || "")}</div></div>
              <label class="switch"><input type="checkbox" data-toggle-rep="${r.id}" ${r.active ? "checked" : ""}><span></span></label>
            </div>
            <div class="rep-stats">
              <div><b>${stats.total}</b><span>إجمالي</span></div>
              <div><b>${stats.open}</b><span>مفتوح</span></div>
              <div><b>${stats.won}</b><span>ناجحة</span></div>
              <div><b class="${stats.breaches ? "text-danger" : ""}">${stats.breaches}</b><span>متأخر</span></div>
              <div><b>${stats.avgResponseMs != null ? CRM.formatDuration(stats.avgResponseMs) : "-"}</b><span>متوسط الرد</span></div>
              <div><b>${stats.slaComplianceRate != null ? stats.slaComplianceRate + "%" : "-"}</b><span>التزام SLA</span></div>
            </div>
          </div>`;
        }).join("")}
      </div>
    `;
    $("#btnAddRep").addEventListener("click", openAddRepModal);
    $$("[data-toggle-rep]").forEach((el) => el.addEventListener("change", (e) => { CRM.toggleRepActive(e.target.dataset.toggleRep); renderReps(); }));
  }

  function openAddRepModal() {
    openModal("إضافة مندوب مبيعات", `
      <form id="addRepForm" class="form">
        <label>الاسم <input required name="name" type="text"></label>
        <label>رقم الهاتف <input name="phone" type="tel" dir="ltr"></label>
        <label>البريد الإلكتروني <input name="email" type="email" dir="ltr"></label>
        <div class="modal-actions"><button type="submit" class="btn btn-primary">إضافة</button></div>
      </form>
    `);
    $("#addRepForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      CRM.addRep({ name: f.get("name"), phone: f.get("phone"), email: f.get("email") });
      closeModal();
      toast("تمت إضافة المندوب");
      renderReps();
    });
  }

  /* ============================================================
     SLA
  ============================================================ */
  function renderSla() {
    const settings = CRM.getSettings();
    const now = Date.now();
    const openLeads = CRM.getLeads()
      .filter((l) => CRM.OPEN_STATUSES.includes(l.status))
      .map((l) => ({ l, s: CRM.slaStatus(l, now) }))
      .sort((a, b) => {
        const order = { breach: 0, unassigned: 1, warning: 2, ok: 3 };
        return (order[a.s.state] ?? 9) - (order[b.s.state] ?? 9);
      });

    $("#view").innerHTML = `
      <div class="card">
        <h3 class="card-title">إعدادات SLA</h3>
        <form id="slaForm" class="form form-inline">
          <label>مهلة أول رد (دقيقة) <input type="number" min="1" name="firstResponseSlaMinutes" value="${settings.firstResponseSlaMinutes}"></label>
          <label>مهلة المتابعة (ساعة) <input type="number" min="1" name="followUpSlaHours" value="${settings.followUpSlaHours}"></label>
          <button type="submit" class="btn btn-primary">حفظ الإعدادات</button>
        </form>
      </div>

      <div class="card table-card">
        <h3 class="card-title">الليدز المفتوحة حسب الأولوية</h3>
        <table class="table">
          <thead><tr><th>العميل</th><th>المندوب</th><th>الحالة</th><th>المرحلة</th><th>الوقت</th><th>SLA</th><th></th></tr></thead>
          <tbody>
            ${openLeads.map(({ l, s }) => {
              const rep = CRM.getRep(l.assignedRepId);
              const timeText = s.stage === "unassigned" ? "بانتظار التوزيع"
                : s.state === "breach" ? "متأخر " + CRM.formatDuration(Math.abs(s.elapsedMs - s.thresholdMs))
                : s.thresholdMs != null ? "متبقي " + CRM.formatDuration(s.thresholdMs - s.elapsedMs) : "-";
              return `<tr>
                <td>${esc(l.name)}</td>
                <td>${rep ? repChip(rep) : `<span class="muted">غير موزع</span>`}</td>
                <td><span class="badge status-${l.status}">${CRM.STATUS_LABELS[l.status]}</span></td>
                <td>${s.stage === "response" ? "أول رد" : s.stage === "followup" ? "متابعة" : "-"}</td>
                <td>${timeText}</td>
                <td><span class="badge ${s.state}">${SLA_STATE_LABEL[s.state]}</span></td>
                <td><button class="btn btn-sm" data-open-lead="${l.id}">فتح</button></td>
              </tr>`;
            }).join("") || `<tr><td colspan="7" class="empty">لا توجد ليدز مفتوحة</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="card table-card">
        <h3 class="card-title">التزام المناديب بـ SLA</h3>
        <table class="table">
          <thead><tr><th>المندوب</th><th>إجمالي الليدز</th><th>تم الرد عليها</th><th>متوسط زمن الرد</th><th>نسبة الالتزام</th><th>متأخر حاليًا</th></tr></thead>
          <tbody>
            ${CRM.getReps().map((r) => {
              const st = CRM.repStats(r.id, 0, now);
              return `<tr>
                <td>${repChip(r)}</td>
                <td>${st.total}</td>
                <td>${st.responded}</td>
                <td>${st.avgResponseMs != null ? CRM.formatDuration(st.avgResponseMs) : "-"}</td>
                <td>${st.slaComplianceRate != null ? st.slaComplianceRate + "%" : "-"}</td>
                <td>${st.breaches ? `<span class="badge breach">${st.breaches}</span>` : "0"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    $("#slaForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      CRM.updateSettings({
        firstResponseSlaMinutes: Number(f.get("firstResponseSlaMinutes")) || 60,
        followUpSlaHours: Number(f.get("followUpSlaHours")) || 24,
      });
      toast("تم حفظ إعدادات SLA");
      renderSla();
    });
  }

  /* ============================================================
     REPORTS
  ============================================================ */
  let reportRange = "month";
  function rangeToTs(range) {
    const now = new Date();
    const end = now.getTime();
    let start;
    if (range === "today") { const d = new Date(now); d.setHours(0, 0, 0, 0); start = d.getTime(); }
    else if (range === "week") start = end - 7 * 86400000;
    else if (range === "month") start = end - 30 * 86400000;
    else start = 0;
    return { from: start, to: end };
  }

  function renderReports() {
    const { from, to } = rangeToTs(reportRange);
    const leads = CRM.leadsInRange(from, to);

    $("#view").innerHTML = `
      <div class="toolbar">
        <select id="reportRange">
          <option value="today" ${reportRange === "today" ? "selected" : ""}>اليوم</option>
          <option value="week" ${reportRange === "week" ? "selected" : ""}>آخر 7 أيام</option>
          <option value="month" ${reportRange === "month" ? "selected" : ""}>آخر 30 يوم</option>
          <option value="all" ${reportRange === "all" ? "selected" : ""}>كل الفترات</option>
        </select>
        <div class="spacer"></div>
        <button class="btn" id="btnExportCsv">⬇️ تصدير CSV</button>
      </div>

      <div class="kpi-grid">
        ${kpiCard("📥", leads.length, "ليدز في الفترة")}
        ${kpiCard("✅", leads.filter((l) => l.status === "won").length, "صفقات ناجحة")}
        ${kpiCard("❌", leads.filter((l) => l.status === "lost").length, "صفقات خاسرة")}
        ${kpiCard("💰", fmtMoney(leads.filter((l) => l.status === "won").reduce((s, l) => s + (Number(l.value) || 0), 0)), "قيمة الصفقات الناجحة")}
      </div>

      <div class="grid-2">
        <div class="card"><h3 class="card-title">الليدز حسب المصدر</h3><canvas id="repChartSource" height="220"></canvas></div>
        <div class="card"><h3 class="card-title">الليدز حسب الحالة</h3><canvas id="repChartStatus" height="220"></canvas></div>
      </div>

      <div class="card table-card">
        <h3 class="card-title">أداء المناديب خلال الفترة</h3>
        <table class="table">
          <thead><tr><th>المندوب</th><th>الليدز</th><th>الردود</th><th>ناجحة</th><th>خاسرة</th><th>متوسط الرد</th><th>التزام SLA</th></tr></thead>
          <tbody>
            ${CRM.getReps().map((r) => {
              const st = CRM.repStats(r.id, from, to);
              return `<tr>
                <td>${repChip(r)}</td><td>${st.total}</td><td>${st.responded}</td><td>${st.won}</td><td>${st.lost}</td>
                <td>${st.avgResponseMs != null ? CRM.formatDuration(st.avgResponseMs) : "-"}</td>
                <td>${st.slaComplianceRate != null ? st.slaComplianceRate + "%" : "-"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    $("#reportRange").addEventListener("change", (e) => { reportRange = e.target.value; renderReports(); });
    $("#btnExportCsv").addEventListener("click", () => exportCsv(leads));

    const srcCounts = {};
    leads.forEach((l) => (srcCounts[l.source] = (srcCounts[l.source] || 0) + 1));
    mkChart("repChartSource", "doughnut", { labels: Object.keys(srcCounts), datasets: [{ data: Object.values(srcCounts), backgroundColor: palette(Object.keys(srcCounts).length) }] }, { plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } });

    const statusCounts = CRM.STATUS_ORDER.map((s) => leads.filter((l) => l.status === s).length);
    mkChart("repChartStatus", "bar", { labels: CRM.STATUS_ORDER.map((s) => CRM.STATUS_LABELS[s]), datasets: [{ label: "عدد", data: statusCounts, backgroundColor: "#2563eb" }] }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });
  }

  function exportCsv(leads) {
    const headers = ["الاسم", "الهاتف", "المصدر", "الحملة", "المندوب", "الحالة", "تاريخ الاستلام", "أول تواصل", "آخر تواصل", "القيمة"];
    const rows = leads.map((l) => {
      const rep = CRM.getRep(l.assignedRepId);
      return [l.name, l.phone, l.source, l.campaign || "", rep ? rep.name : "", CRM.STATUS_LABELS[l.status], fmtDate(l.createdAt), fmtDate(l.firstContactAt), fmtDate(l.lastContactAt), l.value]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });
    const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "crm-leads-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("تم تصدير الملف");
  }

  /* ============================================================
     SETTINGS
  ============================================================ */
  // Accepts either strict JSON or the raw JS snippet Firebase's console gives
  // (unquoted keys, a "const firebaseConfig = ...;" wrapper, // comments, a
  // trailing comma) — pasting that snippet as-is is the normal path for users.
  function parseFirebaseConfig(raw) {
    let text = String(raw || "").trim();
    if (!text) throw new Error("empty");
    try { return JSON.parse(text); } catch (e) {}
    text = text.replace(/\/\/[^\n]*$/gm, "");
    const namedMatch = text.match(/firebaseConfig\s*=\s*\{/);
    const start = namedMatch ? namedMatch.index + namedMatch[0].length - 1 : text.indexOf("{");
    if (start === -1) throw new Error("no object literal found");
    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error("unbalanced braces");
    const objLiteral = text.slice(start, end + 1);
    const value = new Function('"use strict"; return (' + objLiteral + ");")();
    if (!value || typeof value !== "object") throw new Error("not an object");
    return value;
  }

  const FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

  function renderSettings() {
    const settings = CRM.getSettings();
    const connected = CRM.isCloudConnected();
    const hasSavedConfig = !!CRM.getFirebaseConfig();
    $("#view").innerHTML = `
      <div class="card">
        <h3 class="card-title">مشاركة البيانات مع الفريق (مزامنة سحابية)</h3>
        <p class="cell-sub">افتراضيًا البيانات محفوظة على هذا الجهاز فقط. لو عايز إنت والمناديب تشوفوا نفس الليدز لحظيًا من أي جهاز، وصّل النظام بقاعدة بيانات Firebase مجانية (خطوات بسيطة، حساب جوجل كفاية).</p>

        <div id="cloudStatusBox" class="cloud-status ${connected ? "on" : hasSavedConfig ? "pending" : "off"}">
          ${connected ? "🟢 متصل — البيانات الآن مشتركة بينك وبين كل من يفتح النظام بنفس الإعدادات" : hasSavedConfig ? "🟡 محفوظ إعدادات اتصال لكن غير متصل حاليًا" : "⚪ غير متصل — البيانات محلية على هذا الجهاز فقط"}
        </div>

        ${connected ? `
          <div class="modal-actions" style="margin-top:10px">
            <button class="btn btn-danger-outline" id="btnDisconnectCloud">قطع الاتصال والرجوع للوضع المحلي</button>
          </div>
        ` : `
          <details class="cloud-guide" ${hasSavedConfig ? "" : "open"}>
            <summary>خطوات إنشاء قاعدة بيانات مجانية (Firebase) — 5 دقايق</summary>
            <ol>
              <li>ادخل على <b>console.firebase.google.com</b> وسجل بحساب Google بتاعك.</li>
              <li>اضغط "Add project" وسمّي المشروع أي اسم (مثلاً crm-sales) وكمّل الإنشاء.</li>
              <li>من القائمة الجانبية: Build ← Firestore Database ← Create database، اختر أي موقع سيرفر واضغط Next حتى تنشئها (اختر وضع "test mode" أو "production" ثم استخدم القواعد اللي تحت).</li>
              <li>من نفس صفحة Firestore افتح تبويب Rules، امسح المكتوب والصق القواعد دي واضغط Publish:
                <pre class="code-block" id="rulesBlock">${esc(FIRESTORE_RULES)}</pre>
                <button type="button" class="btn btn-sm" id="btnCopyRules">نسخ القواعد</button>
              </li>
              <li>من القائمة الجانبية: Build ← Authentication ← Get started ← فعّل طريقة "Anonymous" من تبويب Sign-in method.</li>
              <li>ارجع لصفحة المشروع الرئيسية، اضغط أيقونة ⚙️ بجانب "Project Overview" ← Project settings، انزل لقسم "Your apps" واضغط أيقونة الويب &lt;/&gt; لإنشاء تطبيق ويب، وهيديك كائن <code>firebaseConfig</code> — انسخه كامل والصقه تحت.</li>
            </ol>
          </details>

          <form id="cloudConnectForm" class="form" style="margin-top:12px">
            <label>الصق كود firebaseConfig هنا (تقدر تلصقه زي ما هو من Firebase، مش لازم تعدّل فيه حاجة)
              <textarea name="config" rows="8" placeholder='const firebaseConfig = {&#10;  apiKey: "...",&#10;  authDomain: "...",&#10;  projectId: "...",&#10;  ...&#10;};'></textarea>
            </label>
            <div id="cloudConnectError" class="form-error"></div>
            <div class="modal-actions" style="justify-content:flex-start">
              <button type="submit" class="btn btn-primary" id="btnConnectCloud">اتصال ومزامنة</button>
            </div>
          </form>
        `}
      </div>

      <div class="card">
        <h3 class="card-title">مصادر الإعلانات</h3>
        <div class="tag-list" id="sourceTags">
          ${settings.adSources.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}
        </div>
        <form id="addSourceForm" class="form form-inline" style="margin-top:12px">
          <label>مصدر جديد <input name="source" type="text" placeholder="مثال: يوتيوب"></label>
          <button type="submit" class="btn">إضافة</button>
        </form>
      </div>

      <div class="card">
        <h3 class="card-title">إدارة البيانات</h3>
        <p class="cell-sub">تُحفظ بيانات هذا النظام محليًا في متصفحك.</p>
        <div class="modal-actions">
          <button class="btn" id="btnResetDemo">إعادة تحميل بيانات تجريبية</button>
          <button class="btn btn-danger-outline" id="btnWipeAll">حذف كل البيانات</button>
        </div>
      </div>
    `;
    $("#addSourceForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      CRM.addSource(f.get("source"));
      renderSettings();
    });

    if ($("#btnCopyRules")) {
      $("#btnCopyRules").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(FIRESTORE_RULES); toast("تم نسخ القواعد"); }
        catch (e) { toast("تعذر النسخ التلقائي — انسخ النص يدويًا"); }
      });
    }
    if ($("#cloudConnectForm")) {
      $("#cloudConnectForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const raw = new FormData(e.target).get("config");
        const errEl = $("#cloudConnectError");
        errEl.textContent = "";
        let config;
        try {
          config = parseFirebaseConfig(raw);
        } catch (e1) {
          errEl.textContent = "تعذرت قراءة الكود اللي لصقته — تأكد إنك نسخت كائن firebaseConfig كامل (من { لحد })، من قسم Your apps في إعدادات مشروع Firebase";
          return;
        }
        const btn = $("#btnConnectCloud");
        btn.disabled = true; btn.textContent = "جاري الاتصال...";
        try {
          await CRM.connectCloud(config);
          toast("تم الاتصال بنجاح — البيانات أصبحت مشتركة");
          updateSyncBadge();
          renderSettings();
          renderCurrentTab();
        } catch (err) {
          console.error(err);
          errEl.textContent = "تعذر الاتصال: " + (err && err.message ? err.message : "تحقق من الإعدادات وقواعد Firestore");
          btn.disabled = false; btn.textContent = "اتصال ومزامنة";
        }
      });
    }
    if ($("#btnDisconnectCloud")) {
      $("#btnDisconnectCloud").addEventListener("click", () => {
        if (confirm("سيتم قطع الاتصال بقاعدة البيانات المشتركة والرجوع لتخزين البيانات على هذا الجهاز فقط. متابعة؟")) {
          CRM.forgetCloud();
          updateSyncBadge();
          toast("تم قطع الاتصال — الوضع المحلي الآن");
          renderSettings();
        }
      });
    }

    $("#btnResetDemo").addEventListener("click", () => {
      if (confirm("سيتم استبدال البيانات الحالية ببيانات تجريبية. متابعة؟")) { CRM.resetDemo(); toast("تم تحميل بيانات تجريبية"); renderCurrentTab(); }
    });
    $("#btnWipeAll").addEventListener("click", () => {
      if (confirm("سيتم حذف كل الليدز والمناديب نهائيًا. هل أنت متأكد؟")) { CRM.wipeAll(); toast("تم حذف جميع البيانات"); renderCurrentTab(); }
    });
  }

  /* ---------------- cloud sync status badge ---------------- */
  function updateSyncBadge() {
    const el = $("#syncStatus");
    if (!el) return;
    if (CRM.isCloudConnected()) {
      el.textContent = "🟢 متصل — بيانات مشتركة";
      el.className = "sync-status on";
    } else if (CRM.getFirebaseConfig()) {
      el.textContent = "🟡 جاري الاتصال...";
      el.className = "sync-status pending";
    } else {
      el.textContent = "⚪ وضع محلي";
      el.className = "sync-status off";
    }
  }

  /* ---------------- utils ---------------- */
  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- global click delegation ---------------- */
  document.addEventListener("click", (e) => {
    const openLeadEl = e.target.closest("[data-open-lead]");
    if (openLeadEl) { openLeadModal(openLeadEl.dataset.openLead); return; }
    const navLink = e.target.closest(".nav-link");
    if (navLink) { e.preventDefault(); go(navLink.dataset.tab); }
  });

  $("#menuToggle").addEventListener("click", () => $(".sidebar").classList.toggle("open"));

  /* ---------------- boot ---------------- */
  CRM.onChange(() => { renderCurrentTab(); updateSyncBadge(); });

  if (!location.hash) location.hash = "#dashboard";
  renderCurrentTab();
  updateSyncBadge();

  const savedCloudConfig = CRM.getFirebaseConfig();
  if (savedCloudConfig) {
    CRM.connectCloud(savedCloudConfig)
      .then(() => { toast("تم الاتصال بقاعدة البيانات المشتركة"); updateSyncBadge(); })
      .catch((err) => {
        console.error("CRM cloud auto-connect failed:", err);
        toast("تعذر الاتصال بالبيانات المشتركة — يعمل النظام محليًا مؤقتًا");
        updateSyncBadge();
      });
  }
})();
