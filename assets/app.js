'use strict';

/* ==========================================================================
   校园雷达 · 机会画布
   --------------------------------------------------------------------------
   界面范式：26 条信息是画布上的 26 个物件，有坐标 / 大小 / 层级。
   三种排布（散落 / 网格 / 时间轴）切换时物件平滑归位；
   详情、我的、发布一律以右侧面板推入，画布状态不丢。

   布局引擎不依赖任何库：
     · 卡片用 CSS 变量 --x/--y/--s/--r/--o/--z 驱动 transform，切排布只改变量
     · 散落态用"张力松弛"在画布内铺开，避免重叠（35 轮迭代）
     · 尺寸按紧急度分档：越近截止越大、越亮 —— 散开时肉眼就能看出优先级
   ========================================================================== */

(function () {
  const DATA = window.CAMPUS_DATA;
  const Store = window.Store;
  const Radar = window.Radar;

  const canvasEl = document.getElementById('canvas');
  const stageEl = document.getElementById('stage');
  const stripEl = document.getElementById('strip');
  const panelEl = document.getElementById('panel');
  const scrimEl = document.getElementById('scrim');
  const countEl = document.getElementById('count');
  const modesEl = document.getElementById('modes');
  const toastEl = document.getElementById('toast');

  /* 层级约定（必须守住，否则卡片会盖住侧栏）：
       卡片       10 … 410（按纵深排序，相对顺序不能变）
       卡片悬停   500
       遮罩      1000
       侧栏      1001
       吐司      2000
     原先球面用 1000+z 给卡片排序，前排卡片能到 1400，直接盖住了 z-index 1001 的侧栏。 */
  const Z_CARD_MIN = 10, Z_CARD_SPAN = 400;

  const REF = '2026-09-19 14:00';
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(
    /[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idx = (n) => String(n).padStart(2, '0');

  let settled = false;
  let settleTimer = null;

  /* 球面（照参考视频 3—5 秒的形态）：卡片均匀贴在看不见的球体表面，
     竖向按纬度分层、横向按经度绕圈，鼠标拖动即整体旋转。
     yaw/pitch 是相机角度，透视由 JS 按 z 值算出（近大远小 + 压暗）。 */
  const globe = {
    yaw: 0.35, pitch: -0.18,
    vYaw: 0.00021, vPitch: 0,
    dragging: false, autoSpin: true,
    radius: 430, flat: 0.62, cardScale: 0.78,   // 椭圆压缩：视频里球面是扁的
    lastT: 0
  };

  const state = {
    mode: 'globe',            // globe | scatter | grid | timeline
    window: '', cat: '', source: '', feasible: '', hidden: '',
    q: '',
    picked: null,
    panel: null               // null | 'detail' | 'mine' | 'publish' | 'gate'
  };

  /* ---------------- 参考时间：冻结在材料标注的考核当日 ---------------- */
  const clock = {
    REF,
    mode() { try { return localStorage.getItem(DATA.storageKey + ':clock') || 'fixed'; } catch { return 'fixed'; } },
    value() { return this.mode() === 'live' ? new Date() : (Radar.parse(REF, false) || new Date()); }
  };

  /* ---------------- 数据视图 ---------------- */
  function allItems() {
    const reports = Store.reports();
    return Radar.all(Store.profile(), clock.value()).map((it) => {
      const downgraded = it.trust.level === 'promo' || (reports[it.id] || 0) >= 3;
      return Object.assign(it, { downgraded });
    });
  }

  const ACTIONABLE = ['open', 'upcoming', 'ongoing', 'rolling'];
  const isActionable = (it) => ACTIONABLE.indexOf(it.status.key) >= 0;

  function filtered() {
    let out = allItems();
    if (state.hidden !== '1') out = out.filter((it) => !it.downgraded);
    if (state.q) {
      const t = state.q.toLowerCase();
      out = out.filter((it) => [it.title, it.cat, it.audience, it.eventWhere || '', it.recurring || '',
        it.applyHow || '', (it.tags || []).join(' ')].join(' ').toLowerCase().indexOf(t) >= 0);
    }
    if (state.cat) out = out.filter((it) => it.cat === state.cat);
    if (state.source) out = out.filter((it) => it.source === state.source);
    if (state.window === 'today') {
      out = out.filter((it) => {
        const s = it.eventStart ? Radar.parse(it.eventStart, true) : null;
        return !!s && Radar.daysBetween(clock.value(), s) === 0;
      });
    } else if (state.window === 'week') {
      out = out.filter((it) => {
        if (it.deadline && it.deadline.ms > 0 && it.deadline.days <= 7) return true;
        const s = it.eventStart ? Radar.parse(it.eventStart, true) : null;
        return !!s && s >= clock.value() && Radar.daysBetween(clock.value(), s) <= 7;
      });
    } else if (state.window === 'open') {
      out = out.filter((it) => it.status.key === 'open');
    } else if (state.window === 'loose') {
      out = out.filter((it) => ['rolling', 'unknown', 'started'].indexOf(it.status.key) >= 0);
    }
    if (state.feasible === '1') out = out.filter((it) => it.fit.level !== 'blocked' && isActionable(it));
    return out;
  }

  /* ---------------- 紧急度分档：决定卡片大小与颜色 ---------------- */
  function tierOf(it) {
    if (['ended', 'closed'].indexOf(it.status.key) >= 0) return 'done';
    if (!it.deadline) return it.status.key === 'ongoing' ? 'urgent' : 'later';
    const d = it.deadline.days;
    if (it.deadline.ms <= 0) return 'done';
    if (d <= 2) return 'urgent';
    if (d <= 7) return 'soon';
    return 'later';
  }
  const TIER = {
    urgent: { w: 210, h: 150, s: 1.00, o: 1.00, cls: 'card--big card--urgent' },
    soon: { w: 186, h: 138, s: 0.94, o: 0.95, cls: 'card--soon' },
    later: { w: 156, h: 120, s: 0.86, o: 0.80, cls: '' },
    done: { w: 138, h: 106, s: 0.80, o: 0.58, cls: 'card--small card--done' }
  };

  /* ---------------- DOM 同步 ---------------- */
  const nodes = new Map();   // id -> { el, it }

  function cardHTML(it, i) {
    const t = tierOf(it);
    return '<span class="card__urgency"><span style="height:' + urgencyPct(it) + '%"></span></span>' +
      '<span class="card__no">' + idx(i + 1) + '</span>' +
      '<span class="card__body"><span class="card__title">' + esc(it.title) + '</span></span>' +
      '<span class="card__foot">' +
        '<span class="pill ' + pillCls(it) + '">' + esc(it.status.label) + '</span>' +
        '<span class="grow">' + esc(it.deadline ? it.deadline.label : (it.recurring ? '未注明截止' : '长期开放')) + '</span>' +
      '</span>';
  }

  function urgencyPct(it) {
    if (!it.deadline || it.deadline.ms <= 0) return 0;
    const d = it.deadline.days;
    if (d <= 0) return 100;
    return Math.max(8, Math.min(100, Math.round(100 * (1 - Math.min(d, 30) / 30))));
  }

  function pillCls(it) {
    const m = { open: 'pill--ok', ongoing: 'pill--accent', closed: 'pill--dim',
      ended: 'pill--dim', rolling: 'pill--dim', started: 'pill--dim', unknown: 'pill--warn' };
    return m[it.status.key] || '';
  }

  function sync(rows) {
    const keep = new Set(rows.map((r) => r.id));
    nodes.forEach((n, id) => { if (!keep.has(id)) { n.el.remove(); nodes.delete(id); } });
    rows.forEach((it, i) => {
      let n = nodes.get(it.id);
      if (!n) {
        const el = document.createElement('article');
        el.className = 'card';
        el.dataset.id = it.id;
        el.innerHTML = cardHTML(it, i);
        el.addEventListener('click', () => openDetail(it.id));
        canvasEl.appendChild(el);
        n = { el, it, x: 0, y: 0, w: 0, h: 0, a: 0 };
        n.el.querySelector('.card__no').textContent = idx(i + 1);
        nodes.set(it.id, n);
      }
      n.it = it;
      n.el.querySelector('.card__no').textContent = idx(i + 1);
      n.el.querySelector('.card__title').textContent = it.title;
      n.el.querySelector('.pill').textContent = it.status.label;
      n.el.querySelector('.pill').className = 'pill ' + pillCls(it);
      n.el.querySelector('.card__foot .grow').textContent =
        it.deadline ? it.deadline.label : (it.recurring ? '未注明截止' : '长期开放');
      n.el.querySelector('.card__urgency span').style.height = urgencyPct(it) + '%';
      const t = TIER[tierOf(it)];
      n.el.className = 'card ' + t.cls + (it.downgraded ? ' card--promo' : '');
      n.tw = t.w; n.th = t.h; n.ts = t.s; n.to = t.o;
    });
  }

  /* ---------------- 布局：散落 ----------------
     做法：为当前卡片找一套"行列数刚好放得下"的槽位网格，把卡片按紧急度
     从画布中心向外塞进最近的槽位，再给每个槽位加固定抖动与旋转。
     槽位本身保证间距，所以结果一定不重叠（前一版因为是先撒再推，
     纵向溢出后卡片被压到画布外，出现了 38 对重叠）。 */
  function layoutScatter(list) {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    const pad = 16, gapX = 16, gapY = 16;
    const usableW = W - pad * 2, usableH = H - pad * 2;

    // 逐列数试算，挑"能把所有卡片放进画布"的最小列数
    let chosen = null;
    for (let cols = 1; cols <= list.length; cols += 1) {
      const rows = Math.ceil(list.length / cols);
      const cellW = usableW / cols, cellH = usableH / rows;
      // 每个槽位要装得下最大尺寸的卡片（缩放后按 1.0 计，留 6px 余量做抖动）
      const maxNeedW = Math.max.apply(null, list.map((it) => nodes.get(it.id).tw)) + 6;
      const maxNeedH = Math.max.apply(null, list.map((it) => nodes.get(it.id).th)) + 6;
      if (cellW >= maxNeedW && cellH >= maxNeedH) { chosen = { cols, rows, cellW, cellH }; break; }
    }
    // 实在放不下（卡片太多/视口太小）：允许重叠，取列数最优的一档并缩小卡片
    if (!chosen) {
      let best = null;
      for (let cols = 1; cols <= list.length; cols += 1) {
        const rows = Math.ceil(list.length / cols);
        const cellW = usableW / cols, cellH = usableH / rows;
        const fit = Math.min(cellW, cellH);
        if (!best || fit > best.fit) best = { cols, rows, cellW, cellH, fit };
      }
      chosen = best;
      const maxNeedW = Math.max.apply(null, list.map((it) => nodes.get(it.id).tw));
      const maxNeedH = Math.max.apply(null, list.map((it) => nodes.get(it.id).th));
      const shrink = Math.min(1, Math.min(chosen.cellW / (maxNeedW + 8), chosen.cellH / (maxNeedH + 8)));
      chosen.shrink = shrink;
    }

    const { cols, rows, cellW, cellH } = chosen;
    const shrink = chosen.shrink || 1;

    // 槽位：按到画布中心的距离排序，最急的落在正中
    const slots = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = pad + c * cellW, y = pad + r * cellH;
        const dx = (x + cellW / 2) - W / 2, dy = (y + cellH / 2) - H / 2;
        slots.push({ c, r, x, y, d: Math.sqrt(dx * dx + dy * dy) });
      }
    }
    slots.sort((a, b) => a.d - b.d);

    const rank = { urgent: 0, soon: 1, later: 2, done: 3 };
    const ordered = list.slice().sort((a, b) => {
      const ra = rank[tierOf(a)], rb = rank[tierOf(b)];
      return ra !== rb ? ra - rb : a.title.localeCompare(b.title, 'zh-Hans-CN');
    });

    return ordered.map((it, i) => {
      const n = nodes.get(it.id);
      const slot = slots[i] || slots[slots.length - 1];
      const s = n.ts * shrink;
      const w = n.tw * s, h = n.th * s;
      const seed = (slot.c + 1) * 7.13 + (slot.r + 1) * 3.71 + 0.7;
      const jx = Math.abs(Math.sin(seed * 12.9898) * 43758.5453 % 1);
      const jy = Math.abs(Math.sin(seed * 78.233) * 43758.5453 % 1);
      const jr = Math.abs(Math.sin(seed * 39.425) * 43758.5453 % 1);
      // 抖动幅度 = 槽位剩余空间的一半，保证抖动后仍在槽内
      const roomX = Math.max(0, (cellW - w - 8) / 2);
      const roomY = Math.max(0, (cellH - h - 8) / 2);
      return {
        n,
        x: slot.x + (cellW - w) / 2 - roomX + jx * roomX * 2,
        y: slot.y + (cellH - h) / 2 - roomY + jy * roomY * 2,
        r: jr * 10 - 5,
        scaleOverride: shrink
      };
    });
  }

  /* ---------------- 布局：球面（照参考视频 3—5 秒） ----------------
     把每条信息放到球面的一组经纬点上：
       竖向分 5 条纬线（赤道上的卡片最大最亮，两极最小最暗，和视频一致）
       横向把同一纬线上的卡片均匀铺开，逐层错开半个格子，避免上下对齐
     再用 yaw / pitch 旋转这个球，透视投影后由 z 决定缩放、亮度与层级。
     拖动时旋转角实时更新，松手后回到自转。 */
  function layoutGlobe(list) {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    const R = Math.min(globe.radius, Math.min(W, H) * (W < 620 ? 0.60 : 0.78));
    const cx = W / 2, cy = H * 0.5;
    const rows = 5;
    const per = Math.ceil(list.length / rows);
    /* 卡片尺寸上限：球面最靠前的卡片放大后也不能顶出画布。
       不设这个上限时，手机上（375px 宽）球面会横向溢出 21px。 */
    const maxCardW = Math.max.apply(null, list.map((it) => nodes.get(it.id).tw)) || 160;
    const boost = 0.58 + 0.50;                       // 最前排的相对放大倍数
    const fitCard = Math.min(1, (W * 0.30) / (maxCardW * boost));
    const cy2 = Math.cos(globe.pitch), sy2 = Math.sin(globe.pitch);
    const out = [];

    list.forEach((it, i) => {
      const n = nodes.get(it.id);
      const band = i % rows;                       // 交错分带，避免同列堆叠
      const k = Math.floor(i / rows);
      const lat = (-Math.PI / 2) + (band + 0.5) * (Math.PI / rows) * 0.86;   // 纬度
      const lon = (k / per) * Math.PI * 2 + band * 0.42 + globe.yaw;  // 经度 + 自转

      const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      let x = cosLat * Math.sin(lon) * R;
      let y = sinLat * R * globe.flat;
      let z = cosLat * Math.cos(lon) * R;

      // 绕 Y 轴（上下转）再绕 X 轴（俯仰）
      const y2 = y * cy2 - z * sy2;
      const z2 = y * sy2 + z * cy2;
      y = y2; z = z2;

      const depth = (z + R) / (2 * R);             // 0 远 → 1 近
      /* 卡片尺寸与球半径解耦：基准大小由 cardScale 定，depth 只做 ±40% 的近大远小。
         之前把缩放乘进了半径，半径一大卡片就小得看不清了。 */
      const sc = globe.cardScale * fitCard * (0.58 + depth * 0.50);
      const op2 = 0.14 + depth * 0.66;   // 后排压暗但仍可辨，前排清晰

      const halfW = (n.tw * sc) / 2;
      const pxRaw = cx + x - halfW;
      const px = Math.max(4, Math.min(W - n.tw * sc - 4, pxRaw));   // 夹在画布内
      out.push({
        n,
        x: px,
        y: cy + y - (n.th * sc) / 2,
        r: x / R * 14,                             // 越靠边越倾斜，贴球面的感觉
        z,
        scaleOverride: null,
        globeScale: sc,
        globeOpacity: op2,
        zIndex: Math.round(Z_CARD_MIN + Z_CARD_SPAN * depth)
      });
    });
    return out;
  }

  /* ---------------- 布局：网格（吸附归位，就是视频里那个 2 列） ---------------- */
  function layoutGrid(list) {
    const W = stageEl.clientWidth;
    const gap = 11, pad = 0;
    const cols = W < 760 ? 1 : 2;
    const cw = (W - gap * (cols - 1) - pad * 2) / cols;
    const ordered = list.slice().sort((a, b) => {
      const rank = { urgent: 0, soon: 1, later: 2, done: 3 };
      const ra = rank[tierOf(a)], rb = rank[tierOf(b)];
      return ra !== rb ? ra - rb : a.title.localeCompare(b.title, 'zh-Hans-CN');
    });
    // 按行推进：先用该行里最高的卡片决定行高，再统一摆放，行内基线才齐
    const out = [];
    let y = 0;
    for (let i = 0; i < ordered.length; i += cols) {
      const row = ordered.slice(i, i + cols);
      const rowH = Math.max.apply(null, row.map((it) => nodes.get(it.id).th));
      row.forEach((it, c) => {
        const n = nodes.get(it.id);
        out.push({ n, x: pad + c * (cw + gap), y, r: 0, forceW: cw, forceH: rowH });
      });
      y += rowH + gap;
    }
    return out;
  }

  /* ---------------- 布局：时间轴（按截止日横排） ---------------- */
  function layoutTimeline(list) {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    const now = clock.value();
    const withD = list.filter((it) => it.deadline && it.deadline.ms > 0)
      .sort((a, b) => a.deadline.ms - b.deadline.ms);
    const noD = list.filter((it) => !(it.deadline && it.deadline.ms > 0));
    const maxD = withD.length ? Math.max.apply(null, withD.map((it) => Math.min(it.deadline.days, 30))) : 1;
    const colW = Math.max(150, Math.min(230, (W - 60) / Math.max(1, Math.min(withD.length, 8))));
    const out = [];
    const lanes = [0, 0, 0, 0, 0];
    withD.forEach((it) => {
      const n = nodes.get(it.id);
      const day = Math.min(it.deadline.days, 30);
      const x = Math.min(W - n.tw - 8, 24 + (day / Math.max(1, maxD)) * (W - colW - 40));
      let lane = 0, best = Infinity;
      for (let l = 0; l < lanes.length; l += 1) if (lanes[l] < best) { best = lanes[l]; lane = l; }
      const y = 46 + lane * (n.th + 12);
      lanes[lane] = y + n.th + 12;
      out.push({ n, x, y, r: 0 });
    });
    noD.forEach((it, i) => {
      const n = nodes.get(it.id);
      out.push({ n, x: 24 + (i % 4) * (n.tw + 12), y: Math.max.apply(null, lanes) + 74 + Math.floor(i / 4) * (n.th + 12), r: 0 });
    });
    return out;
  }

  /* ---------------- 应用布局 ---------------- */
  function layout(preserve) {
    const rows = filtered();
    sync(rows);
    const visible = rows.map((it) => nodes.get(it.id)).filter(Boolean);
    const allNodes = Array.from(nodes.values());
    allNodes.forEach((n) => { if (visible.indexOf(n) < 0) n.el.classList.add('is-dim'); else n.el.classList.remove('is-dim'); });

    let placed;
    if (state.mode === 'globe') placed = layoutGlobe(rows);
    else if (state.mode === 'scatter') placed = layoutScatter(rows);
    else if (state.mode === 'grid') placed = layoutGrid(rows);
    else placed = layoutTimeline(rows);

    const placedIds = new Set(placed.map((p) => p.n.it.id));
    // 被过滤掉的卡片：缩小、压暗、挪到画布外，但保留在 DOM 里以便平滑回来
    allNodes.forEach((n, k) => {
      if (placedIds.has(n.it.id)) return;
      n.el.style.setProperty('--x', Math.round(-n.tw - 40));
      n.el.style.setProperty('--y', Math.round(30 + (k % 12) * 26));
      n.el.style.setProperty('--s', 0.6);
      n.el.style.setProperty('--o', 0);
      n.el.style.setProperty('--r', -6);
      n.el.style.setProperty('--z', 1);
      n.el.classList.add('is-dim');
    });

    placed.forEach((p) => {
      const n = p.n, el = n.el;
      const sc = (p.globeScale || n.ts) * (p.scaleOverride || 1);
      el.style.width = ((p.forceW || n.tw) / (p.scaleOverride || 1)) + 'px';
      el.style.height = ((p.forceH || n.th) / (p.scaleOverride || 1)) + 'px';
      el.style.setProperty('--x', Math.round(p.x));
      el.style.setProperty('--y', Math.round(p.y));
      el.style.setProperty('--s', sc);
      el.style.setProperty('--o', (p.globeOpacity === undefined ? n.to : p.globeOpacity));
      el.style.setProperty('--r', (p.r || 0).toFixed(2));
      el.style.setProperty('--z', p.zIndex !== undefined ? p.zIndex
        : Math.round(Z_CARD_MIN + Z_CARD_SPAN * (1 - Math.min(1, p.y / Math.max(1, stageEl.clientHeight)))));
      el.style.transformOrigin = 'top left';
      // 把最终几何写回对象：自查脚本与后续布局都要读它
      n.x = p.x; n.y = p.y; n.finalW = p.forceW || n.tw; n.finalH = p.forceH || n.th;
      n.r = p.r || 0; n.scale = sc;
    });

    // 网格/时间轴模式下面板里的"位置"要能被看到
    const wrapH = Math.max(
      stageEl.clientHeight,
      state.mode === 'globe' ? stageEl.clientHeight : state.mode === 'grid'
        ? placed.reduce((m, p) => Math.max(m, p.y + (p.forceH || p.n.th)), 0) + 11
        : placed.reduce((m, p) => Math.max(m, p.y + p.n.th), 0) + 20
    );
    canvasEl.style.height = wrapH + 'px';
    if (state.mode === 'grid' && wrapH > stageEl.clientHeight) canvasEl.style.overflowY = 'auto';
    drawRules();

    const independent = allItems().filter((it) => it.role !== 'update').length;
    countEl.innerHTML = '<b>' + idx(rows.length) + '</b> / ' + idx(independent) + ' 条';

    // 布局落定标志：自查脚本靠它判断"动画真的结束了"，而不是猜一个固定等待时间。
    // 之前用固定 sleep 截图，拍到的是飞行途中的半透明卡片 —— 断言算过、画面没到。
    settled = false;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settled = true; }, 820);
  }

  /* 时间轴模式的刻度与日期标签 */
  function drawRules() {
    canvasEl.querySelectorAll('.tl-rule, .tl-tick, .tl-label').forEach((e) => e.remove());
    if (state.mode !== 'timeline') return;
    const W = stageEl.clientWidth, H = canvasEl.clientHeight;
    const rule = document.createElement('div');
    rule.className = 'tl-rule';
    rule.style.top = '34px';
    canvasEl.appendChild(rule);
    const now = clock.value();
    const rows = filtered().filter((it) => it.deadline && it.deadline.ms > 0);
    const maxD = rows.length ? Math.max.apply(null, rows.map((it) => Math.min(it.deadline.days, 30))) : 1;
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const d = Math.round(maxD * f);
      const x = 24 + f * (W - 200);
      const tick = document.createElement('div');
      tick.className = 'tl-tick'; tick.style.left = x + 'px';
      canvasEl.appendChild(tick);
      const lab = document.createElement('div');
      lab.className = 'tl-label'; lab.style.left = x + 'px';
      lab.innerHTML = '<b>' + (d === 0 ? '今天' : Radar.fmtDay(new Date(now.getTime() + d * 86400000))) + '</b><span>' + (d === 0 ? '' : d + ' 天后') + '</span>';
      canvasEl.appendChild(lab);
    });
  }

  /* ---------------- 筛选条 ---------------- */
  function strip() {
    const tg = (key, val, label) =>
      '<button type="button" class="toggle' + (state[key] === val ? ' is-on' : '') + '" data-toggle="' + key + '" data-val="' + val + '">' + label + '</button>';
    const CATS = ['学习资源', '竞赛科研', '志愿公益', '项目组队', '文体兴趣'];
    stripEl.innerHTML =
      '<input class="strip__input" id="q" type="search" placeholder="搜索…" value="' + esc(state.q) + '">' +
      '<span class="strip__sep"></span>' +
      '<span class="strip__label">时间</span>' +
      tg('window', 'today', '今天') + tg('window', 'week', '7 天内') + tg('window', 'open', '报名中') + tg('window', 'loose', '长期/未定') +
      '<span class="strip__sep"></span>' +
      '<span class="strip__label">类别</span>' + CATS.map((c) => tg('cat', c, c)).join('') +
      '<span class="strip__sep"></span>' +
      '<span class="strip__label">来源</span>' + tg('source', 'official', '学校') + tg('source', 'student', '学生') +
      '<span class="strip__sep"></span>' + tg('feasible', '1', '仅我能参加') +
      tg('hidden', '1', '含降权') +
      '<span class="strip__sep"></span><button type="button" class="toggle" data-act="reset">重置</button>';
  }

  /* ---------------- 面板 ---------------- */
  function closePanel() {
    state.panel = null;
    panelEl.hidden = true; panelEl.innerHTML = '';
    scrimEl.hidden = true;
    if (state.picked) {
      const n = nodes.get(state.picked);
      if (n) n.el.classList.remove('is-picked');
    }
    state.picked = null;
    layout();
  }

  function openPanel(html, kind) {
    state.panel = kind;
    panelEl.innerHTML = '<div class="panel__bar"><span class="panel__no">' + (kind === 'detail' ? '记录' : kind === 'mine' ? 'MINE' : kind === 'publish' ? 'COMPOSE' : 'RESTRICTED') +
      '</span><span class="grow"></span><button class="panel__close" type="button" data-act="close">✕</button></div>' +
      '<div class="panel__body">' + html + '</div>';
    panelEl.hidden = false; scrimEl.hidden = false;
    panelEl.scrollTop = 0;
  }

  function openMine() {
    const p = Store.profile();
    const a = Store.actions();
    const all = allItems();
    const pick = (ids) => ids.map((id) => all.find((it) => it.id === id)).filter(Boolean);
    const saved = pick(a.saved), joined = pick(a.joined), hidden = pick(a.hidden);
    const mineItems = all.filter((it) => it.userPublished);
    const rows = (label, arr, emptyMsg, actKind) => '<h2>' + label + '（' + arr.length + '）</h2>' +
      (arr.length
        ? '<ul class="list-plain">' + arr.map((it) => '<li><a href="#/x" data-open="' + esc(it.id) + '">' + esc(it.title) + '</a> ' +
          '<button class="btn btn--sm" type="button" data-act="' + actKind + '" data-id="' + esc(it.id) + '">' +
          (actKind === 'del' ? '删除' : actKind === 'unhide' ? '恢复' : '取消') + '</button></li>').join('') + '</ul>'
        : '<p class="dl dd empty" style="color:#9aa06a">' + esc(emptyMsg) + '</p>');

    openPanel(
      '<h1>我的记录</h1>' +
      '<div class="rowsplit">' +
        '<div><dt>收藏</dt><dd>' + saved.length + '</dd></div>' +
        '<div><dt>已标记报名</dt><dd>' + joined.length + '</dd></div>' +
        '<div><dt>我发布的</dt><dd>' + mineItems.length + '</dd></div>' +
        '<div><dt>已忽略</dt><dd>' + hidden.length + '</dd></div>' +
      '</div>' +
      rows('我收藏的', saved, '还没有收藏。在卡片详情里点「☆ 收藏」。', 'unsave') +
      rows('我标记报名的', joined, '还没有标记报名。', 'unjoin') +
      rows('我发布的内容', mineItems, Store.adminUnlocked() ? '还没有发布。点顶栏右侧的「发布」。' : '发布需要管理员口令。', 'del') +
      rows('已忽略的', hidden, '没有忽略任何内容。', 'unhide') +

      '<h2>我的情况（决定「我能不能参加」）</h2>' +
      '<form id="profileForm">' +
        '<div class="gridform">' +
          '<label class="field"><span class="field__label">昵称（发布署名）</span>' +
            '<input type="text" name="nickname" value="' + esc(p.nickname) + '" placeholder="例如：小明"></label>' +
          '<label class="field"><span class="field__label">年级</span>' +
            '<select name="grade" style="width:100%;padding:9px;background:#0c0c0c;border:1px solid #2a2a2a;color:#f2f0ea;font-family:var(--mono)">' +
            [1, 2, 3, 4].map((g) => '<option value="' + g + '"' + (p.grade === g ? ' selected' : '') + '>' + ['大一', '大二', '大三', '大四'][g - 1] + '</option>').join('') +
            '</select></label>' +
          '<label class="field"><span class="field__label">每周可投入（小时）</span>' +
            '<input type="number" name="hours" min="0" max="60" value="' + p.hours + '"></label>' +
        '</div>' +
        '<div class="panel__acts"><button class="btn btn--solid" type="submit">保存并重算</button>' +
        '<button class="btn" type="button" data-act="export">导出备份</button>' +
        '<button class="btn" type="button" data-act="import">导入</button>' +
        '<input id="importFile" type="file" accept="application/json,.json" hidden>' +
        (Store.adminUnlocked() ? '<button class="btn" type="button" data-act="publish">发布 →</button>' : '') +
        '</div>' +
      '</form>' +
      (Store.adminUnlocked() ? '' :
        '<h2>发布权限</h2><p style="color:#9aa06a;font-size:13px">发布入口默认隐藏，需要管理员口令。</p>' +
        '<div class="panel__acts"><button class="btn" type="button" data-act="gate">输入口令</button></div>'),
      'mine');
  }

  function openGate(msg) {
    openPanel(
      '<h1>发布需要管理员口令</h1>' +
      '<p style="color:#9aa06a;font-size:13px">发布入口默认隐藏 —— 开放发布容易让同学被无关的商业信息刷屏，所以把发布权限收起来。</p>' +
      (msg ? '<p style="color:#ff8a80;font-size:13px;margin-top:12px">' + esc(msg) + '</p>' : '') +
      '<form id="gateForm" style="margin-top:18px">' +
        '<label class="field"><span class="field__label">管理员口令</span>' +
          '<input type="password" name="pass" autocomplete="current-password" placeholder="请输入口令"></label>' +
        '<p class="field__hint">初始口令 radar2026，登录后可在「我的」里修改</p>' +
        '<div class="panel__acts"><button class="btn btn--solid" type="submit">验证</button>' +
        '<button class="btn" type="button" data-act="close">取消</button></div>' +
      '</form>' +
      '<p style="color:#9aa06a;font-size:12px;margin-top:20px;font-family:var(--mono)">这一层是本机口令：纯静态站点没有服务端，口令与内容都存在你自己的浏览器里。</p>',
      'gate');
  }

  function openPublish() {
    if (!Store.adminUnlocked()) return openGate('');
    const f = (label, control, hint) => '<label class="field"><span class="field__label">' + esc(label) + '</span>' + control +
      (hint ? '<span class="field__hint">' + esc(hint) + '</span>' : '') + '</label>';
    openPanel(
      '<h1>发布一条信息</h1>' +
      '<p style="color:#9aa06a;font-size:13px">发布后会立刻出现在画布上，和材料里的信息一起被筛选与排序。</p>' +
      '<form id="publishForm" style="margin-top:18px">' +
        '<div class="gridform">' +
          f('活动名称 *', '<input type="text" name="title" placeholder="周末羽毛球约球（6—8 人）">') +
          f('类别', '<select name="cat" style="width:100%;padding:9px;background:#0c0c0c;border:1px solid #2a2a2a;color:#f2f0ea;font-family:var(--mono)">' +
            ['文体兴趣', '项目组队', '学习资源', '志愿公益', '竞赛科研'].map((c) => '<option>' + c + '</option>').join('') + '</select>') +
          f('活动时间', '<input type="datetime-local" name="eventStart">', '不确定就留空') +
          f('报名截止', '<input type="datetime-local" name="signupBy">', '会显示倒计时并进时间轴') +
          f('地点', '<input type="text" name="eventWhere" placeholder="风雨球场 3 号场">') +
          f('人数 / 名额', '<input type="text" name="capacity" placeholder="6—8 人">') +
          f('参与方式', '<input type="text" name="applyHow" placeholder="报名后拉群">') +
          f('联系方式 *', '<input type="text" name="contact" placeholder="微信号 / 手机">') +
          f('标签（逗号分隔）', '<input type="text" name="tags" placeholder="羽毛球, 周末">') +
        '</div>' +
        '<div class="panel__acts"><button class="btn btn--solid" type="submit">发布</button>' +
        '<button class="btn" type="button" data-act="close">取消</button>' +
        '<button class="btn" type="button" data-act="logout">退出发布权限</button></div>' +
      '</form>',
      'publish');
  }

  function openDetail(id, tab) {
    const it = Radar.find(id, Store.profile(), clock.value());
    if (!it) return;
    state.picked = id;
    nodes.forEach((n, k) => n.el.classList.toggle('is-picked', k === id));
    const cur = tab || 'brief';
    const saved = Store.has('saved', id), joined = Store.has('joined', id);

    const pill = (t, cls) => '<span class="pill' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>';
    const facts = [['时间', it.eventStart ? Radar.fmtDT(it.eventStart) + (it.eventEnd ? ' — ' + Radar.fmtDT(it.eventEnd) : '') : ''],
      ['周期', it.recurring], ['报名截止', it.signupBy ? Radar.fmtDT(it.signupBy) : ''],
      ['地点', it.eventWhere], ['面向', it.audience], ['名额', it.capacity],
      ['投入', it.effort], ['费用', it.fee], ['报名方式', it.applyHow], ['发布方', it.publisher]];

    let body;
    if (cur === 'fit') {
      body = fitHTML(it) +
        '<h2>材料里没写、需要向主办方确认的项</h2>' +
        (it.unconfirmed.length
          ? '<ul class="list-plain">' + it.unconfirmed.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>'
          : '<p style="color:#9aa06a;font-size:13px">这几项上材料的信息是完整的。</p>');
    } else if (cur === 'raw') {
      body = '<h2>材料原文关键信息（不做改写）</h2><dl class="dl">' +
        '<dt>材料编号</dt><dd>第 ' + idx(it.seq) + ' 条</dd>' +
        '<dt>来源口径</dt><dd>' + esc(it.updatedAt) + '</dd>' +
        facts.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd' + (v ? '' : ' class="empty"') + '>' + esc(v || '未注明') + '</dd>').join('') +
        '</dl><p style="color:#9aa06a;font-size:11.5px;margin-top:14px;font-family:var(--mono)">材料没写的显示「未注明」，不做补全</p>' +
        (it.trust.flags.length
          ? '<h2>被标为「' + esc(it.trust.label) + '」的原因</h2><ul class="list-plain">' +
            it.trust.flags.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>'
          : '');
    } else {
      body = fitHTML(it) +
        '<h2>材料给出的条件</h2><dl class="dl">' +
        facts.filter(([, v]) => v).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') +
        '</dl>' +
        (it.unconfirmed.length ? '<h2>材料里没写的 ' + it.unconfirmed.length + ' 项</h2><ul class="list-plain">' +
          it.unconfirmed.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>' : '');
    }

    const tl = (it.updates && it.updates.length)
      ? '<h2>这件事被通知了 ' + (it.updates.length + 1) + ' 次 · 以最新一条为准</h2><div class="timeline">' +
        [{ tag: '原始通知', t: it.title, b: factLine(it) }]
          .concat(it.updates.map((u) => ({ tag: '后续通知', t: u.title, b: factLine(u) })))
          .map((r, i, a) => '<div class="tstep' + (i === a.length - 1 ? ' tstep--last' : '') + '">' +
            '<div class="tstep__tag">' + esc(r.tag) + '</div>' +
            '<div><div class="tstep__title">' + esc(r.t) + '</div><div class="tstep__body">' + esc(r.b) + '</div></div></div>').join('') +
        '</div>' + (it.group ? '<div class="verdict"><b>' + esc(it.group.kind) + '：</b>' + esc(it.group.detail) + '</div>' : '')
      : '';

    openPanel(
      '<h1>' + esc(it.title) + '</h1>' +
      '<div class="panel__pills">' +
        pill(it.status.label, pillCls(it)) +
        (it.deadline ? pill(it.deadline.label, it.deadline.tone === 'danger' ? 'pill--accent' : 'pill--dim') : '') +
        pill(it.cat) + pill(it.source === 'official' ? '学校 / 学院' : it.source === 'student' ? '学生发布' : '来源不明') +
        (it.updates && it.updates.length ? pill('有补充通知', 'pill--warn') : '') +
        (it.downgraded ? pill('已降权', 'pill--accent') : '') +
      '</div>' +
      '<div class="panel__acts">' +
        '<button class="btn' + (saved ? ' btn--solid' : '') + '" type="button" data-act="save" data-id="' + esc(id) + '">' + (saved ? '★ 已收藏' : '☆ 收藏') + '</button>' +
        '<button class="btn' + (joined ? ' btn--solid' : '') + '" type="button" data-act="join" data-id="' + esc(id) + '">' + (joined ? '✓ 已标记报名' : '标记已报名') + '</button>' +
        '<button class="btn" type="button" data-act="hide" data-id="' + esc(id) + '">不感兴趣</button>' +
      '</div>' +
      '<div class="rowsplit">' +
        '<div><dt>报名截止</dt><dd>' + esc(it.deadline ? it.deadline.text : '未注明') + '</dd></div>' +
        '<div><dt>活动时间</dt><dd>' + esc(it.when.when || '未注明') + '</dd></div>' +
        '<div><dt>地点</dt><dd>' + esc(it.where.text) + '</dd></div>' +
      '</div>' +
      '<div class="tabs">' +
        [['brief', '这是什么'], ['fit', '我能不能参加'], ['raw', '原文信息']].map(([k, l]) =>
          '<button class="tab' + (cur === k ? ' is-on' : '') + '" type="button" data-act="tab" data-tab="' + k + '" data-id="' + esc(id) + '">' + esc(l) + '</button>').join('') +
      '</div>' +
      body + tl,
      'detail');
  }

  function factLine(x) {
    return [x.eventStart ? '时间 ' + Radar.fmtDT(x.eventStart) : '', x.eventWhere ? '地点 ' + x.eventWhere : '',
      x.signupBy ? '报名截止 ' + Radar.fmtDT(x.signupBy) : ''].filter(Boolean).join('　·　') || '材料未给出时间地点';
  }

  function fitHTML(it) {
    const f = it.fit;
    const p = Store.profile();
    return '<div class="fit fit--' + f.level + '">' +
      '<div class="fit__verdict">' + esc(f.label) + '</div>' +
      '<p class="field__hint" style="margin-top:6px">按你的情况：' + ['大一', '大二', '大三', '大四'][p.grade - 1] + ' · 每周约 ' + p.hours + ' 小时</p>' +
      (f.blocks.length ? '<ul class="fit__list fit__list--block">' + f.blocks.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '') +
      (f.reasons.length ? '<ul class="fit__list">' + f.reasons.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '') +
      (!f.blocks.length && !f.reasons.length ? '<p class="fit__list">没有发现这条信息与你的情况冲突的条件。</p>' : '') +
    '</div>';
  }

  /* ---------------- 球面：自转与拖动 ---------------- */
  /* 自转用 requestAnimationFrame 推进 yaw，只有在球面模式下才跑；
     拖动时暂停自转、按指针位移改 yaw/pitch，松手后按惯性继续一会儿。 */
  let rafId = null;
  function spinLoop(t) {
    const dt = globe.lastT ? Math.min(48, t - globe.lastT) : 16;
    globe.lastT = t;
    if (state.mode === 'globe') {
      if (!globe.dragging) {
        globe.yaw += globe.vYaw * dt;
        globe.pitch += globe.vPitch * dt;
        globe.vYaw *= 0.988; globe.vPitch *= 0.988;
        if (Math.abs(globe.vYaw) < 0.0003 && globe.autoSpin) globe.vYaw = 0.00021;
        globe.pitch = Math.max(-0.85, Math.min(0.85, globe.pitch));
      }
      layoutGlobeOnly();
    }
    rafId = requestAnimationFrame(spinLoop);
  }

  /* 只重排球面：跳过 DOM 同步，保证每帧都够快 */
  function layoutGlobeOnly() {
    const rows = filtered();
    const placed = layoutGlobe(rows);
    placed.forEach((p) => {
      const n = p.n, el = n.el;
      const sc = p.globeScale;
      el.style.width = (n.tw / 1) + 'px';
      el.style.height = (n.th / 1) + 'px';
      el.style.setProperty('--x', Math.round(p.x));
      el.style.setProperty('--y', Math.round(p.y));
      el.style.setProperty('--s', sc);
      el.style.setProperty('--o', p.globeOpacity);
      el.style.setProperty('--r', (p.r || 0).toFixed(2));
      el.style.setProperty('--z', p.zIndex);
      el.style.transformOrigin = 'top left';
      n.x = p.x; n.y = p.y; n.r = p.r || 0; n.scale = sc;
      n.finalW = n.tw; n.finalH = n.th;
    });
  }

  /* 球面模式下取消过渡：否则每帧都在追一个 720ms 的动画，看着发糊 */
  function setSphereTransition(on) {
    nodes.forEach((n) => {
      n.el.style.transition = on
        ? 'transform .12s linear, opacity .2s linear'
        : 'transform .72s cubic-bezier(.16,1,.3,1), opacity .5s ease, box-shadow .2s ease';
    });
  }

  let drag = null;
  stageEl.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'globe') return;
    if (e.target.closest('.card')) return;
    globe.dragging = true;
    drag = { x: e.clientX, y: e.clientY, yaw: globe.yaw, pitch: globe.pitch };
    stageEl.setPointerCapture(e.pointerId);
    stageEl.style.cursor = 'grabbing';
    setSphereTransition(true);
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (!globe.dragging || !drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    globe.yaw = drag.yaw + dx * 0.005;
    globe.pitch = Math.max(-0.85, Math.min(0.85, drag.pitch - dy * 0.004));
    /* 惯性速度必须限幅：松手后靠它继续滑行，不限幅会越转越快
       （实测松开时 vYaw 会飙到 0.04 量级，一秒转好几圈）。
       上限 0.0016 rad/ms ≈ 1.6 rad/s，约 4 秒一圈，滑行手感正常。 */
    const MAXV = 0.0016;
    globe.vYaw = Math.max(-MAXV, Math.min(MAXV, dx * 0.00013));
    globe.vPitch = Math.max(-MAXV / 2, Math.min(MAXV / 2, -dy * 0.00008));
  });
  const endDrag = (e) => {
    if (!globe.dragging) return;
    globe.dragging = false; drag = null;
    stageEl.style.cursor = '';
    try { stageEl.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
  };
  stageEl.addEventListener('pointerup', endDrag);
  stageEl.addEventListener('pointercancel', endDrag);

  /* 球面上滚轮缩放半径 */
  stageEl.addEventListener('wheel', (e) => {
    if (state.mode !== 'globe') return;
    e.preventDefault();
    globe.radius = Math.max(180, Math.min(560, globe.radius - e.deltaY * 0.6));
    setSphereTransition(true);
    layoutGlobeOnly();
  }, { passive: false });

  /* ---------------- 事件 ---------------- */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('is-show'), 2300);
  }

  modesEl.addEventListener('click', (e) => {
    const mineBtn = e.target.closest('[data-act="mine"]');
    if (mineBtn) { openMine(); return; }
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.mode = b.getAttribute('data-mode');
    modesEl.querySelectorAll('.mode[data-mode]').forEach((m) => m.classList.toggle('is-on', m === b));
    canvasEl.dataset.mode = state.mode;
    setSphereTransition(state.mode === 'globe');
    // 从球面切走时把 yaw 归零，避免网格里带着旋转
    if (state.mode !== 'globe') { globe.yaw = 0; globe.pitch = -0.18; }
    layout(true);
  });

  stripEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle]');
    if (b) {
      const k = b.getAttribute('data-toggle'), v = b.getAttribute('data-val');
      state[k] = state[k] === v ? '' : v;
      strip(); layout(true);
      return;
    }
    const r = e.target.closest('[data-act="reset"]');
    if (r) {
      ['window', 'cat', 'source', 'feasible', 'hidden', 'q'].forEach((k) => { state[k] = ''; });
      strip(); layout(true);
    }
  });

  let searchTimer = null;
  stripEl.addEventListener('input', (e) => {
    if (e.target.id !== 'q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value.trim(); layout(true); }, 170);
  });

  scrimEl.addEventListener('click', closePanel);

  panelEl.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); openDetail(open.getAttribute('data-open')); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.getAttribute('data-act'), id = b.getAttribute('data-id');

    if (act === 'close') return closePanel();
    if (act === 'tab') return openDetail(id, b.getAttribute('data-tab'));
    if (act === 'save' || act === 'join') {
      const kind = act === 'save' ? 'saved' : 'joined';
      const a = Store.toggle(kind, id);
      toast(a[kind].indexOf(id) >= 0 ? (kind === 'saved' ? '已收藏' : '已标记报名') : '已取消');
      openDetail(id, 'brief'); layout();
      return;
    }
    if (act === 'unsave' || act === 'unjoin' || act === 'unhide') {
      Store.toggle({ unsave: 'saved', unjoin: 'joined', unhide: 'hidden' }[act], id);
      toast('已更新'); openMine(); layout();
      return;
    }
    if (act === 'del') {
      if (!window.confirm('删除你发布的这条内容？')) return;
      Store.removeUserItem(id); toast('已删除'); openMine(); layout();
      return;
    }
    if (act === 'hide') {
      Store.toggle('hidden', id);
      toast('已设为不感兴趣，可在「我的」恢复'); closePanel(); layout();
      return;
    }
    if (act === 'publish') return openPublish();
    if (act === 'gate') return openGate('');
    if (act === 'logout') { Store.setAdminUnlocked(false); toast('已退出发布权限'); closePanel(); return; }
    if (act === 'export') {
      const blob = new Blob([Store.exportAll()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'campus-radar-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click(); toast('已导出备份');
      return;
    }
    if (act === 'import') { const f = document.getElementById('importFile'); if (f) f.click(); return; }
  });

  panelEl.addEventListener('change', (e) => {
    if (e.target.id !== 'importFile') return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { Store.importAll(String(reader.result)); toast('已导入'); openMine(); layout(); }
      catch (err) { window.alert('导入失败：' + err.message); }
    };
    reader.readAsText(file);
  });

  panelEl.addEventListener('submit', (e) => {
    const id = e.target.id;
    if (id === 'gateForm') {
      e.preventDefault();
      if (Store.verifyAdmin(e.target.elements.pass.value)) {
        Store.setAdminUnlocked(true); toast('口令正确'); openPublish();
      } else { openGate('口令不正确，请重试。'); }
      return;
    }
    if (id === 'profileForm') {
      e.preventDefault();
      const f = e.target;
      Store.saveProfile({
        nickname: String(f.elements.nickname.value || '').trim(),
        grade: Number(f.elements.grade.value) || 1,
        hours: Number(f.elements.hours.value) || 0,
        interests: Store.profile().interests
      });
      toast('已保存，判定已重算'); closePanel(); layout();
      return;
    }
    if (id === 'publishForm') {
      e.preventDefault();
      const f = e.target;
      const raw = {
        title: f.elements.title.value, cat: f.elements.cat.value,
        eventStart: f.elements.eventStart.value ? f.elements.eventStart.value.replace('T', ' ') : null,
        signupBy: f.elements.signupBy.value ? f.elements.signupBy.value.replace('T', ' ') : null,
        eventWhere: f.elements.eventWhere.value, capacity: f.elements.capacity.value,
        applyHow: f.elements.applyHow.value, contact: f.elements.contact.value,
        tags: f.elements.tags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        publisher: Store.profile().nickname ? Store.profile().nickname + '（学生）' : '学生个人发布',
        whereUnconfirmed: !f.elements.eventWhere.value.trim()
      };
      if (!raw.title.trim()) { toast('请填活动名称'); return; }
      if (!raw.contact.trim()) { toast('请留联系方式'); return; }
      const item = Store.saveUserItem(raw);
      toast('已发布'); closePanel(); layout(); openDetail(item.id);
    }
  });

  document.getElementById('themeBtn').addEventListener('click', () => {
    const next = Store.readTheme() === 'dark' ? 'light' : 'dark';
    Store.writeTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? 'D' : 'L';
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') { closePanel(); return; }
    if (typing) return;
    if (e.key === '/') { const q = document.getElementById('q'); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
    const keys = { '1': 'globe', '2': 'scatter', '3': 'grid', '4': 'timeline' };
    if (keys[e.key]) {
      const b = modesEl.querySelector('[data-mode="' + keys[e.key] + '"]');
      if (b) b.click();
    }
  });

  /* 双击画布空白：散落 ↔ 网格，做"吸附归位"的开关 */
  stageEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('.card')) return;
    const b = modesEl.querySelector('[data-mode="' + (state.mode === 'scatter' ? 'grid' : 'scatter') + '"]');
    if (b) b.click();
  });

  window.addEventListener('resize', () => layout(true));

  /* ---------------- 启动 ---------------- */
  (function boot() {
    Store.seedAdded();
    Store.sync();
    document.getElementById('footText').textContent = DATA.productName + ' · ' + DATA.tagline;
    document.getElementById('buildTag').textContent = '构建 ' + (DATA.build || '—');
    const th = Store.readTheme() === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', th);
    document.getElementById('themeBtn').textContent = th === 'dark' ? 'D' : 'L';
    canvasEl.dataset.mode = state.mode;
    setSphereTransition(false);
    strip();
    // 初始：所有卡片从画布外聚拢进来，形成"散落出现"的入场
    const rows = filtered();
    sync(rows);
    nodes.forEach((n, k) => {
      n.el.style.setProperty('--x', Math.round((k % 7) * 140 - 400));
      n.el.style.setProperty('--y', Math.round(600 + (k % 5) * 40));
      n.el.style.setProperty('--s', 0.7);
      n.el.style.setProperty('--o', 0);
      n.el.style.setProperty('--r', 12);
      n.el.style.width = n.tw + 'px'; n.el.style.height = n.th + 'px';
      n.el.style.transformOrigin = 'top left';
    });
    requestAnimationFrame(() => requestAnimationFrame(() => layout()));
    requestAnimationFrame(spinLoop);
  })();

  window.__App = {
    state, layout, openDetail, openMine, openPublish, openGate, closePanel, filtered, nodes,
    globe, setSphereTransition, layoutGlobeOnly,
    get settled() { return settled; }
  };
})();
