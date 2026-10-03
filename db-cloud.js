// ===================================================================
//  שכבת נתונים בענן (Supabase), עם אותו ממשק כמו LocalDB ב-db.js.
//  נבחרת כש-VAAD_CONFIG.CLOUD הוא true. ההרשאות נאכפות בשרת (supabase/schema.sql):
//  כל חבר קורא רק את הבניין שלו, ורק ועד הבניין כותב.
//
//  טבלאות בענן: buildings (settings), members (מי שייך לאיזה בניין ובאיזה תפקיד),
//  records (כל רשומה של האפליקציה כמסמך JSON), invites (קישורי הצטרפות).
//  קבצים: דלי פרטי vaad-files, נתיב <building_id>/<key>.
//
//  בנוסף לממשק המשותף יש כאן כניסה ובחירת בניין: start, signInWithGoogle,
//  createBuilding, joinBuilding, inviteInfo, inviteLink, members, logout.
// ===================================================================
(function () {
  const cfg = window.VAAD_CONFIG || {};
  if (!cfg.CLOUD) return;

  const TABLES = ["units", "collections", "payments", "projects", "updates", "documents"];
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  const BUILDING_KEY = "vaad-building";   // הבניין האחרון שנבחר (למי שחבר בכמה בניינים)
  const ADMIN_KEY = "vaad-admin";         // מצב ניהול פתוח. רק ועד יכול להיכנס אליו
  const JOIN_KEY = "vaad-join";           // קישור הזמנה שממתין לכניסה עם גוגל
  const PAGE = 1000;                      // מקסימום שורות לבקשה בשרת
  const URL_TTL = 60 * 60 * 24;           // תוקף כתובת לקובץ, בשניות

  const clone = o => JSON.parse(JSON.stringify(o));
  const newId = () => crypto.randomUUID();
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* מצב פרטי */ } }
  };
  const fail = (error, what) => { if (error) { console.error(what, error); throw new Error(what + ": " + (error.message || error)); } };

  function loadSdk() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = SDK_URL;
      s.onload = () => ok(window.supabase);
      s.onerror = () => no(new Error("supabase-js"));
      document.head.appendChild(s);
    });
  }

  const CloudDB = {
    isCloud: true,
    KEY: null,
    sb: null,
    user: null,
    building: null,      // מזהה הבניין הפעיל
    role: null,          // committee / tenant
    memberships: [],     // [{ building_id, role, name }]

    /* ---------------------------- כניסה ---------------------------- */
    // מחזיר את המצב: signed-out, join (יש קישור הזמנה), pick (כמה בניינים), none (אין בניין), ready
    async start() {
      if (!this.sb) {
        const { createClient } = await loadSdk();
        this.sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true } });
      }
      const join = new URLSearchParams(location.search).get("join");
      if (join) {
        ls.set(JOIN_KEY, join);
        const url = new URL(location.href);
        url.searchParams.delete("join");
        history.replaceState(null, "", url.toString());
      }
      const { data: { session } } = await this.sb.auth.getSession();
      this.user = session ? session.user : null;
      if (!this.user) return { state: "signed-out", invite: ls.get(JOIN_KEY) ? await this.inviteInfo(ls.get(JOIN_KEY)).catch(() => null) : null };
      if (ls.get(JOIN_KEY)) return { state: "join", invite: await this.inviteInfo(ls.get(JOIN_KEY)).catch(() => null) };
      return this.loadMemberships();
    },

    async loadMemberships() {
      const { data, error } = await this.sb.from("members").select("building_id, role, buildings(settings)").eq("user_id", this.user.id);
      fail(error, "members");
      this.memberships = (data || []).map(m => ({ building_id: m.building_id, role: m.role, name: (m.buildings && m.buildings.settings && m.buildings.settings.buildingName) || "בניין" }));
      if (!this.memberships.length) return { state: "none" };
      const saved = this.memberships.find(m => m.building_id === ls.get(BUILDING_KEY));
      if (saved || this.memberships.length === 1) { this.useBuilding((saved || this.memberships[0]).building_id); return { state: "ready" }; }
      return { state: "pick", buildings: this.memberships };
    },

    useBuilding(id) {
      const m = this.memberships.find(x => x.building_id === id);
      if (!m) throw new Error("not a member");
      if (ls.get(BUILDING_KEY) !== id) ls.set(ADMIN_KEY, null);   // מצב ניהול לא עובר בין בניינים
      this.building = id;
      this.role = m.role;
      ls.set(BUILDING_KEY, id);
    },

    // חוזרים לאותה כתובת אחרי הכניסה עם גוגל
    async signInWithGoogle() {
      const { error } = await this.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
      fail(error, "google");
    },

    async logout() {
      await this.sb.auth.signOut();
      [ADMIN_KEY, BUILDING_KEY, JOIN_KEY].forEach(k => ls.set(k, null));
    },

    async createBuilding(settings) {
      const { data, error } = await this.sb.rpc("create_building", { p_settings: { buildingName: "", address: "", openingBalance: 0, ...settings } });
      fail(error, "create_building");
      await this.loadMemberships();
      this.useBuilding(data);
      ls.set(ADMIN_KEY, "1");
      return data;
    },

    async inviteInfo(token) {
      const { data, error } = await this.sb.rpc("invite_info", { p_token: token });
      fail(error, "invite_info");
      return data && data[0] ? { token, buildingName: data[0].building_name, role: data[0].role } : null;
    },

    async joinBuilding(token) {
      const { data, error } = await this.sb.rpc("join_building", { p_token: token });
      ls.set(JOIN_KEY, null);
      fail(error, "join_building");
      await this.loadMemberships();
      this.useBuilding(data);
      return data;
    },
    dropInvite() { ls.set(JOIN_KEY, null); },

    /* ------------------ הזמנות וחברים (ועד בלבד) ------------------ */
    // קישור ההזמנה הפעיל לתפקיד, ואם אין, נוצר חדש. fresh = מבטלים את הישן ויוצרים חדש
    async inviteLink(role, fresh = false) {
      if (fresh) {
        const { error } = await this.sb.from("invites").update({ revoked_at: new Date().toISOString() }).eq("building_id", this.building).eq("role", role).is("revoked_at", null);
        fail(error, "invites");
      }
      let { data, error } = await this.sb.from("invites").select("token").eq("building_id", this.building).eq("role", role).is("revoked_at", null).limit(1);
      fail(error, "invites");
      let token = data && data[0] && data[0].token;
      if (!token) {
        ({ data, error } = await this.sb.from("invites").insert({ building_id: this.building, role }).select("token").single());
        fail(error, "invites");
        token = data.token;
      }
      return `${location.origin}${location.pathname}?join=${token}`;
    },

    async members() {
      const { data, error } = await this.sb.from("members").select("user_id, role, email, name, created_at").eq("building_id", this.building).order("created_at");
      fail(error, "members");
      return (data || []).map(m => ({ ...m, me: m.user_id === this.user.id }));
    },
    async setMemberRole(userId, role) {
      const { error } = await this.sb.from("members").update({ role }).eq("building_id", this.building).eq("user_id", userId);
      fail(error, "members");
    },
    async removeMember(userId) {
      const { error } = await this.sb.from("members").delete().eq("building_id", this.building).eq("user_id", userId);
      fail(error, "members");
    },

    /* ----------------------- נתונים, ממשק משותף ----------------------- */
    async loadAll() {
      const { data: b, error: be } = await this.sb.from("buildings").select("settings, version").eq("id", this.building).single();
      fail(be, "buildings");
      const d = { version: b.version, settings: b.settings || {} };
      TABLES.forEach(t => { d[t] = []; });
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.sb.from("records").select("tbl, data").eq("building_id", this.building)
          .order("tbl").order("id").range(from, from + PAGE - 1);
        fail(error, "records");
        data.forEach(r => { if (d[r.tbl]) d[r.tbl].push(r.data); });
        if (data.length < PAGE) break;
      }
      return d;
    },

    async put(table, obj) {
      const now = new Date().toISOString();
      const row = clone(obj);
      if (!row.id) { row.id = newId(); row.createdAt = row.createdAt || now; }
      row.updatedAt = now;
      const { error } = await this.sb.from("records").upsert({ building_id: this.building, tbl: table, id: row.id, data: row });
      fail(error, "put " + table);
      return clone(row);
    },

    // הרבה רשומות בבקשה אחת (העברת נתונים מהמחשב לענן)
    async putMany(table, rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map(r => ({ building_id: this.building, tbl: table, id: r.id, data: r }));
        const { error } = await this.sb.from("records").upsert(chunk);
        fail(error, "put " + table);
      }
    },

    async remove(table, id) {
      const { error } = await this.sb.from("records").delete().eq("building_id", this.building).eq("tbl", table).eq("id", id);
      fail(error, "remove " + table);
    },

    async saveSettings(settings) {
      const { data, error } = await this.sb.from("buildings").select("settings").eq("id", this.building).single();
      fail(error, "settings");
      const { error: ue } = await this.sb.from("buildings").update({ settings: { ...(data.settings || {}), ...clone(settings) } }).eq("id", this.building);
      fail(ue, "settings");
    },

    /* קבצים */
    _path(key) { return `${this.building}/${key}`; },
    async putFile(blob, name, key = newId()) {
      const { error } = await this.sb.storage.from(cfg.STORAGE_BUCKET).upload(this._path(key), blob, { contentType: blob.type || "application/octet-stream", upsert: true });
      fail(error, "upload");
      return { key, name: name || "file", type: blob.type || "", size: blob.size || 0 };
    },
    async fileUrl(meta) {
      const { data, error } = await this.sb.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(this._path(meta.key), URL_TTL);
      if (error) return null;
      return data.signedUrl;
    },
    async removeFile(meta) {
      const { error } = await this.sb.storage.from(cfg.STORAGE_BUCKET).remove([this._path(meta.key)]);
      fail(error, "remove file");
    },

    /* מצב ניהול: רק ועד הבניין, והשרת בודק את זה בכל כתיבה */
    async session() { return { isAdmin: this.role === "committee" && ls.get(ADMIN_KEY) === "1", canAdmin: this.role === "committee" }; },
    async signInAdmin() {
      if (this.role !== "committee") throw new Error("רק ועד הבניין יכול לערוך");
      ls.set(ADMIN_KEY, "1");
    },
    async signOut() { ls.set(ADMIN_KEY, null); }
  };

  window.CloudDB = CloudDB;
  window.DB = CloudDB;
})();
