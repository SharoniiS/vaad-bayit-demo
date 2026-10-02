// ===================================================================
//  אתר ועד הבית, תצוגה ולוגיקה
//  • ניתוב לפי hash:  #/home  #/payments  #/unit/<id>  #/collection/<id>
//                      #/projects  #/project/<id>  #/docs  #/admin
//  • כל הנתונים נטענים לזיכרון ומרונדרים מחדש אחרי כל שינוי.
//  • עריכה זמינה רק במצב ניהול; הדיירים רואים את אותם מסכים לקריאה בלבד.
// ===================================================================
(function () {
  "use strict";

  /* ============================== קבועים ============================== */
  const STATUSES = [
    { id: "planning",    label: "בתכנון",           short: "תכנון",      tone: "neutral" },
    { id: "consulting",  label: "ייעוץ מקצועי",     short: "ייעוץ",      tone: "info" },
    { id: "quotes",      label: "איסוף הצעות מחיר", short: "הצעות מחיר", tone: "warn" },
    { id: "approved",    label: "אושר לביצוע",      short: "אושר",       tone: "info" },
    { id: "in_progress", label: "בביצוע",           short: "ביצוע",      tone: "warn" },
    { id: "done",        label: "הושלם",            short: "הושלם",      tone: "ok" }
  ];
  const STATUS = Object.fromEntries(STATUSES.map(s => [s.id, s]));

  // סוגי מסמכים. receipt עם סכום נספר כהוצאה מהקופה.
  const KINDS = {
    report:  { label: 'דו"ח / חוות דעת', section: "דוחות וחוות דעת", icon: "report",       ph: 'דו"ח יועץ גינון' },
    quote:   { label: "הצעת מחיר",       section: "הצעות מחיר",       icon: "file-invoice", ph: "הצעת מחיר מגנן" },
    receipt: { label: "קבלה / הוצאה",    section: "קבלות והוצאות",    icon: "receipt",      ph: "קבלה על ריסוס" },
    before:  { label: "לפני העבודה",     section: "לפני",             icon: "photo",        ph: "מצב לפני העבודה" },
    after:   { label: "אחרי העבודה",     section: "אחרי",             icon: "photo-check",  ph: "מצב אחרי העבודה" },
    other:   { label: "מסמך אחר",        section: "מסמכים נוספים",    icon: "file",         ph: "" }
  };
  const KIND_ORDER = ["report", "quote", "receipt", "before", "after", "other"];
  const PHOTO_KINDS = ["before", "after"];

  const METHODS = ["מזומן", "ביט", "פייבוקס", "העברה בנקאית", "צ'ק", "אחר"];
  const ICONS = ["bug", "plant-2", "stairs", "bolt", "droplet", "paint", "elevator", "building", "tool", "trash", "key", "shield"];
  const FILE_ACCEPT = "image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx";
  const UNIT = "תת חלקה";

  const S = { openCharges: new Set(), data: null, admin: false, routeKey: "", files: new Map(), urls: new Map(), docFilter: { project: "all", kind: "all" } };
  const $main = document.getElementById("main");

  /* ============================== עזרים ============================== */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });
  const iso = s => `<bdi dir="ltr">${s}</bdi>`; // בידוד כיווניות למספרים בתוך טקסט עברי (מחזיר HTML)
  const money = n => { n = Number(n) || 0; return iso((n < 0 ? "-" : "") + nf.format(Math.abs(Math.round(n * 100) / 100)) + " ₪"); };
  const dateText = d => d ? String(d).slice(0, 10).split("-").reverse().join(".") : "";
  const fmtDate = d => d ? iso(dateText(d)) : "";
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);
  const icon = (name, cls = "") => `<i class="ti ti-${esc(name)} ${cls}" aria-hidden="true"></i>`;
  const isImage = f => /^image\//.test(f.type || "") || /\.(jpe?g|png|gif|webp|heic)$/i.test(f.name || "");
  const isVideo = f => /^video\//.test(f.type || "") || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name || "");
  const isMedia = f => isImage(f) || isVideo(f);
  const MAX_FILE_MB = 50; // מגבלת קובץ בודד באחסון החינמי בענן

  const T = name => (S.data && S.data[name]) || [];
  const find = (name, id) => T(name).find(x => x.id === id);
  const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), "he", { numeric: true });
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  const byDateDesc = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  const nextOrder = name => Math.max(0, ...T(name).map(x => x.order || 0)) + 1;

  const units = all => T("units").filter(u => all || !u.archived).sort(byLabel);
  const projects = all => T("projects").filter(p => all || !p.archived).sort(byOrder);
  const collections = all => T("collections").filter(c => all || !c.archived).sort(byOrder);
  // גביות מיוחדות = כל מה שאינו חודש של דמי ועד
  const special = all => collections(all).filter(c => !c.series);
  const duesMonths = () => T("collections").filter(c => c.series === "dues").sort((a, b) => a.month.localeCompare(b.month));

  /* חודשים */
  const MONTHS = window.VAAD_MONTH_NAMES;
  const curMonth = () => todayISO().slice(0, 7);
  const monthLong = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const MONTHS_SHORT = ["ינו'", "פבר'", "מרץ", "אפר'", "מאי", "יוני", "יולי", "אוג'", "ספט'", "אוק'", "נוב'", "דצמ'"];
  const monthShort = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`; };
  const collTitle = c => c.series === "dues" ? `דמי ועד ${monthLong(c.month)}` : c.title;
  // החודש שמוצג כ"נוכחי": החודש הנוכחי אם קיים בטווח, אחרת האחרון שעבר, אחרת הראשון
  const focusMonth = () => { const ms = duesMonths(); return ms.filter(c => c.month <= curMonth()).pop() || ms[0] || null; };
  const docsOf = (projectId, kind) => T("documents").filter(d => (projectId === undefined || (d.projectId || null) === projectId) && (!kind || d.kind === kind)).sort(byDateDesc);
  const unitName = u => `${UNIT} ${esc(u.label)}`;

  /* ============================ חישובי כסף ============================ */
  function dueFor(c, unitId) {
    const o = c.overrides && c.overrides[unitId];
    if (o !== undefined && o !== null && o !== "") return Number(o);
    return c.amount === null || c.amount === undefined || c.amount === "" ? null : Number(c.amount);
  }
  const paymentsFor = (collId, unitId) => T("payments").filter(p => p.collectionId === collId && p.unitId === unitId).sort(byDateDesc);

  // מצב תשלום של תת חלקה בגבייה: paid / partial / unpaid / exempt / future
  // future = חודש דמי ועד שעוד לא הגיע ולא שולם מראש, לא נחשב חוב
  function cellStatus(c, unitId) {
    const due = dueFor(c, unitId);
    const list = paymentsFor(c.id, unitId);
    const paid = sum(list.map(p => p.amount));
    const future = !!(c.month && c.month > curMonth());
    let st;
    if (due === 0) st = "exempt";
    else if (due === null) st = list.length ? "paid" : future ? "future" : "unpaid";
    else if (paid >= due - 0.001) st = "paid";
    else if (paid > 0) st = "partial";
    else st = future ? "future" : "unpaid";
    const remaining = due === null ? null : Math.max(due - paid, 0);
    return { st, due, paid, remaining, owed: future ? 0 : (remaining || 0) };
  }
  const ST_LABEL = { paid: "שולם", partial: "שולם חלקית", unpaid: "טרם שולם", exempt: "פטור", future: "חודש עתידי" };
  const ST_TONE = { paid: "ok", partial: "warn", unpaid: "neutral", exempt: "neutral", future: "neutral" };
  const ST_ICON = { paid: "check", partial: "circle-half-2", unpaid: "clock", exempt: "minus", future: "point" };

  function collectionProgress(c) {
    const relevant = units().filter(u => dueFor(c, u.id) !== 0);
    const statuses = relevant.map(u => cellStatus(c, u.id));
    const collected = sum(T("payments").filter(p => p.collectionId === c.id).map(p => p.amount));
    const expected = statuses.some(s => s.due === null) ? null : sum(statuses.map(s => s.due));
    const target = collectionTarget(c) || (expected !== null && expected > 0 ? { value: expected, source: `לפי הסכום ל${UNIT}` } : null);
    return { total: relevant.length, paid: statuses.filter(s => s.st === "paid").length, collected, expected, target };
  }

  // הסכום הכולל שצריך לגייס: יעד ידני → עלות הפעולה לפי הקבלות → ההצעה שנבחרה
  function collectionTarget(c) {
    if (c.target !== null && c.target !== undefined && c.target !== "") return { value: Number(c.target), source: "יעד שנקבע" };
    if (!c.projectId) return null;
    const receipts = sum(docsOf(c.projectId, "receipt").map(d => d.amount));
    if (receipts > 0) return { value: receipts, source: "עלות הפעולה לפי הקבלות" };
    const chosen = sum(docsOf(c.projectId, "quote").filter(d => d.chosen).map(d => d.amount));
    if (chosen > 0) return { value: chosen, source: "לפי הצעת המחיר שנבחרה" };
    return null;
  }

  // "נגבו 370 ₪ מתוך 419 ₪ · חסרים 49 ₪"
  function moneyLine(pr) {
    if (!pr.target) return `נגבו ${money(pr.collected)}`;
    const diff = Math.round((pr.target.value - pr.collected) * 100) / 100;
    const tail = diff > 0 ? `, חסרים ${money(diff)}` : diff < 0 ? `, עודף ${money(-diff)}` : ", הגבייה הושלמה";
    return `נגבו ${money(pr.collected)} מתוך ${money(pr.target.value)}${tail}`;
  }
  // פס התקדמות: לפי כסף כשיש יעד, אחרת לפי מספר המשלמים
  const collBar = pr => pr.target ? progressBar(Math.min(pr.collected, pr.target.value), pr.target.value) : progressBar(pr.paid, pr.total);

  function cashBox() {
    const opening = Number(S.data.settings.openingBalance) || 0;
    const inc = sum(T("payments").map(p => p.amount));
    const out = sum(T("documents").filter(d => d.kind === "receipt").map(d => d.amount));
    return { opening, in: inc, out, balance: opening + inc - out };
  }

  /* =========================== רכיבי תצוגה =========================== */
  const pill = (label, tone) => `<span class="pill tone-${tone}">${esc(label)}</span>`;
  const statusPill = s => { const st = STATUS[s] || STATUS.planning; return pill(st.label, st.tone); };
  const projIcon = p => `<span class="picon">${icon(p.icon || "tool")}</span>`;
  const back = (href, label) => `<a class="back" href="${href}">${icon("arrow-right")}${esc(label)}</a>`;
  const adminBtn = (act, label, attrs = "", ic = "plus") => S.admin ? `<button class="btn small" data-act="${act}" ${attrs}>${icon(ic)}${esc(label)}</button>` : "";
  const editBtn = (act, attrs) => S.admin ? `<button class="icon-btn" data-act="${act}" ${attrs} aria-label="עריכה">${icon("pencil")}</button>` : "";
  const empty = (text, extra = "") => `<div class="empty">${esc(text)}${extra}</div>`;

  function progressBar(paid, total) {
    const pct = total ? Math.round((paid / total) * 100) : 0;
    return `<div class="progress" role="img" aria-label="${paid} מתוך ${total}"><span style="width:${pct}%"></span></div>`;
  }

  function stepper(status) {
    const idx = Math.max(0, STATUSES.findIndex(s => s.id === status));
    return `<ol class="stepper">${STATUSES.map((s, i) =>
      `<li class="${i < idx ? "past" : i === idx ? "current" : ""}"><span class="dot">${i < idx ? icon("check") : ""}</span><span class="lbl">${esc(s.short)}</span></li>`
    ).join("")}</ol>`;
  }

  // שורת מסמך, משמשת גם בדף פעולה וגם בלשונית המסמכים
  function docRow(d, opts = {}) {
    const k = KINDS[d.kind] || KINDS.other;
    const p = d.projectId ? find("projects", d.projectId) : null;
    const meta = [
      opts.showProject ? (p ? esc(p.title) : "כללי") : "",
      opts.showKind ? esc(k.label) : "",
      d.supplier ? esc(d.supplier) : "",
      d.date ? fmtDate(d.date) : ""
    ].filter(Boolean).join(" · ");
    const files = d.files || [];
    const first = files[0];
    const titleHtml = esc(d.title || k.label);
    const titleLink = first
      ? `<a class="doc-title" data-file="${esc(first.key)}" href="#" target="_blank" rel="noopener">${titleHtml}</a>`
      : `<span class="doc-title">${titleHtml}</span>`;
    const more = files.slice(1).map((f, i) =>
      `<a class="chip" data-file="${esc(f.key)}" href="#" target="_blank" rel="noopener">${icon(isImage(f) ? "photo" : "paperclip")}${i + 2}</a>`).join("");
    return `<div class="row doc ${d.chosen ? "chosen" : ""}">
      <span class="doc-icon">${icon(k.icon)}</span>
      <div class="grow">
        <div class="row-title">${titleLink}${d.chosen ? ` ${pill("נבחרה", "ok")}` : ""}</div>
        ${meta ? `<div class="muted small">${meta}</div>` : ""}
        ${d.note ? `<div class="small note">${esc(d.note)}</div>` : ""}
        ${more ? `<div class="chips">${more}</div>` : ""}
        ${!files.length && d.kind === "receipt" ? `<div class="muted xs">ללא קובץ מצורף</div>` : ""}
      </div>
      ${d.amount !== null && d.amount !== undefined && d.amount !== "" ? `<span class="amount">${money(d.amount)}</span>` : ""}
      ${editBtn("edit-doc", `data-id="${esc(d.id)}"`)}
    </div>`;
  }

  function photoGroup(d) {
    const imgs = (d.files || []).filter(isMedia);
    const others = (d.files || []).filter(f => !isMedia(f));
    return `<div class="photo-group">
      <div class="row-between"><span class="small">${esc(d.title || "")}${d.date ? ` <span class="muted">${fmtDate(d.date)}</span>` : ""}</span>${editBtn("edit-doc", `data-id="${esc(d.id)}"`)}</div>
      ${d.note ? `<div class="small note">${esc(d.note)}</div>` : ""}
      <div class="thumbs">${imgs.map(f => `<button class="thumb" data-act="lightbox" data-key="${esc(f.key)}" data-group="${esc(d.kind)}:${esc(d.projectId || "")}" aria-label="${isVideo(f) ? "הפעלת סרטון" : "הגדלת תמונה"}">${isVideo(f)
        ? `<video data-file="${esc(f.key)}" muted playsinline preload="metadata"></video><span class="play">${icon("player-play")}</span>`
        : `<img data-file="${esc(f.key)}" alt="" loading="lazy">`}</button>`).join("")}</div>
      ${others.map(f => `<a class="chip" data-file="${esc(f.key)}" href="#" target="_blank" rel="noopener">${icon("paperclip")}${esc(f.name)}</a>`).join("")}
    </div>`;
  }

  /* ============================== מסכים ============================== */
  const VIEWS = {};

  VIEWS.home = () => {
    const cb = cashBox();
    const cols = special();
    const fm = focusMonth();
    const feed = [
      ...T("updates").map(u => ({ date: u.date, createdAt: u.createdAt, projectId: u.projectId, text: u.text, kind: "update" })),
      ...T("documents").map(d => ({ date: d.date, createdAt: d.createdAt, projectId: d.projectId, text: `נוסף: ${d.title || KINDS[d.kind]?.label || "מסמך"}`, kind: d.kind }))
    ].sort(byDateDesc).slice(0, 6);
    const fpr = fm ? collectionProgress(fm) : null;

    return `
      <section class="card hero">
        <div class="muted small">יתרה בקופה</div>
        <div class="big">${money(cb.balance)}</div>
        <div class="hero-meta">
          <span>${icon("arrow-down")} נגבה ${money(cb.in)}</span>
          <span>${icon("arrow-up")} הוצא ${money(cb.out)}</span>
          ${cb.opening ? `<span>יתרת פתיחה ${money(cb.opening)}</span>` : ""}
        </div>
      </section>

      <h2 class="sec">גבייה</h2>
      ${fm ? `<a class="card link coll-card" href="#/dues">
          <div class="row-between"><span class="row-title">${icon("calendar")} דמי ועד ${esc(monthLong(fm.month))}</span>${icon("chevron-left", "muted")}</div>
          ${progressBar(fpr.paid, fpr.total)}
          <div class="muted small">${fpr.paid} מתוך ${fpr.total} שילמו את החודש</div>
        </a>` : ""}
      ${cols.map(c => {
        const pr = collectionProgress(c);
        return `<a class="card link coll-card" href="#/collection/${esc(c.id)}">
          <div class="row-between"><span class="row-title">${esc(c.title)}</span>${icon("chevron-left", "muted")}</div>
          ${collBar(pr)}
          <div class="muted small">${pr.paid} מתוך ${pr.total} שילמו · ${moneyLine(pr)}</div>
        </a>`;
      }).join("")}
      ${!fm && !cols.length ? empty("אין גביות פתוחות כרגע.") : ""}

      <h2 class="sec">פעולות</h2>
      <div class="card list">
        ${projects().map(p => `<a class="row link" href="#/project/${esc(p.id)}">
          ${projIcon(p)}<div class="grow"><div class="row-between"><span class="row-title">${esc(p.title)}</span>${statusPill(p.status)}</div>${p.statusNote ? `<div class="muted small clamp">${esc(p.statusNote)}</div>` : ""}</div>
        </a>`).join("") || empty("עוד לא הוגדרו פעולות.")}
      </div>

      ${feed.length ? `<h2 class="sec">עדכונים אחרונים</h2>
      <div class="card list">${feed.map(f => {
        const p = f.projectId ? find("projects", f.projectId) : null;
        return `<a class="row link" href="${p ? `#/project/${esc(p.id)}` : "#/docs"}">
          <span class="doc-icon">${icon(f.kind === "update" ? "message-2" : (KINDS[f.kind]?.icon || "file"))}</span>
          <div class="grow"><div class="small">${esc(f.text)}</div><div class="muted xs">${p ? esc(p.title) : "כללי"}${f.date ? " · " + fmtDate(f.date) : ""}</div></div>
        </a>`;
      }).join("")}</div>` : ""}
    `;
  };

  // דמי ועד: שורה לכל חודש, עמודה לכל תת חלקה
  VIEWS.dues = () => {
    const ms = duesMonths();
    const us = units();
    const cur = curMonth();
    const amounts = [...new Set(ms.map(c => c.amount).filter(a => a !== null && a !== undefined && a !== ""))];
    const amountLine = !ms.length ? ""
      : !amounts.length ? `<span class="warn-text">הסכום החודשי טרם נקבע</span>`
      : amounts.length === 1 ? `${money(amounts[0])} לחודש ל${UNIT}`
      : "הסכום משתנה לפי חודש";
    const range = ms.length ? `${esc(monthLong(ms[0].month))} עד ${esc(monthLong(ms[ms.length - 1].month))}` : "";
    const fm = focusMonth();
    const fpr = fm ? collectionProgress(fm) : null;

    const table = !ms.length ? empty("עוד לא הוגדרו חודשים.", S.admin ? `<div class="mt">${adminBtn("dues-settings", "הגדרת חודשים וסכום", "", "adjustments")}</div>` : "")
      : !us.length ? empty("לא הוגדרו תתי חלקות.")
      : `<div class="grid-wrap"><table class="pgrid dgrid">
        <thead><tr><th class="sticky">חודש</th>${us.map(u =>
          `<th><button class="unit-head" data-act="dues-unit" data-unit="${esc(u.id)}" aria-label="${unitName(u)}">${esc(u.label)}</button></th>`).join("")}</tr></thead>
        <tbody>${ms.map(c => {
          const pr = collectionProgress(c);
          return `<tr class="${c.month === cur ? "now" : ""}">
            <th class="sticky"><a href="#/collection/${esc(c.id)}"><span>${esc(monthShort(c.month))}</span><span class="xs muted">${pr.paid}/${pr.total}</span></a></th>
            ${us.map(u => {
              const s = cellStatus(c, u.id);
              return `<td><button class="cell sm st-${s.st}" data-act="dues-cell" data-unit="${esc(u.id)}" data-coll="${esc(c.id)}" aria-label="${unitName(u)}, ${esc(monthLong(c.month))}: ${ST_LABEL[s.st]}">${icon(ST_ICON[s.st])}</button></td>`;
            }).join("")}
          </tr>`;
        }).join("")}</tbody>
        <tfoot><tr><th class="sticky xs">שולמו</th>${us.map(u => `<td class="xs">${ms.filter(c => cellStatus(c, u.id).st === "paid").length}</td>`).join("")}</tr></tfoot>
      </table></div>
      <div class="legend">${["paid", "partial", "unpaid", "future", "exempt"].map(k => `<span><span class="cell mini st-${k}">${icon(ST_ICON[k])}</span>${ST_LABEL[k]}</span>`).join("")}</div>`;

    return `
      <div class="page-head">
        <div><h1>דמי ועד</h1><div class="muted small">${range}${range && amountLine ? " · " : ""}${amountLine}</div></div>
        <div class="head-actions">${adminBtn("dues-settings", "הגדרות", "", "adjustments")}</div>
      </div>
      ${fpr ? `<div class="card">
        <div class="row-between"><span class="row-title">${esc(monthLong(fm.month))}</span><span class="small">${fpr.paid} מתוך ${fpr.total} שילמו</span></div>
        ${progressBar(fpr.paid, fpr.total)}
      </div>` : ""}
      <p class="muted small">${S.admin
        ? "לחיצה על משבצת ריקה מסמנת שהחודש שולם (אפשר לבטל מיד). לחיצה על משבצת מסומנת פותחת את פרטי התשלום. לחיצה על מספר תת חלקה מאפשרת לסמן כמה חודשים בבת אחת."
        : "כל שורה היא חודש וכל עמודה היא תת חלקה. לחיצה על מספר תת חלקה מציגה את ההיסטוריה שלה."}</p>
      ${table}
    `;
  };

  // טבלת מצב לגבייה אחת: שורה לכל תת חלקה, מספר ובעלים, מצב במילים + סכום, ואייקון
  function statusTable(c) {
    return `<div class="stable">${units().map(u => {
      const s = cellStatus(c, u.id);
      const text = s.st === "paid" ? `שולם${s.paid ? ` · ${money(s.paid)}` : ""}`
        : s.st === "partial" ? `שולם חלקית · ${money(s.paid)}${s.due !== null ? ` מתוך ${money(s.due)}` : ""}`
        : ST_LABEL[s.st];
      return `<button class="srow" data-act="cell" data-unit="${esc(u.id)}" data-coll="${esc(c.id)}" aria-label="${unitName(u)}: ${ST_LABEL[s.st]}">
        <span class="srow-unit"><b>${esc(u.label)}</b>${u.owners ? `<span class="muted small">${esc(u.owners)}</span>` : ""}</span>
        <span class="srow-text st-text-${s.st}">${text}</span>
        <span class="cell st-${s.st}">${icon(ST_ICON[s.st])}</span>
      </button>`;
    }).join("")}</div>`;
  }

  // רשימת הגביות: כרטיס לכל פעולה (גם אם עוד לא נפתחה לה גבייה) + גביות כלליות
  function chargeItems() {
    const cols = special();
    const prjs = projects();
    const items = [];
    for (const p of prjs) {
      const pc = cols.filter(c => c.projectId === p.id);
      if (pc.length) pc.forEach(c => items.push({ p, c }));
      else items.push({ p, c: null });
    }
    cols.filter(c => !prjs.some(p => p.id === c.projectId)).forEach(c => items.push({ p: null, c }));
    return items;
  }

  function chargeCard({ p, c }) {
    const key = c ? c.id : "p:" + p.id;
    const open = S.openCharges.has(key);
    const title = c ? c.title : p.title;
    const pr = c ? collectionProgress(c) : null;
    let meta, bar = "";
    if (c) {
      meta = `${pr.paid} מתוך ${pr.total} שילמו${hasAmount(c) ? ` · ${money(c.amount)} ל${UNIT}` : ""}</span><span class="small money-line">${moneyLine(pr)}`;
      bar = collBar(pr);
    } else meta = "טרם נפתחה גבייה";
    const body = c
      ? `${pr.target ? `<div class="muted xs target-src">הסכום הנדרש: ${esc(pr.target.source)}</div>` : ""}${statusTable(c)}${S.admin ? `<div class="charge-actions">${adminBtn("edit-collection", "עריכת הגבייה", `data-id="${esc(c.id)}"`, "pencil")}</div>` : ""}`
      : `<p class="muted small">עדיין לא נפתחה גבייה לפעולה זו.</p>${S.admin ? adminBtn("new-charge", "פתיחת גבייה", `data-project="${esc(p.id)}"`) : ""}`;
    return `<div class="card charge ${open ? "open" : ""} ${c ? "" : "no-charge"}">
      <button class="charge-head" data-act="toggle-charge" data-key="${esc(key)}" aria-expanded="${open}">
        <span class="picon">${icon(p ? p.icon || "tool" : "coin")}</span>
        <span class="grow"><span class="row-title">${esc(title)}</span><span class="muted small">${meta}</span>${bar}</span>
        ${icon(open ? "chevron-up" : "chevron-down", "muted chev")}
      </button>
      ${open ? `<div class="charge-body">${body}</div>` : ""}
    </div>`;
  }

  VIEWS.payments = () => {
    const items = chargeItems();
    return `
      <div class="page-head"><h1>גביות</h1><div class="head-actions">${adminBtn("edit-collection", "גבייה כללית")}</div></div>
      <p class="muted small">גבייה לכל פעולה בבניין. לחיצה על פעולה פותחת את מצב התשלומים שלה. ${S.admin ? "לחיצה על \"טרם שולם\" מסמנת מיד \"שולם\" בסכום הגבייה (אפשר לבטל מיד); לחיצה על \"שולם\" פותחת את פרטי התשלום." : ""} דמי הוועד החודשיים נמצאים בלשונית <a href="#/dues">דמי ועד</a>.</p>
      ${items.length ? items.map(chargeCard).join("") : empty("אין גביות.")}
      ${items.some(x => x.c) ? `<div class="legend">${["paid", "partial", "unpaid", "exempt"].map(k => `<span><span class="cell mini st-${k}">${icon(ST_ICON[k])}</span>${ST_LABEL[k]}</span>`).join("")}</div>` : ""}
    `;
  };

  VIEWS.unit = id => {
    const u = find("units", id);
    const backTo = S.lastTab === "dues" ? ["#/dues", "דמי ועד"] : ["#/payments", "גביות"];
    if (!u) return notFound(...backTo);
    const dues = duesMonths().map(c => ({ c, s: cellStatus(c, u.id) }));
    const stats = special(true).filter(c => !c.archived || paymentsFor(c.id, u.id).length).map(c => ({ c, s: cellStatus(c, u.id) }));
    const all = [...dues, ...stats];
    const totalPaid = sum(all.map(x => x.s.paid));
    const owed = sum(all.map(x => x.s.owed));
    const duesTillNow = dues.filter(x => x.s.st !== "future" && x.s.st !== "exempt");
    const duesPaid = duesTillNow.filter(x => x.s.st === "paid").length;
    const duesOpen = duesTillNow.length - duesPaid;
    const duesIds = new Set(dues.map(x => x.c.id));
    const duesPays = T("payments").filter(p => p.unitId === u.id && duesIds.has(p.collectionId)).sort(byDateDesc);

    return `
      ${back(...backTo)}
      <div class="page-head">
        <div><h1>${unitName(u)}</h1><div class="muted">${u.owners ? esc(u.owners) : "בעלים לא הוגדרו"}</div>${u.note ? `<div class="small note">${esc(u.note)}</div>` : ""}</div>
        <div class="head-actions">${editBtn("edit-unit", `data-id="${esc(u.id)}"`)}</div>
      </div>
      ${u.archived ? `<div class="callout">${UNIT} זו מוסתרת (לא פעילה). ההיסטוריה נשמרת.</div>` : ""}
      <div class="stats">
        <div class="stat"><div class="muted small">שולם בסך הכול</div><div class="stat-num">${money(totalPaid)}</div></div>
        <div class="stat"><div class="muted small">יתרה לתשלום</div><div class="stat-num ${owed > 0 ? "warn" : ""}">${money(owed)}</div></div>
      </div>

      ${dues.length ? `<h2 class="sec">דמי ועד</h2>
      <div class="card">
        <div class="row-between">
          <span class="small">שולמו ${duesPaid} מתוך ${duesTillNow.length} חודשים עד היום</span>
          ${duesOpen ? pill(`${duesOpen} פתוחים`, "warn") : duesTillNow.length ? pill("מעודכן", "ok") : ""}
        </div>
        <div class="month-chips">${dues.map(({ c, s }) =>
          `<button class="mchip st-${s.st}" data-act="dues-chip" data-unit="${esc(u.id)}" data-coll="${esc(c.id)}" aria-label="${esc(monthLong(c.month))}: ${ST_LABEL[s.st]}">${icon(ST_ICON[s.st])}<span>${esc(monthShort(c.month))}</span></button>`).join("")}</div>
        ${duesPays.length ? `<details class="pays"><summary class="small">פירוט התשלומים (${duesPays.length})</summary><div class="pay-list">${duesPays.map(p => paymentRow(p, { month: true })).join("")}</div></details>` : ""}
        ${S.admin ? `<div class="mt">${adminBtn("dues-unit", "סימון כמה חודשים", `data-unit="${esc(u.id)}"`, "calendar-check")}</div>` : ""}
      </div>` : ""}

      <h2 class="sec">גביות מיוחדות</h2>
      ${stats.length ? stats.map(({ c, s }) => {
        const list = paymentsFor(c.id, u.id);
        return `<div class="card">
          <div class="row-between">
            <a class="row-title" href="#/collection/${esc(c.id)}">${esc(c.title)}</a>
            ${pill(ST_LABEL[s.st], ST_TONE[s.st])}
          </div>
          <div class="muted small">${s.due === null ? "סכום טרם נקבע" : s.st === "exempt" ? "פטור מגבייה זו" : `לתשלום ${money(s.due)} · שולם ${money(s.paid)}`}${c.archived ? " · בארכיון" : ""}</div>
          ${list.length ? `<div class="pay-list">${list.map(p => paymentRow(p)).join("")}</div>` : ""}
          ${S.admin ? `<div class="mt">${adminBtn("add-payment", "רישום תשלום", `data-unit="${esc(u.id)}" data-coll="${esc(c.id)}"`)}</div>` : ""}
        </div>`;
      }).join("") : empty("אין גביות מיוחדות.")}
    `;
  };

  // opts.month, להציג את החודש במקום תאריך התשלום · opts.del, כפתור מחיקה מהיר
  function paymentRow(p, opts = {}) {
    const c = opts.month ? find("collections", p.collectionId) : null;
    const lead = c && c.month ? esc(monthShort(c.month)) : fmtDate(p.date);
    const meta = [c && c.month ? fmtDate(p.date) : "", esc(p.method || ""), p.payer ? esc(p.payer) : "", p.note ? esc(p.note) : ""].filter(Boolean).join(" · ");
    return `<div class="pay-row">
      <span>${lead}</span>
      <span class="muted">${meta}</span>
      <span class="amount">${money(p.amount)}</span>
      ${editBtn("edit-payment", `data-id="${esc(p.id)}"`)}
      ${opts.del && S.admin ? `<button type="button" class="icon-btn" data-act="del-payment" data-id="${esc(p.id)}" aria-label="מחיקת התשלום">${icon("trash")}</button>` : ""}
    </div>`;
  }

  VIEWS.collection = id => {
    const c = find("collections", id);
    const backTo = c && c.series === "dues" ? ["#/dues", "דמי ועד"] : ["#/payments", "גביות"];
    if (!c) return notFound(...backTo);
    const pr = collectionProgress(c);
    const p = c.projectId ? find("projects", c.projectId) : null;
    return `
      ${back(...backTo)}
      <div class="page-head">
        <div><h1>${esc(collTitle(c))}</h1>
          <div class="muted small">${c.amount !== null && c.amount !== undefined && c.amount !== "" ? `${money(c.amount)} ל${UNIT}` : "סכום טרם נקבע"}${c.dueDate ? ` · לתשלום עד ${fmtDate(c.dueDate)}` : ""}${c.archived ? " · בארכיון" : ""}</div>
          ${p ? `<a class="small" href="#/project/${esc(p.id)}">${icon(p.icon || "tool")} ${esc(p.title)}</a>` : ""}
        </div>
        <div class="head-actions">${editBtn("edit-collection", `data-id="${esc(c.id)}"`)}</div>
      </div>
      <div class="card">
        ${c.series ? progressBar(pr.paid, pr.total) : collBar(pr)}
        <div class="small"><b>${pr.paid} מתוך ${pr.total} שילמו</b> · ${moneyLine(pr)}</div>
        ${pr.target ? `<div class="muted xs">הסכום הנדרש: ${esc(pr.target.source)}</div>` : ""}
      </div>
      <div class="card">${statusTable(c)}</div>
    `;
  };

  VIEWS.projects = () => {
    const active = projects();
    const archived = T("projects").filter(p => p.archived).sort(byOrder);
    const card = p => {
      const docs = docsOf(p.id);
      const media = docs.filter(d => PHOTO_KINDS.includes(d.kind)).flatMap(d => d.files || []);
      const photos = media.filter(f => !isVideo(f)).length, videos = media.filter(isVideo).length;
      const files = docs.filter(d => !PHOTO_KINDS.includes(d.kind)).length;
      return `<a class="card link prj-card" href="#/project/${esc(p.id)}">
        <div class="row">${projIcon(p)}<div class="grow"><div class="row-title">${esc(p.title)}</div></div>${statusPill(p.status)}</div>
        ${p.statusNote ? `<div class="small">${esc(p.statusNote)}</div>` : ""}
        <div class="muted xs meta">${files ? `${icon("files")} ${files === 1 ? "מסמך אחד" : files + " מסמכים"}` : ""}${photos ? ` ${icon("photo")} ${photos === 1 ? "תמונה אחת" : photos + " תמונות"}` : ""}${videos ? ` ${icon("video")} ${videos === 1 ? "סרטון אחד" : videos + " סרטונים"}` : ""}</div>
      </a>`;
    };
    return `
      <div class="page-head"><h1>פעולות</h1><div class="head-actions">${adminBtn("edit-project", "פעולה חדשה")}</div></div>
      ${active.map(card).join("") || empty("עוד לא הוגדרו פעולות.")}
      ${S.admin && archived.length ? `<h2 class="sec muted">בארכיון</h2>${archived.map(card).join("")}` : ""}
    `;
  };

  VIEWS.project = id => {
    const p = find("projects", id);
    if (!p || (p.archived && !S.admin)) return notFound("#/projects", "לפעולות");
    const ups = T("updates").filter(u => u.projectId === p.id).sort(byDateDesc);
    const cols = T("collections").filter(c => c.projectId === p.id).sort(byOrder);
    const section = (title, body, addAct, attrs, count) => (count || S.admin) ? `
      <div class="sec-head"><h2 class="sec">${esc(title)}</h2>${adminBtn(addAct, "הוספה", attrs)}</div>
      ${count ? body : `<div class="empty small">אין עדיין.</div>`}` : "";

    const quotes = docsOf(p.id, "quote").sort((a, b) => (b.chosen ? 1 : 0) - (a.chosen ? 1 : 0) || (Number(a.amount) || 0) - (Number(b.amount) || 0));
    const receipts = docsOf(p.id, "receipt");
    const before = docsOf(p.id, "before"), after = docsOf(p.id, "after");
    const docAttrs = k => `data-project="${esc(p.id)}" data-kind="${k}"`;

    return `
      ${back("#/projects", "פעולות")}
      <div class="page-head">
        <div class="row">${projIcon(p)}<div><h1>${esc(p.title)}</h1>${statusPill(p.status)}</div></div>
        <div class="head-actions">${editBtn("edit-project", `data-id="${esc(p.id)}"`)}</div>
      </div>
      ${stepper(p.status)}
      ${p.statusNote ? `<div class="callout">${esc(p.statusNote)}</div>` : ""}
      ${p.summary ? `<div class="card prose">${esc(p.summary)}</div>` : ""}

      ${cols.map(c => { const pr = collectionProgress(c); return `<a class="card link coll-card" href="#/collection/${esc(c.id)}">
        <div class="row-between"><span class="row-title">${icon("coin")} גבייה: ${esc(c.title)}</span>${icon("chevron-left", "muted")}</div>
        ${collBar(pr)}<div class="muted small">${pr.paid} מתוך ${pr.total} שילמו · ${moneyLine(pr)}</div></a>`; }).join("")}

      ${section("עדכונים", `<div class="card list">${ups.map(u => `<div class="row">
          <div class="grow"><div class="muted xs">${fmtDate(u.date)}</div><div class="prose">${esc(u.text)}</div></div>${editBtn("edit-update", `data-id="${esc(u.id)}"`)}
        </div>`).join("")}</div>`, "edit-update", `data-project="${esc(p.id)}"`, ups.length)}

      ${section(KINDS.report.section, `<div class="card list">${docsOf(p.id, "report").map(d => docRow(d)).join("")}</div>`, "add-doc", docAttrs("report"), docsOf(p.id, "report").length)}

      ${section(KINDS.quote.section, `<div class="card list">${quotes.map(d => docRow(d)).join("")}</div>`, "add-doc", docAttrs("quote"), quotes.length)}

      ${section(KINDS.receipt.section, `<div class="card list">${receipts.map(d => docRow(d)).join("")}
          <div class="row total"><span class="grow">סה"כ הוצאות</span><span class="amount">${money(sum(receipts.map(d => d.amount)))}</span></div></div>`,
        "add-doc", docAttrs("receipt"), receipts.length)}

      ${(before.length || after.length || S.admin) ? `
        <h2 class="sec">לפני ואחרי</h2>
        <div class="ba">
          <div class="ba-col"><div class="sec-head"><h3>לפני</h3>${adminBtn("add-doc", "הוספה", docAttrs("before"), "camera-plus")}</div>${before.map(photoGroup).join("") || `<div class="empty small">אין עדיין.</div>`}</div>
          <div class="ba-col"><div class="sec-head"><h3>אחרי</h3>${adminBtn("add-doc", "הוספה", docAttrs("after"), "camera-plus")}</div>${after.map(photoGroup).join("") || `<div class="empty small">אין עדיין.</div>`}</div>
        </div>` : ""}

      ${section(KINDS.other.section, `<div class="card list">${docsOf(p.id, "other").map(d => docRow(d)).join("")}</div>`, "add-doc", docAttrs("other"), docsOf(p.id, "other").length)}
    `;
  };

  VIEWS.docs = () => {
    const f = S.docFilter;
    const list = T("documents")
      .filter(d => f.project === "all" || (f.project === "general" ? !d.projectId : d.projectId === f.project))
      .filter(d => f.kind === "all" || d.kind === f.kind)
      .filter(d => { const p = d.projectId && find("projects", d.projectId); return S.admin || !p || !p.archived; })
      .sort(byDateDesc);
    const chip = (group, value, label) => `<button class="chip filter ${f[group] === value ? "on" : ""}" data-act="doc-filter" data-group="${group}" data-value="${esc(value)}">${esc(label)}</button>`;
    return `
      <div class="page-head"><h1>מסמכים</h1><div class="head-actions">${adminBtn("add-doc", "מסמך", `data-project="" data-kind="other"`)}</div></div>
      <div class="chips scroll">${chip("project", "all", "הכול")}${projects().map(p => chip("project", p.id, p.title)).join("")}${chip("project", "general", "כללי")}</div>
      <div class="chips scroll">${chip("kind", "all", "כל הסוגים")}${KIND_ORDER.map(k => chip("kind", k, KINDS[k].label)).join("")}</div>
      ${list.length ? `<div class="card list">${list.map(d => docRow(d, { showProject: true, showKind: true })).join("")}</div>` : empty("אין מסמכים להצגה.")}
    `;
  };

  VIEWS.admin = () => {
    if (DB.isSnapshot) return `<div class="page-head"><h1>תצוגה לדוגמה</h1></div><div class="card">זו גרסת תצוגה לקריאה בלבד. העריכה תהיה זמינה באתר הקבוע.</div>`;
    if (!S.admin) {
      return `
        <div class="page-head"><h1>כניסת ועד</h1></div>
        <div class="card">
          <p>מצב ניהול מאפשר להוסיף ולערוך תשלומים, פעולות, מסמכים ותמונות.</p>
          ${DB.isCloud ? "" : `<p class="muted small">האתר פועל כרגע במצב מקומי (הנתונים נשמרים רק בדפדפן הזה), ולכן אין סיסמה. אחרי החיבור לענן הכניסה תהיה עם מייל וסיסמה.</p>`}
          <button class="btn primary" data-act="admin-login">${icon("lock-open")}כניסה למצב ניהול</button>
        </div>`;
    }
    const st = S.data.settings;
    return `
      <div class="page-head"><h1>ניהול</h1></div>

      <div class="sec-head"><h2 class="sec">פרטי הבניין</h2>${adminBtn("edit-settings", "עריכה", "", "pencil")}</div>
      <div class="card list">
        <div class="row"><span class="grow muted">שם</span><span>${esc(st.buildingName || "")}</span></div>
        <div class="row"><span class="grow muted">כתובת</span><span>${esc(st.address || "לא הוזנה")}</span></div>
        <div class="row"><span class="grow muted">יתרת פתיחה בקופה</span><span>${money(st.openingBalance)}</span></div>
      </div>

      <div class="sec-head"><h2 class="sec">תתי חלקות ובעלים</h2>${adminBtn("edit-unit", "הוספה")}</div>
      <div class="card list">${units(true).map(u => `<div class="row">
          <b class="unit-num">${esc(u.label)}</b>
          <div class="grow"><div>${u.owners ? esc(u.owners) : `<span class="muted">בעלים לא הוגדרו</span>`}</div>${u.archived ? `<div class="xs muted">מוסתרת</div>` : ""}</div>
          ${editBtn("edit-unit", `data-id="${esc(u.id)}"`)}
        </div>`).join("") || empty("אין תתי חלקות.")}</div>

      <div class="sec-head"><h2 class="sec">דמי ועד</h2>${adminBtn("dues-settings", "הגדרות", "", "adjustments")}</div>
      <div class="card list">${(() => {
        const ms = duesMonths();
        if (!ms.length) return `<div class="row muted">לא הוגדרו חודשים.</div>`;
        const missing = ms.filter(c => c.amount === null || c.amount === undefined || c.amount === "").length;
        return `<a class="row link" href="#/dues"><div class="grow"><div class="row-title">${esc(monthLong(ms[0].month))} עד ${esc(monthLong(ms[ms.length - 1].month))}</div>
          <div class="xs muted">${ms.length} חודשים${missing ? ` · <span class="warn-text">ל-${missing} חודשים טרם נקבע סכום</span>` : ""}</div></div>${icon("chevron-left", "muted")}</a>`;
      })()}</div>

      <div class="sec-head"><h2 class="sec">גביות מיוחדות</h2>${adminBtn("edit-collection", "הוספה")}</div>
      <div class="card list">${special(true).map(c => `<div class="row">
          <div class="grow"><a class="row-title" href="#/collection/${esc(c.id)}">${esc(c.title)}</a>
          <div class="xs muted">${c.amount !== null && c.amount !== undefined && c.amount !== "" ? money(c.amount) + " ל" + UNIT : `<span class="warn-text">סכום טרם נקבע</span>`}${c.archived ? " · בארכיון" : ""}</div></div>
          ${editBtn("edit-collection", `data-id="${esc(c.id)}"`)}
        </div>`).join("") || empty("אין גביות.")}</div>

      <div class="sec-head"><h2 class="sec">פעולות</h2>${adminBtn("edit-project", "הוספה")}</div>
      <div class="card list">${projects(true).map(p => `<div class="row">${projIcon(p)}<a class="grow row-title" href="#/project/${esc(p.id)}">${esc(p.title)}</a>${p.archived ? `<span class="xs muted">בארכיון</span>` : statusPill(p.status)}${editBtn("edit-project", `data-id="${esc(p.id)}"`)}</div>`).join("")}</div>

      <div class="card mt">
        <button class="btn" data-act="admin-logout">${icon("logout")}יציאה ממצב ניהול</button>
        ${DB.isCloud ? "" : `<button class="btn danger-ghost" data-act="reset-local">${icon("restore")}איפוס לנתוני הפתיחה</button>
        <p class="muted xs">מצב מקומי: הנתונים נשמרים רק בדפדפן הזה ולא יעברו אוטומטית לענן.</p>`}
      </div>
    `;
  };

  function notFound(href, label) {
    return `${back(href, label)}${empty("הדף לא נמצא.")}`;
  }

  /* ============================== רינדור ============================== */
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    const [name, id] = h.split("/");
    return { name: VIEWS[name] ? name : "home", id: id ? decodeURIComponent(id) : null };
  }
  const TAB_OF = { home: "home", dues: "dues", payments: "payments", projects: "projects", project: "projects", docs: "docs" };

  function render() {
    if (!S.data) return;
    const r = parseRoute();
    const key = r.name + "/" + (r.id || "");
    // דף תת חלקה וגבייה שייכים ללשונית שממנה הגיעו (דמי ועד / גביות)
    if (r.name === "dues" || r.name === "payments") S.lastTab = r.name;
    if (r.name === "collection") { const c = find("collections", r.id); S.lastTab = c && c.series === "dues" ? "dues" : "payments"; }
    TAB_OF.unit = TAB_OF.collection = S.lastTab || "payments";
    try {
      $main.innerHTML = VIEWS[r.name](r.id);
    } catch (e) {
      console.error(e);
      $main.innerHTML = empty("משהו השתבש בהצגת הדף.");
    }
    document.querySelectorAll(".bottomnav a").forEach(a => a.classList.toggle("on", a.dataset.tab === TAB_OF[r.name]));
    document.getElementById("brand-name").textContent = S.data.settings.buildingName || "ועד הבית";
    document.title = S.data.settings.buildingName || "ועד הבית";
    const banner = document.getElementById("admin-banner");
    banner.hidden = !S.admin && !DB.isSnapshot;
    banner.classList.toggle("demo", !!DB.isSnapshot);
    banner.innerHTML = DB.isSnapshot ? `${icon("eye")} תצוגה לדוגמה. הנתונים נכונים ל-${fmtDate(S.data.exportedAt)}`
      : S.admin ? `${icon("pencil")} מצב ניהול${DB.isCloud ? "" : " · מקומי"} · <a href="#/admin">הגדרות</a>` : "";
    const al = document.getElementById("admin-link");
    al.hidden = !!DB.isSnapshot;
    al.innerHTML = icon(S.admin ? "settings" : "lock");
    al.setAttribute("aria-label", S.admin ? "ניהול" : "כניסת ועד");
    if (key !== S.routeKey) { window.scrollTo(0, 0); S.routeKey = key; }
    hydrateFiles();
  }

  async function reload() {
    S.data = await DB.loadAll();
    S.files = new Map();
    T("documents").forEach(d => (d.files || []).forEach(f => S.files.set(f.key, { meta: f, doc: d })));
    render();
  }

  // מצמיד כתובות אמיתיות לתמונות ולקישורי קבצים אחרי הרינדור
  async function hydrateFiles() {
    const els = document.querySelectorAll("[data-file]:not([data-ready])");
    for (const el of els) {
      el.dataset.ready = "1";
      const entry = S.files.get(el.dataset.file);
      if (!entry) continue;
      let url = S.urls.get(entry.meta.key);
      if (!url) {
        try { url = await DB.fileUrl(entry.meta); } catch { url = null; }
        if (url) S.urls.set(entry.meta.key, url);
      }
      if (!url) { el.classList.add("missing"); continue; }
      if (el.tagName === "IMG") el.src = url;
      else if (el.tagName === "VIDEO") el.src = el.controls ? url : url + "#t=0.1";
      else {
        el.href = url;
      }
    }
  }

  /* ============================ טפסים (sheet) ============================ */
  function fieldHtml(f) {
    const id = "f_" + f.name;
    const show = f.showWhen ? ` data-show-when="${esc(f.showWhen)}"` : "";
    const req = f.required ? ` <span class="req">*</span>` : "";
    const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : "";
    const v = f.value ?? "";
    let input;
    switch (f.type) {
      case "textarea":
        input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`; break;
      case "select":
        input = `<select id="${id}" name="${f.name}">${f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`; break;
      case "number":
        input = `<input id="${id}" name="${f.name}" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}">`; break;
      case "date":
        input = `<input id="${id}" name="${f.name}" type="date" value="${esc(v)}">`; break;
      case "month":
        input = `<input id="${id}" name="${f.name}" type="month" value="${esc(v)}" placeholder="2026-08">`; break;
      case "checks":
        input = `<div class="checks">${f.options.map(o => `<label class="mcheck"><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${o.checked ? "checked" : ""} ${o.disabled ? "disabled" : ""}><span>${esc(o.label)}</span></label>`).join("")}</div>
          <button type="button" class="btn small mt" data-check-all="${f.name}">${icon("checks")}סימון כל הפתוחים</button>`; break;
      case "checkbox":
        return `<label class="field check"${show}><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}><span>${esc(f.label)}</span>${hint}</label>`;
      case "icon":
        input = `<div class="icon-pick">${ICONS.map(ic => `<label><input type="radio" name="${f.name}" value="${ic}" ${ic === v ? "checked" : ""}><span>${icon(ic)}</span></label>`).join("")}</div>`; break;
      case "unitAmounts":
        return `<details class="field"${show}><summary>${esc(f.label)}</summary>${hint}
          <div class="unit-amounts">${units(true).map(u => `<label><span>${esc(u.label)}</span><input type="number" inputmode="decimal" step="0.01" min="0" data-unit-amount="${esc(u.id)}" value="${esc(v && v[u.id] !== undefined ? v[u.id] : "")}"></label>`).join("")}</div></details>`;
      case "files":
        input = `<div class="file-chips">${(f.existing || []).map(x => `<span class="chip file-chip" data-key="${esc(x.key)}">${icon(isImage(x) ? "photo" : "paperclip")}<span class="fname">${esc(x.name)}</span><button type="button" data-file-remove aria-label="הסרת קובץ">${icon("x")}</button></span>`).join("")}</div>
          <label class="file-drop">${icon("upload")}<span>בחירת קבצים או צילום</span><input id="${id}" type="file" name="${f.name}" multiple accept="${esc(f.accept || FILE_ACCEPT)}"></label>
          <div class="file-picked muted small"></div>`; break;
      default:
        input = `<input id="${id}" name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" autocomplete="off">`;
    }
    return `<div class="field"${show}><label for="${id}">${esc(f.label)}${req}</label>${input}${hint}</div>`;
  }

  function openSheet(opts) {
    const root = document.getElementById("sheet-root");
    root.innerHTML = `<div class="sheet-backdrop" data-sheet-close></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
        <div class="sheet-head"><h2>${esc(opts.title)}</h2><button type="button" class="icon-btn" data-sheet-close aria-label="סגירה">${icon("x")}</button></div>
        <form class="sheet-body" novalidate>
          ${opts.intro || ""}
          ${(opts.fields || []).map(fieldHtml).join("")}
          <div class="form-error" role="alert" hidden></div>
          <div class="sheet-actions">
            <button type="submit" class="btn primary">${esc(opts.submitLabel || "שמירה")}</button>
            ${opts.onDelete ? `<button type="button" class="btn danger-ghost" data-sheet-delete>${icon("trash")}${esc(opts.deleteLabel || "מחיקה")}</button>` : ""}
          </div>
        </form>
      </div>`;
    root.hidden = false;
    document.body.classList.add("sheet-open");
    const form = root.querySelector("form");
    const errBox = root.querySelector(".form-error");
    const showErr = msg => { errBox.textContent = msg; errBox.hidden = !msg; };

    const applyShow = () => root.querySelectorAll("[data-show-when]").forEach(el => {
      const [fname, vals] = el.dataset.showWhen.split(":");
      el.hidden = !vals.split(",").includes(form.elements[fname]?.value);
    });
    form.addEventListener("change", e => {
      applyShow();
      if (e.target.type === "file") {
        const n = e.target.files.length;
        e.target.closest(".field").querySelector(".file-picked").textContent = n ? `נבחרו ${n} קבצים חדשים` : "";
      }
      showErr("");
    });
    form.addEventListener("click", e => {
      const rm = e.target.closest("[data-file-remove]");
      if (rm) rm.closest(".file-chip").classList.toggle("removed");
      const all = e.target.closest("[data-check-all]");
      if (all) form.querySelectorAll(`[name="${all.dataset.checkAll}"]:not(:disabled)`).forEach(i => { i.checked = true; });
    });
    applyShow();

    const collect = () => {
      const vals = {};
      for (const f of opts.fields || []) {
        const wrap = form.querySelector(`[name="${f.name}"]`)?.closest("[data-show-when]");
        const hidden = !!(wrap && wrap.hidden);
        if (f.type === "checkbox") vals[f.name] = !hidden && form.elements[f.name].checked;
        else if (f.type === "number") { const raw = form.elements[f.name].value.trim(); vals[f.name] = hidden || raw === "" ? null : Number(raw); }
        else if (f.type === "checks") vals[f.name] = Array.from(form.querySelectorAll(`[name="${f.name}"]:checked:not(:disabled)`)).map(i => i.value);
        else if (f.type === "icon") vals[f.name] = (form.querySelector(`[name="${f.name}"]:checked`) || {}).value || "tool";
        else if (f.type === "unitAmounts") {
          const o = {};
          form.querySelectorAll("[data-unit-amount]").forEach(i => { if (i.value.trim() !== "") o[i.dataset.unitAmount] = Number(i.value); });
          vals[f.name] = o;
        } else if (f.type === "files") {
          vals[f.name] = {
            add: Array.from(form.elements[f.name].files || []),
            remove: new Set(Array.from(form.querySelectorAll(".file-chip.removed")).map(c => c.dataset.key))
          };
        } else vals[f.name] = hidden ? "" : (form.elements[f.name].value || "").trim();
      }
      return vals;
    };

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const vals = collect();
      for (const f of opts.fields || []) {
        const wrap = form.querySelector(`[name="${f.name}"]`)?.closest("[data-show-when]");
        if (wrap && wrap.hidden) continue;
        const v = vals[f.name];
        if (f.required && (v === "" || v === null || v === undefined)) return showErr(`יש למלא: ${f.label}`);
        if (f.type === "number" && v !== null && (isNaN(v) || v < 0)) return showErr(`ערך לא תקין: ${f.label}`);
      }
      const err = opts.validate && opts.validate(vals);
      if (err) return showErr(err);
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = "שומר...";
      try {
        await opts.onSubmit(vals);
        closeSheet();
        await reload();
        if (opts.after) opts.after();
      } catch (ex) {
        console.error(ex);
        showErr("השמירה נכשלה. אפשר לנסות שוב.");
        btn.disabled = false; btn.textContent = opts.submitLabel || "שמירה";
      }
    });

    const del = root.querySelector("[data-sheet-delete]");
    if (del) del.addEventListener("click", async () => {
      try {
        const done = await opts.onDelete();
        if (done === false) return;
        closeSheet();
        await reload();
      } catch (ex) { console.error(ex); showErr("המחיקה נכשלה."); }
    });
  }

  function closeSheet() {
    const root = document.getElementById("sheet-root");
    root.hidden = true; root.innerHTML = "";
    document.body.classList.remove("sheet-open");
  }

  /* =========================== טפסים ספציפיים =========================== */
  function paymentSheet({ unitId, collId, payment }) {
    const u = find("units", unitId), c = find("collections", collId);
    if (!u || !c) return;
    const s = cellStatus(c, u.id);
    const existing = paymentsFor(c.id, u.id);
    const lastMethod = localStorage.getItem("vaad-last-method") || METHODS[0];
    const defaultAmount = payment ? payment.amount : (s.remaining || s.due || "");
    const intro = `<div class="sheet-intro">
        <div class="row-title">${unitName(u)}${u.owners ? ` · ${esc(u.owners)}` : ""}</div>
        <div class="muted small">${esc(collTitle(c))}</div>
        <div class="small">${s.due === null ? `<span class="warn-text">${c.series ? "הסכום החודשי טרם נקבע (אפשר לקבוע בהגדרות דמי הוועד)" : "סכום הגבייה טרם נקבע (אפשר לקבוע בעריכת הגבייה)"}</span>` : `לתשלום ${money(s.due)} · שולם ${money(s.paid)}`}</div>
        ${!payment && existing.length ? `<div class="pay-list">${existing.map(p => paymentRow(p, { del: true })).join("")}</div>` : ""}
      </div>`;
    openSheet({
      title: payment ? "עריכת תשלום" : existing.length ? "פרטי תשלום" : "רישום תשלום",
      intro,
      fields: [
        { name: "amount", label: "סכום (₪)", type: "number", value: defaultAmount, required: true },
        { name: "date", label: "תאריך התשלום", type: "date", value: payment ? payment.date : todayISO(), required: true },
        { name: "method", label: "אמצעי תשלום", type: "select", options: METHODS.map(m => ({ value: m, label: m })), value: payment ? payment.method : lastMethod },
        { name: "payer", label: "שולם על ידי", type: "text", value: payment ? payment.payer : (u.owners || "") },
        { name: "note", label: "הערה", type: "text", value: payment ? payment.note : "" }
      ],
      submitLabel: payment ? "שמירה" : existing.length ? "רישום תשלום נוסף" : "רישום תשלום",
      onSubmit: async v => {
        localStorage.setItem("vaad-last-method", v.method);
        await DB.put("payments", { ...(payment || {}), unitId: u.id, collectionId: c.id, amount: v.amount, date: v.date, method: v.method, payer: v.payer, note: v.note });
      },
      onDelete: payment ? async () => {
        if (!await confirmDanger("למחוק את התשלום?")) return false;
        await DB.remove("payments", payment.id);
      } : null
    });
  }

  function unitSheet(u) {
    openSheet({
      title: u ? `עריכת ${UNIT} ${u.label}` : `${UNIT} חדשה`,
      fields: [
        { name: "label", label: `מספר ${UNIT}`, type: "text", value: u ? u.label : "", required: true, placeholder: "12" },
        { name: "owners", label: "בעלי הדירה", type: "text", value: u ? u.owners : "", placeholder: "משפחת כהן", hint: "השם מוצג לכל הדיירים. כשהבעלים מתחלפים מעדכנים כאן את השם, והתשלומים הקודמים נשארים רשומים על שם מי ששילם." },
        { name: "note", label: "הערה", type: "text", value: u ? u.note : "" },
        { name: "archived", label: `הסתרה (${UNIT} לא פעילה, ההיסטוריה נשמרת)`, type: "checkbox", value: u ? u.archived : false }
      ],
      validate: v => units(true).some(x => x.label === v.label && (!u || x.id !== u.id)) ? `כבר קיימת ${UNIT} ${v.label}` : null,
      onSubmit: v => DB.put("units", { ...(u || {}), label: v.label, owners: v.owners, note: v.note, archived: v.archived }),
      onDelete: u ? async () => {
        if (T("payments").some(p => p.unitId === u.id)) { await notice(`ל${UNIT} זו יש תשלומים רשומים ולכן אי אפשר למחוק אותה. אפשר להסתיר אותה במקום.`); return false; }
        if (!await confirmDanger(`למחוק את ${UNIT} ${u.label}?`)) return false;
        await DB.remove("units", u.id);
        location.hash = "#/admin";
      } : null
    });
  }

  function collectionSheet(c, preset = {}) {
    if (c && c.series === "dues") return duesMonthSheet(c);
    openSheet({
      title: c ? "עריכת גבייה" : "גבייה חדשה",
      fields: [
        { name: "title", label: "שם הגבייה", type: "text", value: c ? c.title : preset.title || "", required: true, placeholder: "גבייה מיוחדת לחדר המדרגות" },
        { name: "amount", label: `סכום לכל ${UNIT} (₪)`, type: "number", value: c ? c.amount : "", hint: "אפשר להשאיר ריק אם הסכום עוד לא נקבע." },
        { name: "target", label: "סכום כולל נדרש (₪, לא חובה)", type: "number", value: c ? c.target : "", hint: "אם נשאר ריק, הסכום נקבע לפי עלות הפעולה: הקבלות, או הצעת המחיר שנבחרה." },
        { name: "projectId", label: "קשורה לפעולה", type: "select", value: c ? c.projectId || "" : preset.projectId || "", options: [{ value: "", label: "ללא" }, ...projects(true).map(p => ({ value: p.id, label: p.title }))] },
        { name: "dueDate", label: "לתשלום עד", type: "date", value: c ? c.dueDate : "" },
        { name: "overrides", label: `סכום שונה ל${UNIT} מסוימת (לא חובה)`, type: "unitAmounts", value: c ? c.overrides : {}, hint: "שדה ריק: הסכום הרגיל. 0: פטור." },
        { name: "archived", label: "העברה לארכיון (מוסתרת מטבלת התשלומים, נשמרת בהיסטוריה)", type: "checkbox", value: c ? c.archived : false }
      ],
      onSubmit: async v => {
        const saved = await DB.put("collections", { ...(c || { order: nextOrder("collections") }), title: v.title, amount: v.amount, target: v.target, projectId: v.projectId || null, dueDate: v.dueDate, overrides: v.overrides, archived: v.archived });
        if (!c) S.openCharges.add(saved.id); // הגבייה החדשה נפתחת ברשימה
      },
      onDelete: c ? async () => {
        if (T("payments").some(p => p.collectionId === c.id)) { await notice("בגבייה זו יש תשלומים רשומים ולכן אי אפשר למחוק אותה. אפשר להעביר אותה לארכיון."); return false; }
        if (!await confirmDanger(`למחוק את הגבייה "${c.title}"?`)) return false;
        await DB.remove("collections", c.id);
        location.hash = "#/payments";
      } : null
    });
  }

  /* ----------------------------- דמי ועד ----------------------------- */
  const hasAmount = c => !(c.amount === null || c.amount === undefined || c.amount === "");

  // חודש בודד: סכום שונה לחודש זה או לתת חלקה מסוימת
  function duesMonthSheet(c) {
    openSheet({
      title: `דמי ועד · ${monthLong(c.month)}`,
      fields: [
        { name: "amount", label: `סכום לחודש זה לכל ${UNIT} (₪)`, type: "number", value: c.amount, hint: "כדי לשנות את כל החודשים יחד, יש להיכנס להגדרות דמי הוועד." },
        { name: "overrides", label: `סכום שונה ל${UNIT} מסוימת (לא חובה)`, type: "unitAmounts", value: c.overrides, hint: "שדה ריק: הסכום הרגיל. 0: פטור בחודש זה." }
      ],
      onSubmit: v => DB.put("collections", { ...c, amount: v.amount, overrides: v.overrides }),
      onDelete: async () => {
        if (T("payments").some(p => p.collectionId === c.id)) { await notice("בחודש זה יש תשלומים רשומים ולכן אי אפשר למחוק אותו."); return false; }
        if (!await confirmDanger(`להסיר את ${monthLong(c.month)} מטבלת דמי הוועד?`, "הסרה")) return false;
        await DB.remove("collections", c.id);
        location.hash = "#/dues";
      },
      deleteLabel: "הסרת החודש"
    });
  }

  // טווח החודשים והסכום החודשי
  function duesSettingsSheet() {
    const ms = duesMonths();
    const amounts = ms.filter(hasAmount).map(c => Number(c.amount));
    const common = amounts.length ? amounts.sort((a, b) => amounts.filter(x => x === b).length - amounts.filter(x => x === a).length)[0] : null;
    const isMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
    openSheet({
      title: "הגדרות דמי ועד",
      intro: `<div class="sheet-intro small">חודש לכל שורה בטבלה. חודשים חדשים נוספים אוטומטית לפי הטווח; חודש שיש בו תשלומים לא יימחק גם אם יצא מהטווח.</div>`,
      fields: [
        { name: "from", label: "מחודש", type: "month", value: ms.length ? ms[0].month : curMonth(), required: true },
        { name: "to", label: "עד חודש (כולל)", type: "month", value: ms.length ? ms[ms.length - 1].month : curMonth(), required: true },
        { name: "amount", label: `סכום חודשי לכל ${UNIT} (₪)`, type: "number", value: common },
        { name: "applyAll", label: "לעדכן את הסכום בכל החודשים בטווח (גם בקיימים)", type: "checkbox", value: true, hint: "אם הסכום השתנה באמצע השנה, אפשר לבטל את הסימון ולעדכן חודשים בודדים מתוך הטבלה." }
      ],
      validate: v => {
        if (!isMonth(v.from) || !isMonth(v.to)) return "יש לבחור חודשים בפורמט שנה-חודש (למשל 2026-08).";
        if (v.from > v.to) return "חודש ההתחלה מאוחר מחודש הסיום.";
        if (window.VAAD_MONTH_RANGE(v.from, v.to).length > 60) return "טווח של עד 60 חודשים.";
        return null;
      },
      onSubmit: async v => {
        const range = window.VAAD_MONTH_RANGE(v.from, v.to);
        const existing = duesMonths();
        for (const tmpl of window.VAAD_DUES_MONTHS(v.from, v.to, v.amount)) {
          const c = existing.find(x => x.month === tmpl.month);
          if (!c) await DB.put("collections", { ...tmpl, createdAt: new Date().toISOString() });
          else if (v.applyAll && v.amount !== null) await DB.put("collections", { ...c, amount: v.amount });
          else if (!hasAmount(c) && v.amount !== null) await DB.put("collections", { ...c, amount: v.amount });
        }
        const kept = [];
        for (const c of existing.filter(x => !range.includes(x.month))) {
          if (T("payments").some(p => p.collectionId === c.id)) kept.push(monthLong(c.month));
          else await DB.remove("collections", c.id);
        }
        if (kept.length) toast(`נשארו בטבלה חודשים עם תשלומים: ${kept.join(", ")}`);
      }
    });
  }

  // סימון כמה חודשים בבת אחת לתת חלקה (למשל תשלום שנתי מראש)
  function duesUnitSheet(unitId) {
    const u = find("units", unitId);
    if (!u) return;
    const rows = duesMonths().map(c => ({ c, s: cellStatus(c, u.id) })).filter(x => x.s.st !== "exempt");
    const open = rows.filter(x => x.s.st !== "paid");
    if (!rows.length) return toast("לא הוגדרו חודשים לדמי ועד.");
    const lastMethod = localStorage.getItem("vaad-last-method") || METHODS[0];
    openSheet({
      title: `דמי ועד · ${unitName(u)}`,
      intro: `<div class="sheet-intro small">${u.owners ? esc(u.owners) + " · " : ""}${open.length ? `${open.length} חודשים פתוחים. מסמנים את החודשים ששולמו, ולכל חודש נרשם תשלום בסכום החודשי.` : "כל החודשים שולמו."}</div>`,
      fields: [
        { name: "months", label: "חודשים ששולמו", type: "checks", options: rows.map(({ c, s }) => ({
          value: c.id,
          label: monthShort(c.month) + (s.st === "partial" ? " (חלקי)" : ""),
          checked: s.st === "paid", disabled: s.st === "paid" || !hasAmount(c) && dueFor(c, u.id) === null
        })) },
        { name: "date", label: "תאריך התשלום", type: "date", value: todayISO(), required: true },
        { name: "method", label: "אמצעי תשלום", type: "select", options: METHODS.map(m => ({ value: m, label: m })), value: lastMethod },
        { name: "payer", label: "שולם על ידי", type: "text", value: u.owners || "" },
        { name: "note", label: "הערה", type: "text", value: "" }
      ],
      submitLabel: "סימון כשולם",
      validate: v => v.months.length ? null : "לא נבחרו חודשים.",
      onSubmit: async v => {
        localStorage.setItem("vaad-last-method", v.method);
        for (const id of v.months) {
          const c = find("collections", id);
          const s = cellStatus(c, u.id);
          if (s.st === "paid" || s.remaining === null) continue;
          await DB.put("payments", { unitId: u.id, collectionId: c.id, amount: s.remaining, date: v.date, method: v.method, payer: v.payer, note: v.note });
        }
      }
    });
  }

  // לחיצה על משבצת (מצב ניהול), בדמי ועד ובגביות: משבצת פתוחה → סימון מיידי בסכום הגבייה, עם אפשרות ביטול.
  // משבצת ששולמה → פרטי התשלום. סכום לא ידוע → דמי ועד: הגדרות; גבייה: טופס תשלום רגיל.
  async function quickMark(unitId, collId) {
    const u = find("units", unitId), c = find("collections", collId);
    if (!u || !c) return;
    const s = cellStatus(c, u.id);
    if (s.st === "paid" || s.st === "exempt") return paymentSheet({ unitId, collId });
    if (s.remaining === null) {
      if (!c.series) return paymentSheet({ unitId, collId });
      toast("קודם צריך לקבוע את הסכום החודשי.");
      return duesSettingsSheet();
    }
    const method = localStorage.getItem("vaad-last-method") || METHODS[0];
    const saved = await DB.put("payments", { unitId: u.id, collectionId: c.id, amount: s.remaining, date: todayISO(), method, payer: u.owners || "", note: "" });
    await reload();
    toast(`סומן: ${UNIT} ${esc(u.label)}, ${esc(c.series ? monthLong(c.month) : c.title)}, ${money(s.remaining)}`, {
      label: "ביטול",
      run: async () => { await DB.remove("payments", saved.id); await reload(); }
    });
  }

  /* חלון אישור בתוך האתר. לא משתמשים ב-confirm/alert של הדפדפן:
     דפדפנים מוטמעים (למשל בתוך וואטסאפ) חוסמים אותם ומחזירים "לא" בשקט. */
  function ask(message, { ok = "אישור", cancel = "ביטול", danger = false } = {}) {
    return new Promise(resolve => {
      const root = document.getElementById("dialog-root");
      root.innerHTML = `<div class="dlg-backdrop" data-dlg="0"></div>
        <div class="dlg" role="alertdialog" aria-modal="true">
          <div class="dlg-msg">${esc(message).replace(/\n/g, "<br>")}</div>
          <div class="dlg-actions">
            ${cancel ? `<button type="button" class="btn" data-dlg="0">${esc(cancel)}</button>` : ""}
            <button type="button" class="btn ${danger ? "danger" : "primary"}" data-dlg="1">${esc(ok)}</button>
          </div>
        </div>`;
      root.hidden = false;
      const done = v => { root.hidden = true; root.innerHTML = ""; root.onclick = null; S.dialogDone = null; resolve(v); };
      S.dialogDone = done;
      root.onclick = e => { const b = e.target.closest("[data-dlg]"); if (b) done(b.dataset.dlg === "1"); };
      root.querySelector('[data-dlg="1"]').focus();
    });
  }
  const confirmDanger = (message, ok = "מחיקה") => ask(message, { ok, danger: true });
  const notice = message => ask(message, { ok: "הבנתי", cancel: null });

  /* הודעה קצרה בתחתית המסך, עם פעולה אופציונלית (למשל ביטול) */
  function toast(html, action) {
    const el = document.getElementById("toast");
    clearTimeout(S.toastTimer);
    el.innerHTML = `<span>${html}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
    el.hidden = false;
    if (action) el.querySelector("button").onclick = async () => { el.hidden = true; await action.run(); };
    S.toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 4000);
  }

  function projectSheet(p) {
    openSheet({
      title: p ? "עריכת פעולה" : "פעולה חדשה",
      fields: [
        { name: "title", label: "שם הפעולה", type: "text", value: p ? p.title : "", required: true, placeholder: "איטום הגג" },
        { name: "icon", label: "סמל", type: "icon", value: p ? p.icon : "tool" },
        { name: "status", label: "שלב", type: "select", value: p ? p.status : "planning", options: STATUSES.map(s => ({ value: s.id, label: s.label })) },
        { name: "statusNote", label: "מה המצב עכשיו (משפט או שניים)", type: "textarea", rows: 2, value: p ? p.statusNote : "" },
        { name: "summary", label: "רקע ותיאור", type: "textarea", rows: 4, value: p ? p.summary : "" },
        { name: "archived", label: "העברה לארכיון (מוסתרת מהדיירים)", type: "checkbox", value: p ? p.archived : false }
      ],
      onSubmit: async v => {
        const saved = await DB.put("projects", { ...(p || { order: nextOrder("projects") }), title: v.title, icon: v.icon, status: v.status, statusNote: v.statusNote, summary: v.summary, archived: v.archived });
        if (!p) location.hash = "#/project/" + saved.id;
      },
      onDelete: p ? async () => {
        const docs = docsOf(p.id);
        if (!await confirmDanger(`למחוק את "${p.title}"?` + (docs.length ? `\nיימחקו גם ${docs.length} מסמכים ותמונות.` : "") + "\nאפשר במקום זה להעביר לארכיון.")) return false;
        for (const d of docs) await deleteDoc(d);
        for (const u of T("updates").filter(x => x.projectId === p.id)) await DB.remove("updates", u.id);
        for (const c of T("collections").filter(x => x.projectId === p.id)) await DB.put("collections", { ...c, projectId: null });
        await DB.remove("projects", p.id);
        location.hash = "#/projects";
      } : null
    });
  }

  function updateSheet({ projectId, update }) {
    openSheet({
      title: update ? "עריכת עדכון" : "עדכון חדש",
      fields: [
        { name: "date", label: "תאריך", type: "date", value: update ? update.date : todayISO(), required: true },
        { name: "text", label: "מה חדש", type: "textarea", rows: 4, value: update ? update.text : "", required: true, placeholder: "נפגשתי עם שני גננים, ההצעות יגיעו עד סוף השבוע." }
      ],
      onSubmit: v => DB.put("updates", { ...(update || {}), projectId: update ? update.projectId : projectId, date: v.date, text: v.text }),
      onDelete: update ? async () => { if (!await confirmDanger("למחוק את העדכון?")) return false; await DB.remove("updates", update.id); } : null
    });
  }

  function docSheet({ doc, projectId, kind }) {
    const k = doc ? doc.kind : kind || "other";
    openSheet({
      title: doc ? "עריכת מסמך" : `הוספת ${KINDS[k].label}`,
      fields: [
        { name: "kind", label: "סוג", type: "select", value: k, options: KIND_ORDER.map(x => ({ value: x, label: KINDS[x].label })) },
        { name: "projectId", label: "שייך ל", type: "select", value: doc ? doc.projectId || "" : projectId || "", options: [{ value: "", label: "כללי (לא שייך לפעולה)" }, ...projects(true).map(p => ({ value: p.id, label: p.title }))] },
        { name: "title", label: "כותרת", type: "text", value: doc ? doc.title : "", placeholder: KINDS[k].ph },
        { name: "supplier", label: "ספק / גורם מקצועי", type: "text", value: doc ? doc.supplier : "", showWhen: "kind:report,quote,receipt" },
        { name: "amount", label: "סכום (₪)", type: "number", value: doc ? doc.amount : "", showWhen: "kind:quote,receipt", hint: "בקבלה, הסכום נרשם כהוצאה מהקופה." },
        { name: "chosen", label: "זו ההצעה שנבחרה", type: "checkbox", value: doc ? doc.chosen : false, showWhen: "kind:quote" },
        { name: "date", label: "תאריך", type: "date", value: doc ? doc.date : todayISO() },
        { name: "note", label: "הערה", type: "textarea", rows: 2, value: doc ? doc.note : "" },
        { name: "files", label: "קבצים", type: "files", existing: doc ? doc.files : [], accept: PHOTO_KINDS.includes(k) ? "image/*,video/*" : FILE_ACCEPT, hint: PHOTO_KINDS.includes(k) ? `תמונות וסרטונים. סרטון עד ${MAX_FILE_MB}MB, בערך דקה של צילום בטלפון.` : "" }
      ],
      validate: v => {
        const remaining = (doc ? doc.files || [] : []).filter(f => !v.files.remove.has(f.key)).length + v.files.add.length;
        if (v.kind === "receipt" && v.amount === null) return "יש להזין את סכום הקבלה.";
        if (!PHOTO_KINDS.includes(v.kind) && !v.title) return "יש להזין כותרת.";
        if (v.kind !== "receipt" && !remaining) return "יש לצרף לפחות קובץ אחד.";
        const big = v.files.add.find(f => f.size > MAX_FILE_MB * 1024 * 1024);
        if (big) return `הקובץ "${big.name}" גדול מדי (${Math.round(big.size / 1048576)}MB). אפשר להעלות קבצים עד ${MAX_FILE_MB}MB. לסרטון: לקצר אותו או לצלם באיכות נמוכה יותר.`;
        return null;
      },
      onSubmit: async v => {
        const files = (doc ? doc.files || [] : []).filter(f => !v.files.remove.has(f.key));
        for (const file of v.files.add) {
          const prepared = await prepareFile(file);
          files.push(await DB.putFile(prepared.blob, prepared.name));
        }
        const title = v.title || (PHOTO_KINDS.includes(v.kind) ? KINDS[v.kind].label : "");
        await DB.put("documents", { ...(doc || {}), kind: v.kind, projectId: v.projectId || null, title, supplier: v.supplier, amount: v.amount, chosen: v.chosen, date: v.date, note: v.note, files });
        // מוחקים קבצים שהוסרו רק אחרי שהשמירה הצליחה
        if (doc) for (const f of (doc.files || []).filter(f => v.files.remove.has(f.key))) await DB.removeFile(f).catch(() => {});
      },
      onDelete: doc ? async () => {
        if (!await confirmDanger(`למחוק את "${doc.title || KINDS[doc.kind].label}" וכל הקבצים שלו?`)) return false;
        await deleteDoc(doc);
      } : null
    });
  }

  async function deleteDoc(d) {
    for (const f of d.files || []) await DB.removeFile(f).catch(() => {});
    await DB.remove("documents", d.id);
  }

  function settingsSheet() {
    const st = S.data.settings;
    openSheet({
      title: "פרטי הבניין",
      fields: [
        { name: "buildingName", label: "שם האתר / הבניין", type: "text", value: st.buildingName, required: true, placeholder: "ועד הבית רחוב הדוגמה 5" },
        { name: "address", label: "כתובת", type: "text", value: st.address },
        { name: "openingBalance", label: "יתרת פתיחה בקופה (₪)", type: "number", value: st.openingBalance, hint: "הכסף שהיה בקופה לפני שהתחלת לרשום באתר." }
      ],
      onSubmit: v => DB.saveSettings({ buildingName: v.buildingName, address: v.address, openingBalance: v.openingBalance || 0 })
    });
  }

  /* ====================== כיווץ תמונות לפני העלאה ====================== */
  async function prepareFile(file) {
    const compressible = /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && file.size > 350 * 1024;
    if (!compressible) return { blob: file, name: file.name };
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const max = 1800;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.82));
      if (!blob || blob.size >= file.size) return { blob: file, name: file.name };
      return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
    } catch {
      return { blob: file, name: file.name };
    }
  }

  /* ============================== תצוגת תמונות ============================== */
  const LB = { items: [], i: 0 };
  function openLightbox(group, key) {
    const [kind, projectId] = group.split(":");
    LB.items = [];
    docsOf(projectId || null, kind).forEach(d => (d.files || []).filter(isMedia).forEach(f => LB.items.push({ key: f.key, video: isVideo(f), caption: [d.title, dateText(d.date)].filter(Boolean).join(" · ") })));
    LB.i = Math.max(0, LB.items.findIndex(x => x.key === key));
    const el = document.getElementById("lightbox");
    el.hidden = false;
    document.body.classList.add("sheet-open");
    drawLightbox();
  }
  function drawLightbox() {
    const el = document.getElementById("lightbox");
    const it = LB.items[LB.i];
    if (!it) return closeLightbox();
    const many = LB.items.length > 1;
    el.innerHTML = `
      <button class="lb-btn lb-close" data-lb="close" aria-label="סגירה">${icon("x")}</button>
      ${it.video ? `<video data-file="${esc(it.key)}" controls playsinline autoplay></video>` : `<img data-file="${esc(it.key)}" alt="">`}
      <div class="lb-caption">${esc(it.caption)}${many ? ` · ${LB.i + 1}/${LB.items.length}` : ""}</div>
      ${many ? `<button class="lb-btn lb-prev" data-lb="prev" aria-label="הקודמת">${icon("chevron-right")}</button><button class="lb-btn lb-next" data-lb="next" aria-label="הבאה">${icon("chevron-left")}</button>` : ""}`;
    hydrateFiles();
  }
  /* ===================== צפייה בקבצים (PDF ושאר המסמכים) ===================== */
  const isPdf = f => /pdf/i.test(f.type || "") || /.pdf$/i.test(f.name || "");
  async function urlFor(meta) {
    let url = S.urls.get(meta.key);
    if (!url) { url = await DB.fileUrl(meta); if (url) S.urls.set(meta.key, url); }
    return url;
  }

  async function openFileViewer(key) {
    const entry = S.files.get(key);
    if (!entry) return;
    const { meta, doc } = entry;
    const el = document.getElementById("lightbox");
    if (isMedia(meta)) {
      LB.items = (doc.files || []).filter(isMedia).map(f => ({ key: f.key, video: isVideo(f), caption: [doc.title, dateText(doc.date)].filter(Boolean).join(" · ") }));
      LB.i = Math.max(0, LB.items.findIndex(x => x.key === meta.key));
      el.hidden = false; document.body.classList.add("sheet-open");
      return drawLightbox();
    }
    LB.items = [];
    const url = await urlFor(meta);
    el.hidden = false; document.body.classList.add("sheet-open");
    el.innerHTML = `<div class="viewer">
        <div class="viewer-bar">
          <button class="lb-btn" data-lb="close" aria-label="סגירה">${icon("x")}</button>
          <div class="viewer-title">${esc(doc.title || meta.name)}<div class="xs">${esc(meta.name)}</div></div>
          ${url && isPdf(meta) ? `<button class="lb-btn" data-lb="zoom" aria-label="הגדלה">${icon("zoom-in")}</button>` : ""}
          ${url ? `<a class="lb-btn" href="${url}" download="${esc(meta.name)}" aria-label="הורדה">${icon("download")}</a>` : ""}
        </div>
        <div class="viewer-body"><div class="viewer-msg">טוען...</div></div>
      </div>`;
    const body = el.querySelector(".viewer-body");
    if (!url) { body.innerHTML = `<div class="viewer-msg">הקובץ לא נמצא.</div>`; return; }
    if (isPdf(meta)) return renderPdf(url, meta, body);
    body.innerHTML = `<div class="viewer-msg">אין תצוגה מקדימה לקובץ מסוג זה.<br><a class="btn mt" href="${url}" download="${esc(meta.name)}">${icon("download")}הורדת הקובץ</a></div>`;
  }

  // PDF.js נטען רק בפעם הראשונה שפותחים PDF; מצייר כל עמוד כתמונה ברוחב המסך
  let pdfLib = null;
  function loadPdfJs() {
    if (!pdfLib) pdfLib = new Promise((res, rej) => {
      const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
      const sc = document.createElement("script");
      sc.src = base + "pdf.min.js";
      sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js"; res(window.pdfjsLib); };
      sc.onerror = () => { pdfLib = null; rej(new Error("pdf.js failed to load")); };
      document.head.appendChild(sc);
    });
    return pdfLib;
  }

  async function renderPdf(url, meta, body) {
    try {
      const lib = await loadPdfJs();
      const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const pdf = await lib.getDocument({ data }).promise;
      body.innerHTML = "";
      const width = Math.min(body.clientWidth - 16, 900);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!body.isConnected) return; // הצופה נסגר באמצע
        const page = await pdf.getPage(i);
        const scale = width / page.getViewport({ scale: 1 }).width;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        canvas.style.width = width + "px";
        canvas.dataset.w = width;
        canvas.setAttribute("aria-label", `עמוד ${i} מתוך ${pdf.numPages}`);
        body.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      }
    } catch (e) {
      console.error(e);
      body.innerHTML = `<div class="viewer-msg">לא ניתן להציג את הקובץ כאן.<br><a class="btn mt" href="${url}" download="${esc(meta.name)}">${icon("download")}הורדת הקובץ</a></div>`;
    }
  }

  function closeLightbox() {
    const el = document.getElementById("lightbox");
    el.hidden = true; el.innerHTML = "";
    document.body.classList.remove("sheet-open");
  }
  function stepLightbox(d) { LB.i = (LB.i + d + LB.items.length) % LB.items.length; drawLightbox(); }

  (function wireLightbox() {
    const el = document.getElementById("lightbox");
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-lb]");
      if (b && b.dataset.lb === "zoom") {
        const body = el.querySelector(".viewer-body");
        const on = body.classList.toggle("zoomed");
        body.querySelectorAll("canvas").forEach(c => { c.style.width = (on ? c.dataset.w * 2 : c.dataset.w) + "px"; });
        b.innerHTML = icon(on ? "zoom-out" : "zoom-in");
        b.setAttribute("aria-label", on ? "הקטנה" : "הגדלה");
        return;
      }
      if (b) return b.dataset.lb === "close" ? closeLightbox() : stepLightbox(b.dataset.lb === "next" ? 1 : -1);
      if (e.target === el) closeLightbox();
    });
    let x0 = null;
    el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener("touchend", e => {
      if (x0 === null || LB.items.length < 2) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? -1 : 1); // ב-RTL החלקה ימינה = הבאה
    }, { passive: true });
  })();

  /* ============================== אירועים ============================== */
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-sheet-close]")) return closeSheet();

    const fileLink = e.target.closest("a[data-file]");
    if (fileLink) {
      e.preventDefault();
      openFileViewer(fileLink.dataset.file);
      return;
    }

    const t = e.target.closest("[data-act]");
    if (!t) return;
    const a = t.dataset.act, ds = t.dataset;
    switch (a) {
      case "cell":
        if (S.admin) await quickMark(ds.unit, ds.coll);
        else location.hash = "#/unit/" + ds.unit;
        break;
      case "add-payment": paymentSheet({ unitId: ds.unit, collId: ds.coll }); break;
      case "dues-cell":
        if (S.admin) await quickMark(ds.unit, ds.coll);
        else location.hash = "#/unit/" + ds.unit;
        break;
      case "dues-chip": if (S.admin) await quickMark(ds.unit, ds.coll); break;
      case "dues-unit":
        if (S.admin) duesUnitSheet(ds.unit);
        else location.hash = "#/unit/" + ds.unit;
        break;
      case "dues-settings": duesSettingsSheet(); break;
      case "toggle-charge":
        if (S.openCharges.has(ds.key)) S.openCharges.delete(ds.key); else S.openCharges.add(ds.key);
        render();
        break;
      case "new-charge": {
        const p = find("projects", ds.project);
        collectionSheet(null, { title: p ? p.title : "", projectId: ds.project });
        break;
      }
      case "del-payment": {
        const p = find("payments", ds.id);
        if (!p || !await confirmDanger("למחוק את התשלום?")) return;
        await DB.remove("payments", p.id);
        closeSheet(); await reload();
        toast("התשלום נמחק.");
        break;
      }
      case "edit-payment": {
        const p = find("payments", ds.id);
        if (p) paymentSheet({ unitId: p.unitId, collId: p.collectionId, payment: p });
        break;
      }
      case "edit-unit": unitSheet(ds.id ? find("units", ds.id) : null); break;
      case "edit-collection": collectionSheet(ds.id ? find("collections", ds.id) : null); break;
      case "edit-project": projectSheet(ds.id ? find("projects", ds.id) : null); break;
      case "edit-update": updateSheet(ds.id ? { update: find("updates", ds.id) } : { projectId: ds.project }); break;
      case "add-doc": docSheet({ projectId: ds.project, kind: ds.kind }); break;
      case "edit-doc": docSheet({ doc: find("documents", ds.id) }); break;
      case "edit-settings": settingsSheet(); break;
      case "lightbox": openLightbox(ds.group, ds.key); break;
      case "doc-filter": S.docFilter[ds.group] = ds.value; render(); break;
      case "admin-login": await DB.signInAdmin(); S.admin = true; render(); break;
      case "admin-logout": await DB.signOut(); S.admin = false; location.hash = "#/home"; render(); break;
      case "reset-local":
        if (!await confirmDanger("לאפס את כל הנתונים המקומיים ולחזור לנתוני הפתיחה? כל מה שהוזן כאן יימחק.", "איפוס")) return;
        await DB.resetAll(); S.urls.clear(); await reload();
        break;
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (S.dialogDone) return S.dialogDone(false);
    if (!document.getElementById("lightbox").hidden) closeLightbox();
    else if (!document.getElementById("sheet-root").hidden) closeSheet();
  });

  window.addEventListener("hashchange", () => { closeSheet(); closeLightbox(); render(); });
  // שינוי בלשונית אחרת → מרעננים את התצוגה כאן
  window.addEventListener("storage", e => { if (e.key === DB.KEY) reload(); });

  /* ============================== הפעלה ============================== */
  (async function init() {
    try {
      S.admin = (await DB.session()).isAdmin;
      await reload();
    } catch (e) {
      console.error(e);
      $main.innerHTML = empty("טעינת הנתונים נכשלה. יש לרענן את הדף.");
    }
  })();
})();
