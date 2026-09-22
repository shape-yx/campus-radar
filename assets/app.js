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

  /* 画布缩放：0.5 ~ 2.0，存在本机，刷新后保留。
     拖动手势的位移要除以缩放比，否则放大后拖动会"跑得比手快"。 */
  const zoom = {
    value: 1,
    MIN: 0.5, MAX: 2,
    key: (window.CAMPUS_DATA.storageKey) + ':zoom',
    read() {
      try { const v = parseFloat(localStorage.getItem(this.key)); return (v >= this.MIN && v <= this.MAX) ? v : 1; }
      catch { return 1; }
    },
    write(v) { try { localStorage.setItem(this.key, String(v)); } catch { /* 忽略 */ } },
    apply(v) {
      this.value = Math.max(this.MIN, Math.min(this.MAX, v));
      canvasEl.style.setProperty('--zoom', this.value);
      const pct = Math.round(this.value * 100);
      const knob = document.getElementById('zoomKnob');
      const fill = document.getElementById('zoomFill');
      const track = document.getElementById('zoomTrack');
      const val = document.getElementById('zoomVal');
      if (knob) knob.style.bottom = ((this.value - this.MIN) / (this.MAX - this.MIN)) * 100 + '%';
      if (fill) fill.style.height = ((this.value - this.MIN) / (this.MAX - this.MIN)) * 100 + '%';
      if (track) track.setAttribute('aria-valuenow', String(pct));
      if (val) val.textContent = pct + '%';
      this.write(this.value);
      return this.value;
    }
  };

  /* 横向/纵向平移（散落模式拖动视图用）。
     用 transform 平移整个画布，不重算布局 —— 所以拖动很轻，
     也不会像重排那样让卡片跳。范围按内容外接矩形夹住，避免拖到空无一物。 */
  const pan = { x: 0, y: 0, dragging: false, minX: 0, maxX: 0, minY: 0, maxY: 0, inited: false };

  function applyPan() {
    canvasEl.style.setProperty('--pan-x', Math.round(pan.x) + 'px');
    canvasEl.style.setProperty('--pan-y', Math.round(pan.y) + 'px');
  }

  function panOnly() {
    pan.x = Math.max(pan.minX, Math.min(pan.maxX, pan.x));
    pan.y = Math.max(pan.minY, Math.min(pan.maxY, pan.y));
    applyPan();
  }

  /* 可平移范围：必须覆盖"画布右/下边缘能贴到视口边缘"的整个区间。
     早先只按卡片外接矩形算，结果画布比内容宽时（时间轴就是这样：
     画布 2272px，卡片最右 2039px），右边有 6 张卡片永远拖不到 ——
     看起来就像"右边有东西挡住了"，其实是拖不过去。
     所以取"内容外接矩形"和"画布实际尺寸"两者的较大值。 */
  function setPanBounds(placed) {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    /* 用"实际参与排布的卡片"算外接矩形（filtered 掉的卡片被挪到画布外，
       若把全部节点算进来会得到一个荒唐的范围，纵向甚至算不出可用区间）。 */
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    placed.forEach((p) => {
      if (p.css3d) return;                       // 球面卡片自己管坐标，不参与平移
      const w = (p.forceW || p.n.tw) * (p.globeScale || p.n.ts || 1);
      const h = (p.forceH || p.n.th) * (p.globeScale || p.n.ts || 1);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x + w);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y + h);
    });
    if (!isFinite(left)) { left = 0; right = W; top = 0; bottom = H; }

    /* 四向对称：往左拖到"内容右缘进入视口"，往右拖到"内容左缘进入视口"。
       各留 24px 余量，避免边缘卡片紧贴边框。 */
    pan.minX = Math.min(0, W - right - 24);
    pan.maxX = Math.max(0, -left + 24);
    pan.minY = Math.min(0, H - bottom - 24);
    pan.maxY = Math.max(0, -top + 24);

    /* 画布要覆盖整个内容范围（含负坐标），否则溢出部分会被裁掉、拖也拖不出来 */
    canvasEl.style.width = Math.max(W, right - Math.min(0, left) + 24) + 'px';
    canvasEl.style.height = Math.max(H, bottom - Math.min(0, top) + 24) + 'px';
    panOnly();
  }

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
    /* pitch 起始就是 0（水平）—— 静止姿态永远是水平的，
       上下拖动只是一次"探头看"，松手会自己摆正回 homePitch。 */
    yaw: 0.35, pitch: 0,
    vYaw: 0.00021, vPitch: 0,
    dragging: false, autoSpin: true,
    /* 水平吸附：松手后转到最近的吸附角度，像有磁性一样"咔"一下对上。
       步长取卡片在经线上的间隔（2π / per = 2π / 8 = 45°），
       所以每吸附一次，卡片正好落到下一格的经线上。 */
    snapStep: Math.PI / 4,
    snapFrom: 0, snapTo: 0, snapT: 0, snapDur: 0, snapping: false,
    /* 上下拖动松手后 pitch 回正用的起点（终点固定为 0 = 水平） */
    snapFromPitch: 0, snapToPitch: 0,
    homePitch: 0,         // 静止时的水平姿态
    spinIdle: 0,          // 吸附完成后的自转冷却（毫秒）
    radius: 1200, flat: 0.46, cardScale: 0.62,
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

  /* 卡片配图：参考视频里卡片正面是作品截图，材料里没有配图，
     所以只为确实有明确配图的条目挂图（目前是 Python 那张），
     其余仍用条目编号占位。图与数据分离，以后加图不用改卡片结构。 */
  const CARD_IMG = {
    '17': { src: 'assets/img/python.svg', alt: 'Python 学习资源' }
  };

  /* 取一条内容的配图：用户发布的内容优先用自带 image（dataURL） */
  function imageOf(it) {
    if (it && typeof it.image === 'string' && /^data:image\//i.test(it.image)) {
      return { src: it.image, alt: it.title || '配图' };
    }
    return CARD_IMG[it && it.id] || null;
  }

  function cardHTML(it, i) {
    const t = tierOf(it);
    const img = imageOf(it);
    return '<span class="card__urgency"><span style="height:' + urgencyPct(it) + '%"></span></span>' +
      '<span class="card__no">' + idx(i + 1) + '</span>' +
      (img
        ? '<span class="card__media"><img src="' + img.src + '" alt="' + esc(img.alt) + '" loading="lazy" decoding="async"></span>'
        : '') +
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
        el.addEventListener('click', (ev) => {
          if (suppressClick) { ev.preventDefault(); ev.stopPropagation(); return; }
          openDetail(it.id);
        });
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

    /* 散落是"向四面八方铺开的一张桌面"，不是"塞进一屏"：
       目标尺寸取约 2.4 个视口宽 × 2.0 个视口高，四周都溢出，
       所以四个方向都能拖动查看，而不会只有一个方向有内容。
       以前纵向被压缩到视口内（cellH = usableH / rows），
       结果上下两个方向基本没有卡片。 */
    const maxNeedW = Math.max.apply(null, list.map((it) => nodes.get(it.id).tw));
    const maxNeedH = Math.max.apply(null, list.map((it) => nodes.get(it.id).th));

    const iw = maxNeedW + gapX * 2, ih = maxNeedH + gapY * 2;
    let cols = Math.max(2, Math.round(Math.sqrt(list.length * (usableW * 2.4) / (usableH * 2.0))));
    let rows = Math.max(2, Math.ceil(list.length / cols));
    if (cols * rows < list.length) cols = Math.ceil(list.length / rows);
    if (list.length <= 4) { cols = list.length; rows = 1; }

    /* 格子按内容尺寸（接近卡片理想尺寸），并等比缩到目标范围附近。
       注意：格子尺寸与卡片尺寸是两件事 —— 格子负责间距，卡片由 shrink 缩放。 */
    let cellW = Math.max(iw, (usableW * 2.4) / cols);
    let cellH = Math.max(ih, (usableH * 2.0) / rows);
    const totalW = cols * cellW, totalH = rows * cellH;
    const allowW = usableW * 2.8, allowH = usableH * 2.4;
    let shrink = Math.min(1, Math.min(allowW / totalW, allowH / totalH));
    shrink = Math.max(0.55, shrink);

    let chosen = { cols, rows, cellW, cellH, shrink };

    /* 上面的 cols/rows/cellW/cellH/shrink 都已经是当前作用域的 let，
       这里不再重复声明（重名会直接让整个脚本语法报错）。 */

    /* 槽位以内容正中为原点向四周铺开（负坐标是允许的 —— 拖动才看得到），
       最急的落在正中，其余按到中心的距离向外排。 */
    const gridW = cols * cellW, gridH = rows * cellH;
    const originX = W / 2 - gridW / 2;
    const originY = H / 2 - gridH / 2;
    const slots = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = originX + c * cellW, y = originY + r * cellH;
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

  /* 缩放原点：写成"球心在 canvas 内的像素坐标"。
     不写死 50% 50% 的原因：canvas 的高宽会随排布与筛选变化
     （网格模式会把 canvas 撑高），用百分比就会和球心错开。
     任何可能改变 canvas 尺寸的地方都要重新调一次。 */
  function setZoomOrigin(cx, cy) {
    canvasEl.style.setProperty('--zoom-origin', Math.round(cx) + 'px ' + Math.round(cy) + 'px');
  }
  function syncZoomOrigin() {
    setZoomOrigin(stageEl.clientWidth / 2, stageEl.clientHeight * 0.5);
  }

  /* ---------------- 布局：球面（照参考视频 3—5 秒） ----------------
     把每条信息放到球面的一组经纬点上：
       竖向分 5 条纬线（赤道上的卡片最大最亮，两极最小最暗，和视频一致）
       横向把同一纬线上的卡片均匀铺开，逐层错开半个格子，避免上下对齐
     再用 yaw / pitch 旋转这个球，透视投影后由 z 决定缩放、亮度与层级。
     拖动时旋转角实时更新，松手后回到自转。 */
  function layoutGlobe(list) {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    const R = Math.min(globe.radius, Math.min(W, H) * (W < 620 ? 0.40 : 0.78));
    const cx = W / 2, cy = H * 0.5;
    setZoomOrigin(cx, cy);
    const rows = 3;
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
      const lat = ((-Math.PI / 2) + (band + 0.5) * (Math.PI / rows)) * 0.56;   // 纬度（乘 0.72 收紧极区）
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
      /* 中间 1/3 再放大一档：横向 ±1/3 球半径（约 ±20° 经度）这一带
         正对视线，是画面的视觉中心，给它额外 1.45 倍，
         和两侧拉开层次。越靠外越接近 1。 */
      const centerX = Math.abs(x) / R;
      const centerBoost = centerX < 0.34
        ? 1.45
        : Math.max(1, 1.45 - (centerX - 0.34) * 1.6);
      /* 卡片尺寸与球半径解耦：基准大小由 cardScale 定，depth 只做近大远小。
         梯度 0.40—1.30 倍：正面明显更大、背面明显更小。 */
      const sc = globe.cardScale * fitCard * (0.40 + depth * 0.90) * centerBoost;
      /* 透明度只按前后纵深分档：正面 1.0（完全不透明），
         背面 0.14（几乎只剩一层影子）。 */
      const op2 = 0.14 + depth * 0.86;

      const halfW = (n.tw * sc) / 2;
      /* 按纵深做径向缩放：后半球的卡片往中心收（彼此靠得更近 → 看着更密集），
         前半球的往外推（间距拉开 → 看着更松散）。
         0.72 与 1.30 是两侧的极值，中间按 depth 线性过渡。 */
      const radial = 0.72 + depth * 0.58;
      const pxRaw = cx + x * radial - halfW;
      const px = Math.max(4, Math.min(W - n.tw * sc - 4, pxRaw));   // 夹在画布内
      out.push({
        n,
        x: px,
        y: cy + y * radial - (n.th * sc) / 2,
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

  /* ---------------- 布局：时间轴（可拖动的横向时间条） ----------------
     沿用参考站的做法：卡片沿一条水平时间线排开，靠"每一天占多少像素"拉开距离，
     日期刻度跟着平移。视口装不下时整体可以拖动 —— 这就是"时间轴可拖动"的含义：
     拖的是时间，不是把卡片拖乱。

     · 位置 = 24 + (该条截止日 + 拖动偏移) × pxPerDay
     · 刻度按固定间隔（每 3 天一根）画在时间线上，随偏移一起移动
     · 纵向：全部对齐同一条线，超出视口的靠拖动看，不再堆成十几行
   ------------------------------------------------------------ */
  const tl = { offset: 0, pxPerDay: 26, dragging: false, lastX: 0, minX: 0, maxX: 0 };

  function layoutTimeline(list) {
    const W = stageEl.clientWidth, H = stageEl.clientHeight;
    const now = clock.value();
    const withD = list.filter((it) => it.deadline && it.deadline.ms > 0)
      .sort((a, b) => a.deadline.ms - b.deadline.ms);
    const noD = list.filter((it) => !(it.deadline && it.deadline.ms > 0));

    const baseY = 74;
    const out = [];

    // 时间线总长：按最远的截止日决定，但至少一个视口宽，最多 3 个视口宽
    const maxDay = withD.length ? Math.max.apply(null, withD.map((it) => Math.min(it.deadline.days, 60))) : 30;
    /* 内容宽 = 时间线所需宽度，至少 1.6 个视口宽。
       留出余量是因为卡片会因"避免重叠"被逐个右推，实际最右会超过刻度末端；
       画布太窄时右侧那几张拖不进视口（看着像被东西挡住）。
       但也不能给太大 —— 早期试过 2.2 个视口宽，可拖范围过大，
       一拖到底会把卡片全部推出屏幕。 */
    const railW = 24 + maxDay * tl.pxPerDay + 260;
    const contentW = Math.max(Math.round(W * 1.6), railW + 200);
    const minOffset = Math.min(0, W - contentW);   // 可以往左拖到的极限
    tl.minX = minOffset; tl.maxX = 0;
    tl.offset = Math.max(tl.minX, Math.min(tl.maxX, tl.offset));

    /* 摆放规则：
       1. 先按"截止日 × 每天像素"给一个理想 x —— 时间顺序决定横向位置
       2. 按时间先后依次落位；与已落位的卡片相交就右推，推到不重叠为止
       3. 两行纵向错开，并用伪随机倾斜一点，避免看起来像表格
       这样"拖动的仍然是时间"，同时卡片不会叠成一坨。 */
    const pad = 10;
    const placed = [];
    const hits = (x, y, w, h) => placed.some((p2) =>
      x < p2.x + p2.w + pad && x + w + pad > p2.x &&
      y < p2.y + p2.h + pad && y + h + pad > p2.y);

    withD.forEach((it, i) => {
      const n = nodes.get(it.id);
      const day = Math.min(it.deadline.days, 60);
      const w = n.tw * n.ts, h = n.th * n.ts;
      const row = i % 2;
      const y = baseY + row * (h + 14);
      let x = 24 + day * tl.pxPerDay + tl.offset;
      let guard = 0;
      while (hits(x, y, w, h) && guard < 60) { x += 18; guard += 1; }
      placed.push({ x, y, w, h });
      out.push({ n, x, y, r: (i % 2 ? 1.6 : -1.6), tlDay: day });
    });

    // 没有截止日的：接在时间线右侧之后，同样按冲突右推
    const tailX = 24 + (maxDay + 3) * tl.pxPerDay + tl.offset;
    noD.forEach((it, i) => {
      const n = nodes.get(it.id);
      const w = n.tw * n.ts, h = n.th * n.ts;
      const row = i % 2;
      const y = baseY + (2 + row) * (h + 14);
      let x = tailX + Math.floor(i / 2) * (w + pad);
      let guard = 0;
      while (hits(x, y, w, h) && guard < 60) { x += 18; guard += 1; }
      placed.push({ x, y, w, h });
      out.push({ n, x, y, r: (i % 2 ? 1.6 : -1.6), tlDay: null });
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
    /* 散落可能横向溢出：画布要跟着放宽，否则溢出部分会被裁掉、也没法拖出来看 */
    /* 画布宽度只在散落模式按内容放宽；时间轴由 drawRules 自己设（它知道轨道多长）。
       其他模式保持视口宽。 */
    if (state.mode === 'scatter') {
      const wrapW = Math.max(stageEl.clientWidth, placed.reduce((m, p) => {
        const w = (p.forceW || p.n.tw) * (p.n.ts || 1);
        return Math.max(m, p.x + w);
      }, 0) + 20);
      canvasEl.style.width = wrapW + 'px';
    } else if (state.mode !== 'timeline') {
      canvasEl.style.width = stageEl.clientWidth + 'px';
    }
    /* 网格内容比视口高时，让 stage 自己纵向滚动。
       早先写的是 canvasEl.style.overflowY = 'auto' —— 但 canvas 的高度
       就是内容高度，永远不溢出，所以那条等于没生效（网格完全滚不动）。
       滚动必须放在 stage 上。 */
    const scrollable = state.mode === 'grid' && wrapH > stageEl.clientHeight + 1;
    stageEl.classList.toggle('is-scrollable', scrollable);
    if (!scrollable) { stageEl.scrollTop = 0; stageEl.scrollLeft = 0; }
    syncZoomOrigin();          // canvas 尺寸可能刚变，缩放原点要跟着球心走
    /* 散落与时间轴都可能横向溢出，允许拖动视图查看。
       注意顺序：必须先 drawRules()（时间轴在这里给画布设宽度），
       再算平移范围 —— 反过来会读到旧宽度，导致右侧一截卡片永远拖不到。 */
    drawRules();
    if (state.mode === 'scatter' || state.mode === 'timeline') {
      setPanBounds(placed);
      /* 切到该模式时把视图摆在内容中心 —— 这样上下左右都有卡片可拖。
         记住 pan.inited，用户拖过后不再覆盖他的位置。 */
      if (!pan.inited) {
        pan.x = Math.round((pan.minX + pan.maxX) / 2);
        pan.y = Math.round((pan.minY + pan.maxY) / 2);
        pan.inited = true;
        panOnly();
      }
    } else { pan.x = 0; pan.y = 0; pan.inited = false; applyPan(); }

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
    /* 清掉上一次的整条轨道 —— 包括容器本身。
       只删里面的刻度和线是不够的：容器会一层层叠起来，
       而 querySelector 取到的永远是最早那个（位置停留在第一次绘制时的偏移）。 */
    canvasEl.querySelectorAll('.tl-rail-wrap, .tl-rule, .tl-tick, .tl-label').forEach((e) => e.remove());
    if (state.mode !== 'timeline') return;
    const W = stageEl.clientWidth;
    const now = clock.value();
    const rows = filtered().filter((it) => it.deadline && it.deadline.ms > 0);
    const maxDay = rows.length ? Math.max.apply(null, rows.map((it) => Math.min(it.deadline.days, 60))) : 30;
    const railW = 24 + maxDay * tl.pxPerDay + 260;
    /* 与 layoutTimeline 保持同一个公式：两处不一致时，
       平移范围会被较小的那份卡住，右侧卡片就拖不进来。 */
    const contentW = Math.max(Math.round(W * 1.6), railW + 200);

    canvasEl.style.width = contentW + 'px';
    // 刻度容器与时间线一起平移：这样拖动时刻度自然跟着走，不用逐个重算
    const rail = document.createElement('div');
    rail.className = 'tl-rail-wrap';
    rail.style.cssText = 'position:absolute;left:' + Math.round(tl.offset) + 'px;top:0;bottom:0;width:' + railW + 'px;pointer-events:none;';

    const rule = document.createElement('div');
    rule.className = 'tl-rule';
    rule.style.top = '58px';
    rail.appendChild(rule);

    for (let day = 0; day <= maxDay; day += 3) {
      const x = 24 + day * tl.pxPerDay;
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.style.left = x + 'px';
      rail.appendChild(tick);
      const d = new Date(now.getTime() + day * 86400000);
      const lab = document.createElement('div');
      lab.className = 'tl-label';
      lab.style.left = x + 'px';
      lab.innerHTML = '<b>' + (day === 0 ? '今天' : (d.getMonth() + 1) + '/' + d.getDate()) + '</b>' +
        (day ? '<span>' + day + ' 天后</span>' : '');
      rail.appendChild(lab);
    }
    canvasEl.appendChild(rail);
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

  /* 界面配色预设：主色会写到 --page（页面与球面底色）。
     深色档是按同一主色压暗算出来的，所以换色后深浅两档仍然协调。 */
  const ACCENTS = [
    { hex: '#94a04b', name: '橄榄' },
    { hex: '#7f8c4a', name: '苔绿' },
    { hex: '#5f7a52', name: '松绿' },
    { hex: '#8a7b3f', name: '芥黄' },
    { hex: '#a8904a', name: '沙金' },
    { hex: '#6f7f8a', name: '青灰' },
    { hex: '#8a6f7a', name: '灰紫' }
  ];

  /* 把主色转成深色档：压暗到约 38%，保持色相 */
  function darken(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * k);
    const g = Math.round(((n >> 8) & 255) * k);
    const b = Math.round((n & 255) * k);
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }

  /* 应用配色：主色 → --page，深色 → --page 压暗 + data-theme=dark */
  function applyAccent(hex) {
    const accent = /^#[0-9a-f]{6}$/i.test(String(hex)) ? hex : ACCENTS[0].hex;
    const dark = Store.readDark();
    const page = dark ? darken(accent, 0.38) : accent;
    document.documentElement.style.setProperty('--page', page);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    /* 注意：这里不要再往 themeBtn 里写文字。
       右上角那颗钮的内容是一个显示当前主色的小色块（#themeSwatch），
       早先版本写的是 'L'/'D' 文字，会把色块 span 整个覆盖掉。 */
    return { accent, page, dark };
  }

  /* 配色面板的内容 —— 右上角弹出层用这一份，避免两处各写一套导致不同步。
     compact 为 true 时省掉说明文字（弹出层空间小）。 */
  function themeBoxHTML(compact) {
    const cur = (Store.readAccent() || ACCENTS[0].hex).toLowerCase();
    return '<div class="swatches" role="group" aria-label="主色">' +
        ACCENTS.map((a) => {
          const on = cur === a.hex.toLowerCase();
          return '<button class="swatch' + (on ? ' is-on' : '') + '" type="button" data-accent="' + a.hex + '"' +
            ' title="' + a.name + '" aria-label="' + a.name + '" aria-pressed="' + on + '"' +
            ' style="--sw:' + a.hex + '"></button>';
        }).join('') +
      '</div>' +
      '<div class="theme-row">' +
        '<label class="theme-pick"><span>自定义</span>' +
        '<input type="color" id="accentPick" value="' + esc(Store.readAccent() || ACCENTS[0].hex) + '"></label>' +
        '<button class="btn btn--sm" type="button" data-act="theme-toggle">' +
          (Store.readDark() ? '切换为明亮' : '切换为深色') + '</button>' +
      '</div>' +
      (compact ? '' : '<p class="field__hint">主色会应用到页面与球面底色；配色只存在这台电脑上。</p>');
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

  /* ---------------- 发布页配图 ----------------
     纯前端站点没有服务器可上传，所以图片在前端压缩成 dataURL 存本机：
       ① 等比缩到最长边 720px（卡片上根本用不到更大）
       ② 优先 JPEG 0.82，体积通常压到几十 KB
       ③ 超过 ~260KB 就继续降质，避免撑爆 localStorage 配额（一般 5MB）
     这样一次发布带图的体积可控，几十条也不会写满。 */
  let pendingImage = '';

  function compressImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//i.test(file.type)) return reject(new Error('请选择图片文件'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.onload = () => {
        const im = new Image();
        im.onerror = () => reject(new Error('这个图片格式浏览器打不开'));
        im.onload = () => {
          const side = Math.max(im.width, im.height) || 1;
          const k = Math.min(1, (maxSide || 720) / side);
          const w = Math.max(1, Math.round(im.width * k));
          const h = Math.max(1, Math.round(im.height * k));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const cx = cv.getContext('2d');
          cx.fillStyle = '#ffffff';
          cx.fillRect(0, 0, w, h);           // JPEG 不支持透明，先铺白底
          cx.drawImage(im, 0, 0, w, h);
          let out = cv.toDataURL('image/jpeg', quality || 0.82);
          // 还是太大就降质重来（最多两轮，避免卡住）
          for (let i = 0; i < 2 && out.length > 260 * 1024; i++) {
            out = cv.toDataURL('image/jpeg', Math.max(0.4, (quality || 0.82) - 0.18 * (i + 1)));
          }
          resolve({ data: out, w: w, h: h, bytes: out.length });
        };
        im.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
  }

  function publishImageHTML() {
    return '<div class="imgfield">' +
      '<span class="field__label">配图</span>' +
      '<div class="imgfield__body">' +
        '<div class="imgfield__preview" id="pubImgPreview">' +
          (pendingImage ? '<img src="' + pendingImage + '" alt="配图预览">' : '<span class="imgfield__empty">未选择</span>') +
        '</div>' +
        '<div class="imgfield__acts">' +
          '<label class="btn btn--sm imgfield__pick">选择图片' +
            '<input type="file" id="pubImgFile" accept="image/*" hidden></label>' +
          '<button class="btn btn--sm" type="button" data-act="img-clear"' +
            (pendingImage ? '' : ' disabled') + '>移除</button>' +
          '<span class="imgfield__size" id="pubImgSize">' +
            (pendingImage ? Math.round(pendingImage.length / 1024) + ' KB' : '') + '</span>' +
        '</div>' +
      '</div>' +
      '<span class="field__hint">图片会压到最长边 720px 后存在本机；本站无服务器，不会上传到任何地方。</span>' +
    '</div>';
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
        publishImageHTML() +
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

    /* 有配图的内容，详情页顶部先给一张大图 */
    const hero = imageOf(it)
      ? '<figure class="detail__hero"><img src="' + imageOf(it).src + '" alt="' + esc(imageOf(it).alt) + '"></figure>'
      : '';

    let body;
    if (cur === 'fit') {
      body = hero + fitHTML(it) +
        '<h2>材料里没写、需要向主办方确认的项</h2>' +
        (it.unconfirmed.length
          ? '<ul class="list-plain">' + it.unconfirmed.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>'
          : '<p style="color:#9aa06a;font-size:13px">这几项上材料的信息是完整的。</p>');
    } else if (cur === 'raw') {
      body = hero + '<h2>材料原文关键信息（不做改写）</h2><dl class="dl">' +
        '<dt>材料编号</dt><dd>第 ' + idx(it.seq) + ' 条</dd>' +
        '<dt>来源口径</dt><dd>' + esc(it.updatedAt) + '</dd>' +
        facts.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd' + (v ? '' : ' class="empty"') + '>' + esc(v || '未注明') + '</dd>').join('') +
        '</dl><p style="color:#9aa06a;font-size:11.5px;margin-top:14px;font-family:var(--mono)">材料没写的显示「未注明」，不做补全</p>' +
        (it.trust.flags.length
          ? '<h2>被标为「' + esc(it.trust.label) + '」的原因</h2><ul class="list-plain">' +
            it.trust.flags.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>'
          : '');
    } else {
      body = hero + fitHTML(it) +
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
      if (globe.snapping) {
        /* 吸附进行中：按时长做缓出插值，转到位就交还给自转。
           用 yaw 的增减幅度衡量"转了多远"，决定自转冷却时间 ——
           转得多就多停一会儿，转得少马上恢复，手感更自然。 */
        const dt2 = Math.min(48, dt);
        globe.snapT = Math.min(globe.snapDur, globe.snapT + dt2);
        const k = globe.snapDur > 0 ? globe.snapT / globe.snapDur : 1;
        const e = 1 - Math.pow(1 - k, 3);                 // easeOutCubic
        globe.yaw = globe.snapFrom + (globe.snapTo - globe.snapFrom) * e;
        // pitch 同时在同一条动画里回正（上下拖动过的量一起收回 0）
        globe.pitch = globe.snapFromPitch + (globe.snapToPitch - globe.snapFromPitch) * e;
        if (k >= 1) {
          globe.snapping = false;
          globe.yaw = globe.snapTo;
          globe.pitch = globe.snapToPitch;
          globe.vYaw = 0; globe.vPitch = 0;
          const travelled = Math.abs(globe.snapTo - globe.snapFrom);
          globe.spinIdle = 300 + Math.min(1400, travelled / (Math.PI / 4) * 420);
        }
      } else if (globe.spinIdle > 0) {
        globe.spinIdle = Math.max(0, globe.spinIdle - dt);
      } else if (!globe.dragging) {
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

  /* 只重排时间轴（拖动时用），并把刻度一起更新 */
  function layoutTimelineOnly() {
    const placed = layoutTimeline(filtered());
    placed.forEach((p) => {
      const n = p.n, el = n.el;
      el.style.setProperty('--x', Math.round(p.x));
      el.style.setProperty('--y', Math.round(p.y));
      n.x = p.x; n.y = p.y;
    });
    drawRules();
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

  /* 松手后的收束：水平方向吸附到最近的经线网格，垂直方向回正到水平。
     两件事放在同一条动画里做（yaw 与 pitch 同时插值），
     所以看起来是"球自己摆正"，而不是先转一次再弹一次。 */
  function startSnap() {
    const step = globe.snapStep;
    const target = Math.round(globe.yaw / step) * step;
    const yawDelta = Math.abs(target - globe.yaw);
    const pitchDelta = Math.abs(globe.pitch - globe.homePitch);

    /* 已经又正又在网格上 → 什么都不做，避免"咔"一下的无谓抖动 */
    if (yawDelta < 0.004 && pitchDelta < 0.004) {
      globe.yaw = target;
      globe.pitch = globe.homePitch;
      globe.vYaw = 0; globe.vPitch = 0;
      return;
    }
    globe.snapFrom = globe.yaw;
    globe.snapTo = target;
    globe.snapFromPitch = globe.pitch;
    globe.snapToPitch = globe.homePitch;
    globe.snapT = 0;
    /* 时长取水平与垂直两个位移里较大的那个决定（180—460ms）：
       上下拖得多时回正要多花一点时间，否则会显得"啪"地弹过去。 */
    const amp = Math.max(yawDelta / (Math.PI / 4), pitchDelta / 0.5);
    globe.snapDur = 180 + Math.min(280, amp * 240);
    globe.snapping = true;
    globe.vYaw = 0; globe.vPitch = 0;
  }

  /* 时间轴拖动：横向平移时间线（拖的是时间，不是把卡片拖乱） */
  /* ---------------- 指针手势：一套状态机处理三种意图 ----------------
     意图判断只看位移：
       · 位移 < 6px       → 点击（交给卡片的 click 处理，打开详情）
       · 球面 + 水平拖动   → 旋转球体（yaw / pitch）
       · 时间轴 + 水平拖动 → 平移时间线（offset）
     刻意不用 setPointerCapture：
       捕获会把"指针底下是谁"改成捕获元素，导致 click 不再派发给卡片、
       连轻点卡片都被算成拖动吞掉。stage 已覆盖整个画布，不需要捕获。
     ------------------------------------------------------------------ */
  const DRAG_THRESHOLD = 6;
  let gesture = null;        // { kind:'globe'|'timeline', x, y, moved, base... }
  let suppressClick = false; // 刚结束一次拖动时，吞掉紧随其后的 click

  stageEl.addEventListener('pointerdown', (e) => {
    suppressClick = false;
    if (state.mode === 'globe') {
      gesture = { kind: 'globe', x: e.clientX, y: e.clientY, moved: false,
        yaw: globe.yaw, pitch: globe.pitch };
      globe.dragging = true;
      globe.snapping = false;     // 用户一上手就取消吸附动画
      globe.spinIdle = 0;
    } else if (state.mode === 'timeline') {
      gesture = { kind: 'timeline', x: e.clientX, moved: false, offset: tl.offset };
    } else if (state.mode === 'scatter') {
      gesture = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false,
        panX: pan.x, panY: pan.y };
      pan.dragging = true;
    } else {
      gesture = null;
    }
  });

  stageEl.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    // 必须是 let：下面要按缩放比折算位移（dx /= z），const 会抛
    // "Assignment to constant variable"，整个拖动分支直接失效
    let dx = e.clientX - gesture.x;
    let dy = e.clientY - (gesture.y || 0);
    if (!gesture.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      gesture.moved = true;
      canvasEl.classList.add('is-panning');   // 拖动期间卡片不响应指针
      stageEl.style.cursor = 'grabbing';
      if (gesture.kind === 'globe') setSphereTransition(true);
    }
    /* 画布整体被 scale 过，所以手势位移要除以缩放比：
       否则放大到 200% 时拖动会比手指快一倍，缩到 50% 时会跟不上。 */
    const z = zoom.value || 1;
    dx /= z; dy /= z;
    if (gesture.kind === 'pan') {
      /* 散落拖动视图：往右拖内容跟着往右走（和直接抓纸一样） */
      pan.x = gesture.panX + dx;
      pan.y = gesture.panY + dy;
      panOnly();
      return;
    }
    if (gesture.kind === 'globe') {
      globe.yaw = gesture.yaw + dx * 0.005;
      globe.pitch = Math.max(-0.85, Math.min(0.85, gesture.pitch - dy * 0.004));
      const MAXV = 0.0009;                    // 惯性限幅，否则松手后越转越快
      globe.vYaw = Math.max(-MAXV, Math.min(MAXV, dx * 0.00007));   // 惯性收小：松手后尽快进入吸附
      globe.vPitch = Math.max(-MAXV / 2, Math.min(MAXV / 2, -dy * 0.00008));
      layoutGlobeOnly();
    } else {
      tl.offset = Math.max(tl.minX, Math.min(tl.maxX, gesture.offset + dx));
      layoutTimelineOnly();
    }
  });

  const endGesture = () => {
    if (!gesture) return;
    const moved = gesture.moved;
    const kind = gesture.kind;
    gesture = null;
    if (kind === 'pan') pan.dragging = false;
    if (kind === 'globe') {
      globe.dragging = false;
      setSphereTransition(false);
      // 只有真正拖动过（不是点一下）才吸附，避免单击卡片时球体跳一下
      if (moved) startSnap();
    }
    canvasEl.classList.remove('is-panning');
    stageEl.style.cursor = '';
    if (moved) suppressClick = true;          // 这一次算拖动，不要打开详情
  };
  stageEl.addEventListener('pointerup', endGesture);
  stageEl.addEventListener('pointercancel', endGesture);
  /* 刻意不监听 pointerleave：指针从 canvas 移到卡片上（或移到缩放条）都会触发它，
     一触发就把手势清空，拖动立刻中断 —— 表现为"拖不动"。
     结束手势只认 pointerup / pointercancel。 */
  window.addEventListener('blur', endGesture);

  /* ---------------- 右侧缩放条 ---------------- */
  (function zoomBar() {
    const track = document.getElementById('zoomTrack');
    if (!track) return;
    let dragging = false;

    const fromEvent = (e) => {
      const r = track.getBoundingClientRect();
      const t = 1 - (e.clientY - r.top) / r.height;      // 上 → 大
      return zoom.MIN + Math.max(0, Math.min(1, t)) * (zoom.MAX - zoom.MIN);
    };
    const onMove = (e) => { if (dragging) zoom.apply(fromEvent(e)); };

    track.addEventListener('pointerdown', (e) => {
      dragging = true;
      track.classList.add('is-dragging');
      track.setPointerCapture(e.pointerId);             // 这里捕获是必要的：要拖出条外仍跟手
      zoom.apply(fromEvent(e));
      e.preventDefault();
    });
    track.addEventListener('pointermove', onMove);
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-dragging');
      try { track.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);

    track.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.25 : 0.1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { zoom.apply(zoom.value + step); e.preventDefault(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { zoom.apply(zoom.value - step); e.preventDefault(); }
      if (e.key === 'Home') { zoom.apply(1); e.preventDefault(); }
    });

    document.getElementById('zoombar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-zoom]');
      if (!b) return;
      const k = b.getAttribute('data-zoom');
      if (k === 'in') zoom.apply(zoom.value + 0.1);
      else if (k === 'out') zoom.apply(zoom.value - 0.1);
      else zoom.apply(1);
    });

    // Ctrl/⌘ + 滚轮：以画布中心为基准缩放（不改变布局，只改比例）
    stageEl.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoom.apply(zoom.value - e.deltaY * 0.002);
    }, { passive: false });

    zoom.apply(zoom.read());
  })();

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
    if (state.mode !== 'globe') { globe.yaw = 0; globe.pitch = globe.homePitch; }
    if (state.mode === 'timeline') tl.offset = 0;
    pan.inited = false;          // 每次切模式重新把视图摆到内容中心
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
    /* 配色：点色块换主色；点按钮切深浅。两者都立刻生效并写回本机。 */
    const sw = e.target.closest('[data-accent]');
    if (sw) {
      const hex = sw.getAttribute('data-accent');
      Store.writeAccent(hex);
      applyAccent(hex);
      syncThemeBox(panelEl);      // 就地更新选中态，不重建面板
      syncThemeBox(themePopEl);
      syncThemeButton();
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); openDetail(open.getAttribute('data-open')); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.getAttribute('data-act'), id = b.getAttribute('data-id');

    if (act === 'theme-toggle') {
      Store.writeDark(!Store.readDark());
      applyAccent(Store.readAccent() || ACCENTS[0].hex);
      syncThemeButton();
      syncThemeBox(panelEl);
      syncThemeBox(themePopEl);
      return;
    }
    if (act === 'img-clear') {
      pendingImage = '';
      const prev = document.getElementById('pubImgPreview');
      if (prev) prev.innerHTML = '<span class="imgfield__empty">未选择</span>';
      const size = document.getElementById('pubImgSize');
      if (size) size.textContent = '';
      const clr = panelEl.querySelector('[data-act="img-clear"]');
      if (clr) clr.disabled = true;
      const file = document.getElementById('pubImgFile');
      if (file) file.value = '';
      return;
    }
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
    if (e.target.id === 'pubImgFile') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      compressImage(file, 720, 0.82).then((r) => {
        pendingImage = r.data;
        const prev = document.getElementById('pubImgPreview');
        if (prev) prev.innerHTML = '<img src="' + pendingImage + '" alt="配图预览">';
        const size = document.getElementById('pubImgSize');
        if (size) size.textContent = Math.round(r.bytes / 1024) + ' KB · ' + r.w + '×' + r.h;
        const clr = panelEl.querySelector('[data-act="img-clear"]');
        if (clr) clr.disabled = false;
        toast('已加入配图（' + Math.round(r.bytes / 1024) + ' KB）');
      }).catch((err) => toast(err.message || '图片处理失败'));
      return;
    }
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

  /* 自定义主色：取色器一改就立刻生效（input 事件是连续触发的，所以节流到下一帧） */
  panelEl.addEventListener('input', (e) => {
    if (e.target.id !== 'accentPick') return;
    Store.writeAccent(e.target.value);
    applyAccent(e.target.value);
    syncThemeBox(themePopEl);
    syncThemeButton();
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
        image: pendingImage,
        whereUnconfirmed: !f.elements.eventWhere.value.trim()
      };
      if (!raw.title.trim()) { toast('请填活动名称'); return; }
      if (!raw.contact.trim()) { toast('请留联系方式'); return; }
      const item = Store.saveUserItem(raw);
      pendingImage = '';
      toast('已发布'); closePanel(); layout(); openDetail(item.id);
    }
  });

  /* ---------------- 右上角配色弹出层 ----------------
     点顶栏右上角的色块圆钮弹出取色面板；点外部或 Esc 收起。
     面板里的色块与深浅按钮和「我的」共用同一套 data 属性与状态。 */
  const themePopEl = document.getElementById('themePop');
  const themeBtnEl = document.getElementById('themeBtn');

  /* 圆钮上的小色块始终显示当前主色 */
  function syncThemeButton() {
    const hex = Store.readAccent() || ACCENTS[0].hex;
    const sw = document.getElementById('themeSwatch');
    if (sw) sw.style.background = hex;
    themeBtnEl.title = '界面配色 · 当前 ' + hex + (Store.readDark() ? '（深色）' : '（明亮）');
  }

  /* 面板内的选中态就地更新，不重建整块 DOM（重建会丢焦点、也会闪） */
  function syncThemeBox(root) {
    if (!root) return;
    const cur = (Store.readAccent() || ACCENTS[0].hex).toLowerCase();
    root.querySelectorAll('[data-accent]').forEach((b) => {
      const on = b.getAttribute('data-accent').toLowerCase() === cur;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const tg = root.querySelector('[data-act="theme-toggle"]');
    if (tg) tg.textContent = Store.readDark() ? '切换为明亮' : '切换为深色';
  }

  function openThemePop() {
    themePopEl.innerHTML = '<h2>界面配色</h2>' + themeBoxHTML(true);
    themePopEl.hidden = false;
    themeBtnEl.setAttribute('aria-expanded', 'true');
    syncThemeBox(themePopEl);
  }
  function closeThemePop() {
    themePopEl.hidden = true;
    themeBtnEl.setAttribute('aria-expanded', 'false');
  }

  themeBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (themePopEl.hidden) openThemePop(); else closeThemePop();
  });
  themePopEl.addEventListener('click', (e) => e.stopPropagation());

  // 点面板外部收起（顶栏按钮自己 stopPropagation，所以不会被这里误关）
  document.addEventListener('click', () => { if (!themePopEl.hidden) closeThemePop(); });

  themePopEl.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-accent]');
    if (sw) {
      const hex = sw.getAttribute('data-accent');
      Store.writeAccent(hex);
      applyAccent(hex);
      syncThemeBox(themePopEl);
      syncThemeBox(panelEl);
      syncThemeButton();
      return;
    }
    if (e.target.closest('[data-act="theme-toggle"]')) {
      Store.writeDark(!Store.readDark());
      applyAccent(Store.readAccent() || ACCENTS[0].hex);
      syncThemeButton();
      syncThemeBox(themePopEl);
      syncThemeBox(panelEl);
    }
  });
  themePopEl.addEventListener('input', (e) => {
    if (e.target.id !== 'accentPick') return;
    Store.writeAccent(e.target.value);
    applyAccent(e.target.value);
    syncThemeBox(panelEl);
    syncThemeButton();
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') { closeThemePop(); closePanel(); return; }
    if (typing) return;
    if (e.key === '/') { const q = document.getElementById('q'); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
    if (e.key === '+' || e.key === '=') { zoom.apply(zoom.value + 0.1); return; }
    if (e.key === '-' || e.key === '_') { zoom.apply(zoom.value - 0.1); return; }
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

  window.addEventListener('resize', () => { layout(true); syncZoomOrigin(); });

  /* ---------------- 启动 ---------------- */
  (function boot() {
    Store.seedAdded();
    Store.sync();
    /* 恢复上次选的界面配色（主色 + 深浅），没有就用默认橄榄 */
    applyAccent(Store.readAccent() || ACCENTS[0].hex);
    syncThemeButton();
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
    globe, tl, zoom, pan, panOnly, setSphereTransition, startSnap,
    getGesture: () => gesture,
    startSpin: () => { globe.autoSpin = true; if (Math.abs(globe.vYaw) < 0.0003) globe.vYaw = 0.00021; },
    getPan: () => ({ x: Math.round(pan.x), y: Math.round(pan.y),
      minX: Math.round(pan.minX), maxX: Math.round(pan.maxX),
      minY: Math.round(pan.minY), maxY: Math.round(pan.maxY) }), layoutGlobeOnly, layoutTimelineOnly,
    get settled() { return settled; }
  };
})();
