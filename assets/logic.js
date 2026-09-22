'use strict';

/* ==========================================================================
   校园雷达 · 逻辑层
   --------------------------------------------------------------------------
   这里做三件"如果只靠肉眼就要算很久"的事：

   1. 状态判定 —— 把材料里各种时间口径（报名截止 / 活动开始 / 长期开放 /
      报名时间未注明）翻译成"现在到底能不能参加"。
   2. 适配判定 —— 结合用户自己填的年级与每周可投入时间，提前算出
      "有没有硬性条件不满足"，避免新生读到一半才发现自己不符合。
   3. 可信度判定 —— 按信息完整度 + 推广信号，对开放发布的内容做分级，
      既不全盘封杀，也不让低信息量内容淹没主列表。
   ========================================================================== */

(function () {
  const DATA = window.CAMPUS_DATA;

  /* 数据视图：默认是材料里的 26 条；用户自己发布的内容由 Store.sync()
     追加进来，保证"发现"和"发布"看到的是同一份数据。 */
  function items() {
    return (window.Radar && Array.isArray(window.Radar.userItems)) ? window.Radar.userItems : DATA.items;
  }

  /* ======================= 时间工具 ======================= */

  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const pad = (n) => String(n).padStart(2, '0');

  /** 把 'YYYY-MM-DD HH:mm' 解析成 Date；没有时间的按当天 23:59 处理 */
  function parse(text, endOfDayIfBare) {
    if (!text) return null;
    const m = String(text).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, hh, mm] = m;
    const d2 = new Date(Number(y), Number(mo) - 1, Number(d), hh ? Number(hh) : (endOfDayIfBare ? 23 : 0), hh ? Number(mm) : (endOfDayIfBare ? 59 : 0), 0, 0);
    return Number.isNaN(d2.getTime()) ? null : d2;
  }

  /** 已过多少时间 / 还有多久的粗略文本 */
  function humanDelta(ms) {
    const abs = Math.abs(ms);
    const min = Math.round(abs / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟';
    const hour = Math.round(min / 60);
    if (hour < 24) return hour + ' 小时';
    const day = Math.round(hour / 24);
    if (day < 30) return day + ' 天';
    const mon = Math.round(day / 30);
    return mon + ' 个月';
  }

  function fmtDay(d) {
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function fmtDT(text) {
    const d = parse(text, true);
    if (!d) return '';
    const hasTime = /\d{2}:\d{2}/.test(String(text));
    return fmtDay(d) + (hasTime ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '');
  }

  /** 用于筛选分组的"日期键" */
  function dayKey(text) {
    const d = parse(text, true);
    return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : '';
  }

  function daysBetween(a, b) {
    const x = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const y = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((y - x) / 86400000);
  }

  /* ======================= 解析"未注明"的信息 ======================= */
  /* 材料里有很多"未确定/未注明"，要给用户一个可用的估计，同时明确标注为估计。 */

  function resolveWhen(it) {
    if (it.eventStart) {
      return {
        text: fmtDT(it.eventStart), iso: it.eventStart, guessed: false,
        when: it.eventEnd ? fmtDT(it.eventStart) + ' — ' + fmtDT(it.eventEnd) : fmtDT(it.eventStart)
      };
    }
    if (it.userPublished && it.recurring) {
      // 同学自己发布时写了大致时间（例如"这周六下午"），原样展示，不假装是确定时间
      return {
        text: it.recurring + '（发布者写的大致时间）', iso: '', guessed: true,
        when: it.recurring + '（大致时间，未精确到点）',
        guessNote: '发布者只写了大致时间："' + it.recurring + '"，具体安排请他确认。'
      };
    }
    /* 材料写了大致时段（如"拟于 9 月 21 日晚开展，具体时间未确定"）时，
       原样展示这句话，不换算成具体钟点；界面会标注"未确定"。 */
    if (it.recurring && /\d+\s*月\s*\d+\s*日/.test(it.recurring)) {
      const head = it.recurring.split(/[，,；;]/)[0];
      return {
        text: head, iso: '', guessed: true,
        when: head,
        guessNote: '材料原文："' + head + '"，没有给到具体钟点，因此不参与时间轴的钟点排序。'
      };
    }
    return { text: '时间未注明', iso: '', guessed: false, when: '' };
  }

  function resolveWhere(it) {
    if (it.eventWhere) return { text: it.eventWhere, guessed: false };
    return { text: '地点未注明', guessed: false };
  }

  /* ======================= 可信度与信息完整度 ======================= */

  const CHECK_LABELS = {
    publisher: '主办方',
    when: '活动时间',
    where: '地点',
    capacity: '名额 / 参与人数',
    how: '报名或参与方式'
  };

  function trustOf(it) {
    const hasPublisher = !!(it.publisher && it.publisher.indexOf('未注明') === -1);
    const hasHow = !!(it.applyHow && it.applyHow.indexOf('未注明是否需要报名') === -1 && it.applyHow.indexOf('材料未注明') === -1);
    const hasWhen = !!(it.eventStart || it.eventPattern === 'rolling');
    const hasWhere = !!it.eventWhere;
    const hasCap = !!(it.capacity || it.effort);

    const present = [];
    const missing = [];
    const checks = [
      ['publisher', hasPublisher],
      ['when', hasWhen],
      ['where', hasWhere],
      ['capacity', hasCap],
      ['how', hasHow]
    ];
    for (const [k, ok] of checks) (ok ? present : missing).push(k);

    const flags = it.redFlags || [];
    let level;
    if (flags.length >= 2) level = 'promo';
    else if (flags.length === 1) level = 'caution';
    else if (missing.length === 0) level = 'verified';
    else if (missing.length <= 2) level = 'ok';
    else level = 'thin';

    const LEVEL = {
      promo: { label: '疑似推广', tone: 'danger', weight: 0, note: '带有明显推广特征，默认不出现在机会列表中' },
      caution: { label: '信息存疑', tone: 'warn', weight: 1, note: '存在需要留意的信息缺口' },
      verified: { label: '信息完整', tone: 'ok', weight: 4, note: '关键信息齐全' },
      ok: { label: '信息基本可用', tone: 'ok', weight: 3, note: '缺少部分次要信息' },
      thin: { label: '信息较少', tone: 'warn', weight: 2, note: '缺少多项关键信息，建议先向发布者确认' }
    }[level];

    return {
      level, label: LEVEL.label, tone: LEVEL.tone, weight: LEVEL.weight, note: LEVEL.note,
      present, missing, flags,
      missingText: missing.map((k) => CHECK_LABELS[k]).join('、'),
      score: present.length,
      total: checks.length
    };
  }

  /** 发布者视角：这条内容还差什么才算"信息完整" */
  function publishGaps(item) {
    const t = trustOf(item);
    return t.missing.map((k) => CHECK_LABELS[k]);
  }

  /* ======================= 状态判定 ======================= */

  /**
   * 把一条信息翻译成"现在能不能参加"。
   * 返回 { key, label, tone, note, blocking, action }
   */
  /* 材料只有部分条目写了结束时间。没写结束时间的，不替它编一个时长 ——
     只用"开始时间是否已经过去"来判断，并在文案里说明"结束时间材料未注明"。 */
  function statusOf(it, now) {
    const signup = parse(it.signupBy, true);
    const start = parse(it.eventStart, true);
    const end = parse(it.eventEnd, true);

    // 1) 活动已经彻底结束
    if (end && end < now) {
      return {
        key: 'ended', label: '已结束', tone: 'muted', blocking: false, sort: 90,
        note: it.id === '04'
          ? '直播已在 9 月 18 日结束；回放预计 9 月 20 日发布，材料未提供入口。'
          : '活动时间已过。',
        action: it.id === '04' ? '等 9 月 20 日之后的回放' : ''
      };
    }
    if (start && start < now && end && end >= now) {
      return {
        key: 'ongoing', label: '进行中', tone: 'ok', blocking: false, sort: 5,
        note: '活动正在进行，现在还能赶上。', action: '现在就出发'
      };
    }
    /* 材料只给了开始时间、没给结束时间，而开始时间已经过去：
       既不能断定还在进行，也不能断定已结束 —— 如实说明。 */
    if (start && start < now && !end && it.eventPattern === 'single') {
      return {
        key: 'started', label: '已开始', tone: 'muted', blocking: false, sort: 45,
        note: '开始时间是 ' + fmtDT(it.eventStart) + '，材料未注明结束时间；'
          + (it.recurring ? it.recurring + '。' : '现在已经过了开始时间，是否还能参加需向主办方确认。'),
        action: '若要参加，先确认还能不能进'
      };
    }

    // 2) 报名已截止，但活动还没到
    if (signup && signup < now && (!start || start > now)) {
      const canWait = it.id === '19';
      return {
        key: 'closed', label: '报名已截止', tone: 'warn', blocking: true, sort: 40,
        note: canWait
          ? '原报名已在 9 月 18 日 22:00 截止；活动方说明如现场仍有余位可接受候补入场。'
          : '报名时间已过，无法再通过正常渠道报名。',
        action: canWait ? '想去就先确认现场是否还有余位' : '关注下一次机会'
      };
    }

    // 3) 报名开放中
    if (signup && signup >= now) {
      const gap = daysBetween(now, signup);
      return {
        key: 'open', label: '可报名', tone: gap <= 1 ? 'danger' : 'ok', blocking: false, sort: gap <= 1 ? 0 : 10,
        note: '', action: '去报名'
      };
    }

    // 4a) 活动今天就开始（还没到点）——单独一档，因为它最需要"现在决定去不去"
    if (start && start > now && daysBetween(now, start) === 0) {
      const noSignupNeeded = !!(it.applyHow && it.applyHow.indexOf('无需报名') === 0);
      return {
        key: 'upcoming', label: '就是今天', tone: 'danger', blocking: false, sort: 3,
        note: noSignupNeeded
          ? '无需报名，就在今天 ' + pad(start.getHours()) + ':' + pad(start.getMinutes()) + '，直接到场。'
          : '就在今天 ' + pad(start.getHours()) + ':' + pad(start.getMinutes()) + '，注意报名方式。',
        action: '安排今天的时间，别错过'
      };
    }

    // 4b) 没有报名截止时间，活动时间还没到
    if (start && start > now) {
      const noSignupNeeded = !!(it.applyHow && it.applyHow.indexOf('无需报名') === 0);
      if (noSignupNeeded) {
        const limited = !!(it.capacity || (it.capacity && it.capacity.indexOf('限') >= 0));
        return {
          key: 'upcoming', label: '无需报名', tone: 'ok', blocking: false, sort: 12,
          note: limited
            ? '无需报名，直接到场；但' + it.capacity + '，去晚了可能没位置。'
            : '无需报名，直接到场。',
          action: '记好时间到场'
        };
      }
      return {
        key: 'upcoming', label: '时间已定', tone: 'ok', blocking: false, sort: 14,
        note: '活动时间已经确定，但材料没有写报名截止时间；'
          + (it.capacity ? '名额口径：' + it.capacity + '。' : '先确认还能不能报名。'),
        action: '先问组织方还有没有名额'
      };
    }

    // 5) 系列 / 长期开放（有开始时间但没截止时间，且已经开始过的系列）
    if (it.eventPattern === 'series' || it.eventPattern === 'weekly' || it.eventPattern === 'biweekly') {
      return {
        key: 'upcoming', label: '系列活动中', tone: 'ok', blocking: false, sort: 16,
        note: '已经开过一轮，后续按期继续开展：' + (it.recurring || ''),
        action: '确认下一次的时间，中途加入通常也可以'
      };
    }

    // 6) 长期开放（材料明确写了"长期"）
    if (it.eventPattern === 'rolling' || it.id === '16' || it.id === '17' || it.id === '08') {
      return {
        key: 'rolling', label: '长期开放', tone: 'muted', blocking: false, sort: 30,
        note: it.id === '17'
          ? '资料长期开放；但当前网盘提取信息 9 月 22 日失效。'
          : '没有明确截止时间，满员即止或长期招人。',
        action: '尽快联系确认名额'
      };
    }

    if (!start && !signup) {
      return {
        key: 'unknown', label: '时间未注明', tone: 'warn', blocking: false, sort: 50,
        note: '材料未提供活动时间或报名截止时间。', action: '先向发布者确认'
      };
    }

    return { key: 'unknown', label: '待确认', tone: 'warn', blocking: false, sort: 50, note: '', action: '' };
  }

  /** 紧迫度：只对"有明确截止时间"的条目有意义 */
  function deadlineInfo(it, now) {
    const signup = parse(it.signupBy, true);
    if (!signup) return null;
    const ms = signup - now;
    const days = daysBetween(now, signup);
    let label, tone;
    if (ms < 0) { label = '已截止'; tone = 'muted'; }
    else if (ms < 6 * 3600 * 1000) { label = '今天截止'; tone = 'danger'; }
    else if (days === 0) { label = '今天截止'; tone = 'danger'; }
    else if (days === 1) { label = '明天截止'; tone = 'danger'; }
    else if (days <= 3) { label = days + ' 天后截止'; tone = 'warn'; }
    else { label = days + ' 天后截止'; tone = 'ok'; }
    return { at: signup, ms, days, label, tone, text: fmtDT(it.signupBy) };
  }

  /* ======================= 适配度（结合用户画像） ======================= */

  const INTERESTS = [
    { key: 'coding', label: '编程 / 算法', cats: ['学习资源', '项目组队'], kw: ['程序', '训练营', 'Web', '开发', 'Git', '软件', 'Python', '前端', '蓝桥'] },
    { key: 'ai', label: 'AI / 产品', cats: ['学习资源', '竞赛科研'], kw: ['AI', '产品', '创意'] },
    { key: 'research', label: '科研 / 竞赛', cats: ['竞赛科研'], kw: ['科研', '建模', '挑战赛', '助理', '竞赛'] },
    { key: 'volunteer', label: '志愿服务', cats: ['志愿公益'], kw: ['志愿', '公益', '摄影'] },
    { key: 'sports', label: '运动 / 社交', cats: ['文体兴趣'], kw: ['羽毛球', '约球', '交流', '语言角', '搭子'] }
  ];

  function interestMatch(it, interests) {
    if (!interests || !interests.length) return false;
    const hay = (it.title + ' ' + it.oneLine + ' ' + (it.tags || []).join(' ') + ' ' + it.cat).toLowerCase();
    return INTERESTS.some((g) => interests.indexOf(g.key) >= 0 &&
      (g.cats.indexOf(it.cat) >= 0 || g.kw.some((k) => hay.indexOf(k.toLowerCase()) >= 0)));
  }

  /**
   * 适配判定：明确给出"为什么适合 / 为什么不适合"。
   * 这是给新生用的核心能力 —— 先看硬条件，不满足就不必浪费时间。
   */
  function fitOf(it, profile, now) {
    const grade = Number(profile && profile.grade) || 1;
    const hours = Number(profile && profile.hours) || 0;
    const reasons = [];
    const blocks = [];
    let check = false;

    // 年级硬条件
    if (it.gradeMin && grade < it.gradeMin) {
      blocks.push('要求 ' + (it.gradeMin === 2 ? '大二及以上' : '大三及以上') + '，你现在是大' + '一二三四'[grade - 1] + '，暂时不符合');
    }
    if (it.gradeMax && grade > it.gradeMax) {
      blocks.push('面向大一、大二学生，你已超出年级范围');
    }
    if (it.id === '14' && grade > 1) {
      check = true;
      reasons.push('主要面向大一新生，你不在主要范围内，能否录取需看审核');
    }

    // 每周投入时间
    const needMatch = it.effort && it.effort.match(/每周[^0-9]*(\d+)\s*小时/);
    if (needMatch) {
      const need = Number(needMatch[1]);
      if (hours && hours < need) {
        blocks.push('要求每周投入 ' + need + ' 小时以上，你自评只有 ' + hours + ' 小时');
      } else if (hours) {
        reasons.push('每周投入 ' + need + ' 小时，在你自评的 ' + hours + ' 小时内，节奏可控');
      } else {
        check = true;
        reasons.push('需要每周稳定投入 ' + need + ' 小时以上，先确认自己有空');
      }
    }

    // 报名截止 / 状态
    const st = statusOf(it, now);
    if (st.key === 'closed') blocks.push('报名已截止，只能看候补或下一次');
    if (st.key === 'ended') blocks.push('活动已经结束');

    // 能力前置
    if (it.id === '08') {
      check = true;
      reasons.push('希望了解 Git 基本操作，可以先去第 14 条那个零基础工作坊补齐');
    }
    if (it.id === '06') {
      check = true;
      reasons.push('报名时间未注明、满员即止，需要尽快向组织方确认名额');
    }
    if (it.id === '12') reasons.push('个人即可参赛，不必先找队友；但费用未提供，报名前要确认');
    if (it.id === '15') reasons.push('可以先个人交创意，进展示环节后还能再组队，适合先起步');
    if (it.id === '16') reasons.push('有设备者优先但不是硬性要求，没有相机也能问');
    if (it.id === '07') reasons.push('需要自己找齐 2—4 人，先确认能找到队友再登记');

    // 兴趣方向
    if (interestMatch(it, profile && profile.interests)) {
      reasons.push('与你勾选的方向「' + (profile.interests || []).map((k) => (INTERESTS.find((g) => g.key === k) || {}).label).filter(Boolean).join('、') + '」相关');
    }

    const interestScore = interestMatch(it, profile && profile.interests) ? 1 : 0;
    let score = 0;
    if (!blocks.length) {
      score += 40;
      if (it.source === 'official') score += 6;
      score += trustOf(it).weight * 3;
      score += interestScore * 14;
      const d = deadlineInfo(it, now);
      if (d && d.ms > 0) {
        if (d.days <= 2) score += 16;
        else if (d.days <= 5) score += 10;
        else score += 5;
      } else if (st.key === 'upcoming' || st.key === 'ongoing') {
        score += 12;
      }
      score += reasons.length * 2;
    }
    if (blocks.length) score = Math.max(0, 20 - blocks.length * 8);
    if (st.key === 'ended') score = 0;

    const level = blocks.length ? 'blocked' : (check ? 'check' : 'ok');
    return {
      level, score: Math.min(100, score), reasons, blocks, check,
      label: level === 'blocked' ? '暂不符合' : (level === 'check' ? '需先确认' : '适合你')
    };
  }

  /* ======================= 关联通知 ======================= */

  function groupOf(id) {
    return (DATA.groups || []).find((g) => g.mainId === id || g.updateIds.indexOf(id) >= 0) || null;
  }

  function mainIdOf(id) {
    const g = groupOf(id);
    return g ? g.mainId : id;
  }

  /** 主条目身上挂了哪些后续通知 */
  function updatesOf(id) {
    const g = (DATA.groups || []).find((x) => x.mainId === id);
    if (!g) return [];
    return g.updateIds.map((uid) => items().find((it) => it.id === uid)).filter(Boolean);
  }

  /* ======================= 派生视图数据 ======================= */

  function decorate(it, profile, now) {
    const st = statusOf(it, now);
    const g = groupOf(it.id);
    return {
      ...it,
      /* 注意：不要覆盖 it.role —— 原始 role 决定这条是主条目还是后续通知 */
      isUpdateNotice: !!(g && g.updateIds.indexOf(it.id) >= 0),
      status: st,
      deadline: deadlineInfo(it, now),
      trust: trustOf(it),
      fit: fitOf(it, profile, now),
      when: resolveWhen(it),
      where: resolveWhere(it),
      updates: updatesOf(it.id),
      group: g,
      mainId: mainIdOf(it.id)
    };
  }

  function all(profile, now) {
    return items().filter((it) => it.role !== 'update').map((it) => decorate(it, profile, now));
  }

  function find(id, profile, now) {
    const raw = items().find((it) => it.id === id);
    if (!raw) return null;
    return decorate(raw, profile, now);
  }

  window.Radar = {
    DATA, INTERESTS,
    parse, fmtDay, fmtDT, dayKey, daysBetween, humanDelta,
    trustOf, statusOf, deadlineInfo, fitOf, publishGaps,
    groupOf, mainIdOf, updatesOf, decorate, all, find, items,
    CHECK_LABELS
  };
})();
