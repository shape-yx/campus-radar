'use strict';

/* ==========================================================================
   校园雷达 · 编辑式版 自查脚本（无第三方依赖）
   --------------------------------------------------------------------------
   用 Chrome DevTools Protocol 驱动无头 Chrome，检查两类东西：
     1. 功能：六个屏幕能渲染、判定结论正确、权限门有效、数据能持久化
     2. 版式：编号导航、巨型标题、细线分栏、等宽标签、单一强调色是否真的生效
   用法：
     python3 -m http.server 8801
     node check.js http://127.0.0.1:8801/index.html ./shots
   ========================================================================== */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME_CANDIDATES = [
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8801/index.html';
const SHOT_DIR = process.argv[3] || './shots';
/* 调试端口随机取：固定端口会被上一次异常退出留下的浏览器占住，
   新的一次运行就会静默连上旧实例、跑的是旧代码 —— 这个坑真的踩过。 */
const PORT = 9300 + Math.floor(Math.random() * 600);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  — ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portInUse(port) {
  try { await fetch('http://127.0.0.1:' + port + '/json/version'); return true; } catch { return false; }
}

async function main() {
  if (await portInUse(PORT)) {
    console.error('端口 ' + PORT + ' 已被占用（可能是上次运行残留的浏览器），请先关掉它。');
    process.exit(3);
  }
  const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chromePath) { console.error('找不到 Chrome'); process.exit(2); }
  console.log('浏览器：' + chromePath);
  console.log('被测地址：' + URL_UNDER_TEST + '\n');

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-v2-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir,
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    await sleep(250);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch { /* 继续等 */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('Chrome 调试端口没起来'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  const consoleErrors = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(((d.exception && d.exception.description) || d.text).split('\n')[0]);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    }
  };

  const send = (method, params, sessionId) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  });

  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
  const S = attached.result.sessionId;

  await send('Runtime.enable', {}, S);
  await send('Page.enable', {}, S);
  await send('Network.enable', {}, S);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, S);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, S);

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: '(() => { return (' + expr + '); })()',
      returnByValue: true, awaitPromise: true, userGesture: true
    }, S);
    if (r.result && r.result.exceptionDetails) {
      return { error: r.result.exceptionDetails.text + ' ' + ((r.result.exceptionDetails.exception || {}).description || '') };
    }
    return { value: r.result && r.result.result ? r.result.result.value : undefined };
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, S);
    if (r.result && r.result.data) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'));
    }
  };

  const go = async (hash) => {
    await evaluate("(function(){location.hash = " + JSON.stringify(hash) + ";return 'ok';})()");
    await sleep(430);
  };

  await send('Page.navigate', { url: URL_UNDER_TEST }, S);
  await sleep(1500);
  await evaluate("(function(){App.Store.resetUserData();return 'ok';})()");
  await send('Page.reload', {}, S);
  await sleep(1500);

  /* ---------------- 1. 加载与无异常 ---------------- */
  const appLen = await evaluate("document.getElementById('app').innerHTML.length");
  check('页面能加载并渲染', Number(appLen.value) > 5000, appLen.value + ' 字符');
  check('无未捕获 JS 异常', pageErrors.length === 0, pageErrors.join(' | ') || '0 条');
  check('无 console.error', consoleErrors.length === 0, consoleErrors.join(' | ') || '0 条');

  /* ---------------- 2. 版式：照视频还原的橄榄栅格是否真的生效 ----------------
     参照值来自视频帧实测：页面底 #94a04b、卡片 #000、2 列、缝隙 11px、全直角 */
  const navIdx = await evaluate("[].map.call(document.querySelectorAll('#nav a i'),function(e){return e.textContent}).join('')");
  check('导航带方括号编号', navIdx.value === '12345', '编号 ' + navIdx.value);

  const pageBg = await evaluate("getComputedStyle(document.body).backgroundColor");
  check('页面底色为橄榄黄绿 #94a04b', /rgb\(148, 160, 75\)/.test(String(pageBg.value)), String(pageBg.value));

  const chip = await evaluate("(function(){var e=document.querySelector('.chip-now');return e?getComputedStyle(e).borderRadius+'|'+e.textContent.trim():'缺失'})()");
  check('右上角区块胶囊（圆角 + 当前区块名）', /^999px\|/.test(String(chip.value)), String(chip.value));

  await go('#/list');
  const cardBg = await evaluate("getComputedStyle(document.querySelector('.card')).backgroundColor");
  check('卡片底色为纯黑 #000', /rgb\(0, 0, 0\)/.test(String(cardBg.value)), String(cardBg.value));

  const gridGap = await evaluate("getComputedStyle(document.querySelector('.grid')).gap");
  check('卡片之间留出橄榄缝隙（gap ≈ 11px）', String(gridGap.value) === '11px', String(gridGap.value));

  const twoCols = await evaluate("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length");
  check('栅格为 2 列', Number(twoCols.value) === 2, twoCols.value + ' 列');

  const radius = await evaluate("getComputedStyle(document.querySelector('.card')).borderRadius");
  check('卡片为全直角（无圆角）', String(radius.value) === '0px', String(radius.value));

  const metaBar = await evaluate("(function(){var e=document.querySelector('.card__meta');if(!e)return '缺失';var p=document.querySelector('.pill');return getComputedStyle(e).borderTopWidth+'|'+(p?getComputedStyle(p).borderRadius:'无胶囊')})()");
  check('卡片底部元信息栏 + [分类] 胶囊', /1px\|999px/.test(String(metaBar.value)), String(metaBar.value));

  const halo = await evaluate("(function(){var g=document.querySelector('.footer__giant');var s=getComputedStyle(g);return s.fontSize+'|'+s.color})()");
  check('页脚一行巨大橄榄色大字', /px\|rgba?\(0, 0, 0/.test(String(halo.value)), String(halo.value).slice(0, 34));
  await shot('01-list');

  /* ---------------- 3. 六个屏幕都能渲染 ---------------- */
  const screens = [
    ['今天', '#/', '.card', 'home'],
    ['索引', '#/list', '.grid .card', 'list'],
    ['时间轴', '#/calendar', '.tl-item', 'calendar'],
    ['发布（口令门）', '#/publish', '#adminForm', 'gate'],
    ['我的', '#/mine', '.statbar', 'mine'],
    ['详情', '#/item/01', '.detail-head h1', 'detail']
  ];
  for (const [label, hash, sel, name] of screens) {
    await go(hash);
    const n = await evaluate("document.querySelectorAll('" + sel + "').length");
    check('屏幕「' + label + '」渲染正常', Number(n.value) > 0, sel + ' × ' + n.value);
    await shot('02-' + name);
  }

  /* ---------------- 4. 数据与判定结论 ---------------- */
  const total = await evaluate("App.Radar.all(App.Store.profile(), App.now.value()).length");
  check('材料 26 条进入数据层（24 条独立）', Number(total.value) === 24, total.value + ' 条');

  const downgraded = await evaluate("App.visible(App.Store.profile(), true).filter(function(i){return i.downgraded}).length");
  check('低可信内容被识别并降权', Number(downgraded.value) === 2, downgraded.value + ' 条');

  const st = await evaluate(`(function(){
    var p=App.Store.profile(), n=App.now.value();
    function g(id){var i=App.Radar.find(id,p,n);return i.status.key+'/'+i.status.label;}
    return [g('04'), g('02'), g('19'),
      App.Radar.find('13',p,n).fit.level,
      App.Radar.find('01',p,n).eventWhere,
      App.Radar.find('17',p,n).deadline.label];
  })()`);
  const ST = st.value || [];
  check('9-18 已开始的直播判为「已开始」而不是进行中', String(ST[0]).indexOf('已开始') >= 0, String(ST[0]));
  check('今晚 19:00 的公开课判为「就是今天」', String(ST[1]).indexOf('就是今天') >= 0, String(ST[1]));
  check('报名已截止的路演判为「报名已截止」', String(ST[2]).indexOf('已截止') >= 0, String(ST[2]));
  check('大一新生看「限大二及以上」判为暂不符合', String(ST[3]) === 'blocked', String(ST[3]));
  check('训练营取的是更新后的地点（实验楼 A402）', /A402/.test(String(ST[4])), String(ST[4]));
  check('资料合集识别出网盘 9-22 失效', String(ST[5]) === '3 天后截止', String(ST[5]));

  /* ---------------- 5. 变更合并 ---------------- */
  await go('#/item/01');
  const steps = await evaluate("document.querySelectorAll('.tstep').length");
  const verdict = await evaluate("(function(){var e=document.querySelector('.verdict');return e?e.textContent:'';})()");
  check('训练营的两次通知被并成时间线', Number(steps.value) === 2, steps.value + ' 个节点');
  check('给出「以最新一条为准」的结论', /9 月 21 日/.test(String(verdict.value)), String(verdict.value).slice(0, 24));

  await go('#/item/09');
  const redirect = await evaluate("(function(){var e=document.querySelector('.empty strong');return e?e.textContent:'';})()");
  check('单独打开补充通知会引导回主条目', /补充通知/.test(String(redirect.value)), String(redirect.value).slice(0, 18));

  /* ---------------- 6. 详情三个标签 ---------------- */
  await go('#/item/14');
  await evaluate("(function(){document.querySelector('[data-tab=raw]').click();return 'ok';})()");
  await sleep(400);
  const rawText = await evaluate("(function(){var e=document.querySelector('.dl');return e?e.textContent:'';})()");
  check('「原文信息」标签可切换并显示材料字段', /提交报名表/.test(String(rawText.value)),
    String(rawText.value).replace(/\s+/g, ' ').slice(0, 30));

  const emptyCells = await evaluate("document.querySelectorAll('.dl dd.empty').length");
  check('材料未提供的字段显示「未注明」', Number(emptyCells.value) >= 1, emptyCells.value + ' 项');

  /* ---------------- 7. 收藏 / 报名 + 刷新保留 ---------------- */
  await go('#/item/06');
  await evaluate("(function(){document.querySelector('[data-action=save]').click();return 'ok';})()"); await sleep(300);
  await evaluate("(function(){document.querySelector('[data-action=join]').click();return 'ok';})()"); await sleep(300);
  await send('Page.reload', {}, S); await sleep(1500);
  const kept = await evaluate("JSON.stringify(App.Store.actions().saved)+'/'+JSON.stringify(App.Store.actions().joined)");
  check('刷新后收藏与报名标记保留', /"06"/.test(String(kept.value)), String(kept.value));

  /* ---------------- 8. 发布权限门 ---------------- */
  await go('#/');
  const navHidden = await evaluate("(function(){var a=document.querySelector('#nav a[data-nav=publish]');return a?String(a.hidden):'missing';})()");
  check('未解锁时导航不出现发布入口', navHidden.value === 'true', 'hidden=' + navHidden.value);

  await go('#/publish');
  const gateOnly = await evaluate("String(!!document.querySelector('#adminForm') && !document.querySelector('#publishForm'))");
  check('直接访问 #/publish 只出现口令窗口', gateOnly.value === 'true', 'gate=' + gateOnly.value);

  await evaluate("(function(){document.getElementById('adminPass').value='wrong-one';document.getElementById('adminForm').requestSubmit();return 'ok';})()");
  await sleep(500);
  const wrongMsg = await evaluate("(function(){var e=document.querySelector('.notice__title');return e?e.textContent:'';})()");
  const stillGate = await evaluate("String(!!document.querySelector('#publishForm'))");
  check('口令错误时提示且不放行', /口令不正确/.test(String(wrongMsg.value)) && stillGate.value === 'false',
    '提示=' + String(wrongMsg.value).slice(0, 10) + ' 表单=' + stillGate.value);

  await evaluate("(function(){document.getElementById('adminPass').value='radar2026';document.getElementById('adminForm').requestSubmit();return 'ok';})()");
  await sleep(600);
  const unlocked = await evaluate("String(!!document.querySelector('#publishForm'))");
  check('输入正确口令后进入发布表单', unlocked.value === 'true', 'form=' + unlocked.value);
  await shot('03-publish');

  /* ---------------- 9. 发布闭环 ---------------- */
  await evaluate(`(function(){
    var f=document.getElementById('publishForm');
    f.elements.title.value='编辑式版测试：周三自习搭子';
    f.elements.eventStart.value='2026-09-23T19:00';
    f.elements.eventWhere.value='图书馆四楼';
    f.elements.capacity.value='3 人';
    f.elements.applyHow.value='报名后拉群';
    f.elements.contact.value='微信 v2test';
    f.elements.title.dispatchEvent(new Event('input',{bubbles:true}));
    return 'ok';
  })()`);
  await sleep(450);
  const pct = await evaluate("[].filter.call(document.querySelectorAll('.slab .label'),function(e){return /\\d \\/ 6/.test(e.textContent)}).map(function(e){return e.textContent}).join('')");
  check('发布自检面板随填写更新（6 / 6）', /6 \/ 6/.test(String(pct.value)), '自检 ' + String(pct.value));

  await evaluate("(function(){document.getElementById('publishForm').requestSubmit();return 'ok';})()");
  await sleep(650);
  const hash = await evaluate('location.hash');
  check('发布后进入新内容详情页', /^#\/item\/u/.test(String(hash.value)), String(hash.value));

  await go('#/list');
  const inList = await evaluate("[].some.call(document.querySelectorAll('.card__meta .title'),function(a){return a.textContent.indexOf('编辑式版测试')>=0})");
  check('自己发布的内容进入索引', inList.value === true, String(inList.value));

  await go('#/calendar');
  const inCal = await evaluate("[].some.call(document.querySelectorAll('.tl-item__title'),function(a){return a.textContent.indexOf('编辑式版测试')>=0})");
  check('自己发布的内容进入时间轴', inCal.value === true, String(inCal.value));

  /* ---------------- 10. 四个入口展开 ---------------- */
  await go('#/mine');
  const tiles = await evaluate("document.querySelectorAll('.statbar a.stat').length");
  check('「我的」有四个可点击入口', Number(tiles.value) === 4, tiles.value + ' 个');

  for (const [k, label, n] of [['saved', '我收藏的', 1], ['joined', '我标记报名的', 1], ['mine', '我发布的', 1], ['hidden', '已忽略的', 0]]) {
    await go('#/mine?sec=' + k);
    const rows = await evaluate("document.querySelectorAll('.directory .dirrow').length");
    const title = await evaluate("(function(){var hs=document.querySelectorAll('.blockhead h2');for(var i=0;i<hs.length;i++){var t=hs[i].textContent;if(t.indexOf('我收藏')===0||t.indexOf('我标记')===0||t.indexOf('我发布')===0||t.indexOf('已忽略')===0)return t}return ''})()");
    if (n > 0) {
      check('展开「' + label + '」能看到 ' + n + ' 条', Number(rows.value) === n && String(title.value).indexOf(label) >= 0,
        rows.value + ' 条 · ' + String(title.value));
    } else {
      const msg = await evaluate("(function(){var e=document.querySelector('.empty p');return e?e.textContent:'';})()");
      check('展开「' + label + '」为空时给出说明', String(msg.value).length > 8, String(msg.value).slice(0, 24));
    }
  }
  await shot('04-mine');

  /* ---------------- 11. 主题 / 快捷键 ---------------- */
  await go('#/');
  const t1 = await evaluate("document.documentElement.getAttribute('data-theme')");
  await evaluate("(function(){document.getElementById('themeBtn').click();return 'ok';})()");
  await sleep(320);
  const t2 = await evaluate("document.documentElement.getAttribute('data-theme')");
  const bg2 = await evaluate("getComputedStyle(document.body).backgroundColor");
  check('主题可切换且底色随之变化', t1.value !== t2.value && /rgb\(58, 64, 32\)/.test(String(bg2.value)),
    t1.value + ' → ' + t2.value + ' ' + bg2.value);
  await evaluate("(function(){document.getElementById('themeBtn').click();return 'ok';})()");
  await sleep(250);

  await go('#/list');
  const focusId = await evaluate("(function(){document.getElementById('q').blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}));return document.activeElement?document.activeElement.id:'';})()");
  check('按 / 键聚焦搜索框', focusId.value === 'q', '聚焦到 ' + focusId.value);

  /* ---------------- 12. 移动端 ---------------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, S);
  for (const [label, hash] of [['今天', '#/'], ['索引', '#/list'], ['时间轴', '#/calendar'], ['详情', '#/item/01'], ['我的', '#/mine']]) {
    await go(hash);
    const ov = await evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    check('移动端「' + label + '」无横向溢出', Number(ov.value) <= 2, ov.value + 'px');
  }
  await shot('05-mobile');

  /* ---------------- 汇总 ---------------- */
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '─'.repeat(54));
  console.log('通过 ' + (results.length - failed.length) + ' / ' + results.length + ' 项');
  if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join('；'));
  console.log('截图目录：' + path.resolve(SHOT_DIR));
  if (pageErrors.length) console.log('页面异常：\n' + pageErrors.join('\n'));

  ws.close();
  chrome.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('自查脚本出错：', err.message);
  try {
    require('node:child_process').execSync("pkill -f 'remote-debugging-port=" + PORT + "' || true", { stdio: 'ignore' });
  } catch { /* 忽略 */ }
  process.exit(2);
});
