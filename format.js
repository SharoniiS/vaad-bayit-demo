// ===================================================================
//  תצוגת סכומים, תאריכים וחודשים
// -------------------------------------------------------------------
//  פונקציות טהורות. סכומים ותאריכים מוחזרים עטופים ב-<bdi dir="ltr"> כדי
//  שיוצגו נכון בתוך טקסט עברי (תווי בידוד של יוניקוד לא עבדו כאן).
//  בדפדפן: window.VaadFormat, ובנוסף VAAD_MONTH_NAMES ו-VAAD_MONTH_RANGE
//  ש-seed.js ו-db.js משתמשים בהם. ב-node: require("./format.js").
// ===================================================================
(function (root) {
  const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const MONTHS_SHORT = ["ינו'", "פבר'", "מרץ", "אפר'", "מאי", "יוני", "יולי", "אוג'", "ספט'", "אוק'", "נוב'", "דצמ'"];
  const nf = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

  /** טקסט בכיוון שמאל-לימין בתוך עברית (מחזיר HTML). */
  const ltr = s => `<bdi dir="ltr">${s}</bdi>`;
  /** "1,234.5 ₪", מעוגל לאגורות. */
  const money = n => { n = Number(n) || 0; return ltr((n < 0 ? "-" : "") + nf.format(Math.abs(Math.round(n * 100) / 100)) + " ₪"); };
  /** "2026-10-05" → "05.10.2026" (טקסט רגיל). */
  const dateText = d => d ? String(d).slice(0, 10).split("-").reverse().join(".") : "";
  const fmtDate = d => d ? ltr(dateText(d)) : "";
  /** התאריך המקומי בפורמט "YYYY-MM-DD". */
  const todayISO = (now = new Date()) => { const d = new Date(now); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const curMonth = now => todayISO(now).slice(0, 7);
  /** "2026-10" → "אוקטובר 2026" */
  const monthLong = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
  /** "2026-10" → "אוק' 26" */
  const monthShort = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`; };

  /** כל החודשים בטווח, כולל הקצוות: ("2026-11", "2027-01") → ["2026-11", "2026-12", "2027-01"]. עד 120. */
  function monthRange(from, to) {
    const out = [];
    let [y, m] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    while ((y < ty || (y === ty && m <= tm)) && out.length < 120) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }

  const api = { MONTHS, MONTHS_SHORT, ltr, money, dateText, fmtDate, todayISO, curMonth, monthLong, monthShort, monthRange };
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.VaadFormat = api;
    root.VAAD_MONTH_NAMES = MONTHS;
    root.VAAD_MONTH_RANGE = monthRange;
  }
})(typeof window !== "undefined" ? window : globalThis);
