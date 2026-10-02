// ===================================================================
//  שכבת נתונים, ממשק אחד, שני מימושים:
//   • מקומי (localStorage לנתונים + IndexedDB לקבצים) כשאין הגדרות ענן
//   • ענן (Supabase), יתווסף בשלב ההקמה, עם אותו ממשק בדיוק
//  app.js מדבר רק עם window.DB ולא יודע איפה הנתונים נשמרים.
//
//  טבלאות: units, collections, payments, projects, updates, documents
//  ובנוסף אובייקט settings אחד.
// ===================================================================
(function () {
  const TABLES = ["units", "collections", "payments", "projects", "updates", "documents"];

  function newId() {
    // crypto.randomUUID זמין רק בהקשר מאובטח (https / localhost)
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  const clone = o => JSON.parse(JSON.stringify(o));

  /* ------------------------- IndexedDB לקבצים ------------------------- */
  const idb = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open("vaad-files", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("files");
        r.onsuccess = () => { this._db = r.result; res(this._db); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction("files", mode);
        const out = fn(t.objectStore("files"));
        t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
        t.onerror = () => rej(t.error);
      });
    },
    put(key, blob) { return this.tx("readwrite", s => s.put(blob, key)); },
    get(key) { return this.tx("readonly", s => s.get(key)); },
    del(key) { return this.tx("readwrite", s => s.delete(key)); },
    clear() { return this.tx("readwrite", s => s.clear()); }
  };

  /* ============================ מצב מקומי ============================ */
  const LocalDB = {
    isCloud: false,
    KEY: "vaad-data-v1",
    ADMIN_KEY: "vaad-admin",
    _data: null,

    // קוראים מחדש מ-localStorage בכל פעולה (בלי מטמון בזיכרון), כדי ששתי לשוניות פתוחות
    // לא ידרסו זו את השמירות של זו
    _load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(this.KEY)); } catch { d = null; }
      if (!d) d = clone(window.VAAD_SEED || {});
      d.settings = d.settings || {};
      TABLES.forEach(t => { if (!Array.isArray(d[t])) d[t] = []; });
      if ((d.version || 1) < 2) {
        // גרסה 2: דמי ועד עברו מגבייה שנתית אחת לגבייה נפרדת לכל חודש
        const old = d.collections.find(c => c.id === "c-dues-2026");
        if (old && !d.payments.some(p => p.collectionId === old.id)) d.collections = d.collections.filter(c => c !== old);
        if (!d.collections.some(c => c.series === "dues")) d.collections.push(...window.VAAD_DUES_MONTHS("2026-08", "2027-08"));
        d.version = 2;
      }
      if (d.version < 3) {
        // גרסה 3: ניקוי סימני פיסוק טיפוגרפיים בטקסטים שמורים
        const fix = v => typeof v !== "string" ? v : v
          .replace(/^תמונות — לפני$/, "לפני העבודה").replace(/^תמונות — אחרי$/, "אחרי העבודה")
          .replace(/\u05F4/g, '"').replace(/\u05F3/g, "'").replace(/ [\u2014\u2013] /g, ", ").replace(/[\u2014\u2013]/g, "-").replace(/\u05BE/g, " ");
        TABLES.forEach(t => d[t].forEach(row => Object.keys(row).forEach(k => { if (k !== "id") row[k] = fix(row[k]); })));
        Object.keys(d.settings).forEach(k => { d.settings[k] = fix(d.settings[k]); });
        d.version = 3;
      }
      this._data = d;
      this._save();
      return d;
    },
    _save() { localStorage.setItem(this.KEY, JSON.stringify(this._data)); },

    async loadAll() { return clone(this._load()); },

    async put(table, obj) {
      const d = this._load();
      const now = new Date().toISOString();
      const row = clone(obj);
      if (!row.id) { row.id = newId(); row.createdAt = row.createdAt || now; }
      row.updatedAt = now;
      const arr = d[table];
      const i = arr.findIndex(x => x.id === row.id);
      if (i >= 0) arr[i] = row; else arr.push(row);
      this._save();
      return clone(row);
    },

    async remove(table, id) {
      const d = this._load();
      d[table] = d[table].filter(x => x.id !== id);
      this._save();
    },

    async saveSettings(settings) {
      const d = this._load();
      d.settings = { ...d.settings, ...clone(settings) };
      this._save();
    },

    /* קבצים */
    async putFile(blob, name) {
      const key = newId();
      await idb.put(key, blob);
      return { key, name: name || "file", type: blob.type || "", size: blob.size || 0 };
    },
    async fileUrl(meta) {
      const blob = await idb.get(meta.key);
      return blob ? URL.createObjectURL(blob) : null;
    },
    async removeFile(meta) { await idb.del(meta.key); },

    /* הרשאות, במצב מקומי אין סיסמה, רק מתג מצב ניהול */
    async session() { return { isAdmin: localStorage.getItem(this.ADMIN_KEY) === "1" }; },
    async signInAdmin() { localStorage.setItem(this.ADMIN_KEY, "1"); },
    async signOut() { localStorage.removeItem(this.ADMIN_KEY); },

    async resetAll() {
      localStorage.removeItem(this.KEY);
      this._data = null;
      await idb.clear();
    }
  };

  /* ===================== תצוגה לדוגמה (קריאה בלבד) =====================
     הנתונים נטענים מקובץ data.json והקבצים מתיקיית files. אין עריכה. */
  const SnapshotDB = {
    isCloud: false,
    isSnapshot: true,
    KEY: null,
    _data: null,
    async loadAll() {
      if (!this._data) {
        const res = await fetch("data.json", { cache: "no-store" });
        if (!res.ok) throw new Error("data.json " + res.status);
        this._data = await res.json();
      }
      return clone(this._data);
    },
    async fileUrl(meta) { return meta.path || null; },
    async session() { return { isAdmin: false }; },
    async put() { throw new Error("read-only"); },
    async remove() { throw new Error("read-only"); },
    async saveSettings() { throw new Error("read-only"); },
    async putFile() { throw new Error("read-only"); },
    async removeFile() {},
    async signInAdmin() {},
    async signOut() {},
    async resetAll() {}
  };

  window.LocalDB = LocalDB;
  window.DB = (window.VAAD_CONFIG || {}).SNAPSHOT ? SnapshotDB : LocalDB;
})();
