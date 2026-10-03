// ===================================================================
//  נתוני פתיחה, נטענים רק בפעם הראשונה, כשעוד אין נתונים שמורים.
//  הכול כאן ניתן לעריכה מתוך האתר במצב ניהול: מספרי תתי החלקות, הבעלים,
//  הגביות, הפעולות והסטטוסים שלהן.
// ===================================================================
// בונה רשומת גבייה לכל חודש בטווח ("YYYY-MM"). משמש גם את הגדרות דמי הוועד באתר.
// VAAD_MONTH_RANGE ו-VAAD_MONTH_NAMES מוגדרים ב-format.js, שנטען לפני הקובץ הזה.
window.VAAD_DUES_MONTHS = function (from, to, amount = null) {
  return window.VAAD_MONTH_RANGE(from, to).map(ym => {
    const [y, m] = ym.split("-").map(Number);
    return {
      id: "dues-" + ym, series: "dues", month: ym, order: y * 12 + m,
      title: `דמי ועד ${window.VAAD_MONTH_NAMES[m - 1]} ${y}`,
      amount, overrides: {}, projectId: null, dueDate: "", archived: false
    };
  });
};

window.VAAD_SEED = {
  version: 4,
  settings: {
    buildingName: "ועד הבית",
    address: "",
    openingBalance: 0
  },

  units: [4, 5, 6, 7, 8, 9, 10, 11].map(n => ({
    id: "u" + n, label: String(n), owners: "", note: "", archived: false
  })),

  projects: [
    {
      id: "p-spray", title: "ריסוס והדברה", icon: "bug", order: 1, archived: false,
      status: "done", statusNote: "הריסוס וההדברה בוצעו בהצלחה.", summary: ""
    },
    {
      id: "p-garden", title: "גינון", icon: "plant-2", order: 2, archived: false,
      status: "quotes", statusNote: 'התקבל דו"ח של יועץ גינון. כעת נאספות הצעות מחיר מגננים.', summary: ""
    },
    {
      id: "p-stairs", title: "חדר מדרגות", icon: "stairs", order: 3, archived: false,
      status: "quotes", statusNote: 'התקבל דו"ח קונסטרוקטור על הנזק. על פיו ייאספו הצעות מחיר.', summary: ""
    },
    {
      id: "p-electric", title: "חשמל", icon: "bolt", order: 4, archived: false,
      status: "consulting", statusNote: "טרם התקבל ייעוץ מקצועי בנושא.", summary: ""
    }
  ],

  // הסכומים טרם הוגדרו, יש להשלים במצב ניהול
  collections: [
    // דמי ועד: גבייה נפרדת לכל חודש (series: "dues"), אוגוסט 2026 עד אוגוסט 2027
    ...window.VAAD_DUES_MONTHS("2026-08", "2027-08"),
    {
      id: "c-spray", title: "ריסוס והדברה", order: 100, archived: false,
      amount: null, overrides: {}, projectId: "p-spray", dueDate: ""
    }
  ],

  payments: [],
  updates: [],
  documents: []
};
