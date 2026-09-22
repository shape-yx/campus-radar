'use strict';

/* ==========================================================================
   校园雷达 · Runtime（编辑式版）
   命名空间、参考时间、通用格式化、记录行渲染
   ========================================================================== */

(function () {
  const App = window.App = window.App || { Views: {} };

  App.DATA = window.CAMPUS_DATA;
  App.Store = window.Store;
  App.Radar = window.Radar;

  const esc = App.esc = (v) => String(v === null || v === undefined ? '' : v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
  App.raw = (v) => String(v === null || v === undefined ? '' : v);

  /* ---------------- 参考时间：冻结在材料标注的考核当日 ---------------- */
  App.now = (function () {
    const REF = '2026-09-19 14:00';
    return {
      REF,
      mode() { try { return localStorage.getItem(App.DATA.storageKey + ':clock') || 'fixed'; } catch { return 'fixed'; } },
      setMode(m) { try { localStorage.setItem(App.DATA.storageKey + ':clock', m); } catch { /* 忽略 */ } },
      value() {
        if (this.mode() === 'live') return new Date();
        return App.Radar.parse(REF, false) || new Date();
      },
      driftHours() {
        const ref = App.Radar.parse(REF, false);
        return ref ? Math.round((new Date() - ref) / 3600000) : 0;
      }
    };
  })();

  /* ---------------- 索引编号：01 / 02 … ---------------- */
  App.idx = (n) => String(n).padStart(2, '0');
  App.dash = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

  /* ---------------- 状态 → 标记样式 ---------------- */
  const MARK = {
    open: 'accent', upcoming: 'ink', ongoing: 'solid-accent',
    closed: 'muted', ended: 'muted', rolling: 'muted', started: 'muted', unknown: 'muted'
  };
  App.statusMark = (it) =>
    '<span class="mark mark--' + (MARK[it.status.key] || 'muted') + '">' + esc(it.status.label) + '</span>';

  const DMARK = { danger: 'accent', warn: 'ink', ok: 'muted', muted: 'muted' };
  App.deadlineMark = (it) => (it.deadline
    ? '<span class="mark mark--' + (DMARK[it.deadline.tone] || 'muted') + '">' + esc(it.deadline.label) + '</span>'
    : '<span class="mark mark--muted">无截止时间</span>');

  const FMARK = { ok: 'ink', check: 'muted', blocked: 'accent' };
  App.fitMark = (it) =>
    '<span class="mark mark--' + (FMARK[it.fit.level] || 'muted') + '" title="按你在「我的」里填的年级与可投入时间判断">' +
    esc(it.fit.label) + '</span>';

  App.sourceMark = (it) => {
    if (it.source === 'official') return '<span class="mark mark--muted">学校 / 学院</span>';
    if (it.source === 'student') return '<span class="mark mark--muted">学生自主发布</span>';
    return '<span class="mark mark--accent">来源不明</span>';
  };

  App.trustMark = (it) => (it.trust.level === 'verified'
    ? '' : '<span class="mark mark--' + (it.trust.level === 'promo' ? 'accent' : 'muted') + '">' + esc(it.trust.label) + '</span>');

  /* ---------------- 数据视图（含降权过滤） ---------------- */
  App.visible = function (profile, includeDowngraded) {
    const reports = App.Store.reports();
    return App.Radar.all(profile, App.now.value()).map((it) => {
      const downgraded = it.trust.level === 'promo' || (reports[it.id] || 0) >= 3;
      return Object.assign(it, { downgraded });
    }).filter((it) => includeDowngraded || !it.downgraded);
  };

  const ACT = ['open', 'upcoming', 'ongoing', 'rolling'];
  App.isActionable = (it) => ACT.indexOf(it.status.key) >= 0;

  App.deadlineMs = (it) => (it.deadline && it.deadline.ms > 0 ? it.deadline.ms : Infinity);

  App.sortByDeadline = (list) => list.slice().sort((a, b) => App.deadlineMs(a) - App.deadlineMs(b));

  /* ---------------- 卡片：照视频的 Work 网格 ----------------
     结构 = 黑色方块 + 媒体居中（这里用条目编号做图形占位）+ 底部元信息栏
     元信息栏：左侧 [分类] 胶囊 + 标题，右侧等宽小字放状态与截止          */
  App.card = function (it, i) {
    const pill = (t, cls) => '<span class="pill' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>';
    const statusCls = { open: 'pill--ok', upcoming: '', ongoing: 'pill--accent', closed: 'pill--dim',
      ended: 'pill--dim', rolling: 'pill--dim', started: 'pill--dim', unknown: 'pill--warn' }[it.status.key] || '';
    const dlCls = it.deadline && it.deadline.tone === 'danger' ? 'pill--accent'
      : (it.deadline && it.deadline.tone === 'warn' ? 'pill--warn' : 'pill--dim');

    return '<article class="card' + (it.downgraded ? ' card--promo' : '') + '">' +
      '<a class="card__media" href="#/item/' + esc(it.id) + '" aria-label="' + esc(it.title) + '">' +
        '<span class="card__glyph">' + App.idx(i + 1) + '</span>' +
        '<span class="card__banner">' +
          '<span>' + esc(it.cat) + '</span>' +
          '<span>' + esc(it.source === 'official' ? '学校 / 学院' : it.source === 'student' ? '学生发布' : '来源不明') + '</span>' +
          (it.updates && it.updates.length ? '<span>有 ' + it.updates.length + ' 条补充通知</span>' : '') +
          (it.downgraded ? '<span>已降权</span>' : '') +
        '</span>' +
      '</a>' +
      '<div class="card__meta">' +
        pill(it.cat) +
        '<a class="title" href="#/item/' + esc(it.id) + '">' + esc(it.title) + '</a>' +
        '<span class="dim">' + pill(it.status.label, statusCls) +
          (it.deadline ? pill(it.deadline.label, dlCls) : '') + '</span>' +
      '</div>' +
    '</article>';
  };

  /* ---------------- 目录行：用于时间轴 / 我的等需要紧凑罗列的地方 ---------------- */
  App.dirrow = function (it, i, opts) {
    const o = opts || {};
    const kb = (k, v) => '<span class="kv"><b>' + esc(k) + '</b><span>' + esc(v || '—') + '</span></span>';
    const MC = { open: '', upcoming: '', ongoing: 'pill--accent', closed: 'pill--dim',
      ended: 'pill--dim', rolling: 'pill--dim', started: 'pill--dim', unknown: 'pill--warn' };
    return '<div class="dirrow">' +
      '<div class="dirrow__idx">' + App.idx(i + 1) + '</div>' +
      '<div>' +
        '<a class="dirrow__title" href="#/item/' + esc(it.id) + '">' + esc(it.title) + '</a>' +
        '<div class="btn-row" style="margin-top:8px">' +
          '<span class="pill ' + (MC[it.status.key] || 'pill--dim') + '">' + esc(it.status.label) + '</span>' +
          (it.deadline ? '<span class="pill ' + (it.deadline.tone === 'danger' ? 'pill--accent' : 'pill--dim') + '">' + esc(it.deadline.label) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="dirrow__meta">' +
        kb('时间', it.when.when || '未注明') +
        kb('地点', it.where.text) +
        (o.showGaps && it.unconfirmed.length ? kb('缺失', it.unconfirmed.length + ' 项') : '') +
      '</div>' +
      '<div class="dirrow__side"><a class="btn btn--sm" href="#/item/' + esc(it.id) + '">查看 →</a></div>' +
    '</div>';
  };

  /* ---------------- 吐司 ---------------- */
  let toastTimer = null;
  App.toast = function (msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 2400);
  };

  App.toQuery = function (o) {
    const p = new URLSearchParams();
    Object.keys(o).forEach((k) => {
      if (o[k] !== '' && o[k] !== null && o[k] !== undefined) p.set(k, o[k]);
    });
    return p.toString();
  };

  App.parseHash = function () {
    const raw = location.hash.replace(/^#/, '');
    const [path, search] = raw.split('?');
    const query = {};
    new URLSearchParams(search || '').forEach((v, k) => { query[k] = v; });
    return { path: path || '/', query };
  };
})();
