// ===================================================================
//  חישובי הכסף והסטטוסים של ועד הבית
// -------------------------------------------------------------------
//  פונקציות טהורות: מקבלות נתונים ומחזירות תוצאה, בלי גישה למסך או לאחסון.
//  כך אפשר לבדוק אותן לבד: tests/domain.test.js (node --test tests/).
//  אין כאן שום בדיקה שהסכומים "שווים" או "הגיוניים". הוועד קובע סכומים
//  חופשיים (סכום שונה לתת חלקה, פטור, תשלום חלקי, תשלום ביתר) והחישוב
//  רק משקף את מה שהוזן.
//  בדפדפן: window.VaadDomain. ב-node: require("./domain.js").
// ===================================================================
(function (root) {
  /**
   * @typedef {Object} Unit          תת חלקה
   * @property {string} id
   * @property {string} label        המספר שמוצג, למשל "12"
   * @property {string} [owners]
   * @property {boolean} [archived]
   *
   * @typedef {Object} Collection    גבייה (גם חודש של דמי ועד)
   * @property {string} id
   * @property {string} title
   * @property {number|null} amount  סכום לכל תת חלקה. null = טרם נקבע
   * @property {Object<string, number>} [overrides]  סכום שונה לתת חלקה. 0 = פטור
   * @property {number|null} [target]  סכום כולל נדרש, ידני
   * @property {string|null} [projectId]
   * @property {"dues"} [series]     רק בחודשי דמי ועד
   * @property {string} [month]      "YYYY-MM", רק בחודשי דמי ועד
   *
   * @typedef {Object} Payment
   * @property {string} id
   * @property {string} unitId
   * @property {string} collectionId
   * @property {number} amount
   * @property {string} date         "YYYY-MM-DD"
   *
   * @typedef {Object} Doc           מסמך של פעולה. receipt עם סכום = הוצאה
   * @property {string} id
   * @property {string|null} projectId
   * @property {"report"|"quote"|"receipt"|"before"|"after"|"other"} kind
   * @property {number|null} [amount]
   * @property {boolean} [chosen]    הצעת מחיר שנבחרה
   *
   * @typedef {"paid"|"partial"|"unpaid"|"exempt"|"future"} PayState
   */

  const isSet = v => !(v === null || v === undefined || v === "");
  const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);
  const round2 = n => Math.round(n * 100) / 100;

  /** הסכום שתת חלקה צריכה לשלם בגבייה. null = טרם נקבע, 0 = פטור. */
  function dueFor(c, unitId) {
    const o = c.overrides && c.overrides[unitId];
    if (isSet(o)) return Number(o);
    return isSet(c.amount) ? Number(c.amount) : null;
  }

  /**
   * מצב תשלום של תת חלקה בגבייה אחת.
   * future = חודש דמי ועד אחרי החודש הנוכחי שעוד לא שולם. לא נחשב חוב (owed = 0).
   * @param {Collection} c @param {string} unitId @param {Payment[]} payments @param {string} nowMonth "YYYY-MM"
   * @returns {{ st: PayState, due: number|null, paid: number, remaining: number|null, owed: number }}
   */
  function cellStatus(c, unitId, payments, nowMonth) {
    const due = dueFor(c, unitId);
    const list = payments.filter(p => p.collectionId === c.id && p.unitId === unitId);
    const paid = sum(list.map(p => p.amount));
    const future = !!(c.month && c.month > nowMonth);
    let st;
    if (due === 0) st = "exempt";
    else if (due === null) st = list.length ? "paid" : future ? "future" : "unpaid";
    else if (paid >= due - 0.001) st = "paid";
    else if (paid > 0) st = "partial";
    else st = future ? "future" : "unpaid";
    const remaining = due === null ? null : Math.max(due - paid, 0);
    return { st, due, paid, remaining, owed: future ? 0 : (remaining || 0) };
  }

  /**
   * הסכום הכולל שצריך לגייס: יעד ידני, ואם אין אז עלות הפעולה לפי הקבלות,
   * ואם אין אז הצעות המחיר שנבחרו.
   * @returns {{ value: number, source: "manual"|"receipts"|"quote" }|null}
   */
  function collectionTarget(c, documents) {
    if (isSet(c.target)) return { value: Number(c.target), source: "manual" };
    if (!c.projectId) return null;
    const ofProject = documents.filter(d => d.projectId === c.projectId);
    const receipts = sum(ofProject.filter(d => d.kind === "receipt").map(d => d.amount));
    if (receipts > 0) return { value: receipts, source: "receipts" };
    const chosen = sum(ofProject.filter(d => d.kind === "quote" && d.chosen).map(d => d.amount));
    if (chosen > 0) return { value: chosen, source: "quote" };
    return null;
  }

  /**
   * מצב גבייה: כמה שילמו, כמה נגבה, ומה הסכום הנדרש.
   * תתי חלקות פטורות (סכום 0) לא נספרות. אם אין יעד ממקור אחר, היעד הוא סכום החיובים
   * של כל תתי החלקות (source: "perUnit"), רק כשכולם ידועים.
   * @param {Collection} c @param {Unit[]} units פעילות בלבד @param {Payment[]} payments @param {Doc[]} documents @param {string} nowMonth
   */
  function collectionProgress(c, units, payments, documents, nowMonth) {
    const relevant = units.filter(u => dueFor(c, u.id) !== 0);
    const statuses = relevant.map(u => cellStatus(c, u.id, payments, nowMonth));
    const collected = sum(payments.filter(p => p.collectionId === c.id).map(p => p.amount));
    const expected = statuses.some(s => s.due === null) ? null : sum(statuses.map(s => s.due));
    const target = collectionTarget(c, documents) || (expected !== null && expected > 0 ? { value: expected, source: "perUnit" } : null);
    return { total: relevant.length, paid: statuses.filter(s => s.st === "paid").length, collected, expected, target };
  }

  /** כמה חסר עד היעד. שלילי = נגבה יותר מהנדרש (היתרה נשארת בקופה המשותפת). */
  const remainingToTarget = pr => round2(pr.target.value - pr.collected);

  /** הקופה: יתרת פתיחה + כל התשלומים, פחות סכומי הקבלות. */
  function cashBox(data) {
    const opening = Number((data.settings || {}).openingBalance) || 0;
    const inc = sum((data.payments || []).map(p => p.amount));
    const out = sum((data.documents || []).filter(d => d.kind === "receipt").map(d => d.amount));
    return { opening, in: inc, out, balance: opening + inc - out };
  }

  /**
   * מצב דמי הוועד של תת חלקה עד היום.
   * none = אין עדיין חודשים לתשלום. ok = הכול שולם (lastPaidMonth: עד איזה חודש, ahead: כולל מראש).
   * open = יש חודשים שלא שולמו במלואם (open: רשימת "YYYY-MM", owed: סכום החוב).
   * @param {string} unitId @param {Collection[]} months חודשי דמי ועד @param {Payment[]} payments @param {string} nowMonth
   */
  function duesStatus(unitId, months, payments, nowMonth) {
    const rows = [...months].sort((a, b) => a.month.localeCompare(b.month)).map(c => ({ c, s: cellStatus(c, unitId, payments, nowMonth) }));
    const due = rows.filter(x => x.s.st !== "future" && x.s.st !== "exempt");
    if (!due.length) return { kind: "none" };
    const open = due.filter(x => x.s.st === "unpaid" || x.s.st === "partial");
    if (!open.length) {
      let last = null;
      for (const x of rows) { if (x.s.st === "paid" || x.s.st === "exempt") last = x.c.month; else break; }
      return { kind: "ok", lastPaidMonth: last, ahead: !!last && last > nowMonth };
    }
    return { kind: "open", open: open.map(x => x.c.month), owed: sum(open.map(x => x.s.owed)) };
  }

  const api = { dueFor, cellStatus, collectionTarget, collectionProgress, remainingToTarget, cashBox, duesStatus };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VaadDomain = api;
})(typeof window !== "undefined" ? window : globalThis);
