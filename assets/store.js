'use strict';

/* ==========================================================================
   校园雷达 · 存储层
   --------------------------------------------------------------------------
   全部数据只存在浏览器 localStorage，不上传任何服务器。分四个键保存，
   用户的操作结果（收藏 / 报名 / 忽略 / 自己发布）刷新和重开都还在：
     :items       用户自己发布的内容
     :profile     用户画像（年级 / 每周可投入时间 / 兴趣 / 昵称）
     :actions     收藏、标记已报名、已忽略
     :reports     对可疑内容的举报次数
   ========================================================================== */

(function () {
  const CFG = window.CAMPUS_DATA;
  const NS = CFG.storageKey;

  const K = {
    items: NS + ':items',
    profile: NS + ':profile',
    actions: NS + ':actions',
    reports: NS + ':reports',
    theme: NS + ':theme',
    accent: NS + ':accent',
    dark: NS + ':dark',
    admin: NS + ':admin'
  };

  /* 管理员口令。默认口令：radar2026（可在「我的」里改）。
     注意：这是纯前端站点的本地口令，只用于挡住"随口发布"，
     不是真正的安全机制 —— 数据与校验都在本机浏览器里。 */
  const DEFAULT_ADMIN = 'radar2026';

  /** 简易字符串散列（不用于任何安全场景，只避免明文直存） */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36) + '_' + str.length;
  }

  const DEFAULT_PROFILE = { nickname: '', grade: 1, hours: 6, interests: ['coding', 'ai'] };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (err) {
      console.warn('[校园雷达] 读取本地数据失败，已回退默认值：', key, err);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[校园雷达] 写入本地数据失败：', key, err);
      return false;
    }
  }

  function uid() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- 用户自己发布的内容 ---------------- */

  function normalizeUserItem(raw) {
    const now = new Date();
    const item = {
      id: raw.id || uid(),
      title: String(raw.title || '').trim(),
      cat: raw.cat || '文体兴趣',
      type: raw.type || '学生活动',
      source: 'student',
      publisher: String(raw.publisher || '').trim() || '学生个人发布',
      audience: String(raw.audience || '').trim() || '欢迎感兴趣的同学',
      gradeMin: Number(raw.gradeMin) || 1,
      signupBy: raw.signupBy || null,
      eventStart: raw.eventStart || null,
      eventEnd: null,
      // 时间是"确定的日期"还是"只写了文字"，用不同标识区分，界面据此决定怎么显示
      eventPattern: raw.eventStart ? 'single' : 'textonly',
      recurring: String(raw.whatIf || raw.recurring || '').trim(),
      eventWhere: raw.whereUnconfirmed ? '' : String(raw.eventWhere || '').trim(),
      fee: raw.feeMode === 'aa' ? '费用 AA' : (raw.feeMode === 'free' ? '免费' : (String(raw.fee || '').trim() || null)),
      capacity: String(raw.capacity || '').trim() || null,
      effort: String(raw.effort || '').trim() || null,
      applyHow: raw.howUnconfirmed ? '材料未注明是否需要报名' : (String(raw.applyHow || '').trim() || '报名后拉群'),
      applyRisk: '',
      gain: '',
      mustKnow: (raw.mustKnow || []).filter(Boolean),
      actions: (raw.actions || []).filter(Boolean),
      unconfirmed: (raw.unconfirmed || []).filter(Boolean),
      redFlags: (raw.redFlags || []).filter(Boolean),
      related: [], role: 'main', updatedAt: '由你发布',
      tags: (raw.tags || []).filter(Boolean),
      /* 配图：只接受 dataURL（纯前端站点没有服务器可上传）。
         体积由前端压缩控制在几十 KB，避免撑爆 localStorage 配额。 */
      image: /^data:image\//i.test(String(raw.image || '')) ? String(raw.image) : '',
      contact: String(raw.contact || '').trim(),
      userPublished: true,
      createdAt: raw.createdAt || now.toISOString(),
      updatedAtHuman: raw.updatedAtHuman || ''
    };
    if (raw.whereUnconfirmed) item.unconfirmed = ['最终场地（发布时标注为待确认）'].concat(item.unconfirmed);
    if (item.eventPattern === 'rolling' && !item.unconfirmed.length) {
      item.unconfirmed = ['具体时间'];
    } else if (item.eventPattern === 'rolling') {
      item.unconfirmed = ['具体时间'].concat(item.unconfirmed.filter((x) => x !== '具体时间'));
    }
    return item;
  }

  /* ---------------- 种子数据的"增量合并" ----------------
     开发者后续往 data.js 里补了新条目时，已存过数据的老用户也能拿到，
     不会因为 localStorage 里已有旧副本就永远看不到新内容。            */

  function ensureSeed() {
    const seen = read(NS + ':seedIds', []);
    // 只跟踪"独立条目"：后续通知（role: 'update'）会并入主条目，不单独占列表
    const ids = CFG.items.filter((it) => it.role !== 'update').map((it) => it.id);
    const added = ids.filter((id) => seen.indexOf(id) < 0);
    if (added.length) write(NS + ':seedIds', ids);
    return added;
  }

  /* ---------------- 统一的数据入口 ----------------
     Radar 的数据访问都走 window.Radar.userItems（种子 + 用户发布）。   */

  function allItemsRaw() {
    return (window.Radar && window.Radar.userItems) || CFG.items;
  }

  const Store = {
    K, DEFAULT_PROFILE, uid,

    /* --- 用户发布 --- */
    userItems() { return read(K.items, []); },
    saveUserItem(raw) {
      const list = read(K.items, []);
      const item = normalizeUserItem(raw);
      const idx = list.findIndex((x) => x.id === item.id);
      if (idx >= 0) list[idx] = item; else list.unshift(item);
      write(K.items, list);
      this.sync();
      return item;
    },
    removeUserItem(id) {
      const list = read(K.items, []).filter((x) => x.id !== id);
      write(K.items, list);
      this.sync();
    },

    /** 把用户发布的内容注入逻辑层的数据视图 */
    sync() {
      if (!window.Radar) return;
      const mine = read(K.items, []).map(normalizeUserItem);
      window.Radar.userItems = CFG.items.concat(mine);
    },

    /* --- 画像 --- */
    profile() {
      const p = read(K.profile, {});
      return Object.assign({}, DEFAULT_PROFILE, p, {
        interests: Array.isArray(p.interests) ? p.interests : DEFAULT_PROFILE.interests.slice(),
        grade: Number(p.grade) || DEFAULT_PROFILE.grade,
        hours: Number(p.hours) || DEFAULT_PROFILE.hours
      });
    },
    saveProfile(patch) {
      const next = Object.assign(this.profile(), patch || {});
      write(K.profile, next);
      return next;
    },

    /* --- 收藏 / 报名 / 忽略 --- */
    actions() {
      const a = read(K.actions, {});
      return { saved: a.saved || [], joined: a.joined || [], hidden: a.hidden || [] };
    },
    toggle(kind, id) {
      const a = this.actions();
      if (!a[kind]) return a;
      const i = a[kind].indexOf(id);
      if (i >= 0) a[kind].splice(i, 1); else a[kind].unshift(id);
      write(K.actions, a);
      return a;
    },
    has(kind, id) {
      return this.actions()[kind].indexOf(id) >= 0;
    },

    /* --- 举报（本地计数：同一内容被多次举报后自动降权） --- */
    reports() { return read(K.reports, {}); },
    report(id) {
      const r = this.reports();
      r[id] = (r[id] || 0) + 1;
      write(K.reports, r);
      return r[id];
    },
    reportCount(id) { return this.reports()[id] || 0; },

    /* --- 发布权限（管理员口令）--- */
    adminStored() {
      const a = read(K.admin, null);
      return a && a.pass ? a : null;
    },
    hasAdminPass() { return !!this.adminStored(); },
    verifyAdmin(pass) {
      const a = this.adminStored();
      const expect = a ? a.pass : hash(DEFAULT_ADMIN);
      return hash(String(pass || '')) === expect;
    },
    adminUnlocked() {
      try { return sessionStorage.getItem(K.admin + ':unlocked') === '1'; } catch { return false; }
    },
    setAdminUnlocked(on) {
      try {
        if (on) sessionStorage.setItem(K.admin + ':unlocked', '1');
        else sessionStorage.removeItem(K.admin + ':unlocked');
      } catch { /* 隐私模式忽略 */ }
      return this.adminUnlocked();
    },
    setAdminPass(pass) {
      if (!pass || String(pass).length < 4) return false;
      write(K.admin, { pass: hash(String(pass)), updatedAt: new Date().toISOString() });
      return true;
    },
    adminPassIsDefault() { return !this.adminStored(); },

    /* --- 主题 --- */
    readTheme() { try { return localStorage.getItem(K.theme) || 'auto'; } catch { return 'auto'; } },
    writeTheme(m) { try { localStorage.setItem(K.theme, m); } catch { /* 隐私模式下忽略 */ } },

    /* --- 界面配色：主色（页面底色）+ 深浅 ---
       主色存在本机，刷新后保留；深浅是独立的开关，
       这样用户既能换色、也能单独切换明亮/深色。 */
    readAccent() {
      try {
        const v = localStorage.getItem(K.accent);
        return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : '';
      } catch { return ''; }
    },
    writeAccent(hex) { try { localStorage.setItem(K.accent, String(hex)); } catch { /* 忽略 */ } },
    readDark() { try { return localStorage.getItem(K.dark) === '1'; } catch { return false; } },
    writeDark(on) { try { localStorage.setItem(K.dark, on ? '1' : '0'); } catch { /* 忽略 */ } },

    /* --- 维护 --- */
    exportAll() {
      return JSON.stringify({
        app: CFG.productName,
        exportedAt: new Date().toISOString(),
        myItems: read(K.items, []),
        profile: this.profile(),
        actions: this.actions()
      }, null, 2);
    },
    importAll(json) {
      const p = JSON.parse(json);
      if (Array.isArray(p.myItems)) write(K.items, p.myItems);
      if (p.profile) write(K.profile, p.profile);
      if (p.actions) write(K.actions, p.actions);
      this.sync();
    },
    resetUserData() {
      write(K.items, []);
      write(K.actions, { saved: [], joined: [], hidden: [] });
      write(K.reports, {});
      this.sync();
    },

    seedAdded: ensureSeed,
    allItemsRaw
  };

  window.Store = Store;
})();
