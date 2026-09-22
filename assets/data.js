'use strict';

/* ==========================================================================
   校园雷达 · 数据层
   --------------------------------------------------------------------------
   这里只放"事实"。每一条都来自考核材料，不补全材料没写的信息：
   材料里没写的地点、费用、截止时间，一律留空并在 unconfirmed 里声明，
   由界面如实呈现"信息未注明"，而不是自己编一个。
   --------------------------------------------------------------------------
   字段说明
     id            稳定标识（与材料编号一致，01~26）
     seq           材料编号
     title         标题
     cat           分类：学习资源 | 竞赛科研 | 志愿公益 | 文体兴趣 | 项目组队
     source        来源：official(学校/学院) | student(学生自主发布) | unclear(来源不明)
     publisher     发布方（材料明确写了才填）
     audience      面向对象原文口径
     gradeMin      最低年级要求（1=大一；null 表示材料未限制）
     signupBy      报名/登记截止时间
     eventStart    首次活动开始时间
     eventEnd      活动结束时间
     recurring     例训/系列安排说明
     eventWhere    地点
     fee           费用口径
     capacity      名额口径
     effort        时间投入口径
     applyHow      报名方式
     applyRisk     报名流程里容易误解的点
     oneLine       一句话说清"这是什么"
     gain          参加能得到什么
     mustKnow      必须先知道的条件
     actions       用户现在要做的具体动作（2~3 条，尽量可执行）
     unconfirmed   材料未写明、需要用户自行向主办方确认的信息
     redFlags      疑似推广/低可信信号（面向 24、25 这类内容）
     related       关联条目 id（同一件事的多条通知）
     role          'main' 主条目 | 'update' 后续通知（内容并入主条目，不单独占用列表）
     updatedAt     该条通知本身的发布时间口径
     tags          标签
   ========================================================================== */

window.CAMPUS_DATA = {
  productName: '校园雷达',
  tagline: '新生优先的校园机会导航台',
  storageKey: 'campus-radar-v2',
  build: '09-22 20:18',   // 构建标记：用来一眼确认页面（或缓存）里跑的是哪一版

  author: '应试作品',

  /* ============ 同一件事的多条通知：主条目 + 后续通知 ============ */
  groups: [
    {
      mainId: '01',
      updateIds: ['09'],
      kind: '时间地点变更',
      headline: '首次训练改到 9 月 21 日 19:30，地点改为实验楼 A402',
      detail: '第 09 条是第 01 条的补充通知：因场地调整，首次训练改到 9 月 21 日 19:30，地点改至实验楼 A402；报名截止时间不变（9 月 24 日 22:00），已报名同学无需重复提交。注意第 01 条只写了"原计划 9 月 20 日起每周六训练"，并没有给钟点，所以不要自己按 19:00 之类的点去等。',
      advice: '以第 09 条为准，不要按最早那条通知的时间去。'
    },
    {
      mainId: '03',
      updateIds: ['20'],
      kind: '名额变化',
      headline: '开发方向名额已满，现主要补充设计与材料成员',
      detail: '第 20 条是第 03 条的补充说明：开发方向名额已满，目前主要补充设计与材料方向；截止时间仍为 9 月 22 日 18:00，此前已投递者无需重复提交。',
      advice: '想投开发方向的同学应把精力转到其他组队机会；投设计/材料的同学照常准备自我介绍。'
    },
    {
      mainId: '19',
      updateIds: [],
      kind: '截止时间已过',
      headline: '原报名已在 9 月 18 日 22:00 截止',
      detail: '活动方说明：如现场仍有余位，可接受候补入场。也就是说这条信息现在只能"碰运气"，不能保证进得去。',
      advice: '不要为了它专门跑一趟；去之前先确认现场是否还有余位。'
    },
    {
      mainId: '14',
      updateIds: [],
      kind: '报名流程有误解风险',
      headline: '提交报名表 ≠ 报名成功',
      detail: '主办方明确：需提前预约，且提交报名表不代表最终录取，以审核通知为准。',
      advice: '交完表要盯审核通知，别默认自己已经报上了。'
    },
    {
      mainId: '04',
      updateIds: [],
      kind: '活动已结束',
      headline: '直播已在 9 月 18 日 19:30 结束',
      detail: '活动方预计 9 月 20 日上传回放。回放的具体入口和地址，材料中未提供。',
      advice: '想看的同学按"9 月 20 日后再去找回放"安排，不要现在去找直播入口。'
    },
    {
      mainId: '24',
      updateIds: [],
      kind: '疑似推广',
      headline: '缺少主办方、地点与完整活动内容',
      detail: '标题为"校园兼职福利分享"，正文称"零门槛、日结"，要求添加私人微信获取详情；未提供主办方、地点和完整内容。',
      advice: '校园兼职类信息若只给私人微信、不谈岗位与结算主体，风险较高。'
    },
    {
      mainId: '25',
      updateIds: [],
      kind: '疑似推广',
      headline: '标题是技术交流，正文是商家优惠与购买链接',
      detail: '正文主要介绍某商家优惠及购买链接，活动时间、地点均未注明。',
      advice: '与校园技术交流关联较弱，按广告对待即可。'
    }
  ],

  /* ============================ 活动与机会 ============================ */
  items: [
    /* ---------------------------------------------------------------- 01 */
    {
      id: '01', seq: 1,
      title: '“蓝桥杯”程序设计校内训练营',
      cat: '学习资源', source: 'official', publisher: '材料未注明',
      audience: '面向全校学生，零基础可参加',
      gradeMin: 1,
      signupBy: '2026-09-24 22:00',
      eventStart: '2026-09-21 19:30',
      eventEnd: null,
      eventPattern: 'single',
      recurring: '原计划 9 月 20 日起每周六训练（材料未注明具体时间）',
      eventWhere: '实验楼 A402',
      fee: null, capacity: null, effort: null,
      applyHow: '报名（材料未注明具体报名入口）',
      unconfirmed: ['材料未注明报名入口与主办方联系方式', '材料未注明每周例训的具体时间与地点'],
      redFlags: [],
      related: ['09'], role: 'main', updatedAt: '材料编号 01 + 09',
      tags: ['零基础友好', '算法竞赛', '每周固定', '有更新']
    },

    /* ---------------------------------------------------------------- 02 */
    {
      id: '02', seq: 2,
      title: 'AI 应用入门公开课',
      cat: '学习资源', source: 'official', publisher: '材料未注明',
      audience: '面向全校学生',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-19 19:00',
      eventEnd: null,
      eventPattern: 'single',
      recurring: '',
      eventWhere: '计算机学院教学楼（具体教室未注明）',
      fee: null, capacity: null, effort: null,
      applyHow: '无需报名，直接到场',
      unconfirmed: ['材料未注明具体教室'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 02',
      tags: ['今晚', '无需报名', '零基础友好', 'AI']
    },

    /* ---------------------------------------------------------------- 03 */
    {
      id: '03', seq: 3,
      title: '大学生创新创业项目团队招募',
      cat: '项目组队', source: 'official', publisher: '材料未注明',
      audience: '招募开发、设计、材料成员',
      gradeMin: 1,
      signupBy: '2026-09-22 18:00',
      eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '项目制，材料未注明周期',
      eventWhere: null, fee: null,
      capacity: '开发方向名额已满（见第 20 条）；设计、材料方向仍在招募',
      effort: '每周需稳定投入 4 小时以上',
      applyHow: '提交简短自我介绍',
      unconfirmed: ['材料未注明提交自我介绍的渠道'],
      redFlags: [],
      related: ['20'], role: 'main', updatedAt: '材料编号 03 + 20',
      tags: ['每周 4h+', '项目经历', '有更新', '需自我介绍']
    },

    /* ---------------------------------------------------------------- 04 */
    {
      id: '04', seq: 4,
      title: '数学建模竞赛经验分享会（直播）',
      cat: '竞赛科研', source: 'official', publisher: '材料未注明',
      audience: '不限专业',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-18 19:30',
      eventEnd: null, eventPattern: 'single',
      recurring: '活动方预计 9 月 20 日上传回放',
      eventWhere: '线上直播（平台未注明）',
      fee: null, capacity: null, effort: null,
      applyHow: '线上直播，材料未注明是否需要预约',
      unconfirmed: ['材料未提供回放地址与直播平台'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 04',
      tags: ['已结束', '等回放', '不限专业']
    },

    /* ---------------------------------------------------------------- 05 */
    {
      id: '05', seq: 5,
      title: '校园公益志愿服务活动',
      cat: '志愿公益', source: 'official', publisher: '材料未注明',
      audience: '材料未注明限制，通常面向全校学生',
      gradeMin: 1,
      signupBy: '2026-09-20 12:00',
      eventStart: '2026-09-27 08:30',
      recurring: '',
      eventWhere: null, fee: null, capacity: null,
      effort: '需 8 小时志愿时长',
      applyHow: '报名（材料未注明报名入口）',
      unconfirmed: ['材料未注明报名入口'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 05',
      tags: ['志愿时长', '需提前签到', '全天']
    },

    /* ---------------------------------------------------------------- 06 */
    {
      id: '06', seq: 6,
      title: 'Web 开发零基础学习小组',
      cat: '学习资源', source: 'official', publisher: '材料未注明',
      audience: '面向零基础学生',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-23 19:30',
      eventEnd: null, eventPattern: 'weekly',
      recurring: '9 月 23 日起每周三 19:30，共 6 周',
      eventWhere: null, fee: null,
      capacity: '限 30 人，满员即止',
      effort: '每周一次，共 6 周',
      applyHow: '报名（材料未注明报名入口）',
      unconfirmed: ['材料未注明报名入口与报名时间', '材料未注明上课地点'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 06',
      tags: ['限 30 人', '满员即止', '零基础友好', '每周固定']
    },

    /* ---------------------------------------------------------------- 07 */
    {
      id: '07', seq: 7,
      title: 'AI 创新应用挑战赛',
      cat: '竞赛科研', source: 'official', publisher: '材料未注明',
      audience: '2—4 人组队',
      gradeMin: 1,
      signupBy: '2026-09-21 18:00',
      eventStart: null,
      recurring: '9 月 21 日 18:00 前校内意向登记；10 月 20 日提交作品；意向登记不等同于最终作品提交',
      eventWhere: null, fee: null, capacity: '2—4 人组队',
      effort: null,
      applyHow: '校内意向登记（材料未注明登记入口）',
      unconfirmed: ['材料未注明登记入口'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 07',
      tags: ['需组队', '两步流程', '10 月节点']
    },

    /* ---------------------------------------------------------------- 08 */
    {
      id: '08', seq: 8,
      title: '校园软件项目组招募',
      cat: '项目组队', source: 'official', publisher: '材料未注明',
      audience: '面向大一、大二学生',
      gradeMin: 1, gradeMax: 2,
      signupBy: null,
      eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '长期招募，满员即止',
      eventWhere: null, fee: null,
      capacity: '满员即止（未给具体人数）',
      effort: '每周预计投入 5 小时',
      applyHow: '报名（材料未注明报名入口）',
      unconfirmed: ['材料未注明报名入口与联系人'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 08',
      tags: ['大一可参加', '每周 5h', '长期招募', '要会 Git']
    },

    /* ---------------------------------------------------------------- 09（后续通知） */
    {
      id: '09', seq: 9,
      title: '程序设计训练营补充通知（首次训练时间与地点调整）',
      cat: '学习资源', source: 'official', publisher: '材料未注明',
      audience: '材料未注明（补充通知，对象同第 01 条）',
      gradeMin: 1,
      signupBy: '2026-09-24 22:00',
      eventStart: '2026-09-21 19:30',
      eventEnd: null, eventPattern: 'single',
      recurring: '',
      eventWhere: '实验楼 A402',
      fee: null, capacity: null, effort: null,
      applyHow: '已报名同学无需重复提交',
      unconfirmed: [],
      redFlags: [],
      related: ['01'], role: 'update', updatedAt: '材料编号 09',
      tags: ['补充通知', '时间地点变更']
    },

    /* ---------------------------------------------------------------- 10 */
    {
      id: '10', seq: 10,
      title: '前端开发经验交流会',
      cat: '学习资源', source: 'official', publisher: '材料未注明',
      audience: '材料未注明限制',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-19 15:00',
      eventEnd: '2026-09-19 16:30', eventPattern: 'single',
      recurring: '',
      eventWhere: '线下 A201，并同步线上直播',
      fee: null, capacity: null, effort: '1 小时 30 分钟',
      applyHow: '无需报名',
      unconfirmed: ['材料未提供线上直播平台与链接'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 10',
      tags: ['今天', '无需报名', '可线上']
    },

    /* ---------------------------------------------------------------- 11 */
    {
      id: '11', seq: 11,
      title: '大学生科研入门分享会',
      cat: '竞赛科研', source: 'official', publisher: '材料未注明',
      audience: '面向全校学生',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-21 19:00',
      eventEnd: '2026-09-21 20:30', eventPattern: 'single',
      recurring: '',
      eventWhere: null, fee: null, capacity: null, effort: '1 小时 30 分钟',
      applyHow: '材料未注明是否需要报名',
      unconfirmed: ['材料未注明场地与是否需要报名'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 11',
      tags: ['科研入门', '不限专业', '材料未注明时长']
    },

    /* ---------------------------------------------------------------- 12 */
    {
      id: '12', seq: 12,
      title: '全国高校计算机能力挑战赛',
      cat: '竞赛科研', source: 'official', publisher: '材料未注明',
      audience: '面向本科生',
      gradeMin: 1,
      signupBy: '2026-10-05 23:59',
      eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '报名截止 10 月 5 日 23:59；比赛时间材料未提供',
      eventWhere: null,
      fee: null, capacity: '个人参赛', effort: null,
      applyHow: '报名（材料未注明报名入口）',
      unconfirmed: ['材料未提供费用信息', '材料未注明比赛时间', '材料未注明报名入口'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 12',
      tags: ['个人参赛', '费用待确认', '10 月节点']
    },

    /* ---------------------------------------------------------------- 13 */
    {
      id: '13', seq: 13,
      title: '科研助理招募',
      cat: '竞赛科研', source: 'official', publisher: '材料未注明',
      audience: '仅限大二及以上学生',
      gradeMin: 2,
      signupBy: '2026-09-21 23:59',
      eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '9 月 21 日截止报名；工作周期材料未注明',
      eventWhere: null, fee: null, capacity: null,
      effort: '每周预计投入 6 小时',
      applyHow: '报名（材料未注明报名入口）',
      unconfirmed: ['材料未注明报名入口'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 13',
      tags: ['限大二以上', '每周 6h', '科研经历']
    },

    /* ---------------------------------------------------------------- 14 */
    {
      id: '14', seq: 14,
      title: 'Git 与 GitHub 零基础工作坊',
      cat: '学习资源', source: 'official', publisher: '材料未注明',
      audience: '主要面向大一新生',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-21 19:00',
      eventEnd: '2026-09-21 20:30', eventPattern: 'single',
      recurring: '',
      eventWhere: null, fee: null,
      capacity: '限 40 人，需审核',
      effort: '1 小时 30 分钟',
      applyHow: '需提前预约并提交报名表，通过审核后才算录取',
      unconfirmed: ['材料未注明报名表入口与截止时间', '材料未注明场地'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 14',
      tags: ['限 40 人', '需审核', '大一优先', '要会 Git']
    },

    /* ---------------------------------------------------------------- 15 */
    {
      id: '15', seq: 15,
      title: 'AI 应用创意挑战',
      cat: '竞赛科研', source: 'official', publisher: '材料未注明',
      audience: '允许个人或团队参加',
      gradeMin: 1,
      signupBy: '2026-09-23 23:59',
      eventStart: null,
      recurring: '9 月 23 日 23:59 前提交创意方案；9 月 30 日前提交最终作品',
      eventWhere: null, fee: null, capacity: null, effort: null,
      applyHow: '提交创意方案（材料未注明提交入口）',
      unconfirmed: ['材料未注明提交入口与格式要求'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 15',
      tags: ['个人可参加', '两步流程', '一周冲刺']
    },

    /* ---------------------------------------------------------------- 16 */
    {
      id: '16', seq: 16,
      title: '校园摄影志愿者招募',
      cat: '志愿公益', source: 'official', publisher: '材料未注明',
      audience: '材料未注明限制',
      gradeMin: 1,
      signupBy: null,
      eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '长期招募，参与校内大型活动摄影',
      eventWhere: null, fee: null, capacity: null, effort: '按活动排期',
      applyHow: '报名（材料未注明报名入口）',
      unconfirmed: ['材料未注明报名入口与负责人'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 16',
      tags: ['长期招募', '无截止时间', '志愿服务']
    },

    /* ---------------------------------------------------------------- 17 */
    {
      id: '17', seq: 17,
      title: 'Python 程序设计学习资料合集',
      cat: '学习资源', source: 'official', publisher: '材料未注明',
      audience: '材料未注明限制',
      gradeMin: 1,
      signupBy: '2026-09-22 23:59',
      eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '资料长期开放；当前网盘提取信息有效至 9 月 22 日，后续将统一更新',
      eventWhere: '网盘（链接材料未提供）',
      fee: null, capacity: null, effort: null,
      applyHow: '按材料的网盘提取信息自行保存',
      unconfirmed: ['材料未提供网盘链接与提取码'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 17',
      tags: ['长期开放', '9 月 22 日失效', '自学资源']
    },

    /* ---------------------------------------------------------------- 18 */
    {
      id: '18', seq: 18,
      title: '网络安全兴趣交流小组',
      cat: '文体兴趣', source: 'official', publisher: '材料未注明',
      audience: '面向对 CTF、Web 安全等方向感兴趣的学生，不限基础',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-19 19:30',
      eventEnd: null, eventPattern: 'biweekly',
      recurring: '首次交流 9 月 19 日 19:30，之后每两周一次',
      eventWhere: null, fee: null, capacity: null, effort: '每两周一次',
      applyHow: '材料未注明是否需要报名',
      unconfirmed: ['材料未注明地点与是否需要报名'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 18',
      tags: ['今晚', '不限基础', '每两周']
    },

    /* ---------------------------------------------------------------- 19 */
    {
      id: '19', seq: 19,
      title: '学生创新项目路演观摩',
      cat: '项目组队', source: 'official', publisher: '材料未注明',
      audience: '材料未注明限制',
      gradeMin: 1,
      signupBy: '2026-09-18 22:00',
      eventStart: '2026-09-20 14:30',
      eventEnd: null, eventPattern: 'single',
      recurring: '',
      eventWhere: null, fee: null, capacity: '材料未注明名额；报名已截止，现场有余位时可候补',
      effort: null,
      applyHow: '原报名通道已关闭；活动方说明如现场仍有余位，可接受候补入场',
      unconfirmed: ['现场是否还有余位（只有到场或咨询才知道）'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 19',
      tags: ['报名已截止', '候补', '需现场确认']
    },

    /* ---------------------------------------------------------------- 20（后续通知） */
    {
      id: '20', seq: 20,
      title: '创新创业项目团队补充说明（名额变化）',
      cat: '项目组队', source: 'official', publisher: '材料未注明',
      audience: '材料未注明（补充说明，方向同第 03 条）',
      gradeMin: 1,
      signupBy: '2026-09-22 18:00',
      eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '',
      eventWhere: null, fee: null,
      capacity: '开发方向名额已满',
      effort: '每周稳定投入 4 小时以上',
      applyHow: '投递设计与材料方向；此前已投递者无需重复提交',
      unconfirmed: [],
      redFlags: [],
      related: ['03'], role: 'update', updatedAt: '材料编号 20',
      tags: ['补充通知', '名额变化']
    },

    /* ---------------------------------------------------------------- 21 */
    {
      id: '21', seq: 21,
      title: '计算机学院 AI 产品设计分享会',
      cat: '学习资源', source: 'official', publisher: '计算机学院',
      audience: '面向全校学生',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-20 19:00',
      eventEnd: null, eventPattern: 'single',
      recurring: '',
      eventWhere: '明德楼 B203',
      fee: null, capacity: '座位有限',
      effort: null,
      applyHow: '无需报名，直接到场',
      unconfirmed: ['材料未注明主讲人'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 21',
      tags: ['无需报名', '座位有限', '学院发布']
    },

    /* ---------------------------------------------------------------- 22 */
    {
      id: '22', seq: 22,
      title: '周末羽毛球约球',
      cat: '文体兴趣', source: 'student', publisher: '学生个人发布',
      audience: '计划 6—8 人',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-20 16:00',
      eventEnd: null, eventPattern: 'single',
      recurring: '',
      eventWhere: '场地待最终确认',
      fee: '费用 AA',
      capacity: '计划 6—8 人',
      effort: null,
      applyHow: '联系发布同学（材料未提供联系方式）',
      unconfirmed: ['材料未注明联系方式（原文写「场地待最终确认」）'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 22',
      tags: ['学生发布', '场地待定', 'AA', '9 月 20 日']
    },

    /* ---------------------------------------------------------------- 23 */
    {
      id: '23', seq: 23,
      title: 'AI 工具交流搭子招募',
      cat: '文体兴趣', source: 'student', publisher: '学生个人发布',
      audience: '欢迎零基础',
      gradeMin: 1,
      signupBy: null,
      eventStart: null,
      eventEnd: null, eventPattern: 'textonly',
      recurring: '拟于 9 月 21 日晚开展，具体时间未确定',
      eventWhere: null,
      fee: null, capacity: null, effort: null,
      applyHow: '报名后拉群',
      unconfirmed: ['具体时间未确定', '具体地点未确定', '材料未提供联系方式'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 23',
      tags: ['学生发布', '地点待定', '零基础友好']
    },

    /* ---------------------------------------------------------------- 24 */
    {
      id: '24', seq: 24,
      title: '“校园兼职福利分享”',
      cat: '文体兴趣', source: 'student', publisher: '学生个人发布',
      audience: '未说明',
      gradeMin: 1,
      signupBy: null, eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '',
      eventWhere: null,
      fee: '未说明（称“日结”）',
      capacity: null, effort: null,
      applyHow: '要求添加私人微信获取详情',
      unconfirmed: ['材料未提供主办方、地点与完整内容'],
      redFlags: ['未提供主办方', '要求添加私人微信', '“零门槛、日结”话术', '无可核实的时间地点'],
      related: [], role: 'main', updatedAt: '材料编号 24',
      tags: ['低可信', '疑似推广', '学生发布']
    },

    /* ---------------------------------------------------------------- 25 */
    {
      id: '25', seq: 25,
      title: '数码新品体验交流',
      cat: '文体兴趣', source: 'unclear', publisher: '材料未注明',
      audience: '未说明',
      gradeMin: 1,
      signupBy: null, eventStart: null, eventEnd: null, eventPattern: 'rolling',
      recurring: '',
      eventWhere: null, fee: '商家优惠（非活动费用）', capacity: null, effort: null,
      applyHow: '正文提供购买链接',
      unconfirmed: ['材料未注明活动时间与地点'],
      redFlags: ['标题与正文不一致', '含购买链接', '无时间地点', '来源不明'],
      related: [], role: 'main', updatedAt: '材料编号 25',
      tags: ['低可信', '疑似推广', '来源不明']
    },

    /* ---------------------------------------------------------------- 26 */
    {
      id: '26', seq: 26,
      title: '外国语学院校园语言角',
      cat: '文体兴趣', source: 'official', publisher: '外国语学院',
      audience: '面向全校学生',
      gradeMin: 1,
      signupBy: null,
      eventStart: '2026-09-21 15:00',
      eventEnd: null, eventPattern: 'single',
      recurring: '',
      eventWhere: null,
      fee: null,
      capacity: '场地容量有限',
      effort: null,
      applyHow: '无需提前报名，自由交流',
      unconfirmed: ['材料未注明具体场地'],
      redFlags: [],
      related: [], role: 'main', updatedAt: '材料编号 26',
      tags: ['无需报名', '外语', '场地有限']
    }
  ]
};
