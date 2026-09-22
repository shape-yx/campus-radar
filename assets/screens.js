'use strict';

/* ==========================================================================
   校园雷达 · 屏幕（编辑式版）
   --------------------------------------------------------------------------
   六块：今天 / 索引 / 时间轴 / 详情 / 发布 / 我的
   版式统一遵循同一套体例：页头巨型标题 + 右侧索引计数 → 细线分栏 →
   索引行（编号 · 标题 · 元信息 · 状态 · 操作）
   ========================================================================== */

(function () {
  const App = window.App;
  const DATA = App.DATA;
  const Store = App.Store;
  const Radar = App.Radar;
  const esc = App.esc;
  const raw = App.raw;

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ======================= 通用片段 ======================= */

  /** 页头：巨型标题 + 右侧索引计数 */
  function pagehead(kicker, title, sub, index) {
    return '<header class="pagehead">' +
      '<div>' +
        '<div class="pagehead__kicker">' + kicker.map((k) => '<span>' + esc(k) + '</span>').join('') + '</div>' +
        '<h1>' + title + '</h1>' +
        (sub ? '<p class="pagehead__sub">' + esc(sub) + '</p>' : '') +
      '</div>' +
      (index ? '<div class="pagehead__index">' + index + '</div>' : '') +
    '</header>';
  }

  function sectionHead(title, note, right) {
    return '<div class="blockhead">' +
      '<h2>' + esc(title) + '</h2>' +
      (note ? '<span class="count">' + esc(note) + '</span>' : '') +
      (right || '') +
    '</div>';
  }

  function kv(k, v) {
    return '<span class="kv"><b>' + esc(k) + '</b><span>' + (v ? esc(v) : '—') + '</span></span>';
  }

  /* ======================= 1. 今天 ======================= */

  function today() {
    const profile = Store.profile();
    const nowD = App.now.value();
    const all = App.visible(profile, false);

    const actionable = all.filter(App.isActionable);
    const openOk = actionable.filter((it) => it.fit.level === 'ok');
    const needCheck = actionable.filter((it) => it.fit.level === 'check');
    const blocked = all.filter((it) => it.fit.level === 'blocked');
    const week = App.sortByDeadline(all.filter((it) => it.deadline && it.deadline.ms > 0 && it.deadline.days <= 7));
    const soon = App.sortByDeadline(all.filter((it) => it.fit.level !== 'blocked')).slice(0, 6);
    const sec = App.parseHash().query.sec || '';

    const tiles = [
      ['ok', '现在就能参加', openOk.length, '符合你的条件且仍可参加'],
      ['check', '需先确认', needCheck.length, '缺信息或名额口径不明'],
      ['blocked', '暂不符合', blocked.length, '年级 / 时间投入不满足']
    ];

    return '<div class="view">' +

      '<header class="pagehead">' +
        '<div>' +
          '<div class="pagehead__kicker">' +
            '<span>' + nowD.getFullYear() + '</span>' +
            '<span>' + App.idx(nowD.getMonth() + 1) + ' / ' + App.idx(nowD.getDate()) + '</span>' +
            '<span>' + WEEK[nowD.getDay()] + '</span>' +
            '<span>' + (App.now.mode() === 'live' ? '按真实时间' : '基准 ' + App.now.REF.slice(11)) + '</span>' +
          '</div>' +
          '<h1 class="hero-words"><span>今天</span><span>值得看的</span><span>校园机会</span></h1>' +
          '<p class="pagehead__sub">收录材料里的 ' + all.length + ' 条信息。每条都按材料给出的时间与条件算出状态，' +
            '并按你在「我的」里填的年级与每周可投入时间做过条件比对。材料没写的字段，一律显示「未注明」。</p>' +
        '</div>' +
        '<div class="pagehead__index"><b>' + App.idx(all.length) + '</b><br>条记录</div>' +
      '</header>' +

      // 三档判定：可点击展开
      '<div class="statbar">' + tiles.map(([k, label, n, hint]) =>
        '<a class="stat' + (sec === k ? ' is-open' : '') + '" href="#/' + (sec === k ? '' : '?sec=' + k) + '">' +
          '<div class="stat__label">' + esc(label) + '</div>' +
          '<div class="stat__value">' + App.idx(n) + '</div>' +
          '<div class="stat__hint">' + (sec === k ? '▲ 收起' : '▼ ' + esc(hint)) + '</div>' +
        '</a>').join('') + '</div>' +

      (sec
        ? (function () {
            const map = { ok: openOk, check: needCheck, blocked: blocked };
            const list = map[sec] || [];
            const names = { ok: '现在就能参加', check: '需先向主办方确认', blocked: '按你的情况暂不符合' };
            return '<section class="slab">' +
              sectionHead(names[sec] + '（' + list.length + '）', '按报名截止从近到远',
                '<a class="btn btn--sm" href="#/">收起</a>') +
              (list.length
                ? '<div class="grid">' + App.sortByDeadline(list).map((it, i) => App.card(it, i)).join('') + '</div>'
                : '<div class="empty"><strong>这一档目前是空的</strong><p>换个档位看看，或到「索引」里按条件筛选。</p></div>') +
            '</section>';
          })()
        : '') +

      (week.length
        ? '<section class="slab">' +
          sectionHead('7 天内到报名截止的 ' + week.length + ' 条', '过了就报不上，先处理这些') +
          '<div class="grid">' + week.map((it, i) => App.card(it, i)).join('') + '</div>' +
          '</section>'
        : '') +

      '<section class="slab">' +
        sectionHead('全部条目', '按报名截止从近到远，已排除你暂不符合条件的',
          '<a class="btn btn--sm" href="#/list">去筛选 →</a>') +
        '<div class="grid">' + soon.map((it, i) => App.card(it, i)).join('') + '</div>' +
        (all.filter((it) => it.fit.level !== 'blocked').length > soon.length
          ? '<div class="btn-row" style="margin-top:16px"><a class="btn" href="#/list">查看全部 ' +
            all.filter((it) => it.fit.level !== 'blocked').length + ' 条 →</a></div>'
          : '') +
      '</section>' +

      disclosure() +
    '</div>';
  }

  /** 数据处理说明：把"材料没写全、必须选一种行为"的处理摊开 */
  function disclosure() {
    const rows = [
      ['分类 / 标签', '把信息归入五个分类并打标签', '题目允许"整理、分类、比较、分析"；分类与标签由我划定，不是材料原文'],
      ['时间字段', '材料只给日期或时段时，原样展示，不换算成具体钟点', '例如 23 号原文只写"拟于 9 月 21 日晚开展，具体时间未确定"'],
      ['报名截止', '只给日期没给时间的，按当日 23:59 计算"还剩几天"', '否则无法显示倒计时；界面同时显示材料原文口径'],
      ['活动时间', '只给开始时间、未给结束时间的，状态显示「已开始」', '不替材料推算时长，也不因此断言活动已结束'],
      ['时间投入', '10 / 11 / 14 按材料给出的起止时间显示为 1 小时 30 分钟', '由材料写明的 15:00—16:30 等起止时间得出'],
      ['发布方', '材料没写发布方的一律显示「材料未注明」', '原先我写过"活动方/课题组"这类名称，材料并没有，已删除'],
      ['状态 / 适配', '「可报名 / 已截止」按材料时间与当前时间算出；「适合你」按你填的年级与可投入时间比对', '这两类是产品判断，不是材料原文']
    ];
    return '<section class="slab">' +
      '<details class="fold">' +
        '<summary>数据处理说明<span>材料没写全的地方，我们是怎么处理的（' + rows.length + ' 类）</span></summary>' +
        '<div class="block" style="border-top:none;padding-top:14px">' +
          '<p class="muted" style="font-size:13.5px;margin-bottom:12px">原则：材料没写的一律显示「未注明」，不补全、不猜。' +
          '下面是"材料没写全、但产品必须选一种行为才能显示"的情形，逐条列出依据。</p>' +
          '<div class="dl">' + rows.map(([k, what, why]) =>
            '<dt>' + esc(k) + '</dt><dd>' + esc(what) + '<br><span class="muted" style="font-size:12.5px">依据：' + esc(why) + '</span></dd>').join('') +
          '</div>' +
        '</div>' +
      '</details>' +
    '</section>';
  }

  /* ======================= 2. 索引（列表） ======================= */

  function filtered(q) {
    const profile = Store.profile();
    const nowD = App.now.value();
    const includeDowngraded = q.hidden === '1';
    let out = App.visible(profile, includeDowngraded);

    const term = String(q.q || '').trim().toLowerCase();
    if (term) {
      out = out.filter((it) => [it.title, it.publisher, it.cat, it.audience, it.eventWhere || '',
        it.recurring || '', it.applyHow || '', (it.tags || []).join(' ')].join(' ').toLowerCase().indexOf(term) >= 0);
    }
    if (q.cat) out = out.filter((it) => it.cat === q.cat);
    if (q.source) out = out.filter((it) => it.source === q.source);
    if (q.window === 'today') {
      out = out.filter((it) => {
        const s = it.eventStart ? Radar.parse(it.eventStart, true) : null;
        return !!s && Radar.daysBetween(nowD, s) === 0;
      });
    } else if (q.window === 'week') {
      out = out.filter((it) => {
        if (it.deadline && it.deadline.ms > 0 && it.deadline.days <= 7) return true;
        const s = it.eventStart ? Radar.parse(it.eventStart, true) : null;
        return !!s && s >= nowD && Radar.daysBetween(nowD, s) <= 7;
      });
    } else if (q.window === 'open') {
      out = out.filter((it) => it.status.key === 'open');
    } else if (q.window === 'rolling') {
      out = out.filter((it) => ['rolling', 'unknown', 'started'].indexOf(it.status.key) >= 0);
    }
    if (q.feasible === '1') out = out.filter((it) => it.fit.level !== 'blocked' && App.isActionable(it));

    if (q.sort === 'fit') return out.slice().sort((a, b) => b.fit.score - a.fit.score);
    if (q.sort === 'title') return out.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'));
    if (q.sort === 'source') return out.slice().sort((a, b) => String(a.source).localeCompare(String(b.source)));
    return App.sortByDeadline(out);
  }

  function list(q) {
    const rows = filtered(q);
    const includeDowngraded = q.hidden === '1';
    const allCount = App.visible(Store.profile(), includeDowngraded).length;
    const hiddenCount = App.visible(Store.profile(), true).filter((it) => it.downgraded).length;

    const tag = (key, val, label, on) => {
      const next = Object.assign({}, q);
      next[key] = on ? '' : val;
      return '<a class="tag' + (on ? ' is-on' : '') + '" href="#/list?' + App.toQuery(next) + '">' + esc(label) + '</a>';
    };
    const CATS = ['学习资源', '竞赛科研', '志愿公益', '项目组队', '文体兴趣'];

    return '<div class="view">' +
      pagehead(['Index', '2026 / 09', includeDowngraded ? '含降权内容' : '默认视图'],
        '全部机会<em>与活动</em>',
        '学校 / 学院发布与学生自主发布分开标注。筛选条件写在网址里，可以直接把结果分享给同学。',
        '<b>' + App.idx(rows.length) + '</b><br>／' + App.idx(allCount) + ' 条') +

      '<div class="toolbar">' +
        '<div class="toolbar__group">' +
          '<label class="search"><span class="label">检索</span>' +
            '<input id="q" type="search" data-role="search" placeholder="零基础 / 每周 4 小时 / 志愿 / Git / 大一" value="' + esc(q.q || '') + '"></label>' +
          '<button class="btn btn--sm" type="button" data-action="copy-link">复制链接</button>' +
          (Store.adminUnlocked() ? '<a class="btn btn--sm btn--solid" href="#/publish">＋ 发布</a>' : '') +
        '</div>' +
        '<div class="toolbar__group"><span class="label" style="min-width:52px">时间</span>' +
          tag('window', 'today', '今天', q.window === 'today') +
          tag('window', 'week', '7 天内要办', q.window === 'week') +
          tag('window', 'open', '正在报名', q.window === 'open') +
          tag('window', 'rolling', '长期 / 未定', q.window === 'rolling') +
        '</div>' +
        '<div class="toolbar__group"><span class="label" style="min-width:52px">类别</span>' +
          CATS.map((c) => tag('cat', c, c, q.cat === c)).join('') +
        '</div>' +
        '<div class="toolbar__group"><span class="label" style="min-width:52px">来源</span>' +
          tag('source', 'official', '学校 / 学院', q.source === 'official') +
          tag('source', 'student', '学生发布', q.source === 'student') +
          '<span class="label">仅可参加</span>' + tag('feasible', '1', '是', q.feasible === '1') +
          (hiddenCount ? '<span class="label">降权</span>' + tag('hidden', '1', '显示 ' + hiddenCount, includeDowngraded) : '') +
        '</div>' +
        '<div class="toolbar__group">' +
          '<span class="label" style="min-width:52px">排序</span>' +
          '<select id="sortSel" data-role="sort" style="max-width:260px">' +
            [['deadline', '报名截止（近 → 远）'], ['fit', '与我的匹配度'], ['title', '标题'], ['source', '来源']]
              .map(([v, l]) => '<option value="' + v + '"' + ((q.sort || 'deadline') === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') +
          '</select>' +
          (Object.keys(q).some((k) => q[k] && k !== 'sort') ? '<a class="btn btn--sm" href="#/list">清空条件</a>' : '') +
        '</div>' +
      '</div>' +

      '<div id="listRegion">' + region(q) + '</div>' +
    '</div>';
  }

  function region(q) {
    const rows = filtered(q);
    if (!rows.length) {
      return '<div class="empty"><strong>没有符合条件的信息</strong>' +
        '<p>换个关键词，或清空筛选条件再看看。</p>' +
        '<div class="btn-row" style="justify-content:center;margin-top:16px"><a class="btn" href="#/list">清空筛选</a></div></div>';
    }
    return '<div class="grid">' + rows.map((it, i) => App.card(it, i)).join('') + '</div>';
  }

  function refreshList(q) {
    const box = document.getElementById('listRegion');
    if (box) box.innerHTML = region(q);
    const s = App.toQuery(q);
    history.replaceState(null, '', '#/list' + (s ? '?' + s : ''));
  }

  /* ======================= 3. 时间轴 ======================= */

  function calendar() {
    const profile = Store.profile();
    const nowD = App.now.value();
    const all = App.visible(profile, false).filter((it) => it.fit.level !== 'blocked');
    const hidden = Store.actions().hidden;
    const entries = [];
    for (const it of all) {
      if (hidden.indexOf(it.id) >= 0) continue;
      if (it.deadline && it.deadline.ms > 0) entries.push({ it, kind: 'deadline', at: it.deadline.at });
      const s = it.eventStart ? Radar.parse(it.eventStart, true) : null;
      if (s && s >= nowD) entries.push({ it, kind: 'event', at: s });
    }
    entries.sort((a, b) => a.at - b.at);

    const byDay = {};
    for (const e of entries) {
      const k = e.at.getFullYear() + '-' + String(e.at.getMonth() + 1).padStart(2, '0') + '-' + String(e.at.getDate()).padStart(2, '0');
      (byDay[k] = byDay[k] || []).push(e);
    }
    const days = Object.keys(byDay).sort();
    const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const dayLabel = (d) => {
      const diff = Radar.daysBetween(nowD, d);
      if (diff === 0) return '今天';
      if (diff === 1) return '明天';
      if (diff === 2) return '后天';
      return WEEK[d.getDay()];
    };
    const missed = App.visible(profile, false).filter((it) => ['ended', 'closed'].indexOf(it.status.key) >= 0);

    return '<div class="view">' +
      pagehead(['Timeline', '报名截止 / 活动开始'],
        '接下来<em>发生的事</em>',
        '把「报名截止」和「活动开始」放在同一条线上 —— 这两件事经常差得比你以为的远。只显示你符合条件的内容。',
        '<b>' + App.idx(entries.length) + '</b><br>个节点') +

      '<div class="btn-row" style="margin:20px 0"><button class="btn" type="button" data-action="export-ics">导出 .ics 日历</button>' +
        '<span class="label">报名截止会带「提前一天」提醒</span></div>' +

      (days.length
        ? '<div>' + days.map((k) => {
            const d = Radar.parse(k + ' 08:00', false);
            return '<div class="tl-day">' +
              '<div class="tl-day__head">' +
                '<span class="tl-day__date">' + (d.getMonth() + 1) + ' / ' + d.getDate() + '</span>' +
                '<span class="tl-day__week">' + dayLabel(d) + '</span>' +
              '</div>' +
              '<div class="tl-day__body">' + byDay[k].map((e) =>
                '<a class="tl-item tl-item--' + e.kind + '" href="#/item/' + esc(e.it.id) + '">' +
                  '<span class="tl-item__time">' + hhmm(e.at) + '</span>' +
                  '<span class="tl-item__kind">' + (e.kind === 'deadline' ? '报名截止' : '活动开始') + '</span>' +
                  '<span class="tl-item__title">' + esc(e.it.title) + '</span>' +
                  '<span class="tl-item__where">' + esc(e.it.where.text) + '</span>' +
                '</a>').join('') + '</div>' +
            '</div>';
          }).join('') + '</div>'
        : '<div class="empty"><strong>接下来没有已确定时间的安排</strong><p>长期开放或时间未注明的信息，请到「索引」里看。</p></div>') +

      (missed.length
        ? '<section class="slab">' +
          sectionHead('已错过的 ' + missed.length + ' 条', '列出来是为了知道下一次什么时候看') +
          '<div class="grid">' + missed.map((it, i) => App.card(it, i)).join('') + '</div>' +
          '</section>'
        : '') +
    '</div>';
  }

  /* ======================= 4. 详情 ======================= */

  function facts(it) {
    const rows = [
      ['活动时间', it.eventStart ? Radar.fmtDT(it.eventStart) + (it.eventEnd ? ' — ' + Radar.fmtDT(it.eventEnd) : '') : ''],
      ['周期安排', it.recurring],
      ['报名截止', it.signupBy ? Radar.fmtDT(it.signupBy) : ''],
      ['活动地点', it.eventWhere],
      ['面向对象', it.audience],
      ['名额', it.capacity],
      ['时间投入', it.effort],
      ['费用', it.fee],
      ['报名方式', it.applyHow],
      ['发布方', it.publisher]
    ];
    return '<section class="slab">' +
      sectionHead('材料给出的条件', '未列出的项目表示材料未提供，产品不做补全') +
      '<div class="dl">' + rows.map(([k, v]) =>
        '<dt>' + esc(k) + '</dt><dd' + (v ? '' : ' class="empty"') + '>' + esc(v || '未注明') + '</dd>').join('') + '</div>' +
      (it.tags && it.tags.length
        ? '<div class="row__tags" style="margin-top:16px">' + it.tags.map((t) => '<span class="label">' + esc(t) + '</span>').join('') + '</div>'
        : '') +
    '</section>';
  }

  function fitPanel(it) {
    const f = it.fit;
    const p = Store.profile();
    const gradeCn = { 1: '大一', 2: '大二', 3: '大三', 4: '大四' }[p.grade] || '大一';
    return '<div class="slab fit fit--' + f.level + '">' +
      '<div class="fit__verdict">' + esc(f.label) + '</div>' +
      '<p class="label" style="margin-top:8px">按你的情况：' + esc(gradeCn) + ' · 每周约 ' + p.hours + ' 小时' +
        '　·　<a href="#/mine" style="color:var(--accent)">改我的情况</a></p>' +
      (f.blocks.length ? '<ul class="fit__list fit__list--block">' + f.blocks.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '') +
      (f.reasons.length ? '<ul class="fit__list">' + f.reasons.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '') +
      (!f.blocks.length && !f.reasons.length ? '<p class="muted" style="margin-top:10px">没有发现这条信息与你的情况冲突的条件。</p>' : '') +
    '</div>';
  }

  function timelineOf(it) {
    if (!it.updates || !it.updates.length) return '';
    const g = it.group;
    const fact = (x) => [x.eventStart ? '时间 ' + Radar.fmtDT(x.eventStart) : '',
      x.eventWhere ? '地点 ' + x.eventWhere : '',
      x.signupBy ? '报名截止 ' + Radar.fmtDT(x.signupBy) : ''].filter(Boolean).join('　·　') || '材料未给出时间地点';
    const rows = [{ tag: '原始通知', title: it.title, body: fact(it) }]
      .concat(it.updates.map((u) => ({ tag: '后续通知', title: u.title, body: fact(u) })));
    return '<section class="slab">' +
      sectionHead('这件事被通知了 ' + rows.length + ' 次', '以最新一条为准') +
      '<div class="timeline">' + rows.map((r, i) =>
        '<div class="tstep' + (i === rows.length - 1 ? ' tstep--last' : '') + '">' +
          '<div class="tstep__tag">' + esc(r.tag) + '</div>' +
          '<div><div class="tstep__title">' + esc(r.title) + '</div>' +
          '<div class="tstep__body">' + esc(r.body) + '</div></div>' +
        '</div>').join('') + '</div>' +
      (g ? '<div class="verdict"><b>' + esc(g.kind) + '：</b>' + esc(g.detail) + '</div>' : '') +
    '</section>';
  }

  function detail(id) {
    const it = Radar.find(id, Store.profile(), App.now.value());
    if (!it) return missing();
    if (it.isUpdateNotice) {
      return '<div class="view"><div class="empty">' +
        '<strong>这是一条补充通知，内容已并入主条目</strong>' +
        '<p>单独看它容易断章取义，我们把它合并到了主条目里一起呈现。</p>' +
        '<div class="btn-row" style="justify-content:center;margin-top:16px">' +
        '<a class="btn btn--solid" href="#/item/' + esc(it.mainId) + '">去看合并后的主条目</a></div></div></div>';
    }

    const tab = App.getTab();
    const saved = Store.has('saved', it.id);
    const joined = Store.has('joined', it.id);

    let body;
    if (tab === 'fit') {
      body = '<div class="grid" style="grid-template-columns:minmax(0,1fr)">' + fitPanel(it) +
        '<section class="slab">' + sectionHead('材料里没写、需要向主办方确认的项', it.unconfirmed.length + ' 项') +
          (it.unconfirmed.length
            ? '<ul class="list-plain">' + it.unconfirmed.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>'
            : '<p class="muted">这几项上材料的信息是完整的。</p>') +
          '<p class="label" style="margin-top:12px">材料没写的一律显示「未注明」，不补全、不猜</p>' +
        '</section>';
    } else if (tab === 'raw') {
      body = '<div class="grid" style="grid-template-columns:minmax(0,1fr)"><section class="slab">' +
        sectionHead('材料原文关键信息', '不做改写') +
        '<div class="dl">' +
          '<dt>材料编号</dt><dd>第 ' + App.idx(it.seq) + ' 条</dd>' +
          '<dt>信息来源口径</dt><dd>' + esc(it.updatedAt) + '</dd>' +
          '<dt>发布方</dt><dd' + (it.publisher ? '' : ' class="empty"') + '>' + esc(it.publisher || '未注明') + '</dd>' +
          '<dt>面向对象</dt><dd>' + esc(it.audience) + '</dd>' +
          '<dt>报名截止</dt><dd' + (it.signupBy ? '' : ' class="empty"') + '>' + (it.signupBy ? esc(Radar.fmtDT(it.signupBy)) : '未注明') + '</dd>' +
          '<dt>活动时间</dt><dd' + (it.eventStart ? '' : ' class="empty"') + '>' + (it.eventStart ? esc(Radar.fmtDT(it.eventStart)) : '未注明') + '</dd>' +
          '<dt>周期安排</dt><dd' + (it.recurring ? '' : ' class="empty"') + '>' + esc(it.recurring || '未注明') + '</dd>' +
          '<dt>地点</dt><dd' + (it.eventWhere ? '' : ' class="empty"') + '>' + esc(it.eventWhere || '未注明') + '</dd>' +
          '<dt>名额</dt><dd' + (it.capacity ? '' : ' class="empty"') + '>' + esc(it.capacity || '未注明') + '</dd>' +
          '<dt>时间投入</dt><dd' + (it.effort ? '' : ' class="empty"') + '>' + esc(it.effort || '未注明') + '</dd>' +
          '<dt>费用</dt><dd' + (it.fee ? '' : ' class="empty"') + '>' + esc(it.fee || '未注明') + '</dd>' +
          '<dt>报名方式</dt><dd>' + esc(it.applyHow) + '</dd>' +
        '</div>' +
        '<p class="label" style="margin-top:14px">以上为材料实际写出的内容；未提供的项目显示「未注明」，没有做任何补全</p>' +
      '</section>' +
      (it.trust.flags.length
        ? '<section class="slab">' + sectionHead('这条被标为「' + it.trust.label + '」的原因') +
          '<ul class="list-plain">' + it.trust.flags.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>' +
          '<p class="muted" style="margin-top:12px;font-size:13.5px">这不代表它一定有问题，但它在校园活动应有的信息上缺口较大，请自行判断并向发布者核实。</p>' +
          '</section>'
        : '') + '</div>';
    } else {
      body = fitPanel(it) + facts(it) +
        (it.unconfirmed.length
          ? '<div class="slab notice notice--info"><div><div class="notice__title">材料里还有 ' + it.unconfirmed.length + ' 项没写</div>' +
            it.unconfirmed.map((u) => '<div class="notice__item">' + esc(u) + '</div>').join('') + '</div></div>'
          : '') + '</div>';
    }

    return '<div class="view">' +
      '<p class="label" style="padding:4px 2px"><a href="#/list">← 返回索引</a></p>' +

      '<div class="grid" style="grid-template-columns:minmax(0,1fr);gap:11px">' +
      '<header class="slab detail-head">' +
        '<div class="detail-head__top">' +
          '<span class="label">第 ' + App.idx(it.seq) + ' 条</span>' +
          App.statusMark(it) +
          (it.deadline ? App.deadlineMark(it) : '') +
          App.sourceMark(it) +
          '<span class="mark mark--muted">' + esc(it.cat) + '</span>' +
          App.trustMark(it) +
          (it.updates && it.updates.length ? '<span class="mark mark--accent">有 ' + it.updates.length + ' 条补充通知</span>' : '') +
        '</div>' +
        '<h1>' + esc(it.title) + '</h1>' +
        '<div class="detail-head__acts">' +
          '<button class="btn' + (saved ? ' btn--solid' : '') + '" type="button" data-action="save" data-id="' + esc(it.id) + '">' +
            (saved ? '★ 已收藏' : '☆ 收藏') + '</button>' +
          '<button class="btn' + (joined ? ' btn--solid' : '') + '" type="button" data-action="join" data-id="' + esc(it.id) + '">' +
            (joined ? '✓ 已标记报名' : '标记已报名') + '</button>' +
          '<button class="btn" type="button" data-action="copy-link">复制链接</button>' +
          '<button class="btn" type="button" data-action="hide" data-id="' + esc(it.id) + '">不感兴趣</button>' +
        '</div>' +
      '</header>' +

      '<div class="factbar">' +
        '<div><dt>活动时间</dt><dd>' + esc(it.when.when || '未注明') + '</dd></div>' +
        '<div><dt>报名截止</dt><dd>' + (it.deadline ? esc(it.deadline.text) + '（' + esc(it.deadline.label) + '）' : '未注明') + '</dd></div>' +
        '<div><dt>地点</dt><dd>' + esc(it.where.text) + '</dd></div>' +
        '<div><dt>投入 / 名额</dt><dd>' + esc(it.effort || it.capacity || '未注明') + '</dd></div>' +
      '</div>' +

      '<nav class="tabs">' +
        [['brief', '这是什么'], ['fit', '我能不能参加'], ['raw', '原文信息']].map(([k, l]) =>
          '<button class="tab' + (tab === k ? ' is-on' : '') + '" type="button" data-action="tab" data-tab="' + k + '">' + esc(l) + '</button>').join('') +
      '</nav>' +

      body + timelineOf(it) + '</div>' +

      (it.downgraded
        ? '<section class="slab">' + sectionHead('这条被降权显示') +
          '<p class="muted" style="font-size:14px">它来自开放发布，但带有明显的推广特征，因此默认不出现在索引里。你仍然能看到它，也可以举报。</p>' +
          '<div class="btn-row" style="margin-top:14px">' +
            '<button class="btn btn--accent" type="button" data-action="report" data-id="' + esc(it.id) + '">举报这条内容</button>' +
            '<span class="label">已举报 ' + Store.reportCount(it.id) + ' 次（累计 3 次自动降权）</span>' +
          '</div>' +
          '</section>'
        : '') +
    '</div>';
  }

  function missing() {
    return '<div class="view"><div class="empty" style="margin-top:40px">' +
      '<strong>这条信息不存在</strong><p>可能是链接不完整，或这条内容已经被删除。</p>' +
      '<div class="btn-row" style="justify-content:center;margin-top:16px"><a class="btn btn--solid" href="#/list">回到索引</a></div></div></div>';
  }

  /* ======================= 5. 发布 ======================= */

  function gate(msg) {
    const isDefault = Store.adminPassIsDefault();
    return '<div class="view">' +
      pagehead(['Restricted', '需要管理员口令'], '发布<em>入口</em>',
        '发布入口默认隐藏 —— 开放发布容易让同学被无关的商业信息刷屏，所以把发布权限收起来，只给管理员使用。') +
      (msg ? '<div class="slab notice notice--warn"><div class="notice__title">' + esc(msg) + '</div></div>' : '') +
      '<form id="adminForm" style="max-width:420px;margin-top:20px">' +
        '<div class="field"><label class="field__label" for="adminPass">管理员口令</label>' +
          '<input type="password" id="adminPass" name="pass" autocomplete="current-password" placeholder="请输入管理员口令">' +
          '<span class="field__hint">' + (isDefault ? '初始口令 radar2026，登录后可在「我的」里修改' : '口令已由管理员修改过') + '</span>' +
        '</div>' +
        '<div class="btn-row" style="margin-top:18px">' +
          '<button class="btn btn--solid" type="submit">验证并进入</button>' +
          '<a class="btn" href="#/">返回</a>' +
        '</div>' +
        '<p class="label" style="margin-top:18px;line-height:1.7">这一层是<b>本机口令</b>：纯静态站点没有服务端，' +
          '口令与内容都保存在你自己的浏览器里，能挡住随口发布与误触，但不是真正的安全边界</p>' +
      '</form>' +
    '</div>';
  }

  function publish() {
    if (!Store.adminUnlocked()) {
      const m = App.getPublishError();
      App.setPublishError('');
      return gate(m);
    }
    const TPL = { sport: '周末约球', study: '找学习搭子', team: '组队招人', event: '兴趣活动' };
    const field = (label, control, hint) =>
      '<div class="field"><label class="field__label">' + esc(label) + '</label>' + control +
      (hint ? '<span class="field__hint">' + esc(hint) + '</span>' : '') + '</div>';

    return '<div class="view">' +
      pagehead(['Compose', '管理员已解锁'], '发布<em>我的信息</em>',
        '约球、找搭子、组队、兴趣活动都可以发。发布后会立刻进入索引与时间轴，和其他信息一起被搜索、筛选到。') +

      '<div class="toolbar" style="margin-top:20px"><div class="toolbar__group">' +
        '<span class="label" style="min-width:52px">模板</span>' +
        Object.keys(TPL).map((k) => '<button class="tag" type="button" data-action="quick-publish" data-tpl="' + k + '">' + esc(TPL[k]) + '</button>').join('') +
      '</div></div>' +

      '<form id="publishForm" novalidate style="margin-top:24px">' +
        '<div class="form-grid">' +
          field('活动名称 *', '<input type="text" name="title" placeholder="例如：周末羽毛球约球（6—8 人）">') +
          field('类别', '<select name="cat">' + ['文体兴趣', '项目组队', '学习资源', '志愿公益', '竞赛科研'].map((c) => '<option>' + c + '</option>').join('') + '</select>') +
          field('类型', '<input type="text" name="type" value="约球 / 约运动">') +
        '</div>' +

        '<h3 class="sub-title">时间</h3>' +
        '<div class="form-grid">' +
          field('活动时间', '<input type="datetime-local" name="eventStart">', '不确定就留空，并在右边写清大致时间') +
          field('时间还没定？写成文字', '<input type="text" name="whatIf" placeholder="例如：这周六下午，具体看大家时间">') +
          field('报名截止', '<input type="datetime-local" name="signupBy">', '填了之后会显示"还剩 X 天"并进入时间轴') +
        '</div>' +

        '<h3 class="sub-title">地点与参与</h3>' +
        '<div class="form-grid">' +
          field('地点', '<input type="text" name="eventWhere" placeholder="例如：风雨球场 3 号场">') +
          field('人数 / 名额', '<input type="text" name="capacity" placeholder="例如：6—8 人 / 限 20 人">') +
          field('时间投入', '<input type="text" name="effort" placeholder="例如：每周 2 小时，持续 4 周">') +
          field('参与方式', '<input type="text" name="applyHow" placeholder="例如：报名后拉群 / 直接到场">') +
          field('联系方式 *', '<input type="text" name="contact" placeholder="微信号 / 手机 / QQ">') +
          field('标签（逗号分隔）', '<input type="text" name="tags" placeholder="羽毛球, 周末, 零基础友好">') +
        '</div>' +

        '<div class="field" style="margin-top:16px"><label class="field__label">地点状态</label>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:14px">' +
            '<input type="checkbox" name="whereConfirmed" checked style="width:auto"> 地点已确定</label>' +
          '<span class="field__hint">取消勾选会显示为「地点待确认」——这比编一个假地点更负责</span>' +
        '</div>' +

        '<div class="field" style="margin-top:16px"><label class="field__label">必须知道的条件（每行一条）</label>' +
          '<textarea name="mustKnow" rows="3" placeholder="自带球拍&#10;迟到 15 分钟以上视为放弃"></textarea>' +
        '</div>' +

        '<div class="btn-row" style="margin-top:22px">' +
          '<button class="btn btn--solid" type="submit">发布</button>' +
          '<a class="btn" href="#/list">取消</a>' +
          '<button class="btn" type="button" data-action="admin-logout">退出发布权限</button>' +
        '</div>' +
      '</form>' +

      '<div id="publishPreview" style="margin-top:26px">' + preview() + '</div>' +
    '</div>';
  }

  const CHECKS = [
    ['title', '活动名称', '同学看到的第一眼'],
    ['when', '具体时间', '没填会显示「时间未注明」'],
    ['where', '具体地点', '不确定可勾选"待确认"'],
    ['capacity', '人数 / 名额', '约球、组队尤其需要'],
    ['how', '参与方式', '怎么报名、加不加群'],
    ['contact', '联系方式', '不填同学没办法找到你']
  ];

  function preview() {
    const f = document.getElementById('publishForm');
    if (!f) return '';
    const v = (n) => (f.elements[n] ? String(f.elements[n].value || '').trim() : '');
    const has = {
      title: !!v('title'),
      when: !!v('eventStart') || !!v('whatIf'),
      where: !!v('eventWhere') || !(f.elements.whereConfirmed && f.elements.whereConfirmed.checked),
      capacity: !!v('capacity') || !!v('effort'),
      how: !!v('applyHow'),
      contact: !!v('contact')
    };
    const done = CHECKS.filter(([k]) => has[k]).length;
    const pct = Math.round((done / CHECKS.length) * 100);
    const flags = [];
    if (/微信|vx|v信|加我/i.test(v('contact') + v('applyHow'))) flags.push('只留私人联系方式而不说明主办方与内容，是低可信信息的典型特征');
    if (/日结|零门槛|返利|兼职/i.test(v('title'))) flags.push('标题出现"日结 / 零门槛 / 兼职"等词，容易被判为疑似推广而降权');
    if (/http|www\.|链接|扫码/i.test(v('title') + v('mustKnow'))) flags.push('正文带有购买链接或二维码引导，会被降权');

    return '<section class="slab">' +
      sectionHead('发布前自检', '信息完整度 ' + pct + '%', '<span class="label">' + done + ' / ' + CHECKS.length + '</span>') +
      '<div class="dl">' + CHECKS.map(([k, label, hint]) =>
        '<dt>' + (has[k] ? '✓ ' : '○ ') + esc(label) + '</dt><dd>' + esc(hint) + '</dd>').join('') + '</div>' +
      (flags.length
        ? '<div class="notice notice--warn" style="margin-bottom:0"><div><div class="notice__title">可能被判为疑似推广</div>' +
          flags.map((x) => '<div class="notice__item">' + esc(x) + '</div>').join('') +
          '<div class="notice__item label">出现 2 项以上会降权：内容仍可通过链接访问，但默认不进入索引</div></div></div>'
        : '') +
    '</section>';
  }

  function refreshPreview() {
    const box = document.getElementById('publishPreview');
    if (box) box.innerHTML = preview();
  }

  function applyTemplate(k) {
    const T = { sport: '周末约球', study: '找一起自习的搭子', team: '项目组队招募', event: '兴趣活动' }[k];
    const f = document.getElementById('publishForm');
    if (!T || !f) return;
    f.elements.title.value = T;
    f.elements.cat.value = k === 'team' ? '项目组队' : '文体兴趣';
    f.elements.type.value = { sport: '约球 / 约运动', study: '学习搭子', team: '组队 / 招人', event: '兴趣活动' }[k];
    f.elements.applyHow.value = k === 'team' ? '提交简短自我介绍' : '报名后拉群';
    refreshPreview();
    f.elements.title.focus();
    App.toast('已套用模板，改成你的实际情况再发布');
  }

  /* ======================= 6. 我的 ======================= */

  function gradeLabel(g) { return { 1: '大一', 2: '大二', 3: '大三', 4: '大四' }[g] || '大一'; }

  function mine() {
    const p = Store.profile();
    const a = Store.actions();
    const all = App.visible(p, true);
    const pick = (ids) => ids.map((id) => all.find((it) => it.id === id)).filter(Boolean);
    const saved = pick(a.saved);
    const joined = pick(a.joined);
    const hidden = pick(a.hidden);
    const mineItems = all.filter((it) => it.userPublished);
    const sec = App.parseHash().query.sec || '';

    const missed = joined.filter((it) => it.deadline && it.deadline.ms <= 0);
    const urgent = joined.filter((it) => it.deadline && it.deadline.ms > 0 && it.deadline.days <= 3);

    const T = [
      ['saved', '我收藏的', saved, '在条目或详情页点「☆ 收藏」，之后就能在这里统一查看'],
      ['joined', '我标记报名的', joined, '点「标记已报名」记录打算参加的活动，截止前 3 天会在这里提示'],
      ['mine', '我发布的', mineItems, Store.adminUnlocked() ? '点「发布」发一条约球或找搭子信息' : '发布入口需要管理员口令，见下方「发布权限」'],
      ['hidden', '已忽略的', hidden, '在「索引」里点「不感兴趣」，被忽略的内容会收在这里，随时可恢复']
    ];

    const tiles = '<div class="statbar">' + T.map(([k, label, list]) =>
      '<a class="stat' + (sec === k ? ' is-open' : '') + '" href="#/mine' + (sec === k ? '' : '?sec=' + k) + '">' +
        '<div class="stat__label">' + esc(label) + '</div>' +
        '<div class="stat__value">' + App.idx(list.length) + '</div>' +
        '<div class="stat__hint">' + (sec === k ? '▲ 收起' : '▼ 点开展开') + '</div>' +
      '</a>').join('') + '</div>';

    const cur = T.find((t) => t[0] === sec);
    let panel = '';
    if (cur) {
      const [k, label, list, emptyMsg] = cur;
      panel = '<section class="slab">' +
        sectionHead(label + '（' + list.length + '）', '', '<a class="btn btn--sm" href="#/mine">收起</a>') +
        (list.length
          ? '<div class="directory">' + list.map((it, i) =>
              App.dirrow(it, i, { showGaps: k === 'mine' }) +
              '<div class="btn-row" style="padding:0 0 14px 68px;margin-top:-10px">' +
                '<a class="btn btn--sm" href="#/item/' + esc(it.id) + '">查看</a>' +
                '<button class="btn btn--sm" type="button" data-action="' +
                  (k === 'mine' ? 'delete-mine' : 'toggle-' + k) + '" data-id="' + esc(it.id) + '">' +
                  (k === 'mine' ? '删除' : (k === 'hidden' ? '恢复显示' : (k === 'saved' ? '取消收藏' : '取消报名标记'))) +
                '</button>' +
                (k === 'mine' && it.contact ? '<span class="label">联系方式 ' + esc(it.contact) + '</span>' : '') +
              '</div>').join('') + '</div>'
          : '<div class="empty"><strong>这里还是空的</strong><p>' + esc(emptyMsg) + '</p></div>') +
      '</section>';
    }

    return '<div class="view">' +
      pagehead(['Mine', '本机数据'], '我的<em>记录</em>',
        '收藏、报名标记、我发布的内容，以及决定「适合你」的判断依据。所有数据只存在这台设备上。',
        '<b>' + App.idx(saved.length + joined.length + mineItems.length) + '</b><br>条标记') +

      (missed.length
        ? '<div class="slab notice notice--warn"><div><div class="notice__title">你标记过报名，但已经错过截止时间</div>' +
          missed.map((it) => '<div class="notice__item"><a href="#/item/' + esc(it.id) + '">' + esc(it.title) + '</a>' +
            '<span class="label">' + esc(it.deadline ? it.deadline.text : '') + ' 截止</span></div>').join('') + '</div></div>'
        : '') +
      (urgent.length
        ? '<div class="slab notice notice--info"><div><div class="notice__title">3 天内会有截止</div>' +
          urgent.map((it) => '<div class="notice__item"><a href="#/item/' + esc(it.id) + '">' + esc(it.title) + '</a>' +
            '<span class="label">' + esc(it.deadline.label) + ' · ' + esc(it.deadline.text) + '</span></div>').join('') + '</div></div>'
        : '') +

      tiles +
      panel +

      '<section class="slab">' +
        sectionHead('我的情况', '决定「适合你」的判断') +
        '<form id="profileForm">' +
          '<div class="form-grid">' +
            '<div class="field"><label class="field__label">昵称（发布时署名）</label>' +
              '<input type="text" name="nickname" value="' + esc(p.nickname) + '" placeholder="例如：小明"></div>' +
            '<div class="field"><label class="field__label">年级</label><select name="grade">' +
              [1, 2, 3, 4].map((g) => '<option value="' + g + '"' + (p.grade === g ? ' selected' : '') + '>' + gradeLabel(g) + '</option>').join('') +
            '</select></div>' +
            '<div class="field"><label class="field__label">每周可投入时间（小时）</label>' +
              '<input type="number" name="hours" min="0" max="60" value="' + p.hours + '"></div>' +
          '</div>' +
          '<div class="field" style="margin-top:16px"><label class="field__label">感兴趣的方向</label>' +
            '<div class="row__tags">' + Radar.INTERESTS.map((g) =>
              '<label class="tag" style="cursor:pointer"><input type="checkbox" name="interests" value="' + g.key + '"' +
              (p.interests.indexOf(g.key) >= 0 ? ' checked' : '') + ' style="width:auto;margin-right:6px">' + esc(g.label) + '</label>').join('') +
            '</div>' +
          '</div>' +
          '<div class="btn-row" style="margin-top:18px"><button class="btn btn--solid" type="submit">保存</button></div>' +
        '</form>' +
        '<p class="label" style="margin-top:14px;line-height:1.7">改这里会立刻影响「适合你 / 需先确认 / 暂不符合」的判断。' +
          '例如把年级设为大一，科研助理招募（限大二及以上）就会直接标为「暂不符合」</p>' +
      '</section>' +

      adminBlock() +

      '<section class="slab">' +
        sectionHead('数据管理', '数据存在本机浏览器，刷新不丢') +
        '<div class="btn-row">' +
          '<button class="btn" type="button" data-action="export-json">导出备份 JSON</button>' +
          '<button class="btn" type="button" data-action="import-trigger">导入备份</button>' +
          '<input id="importFile" type="file" accept="application/json,.json" hidden>' +
          '<button class="btn btn--accent" type="button" data-action="reset-mine">清空我的数据</button>' +
        '</div>' +
      '</section>' +
    '</div>';
  }

  function adminBlock() {
    const on = Store.adminUnlocked();
    if (!on) {
      return '<section class="slab">' +
        sectionHead('发布权限', '已锁定', '<a class="btn btn--sm" href="#/publish">输入口令</a>') +
        '<p class="muted" style="font-size:14px">发布入口默认隐藏：同学能浏览、收藏、标记报名，但发布需要管理员口令。</p>' +
      '</section>';
    }
    return '<section class="slab">' +
      sectionHead('发布权限', '管理员已解锁', '<button class="btn btn--sm" type="button" data-action="admin-logout">退出</button>') +
      '<form id="adminPassForm" style="margin-top:8px">' +
        '<div class="form-grid">' +
          '<div class="field"><label class="field__label">当前口令</label><input type="password" name="cur" autocomplete="current-password"></div>' +
          '<div class="field"><label class="field__label">新口令</label><input type="password" name="next" autocomplete="new-password" placeholder="至少 4 位"></div>' +
          '<div class="field"><label class="field__label">再输一次</label><input type="password" name="again" autocomplete="new-password"></div>' +
        '</div>' +
        '<div class="btn-row" style="margin-top:14px"><button class="btn btn--solid" type="submit">保存新口令</button></div>' +
        (Store.adminPassIsDefault() ? '<p class="label" style="margin-top:12px">当前还是初始口令 radar2026，建议改掉</p>' : '') +
      '</form>' +
      '<p class="label" style="margin-top:14px;line-height:1.7">本机口令：纯静态站点没有服务端，口令与内容都保存在本机浏览器，' +
        '能挡住随口发布与误触，但不是真正的安全边界</p>' +
    '</section>';
  }

  /* ======================= 状态钩子 ======================= */

  let tab = 'brief';
  let publishError = '';
  App.getTab = () => tab;
  App.setTab = (k) => { tab = k || 'brief'; };
  App.getPublishError = () => publishError;
  App.setPublishError = (m) => { publishError = m || ''; };

  App.Views = { today, list, calendar, detail, publish, mine, missing, region, refreshList, refreshPreview, applyTemplate };

  App.Views.afterRender = function (route) {
    if (route === 'list') {
      const sel = document.getElementById('sortSel');
      if (sel) sel.value = App.parseHash().query.sort || 'deadline';
    }
    if (route === 'publish') refreshPreview();
  };
})();
