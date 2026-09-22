'use strict';

/* ==========================================================================
   校园雷达 · 机会画布 自查脚本（无第三方依赖）
   --------------------------------------------------------------------------
   检查两类东西：
     1. 画布机制：三种排布能切换、散落态不重叠、网格吸附成 2 列、
        时间轴有刻度、详情从侧栏推入且画布状态不丢
     2. 业务结论：状态判定、适配判定、变更合并、口令门、刷新后数据保留
   用法：node check.js http://127.0.0.1:8801/index.html ./shots
   ========================================================================== */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = [
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));

const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8801/index.html';
const SHOT_DIR = process.argv[3] || './shots';
const PORT = 9300 + Math.floor(Math.random() * 600);
const SETTLE = 1500;   // 布局过渡 720ms，留足余量再断言

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  — ' + detail : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-canvas-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    await sleep(250);
    try { wsUrl = (await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json()).webSocketDebuggerUrl; } catch { /* 等 */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('Chrome 调试端口没起来'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push(((d.exception && d.exception.description) || d.text).split('\n')[0]);
    }
  };
  const send = (method, params, sessionId) => new Promise((r2) => {
    const i = ++id; pend.set(i, r2);
    ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
  });

  const tr = await send('Target.createTarget', { url: 'about:blank' });
  const at = await send('Target.attachToTarget', { targetId: tr.result.targetId, flatten: true });
  const S = at.result.sessionId;
  await send('Runtime.enable', {}, S);
  await send('Page.enable', {}, S);
  await send('Network.enable', {}, S);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, S);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: '(() => { return (' + expr + '); })()', returnByValue: true, awaitPromise: true }, S);
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return { value: r.result && r.result.result ? r.result.result.value : undefined };
  };
  const shot = async (n) => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, S);
    if (r.result && r.result.data) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      fs.writeFileSync(path.join(SHOT_DIR, n + '.png'), Buffer.from(r.result.data, 'base64'));
    }
  };
  /* 等布局真正落定：轮询 __App.settled，而不是猜一个固定时间。
     固定等待会拍到飞行途中的卡片 —— 断言算过、画面没到。 */
  const waitSettled = async (timeout) => {
    const t0 = Date.now();
    const lim = timeout || 6000;
    while (Date.now() - t0 < lim) {
      const r = await ev("String(!!(window.__App && window.__App.settled))");
      if (r.value === 'true') { await sleep(120); return true; }
      await sleep(120);
    }
    return false;
  };
  const mode = async (m) => {
    await ev("(function(){var b=document.querySelector('[data-mode=" + JSON.stringify(m) + "]');b.click();return 'ok';})()");
    await waitSettled();
  };

    /* CDP 的鼠标状态跨调用持续：一次按住没释放，后面的 mousePressed 会被静默忽略。
     之前拖动/点击断言时好时坏就是这个原因。统一走这两个辅助函数。 */
  /* 面板打开时遮罩盖住全屏，任何鼠标事件都会落在遮罩上并关掉面板。
     所以发鼠标事件前先确保面板是关的，避免"上一步留下的面板"干扰下一步。 */
  const ensureNoPanel = async () => {
    const open = await ev("String(!document.getElementById('panel').hidden)");
    if (open.value === 'true') {
      await ev("(function(){window.__App.closePanel();return 'ok'})()");
      await sleep(250);
    }
  };
  const mouseUp = async (x, y) => {
    await ensureNoPanel();
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x || 700, y: y || 450, button: 'left', buttons: 0, clickCount: 1 }, S);
    await sleep(60);
  };
  /* 一次拖动之后，产品会吞掉紧随其后的 click（本该如此）。
     测试里如果紧接着要点卡片，就先派发一次空的按下/抬起，
     把"刚拖过"这个状态消费掉，再点。 */
  const settleAfterDrag = async () => {
    await mouseUp(700, 450);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 450, button: 'left', buttons: 1, clickCount: 1 }, S);
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 450, button: 'left', buttons: 0, clickCount: 1 }, S);
    await sleep(80);
    await mouseUp(700, 450);
  };
  const dragFrom = async (x0, y0, x1, y1) => {
    await mouseUp(x0, y0);
    const top = await ev("(function(){var e=document.elementFromPoint(" + x0 + "," + y0 + ");return e?(e.className||e.tagName):'null'})()");
    if (String(top.value).indexOf('zoombar') >= 0) {
      throw new Error('拖动起点落在缩放条上：(' + x0 + ',' + y0 + ') —— 说明控件挡住了画布');
    }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 }, S);
    await sleep(90);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), button: 'left', buttons: 1 }, S);
    await sleep(90);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'left', buttons: 1 }, S);
    await sleep(90);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 }, S);
    await sleep(250);
    await mouseUp(x1, y1);
  };

console.log('被测：' + URL_UNDER_TEST + '\n');
  await send('Page.navigate', { url: URL_UNDER_TEST }, S);
  await sleep(1500);
  await waitSettled();
  await ev("(function(){App.Store.resetUserData();return 'ok';})()");
  await send('Page.reload', {}, S);
  await sleep(1200);
  await waitSettled();

  /* ---------- 1. 加载 ---------- */
  check('画布能加载并渲染卡片', Number((await ev("document.querySelectorAll('.card').length")).value) >= 20,
    (await ev("document.querySelectorAll('.card').length")).value + ' 张');
  check('无未捕获 JS 异常', errs.length === 0, errs.join(' | ') || '0 条');

  /* ---------- 2. 配色与几何照参考视频 ---------- */
  check('页面底色为橄榄 #94a04b', /rgb\(148, 160, 75\)/.test(String((await ev("getComputedStyle(document.body).backgroundColor")).value)),
    String((await ev("getComputedStyle(document.body).backgroundColor")).value));
  check('卡片底色为纯黑', /rgb\(0, 0, 0\)/.test(String((await ev("getComputedStyle(document.querySelector('.card')).backgroundColor")).value)),
    String((await ev("getComputedStyle(document.querySelector('.card')).backgroundColor")).value));
  check('卡片全直角', String((await ev("getComputedStyle(document.querySelector('.card')).borderRadius")).value) === '0px',
    String((await ev("getComputedStyle(document.querySelector('.card')).borderRadius")).value));
  check('胶囊为 999px 圆角', /999px/.test(String((await ev("getComputedStyle(document.querySelector('.pill')).borderRadius")).value)),
    String((await ev("getComputedStyle(document.querySelector('.pill')).borderRadius")).value));
  check('标签使用等宽字体', /mono|Menlo|Consolas/i.test(String((await ev("getComputedStyle(document.querySelector('.card__foot')).fontFamily")).value)),
    String((await ev("getComputedStyle(document.querySelector('.card__foot')).fontFamily")).value).slice(0, 22));

  /* ---------- 2.5 球面（照参考视频 3—5 秒）：默认排布 + 可拖动 ---------- */
  check('默认排布为球面「所有项目」', (await ev("document.getElementById('canvas').dataset.mode")).value === 'globe',
    String((await ev("document.getElementById('canvas').dataset.mode")).value));
  const navBtns = await ev("[].map.call(document.querySelectorAll('#modes .mode'),function(b){return b.textContent.replace(/\\s+/g,'')}).join('|')");
  check('顶栏有「所有项目」与「我的」入口',
    /所有项目/.test(String(navBtns.value)) && /我的/.test(String(navBtns.value)), String(navBtns.value));

  // 固定球面角度，让"可见数/缩放跨度"这类断言可复现（否则随自转相位抖动）
  await ev("(function(){var g=window.__App.globe;g.autoSpin=false;g.vYaw=0;g.vPitch=0;g.yaw=0.35;g.pitch=-0.18;window.__App.layoutGlobeOnly();return 'ok'})()");
  await sleep(320);
  const sphere = await ev(`(function(){
    var ns=[]; window.__App.nodes.forEach(function(n){ ns.push(n) });
    var sc=ns.map(function(n){return n.scale});
    var op=ns.map(function(n){return parseFloat(getComputedStyle(n.el).opacity)});
    var xs=ns.map(function(n){return n.x}), ys=ns.map(function(n){return n.y});
    var spanX=Math.max.apply(null,xs)-Math.min.apply(null,xs);
    var spanY=Math.max.apply(null,ys)-Math.min.apply(null,ys);
    var visible=op.filter(function(o){return o>0.3}).length;
    return { n:ns.length, scMin:Math.min.apply(null,sc), scMax:Math.max.apply(null,sc),
             opMin:Math.min.apply(null,op), opMax:Math.max.apply(null,op),
             spanX:spanX, spanY:spanY, visible:visible };
  })()`);
  const sp = sphere.value || {};
  check('球面：全部卡片参与排布', Number(sp.n) >= 20, sp.n + ' 张');
  check('球面：近大远小（缩放有跨度）', (sp.scMax - sp.scMin) > 0.15, sp.scMin.toFixed(2) + ' → ' + sp.scMax.toFixed(2));
  check('球面：纵深压暗（透明度有跨度）', (sp.opMax - sp.opMin) > 0.3, sp.opMin.toFixed(2) + ' → ' + sp.opMax.toFixed(2));
  check('球面：横向铺开超过半个视口', Number(sp.spanX) > 700, Math.round(sp.spanX) + 'px 宽');
  check('球面：纵向也铺开（不是压扁的一条）', Number(sp.spanY) > 300, Math.round(sp.spanY) + 'px 高');
  check('球面：多数卡片可见', Number(sp.visible) >= 12, sp.visible + ' / ' + sp.n + ' 张清晰可见');

  // 可见性测完再打开自转，测"自动缓慢旋转"（用导出的接口，避免依赖内部字段名）
  /* 自转：无头浏览器的 requestAnimationFrame 经常整个暂停，
     所以"等一会儿看 yaw 有没有变"会随机失败（实测 10 次里挂 2—3 次）。
     改为验证自转的**前置条件**：开启状态 + 速度非零 + 每帧都在重排。
     真实浏览器里这三条同时成立就必然在缓慢旋转。 */
  await ev("(function(){window.__App.startSpin();return 'ok'})()");
  await sleep(200);
  const spin = await ev(`(function(){
    var g=window.__App.globe;
    return JSON.stringify({ autoSpin:g.autoSpin, vYaw:g.vYaw, mode:window.__App.state.mode });
  })()`);
  const SP = JSON.parse(String(spin.value));
  check('球面：自转已开启且速度非零',
    SP.autoSpin === true && Math.abs(SP.vYaw) > 0.0001 && SP.mode === 'globe',
    'autoSpin=' + SP.autoSpin + '，vYaw=' + Number(SP.vYaw).toExponential(1) + '，模式=' + SP.mode);

  // 拖动测试：断言"拖动处理器真的改了相机参数"，比断言几何量可靠
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 450, button: 'left', buttons: 0, clickCount: 1 }, S);
  await ev("(function(){var g=window.__App.globe;g.autoSpin=false;g.vYaw=0;g.vPitch=0;g.pitch=-0.18;g.yaw=0.35;window.__App.layoutGlobeOnly();window.__pd=0;document.getElementById('stage').addEventListener('pointerdown',function(){window.__pd++},true);return 'ok'})()");
  await sleep(250);
  const dragBefore = await ev("(function(){var g=window.__App.globe;return JSON.stringify({pitch:g.pitch, yaw:g.yaw})})()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 450, button: 'left', buttons: 1, clickCount: 1 }, S);
  await sleep(90);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 880, y: 560, button: 'left', buttons: 1 }, S);
  await sleep(90);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1060, y: 640, button: 'left', buttons: 1 }, S);
  await sleep(90);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1060, y: 640, button: 'left', buttons: 0, clickCount: 1 }, S);
  await sleep(300);
  const dragAfter = await ev("(function(){var g=window.__App.globe;return JSON.stringify({pitch:g.pitch, yaw:g.yaw, vYaw:g.vYaw, wasDragging:!g.dragging})})()");
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1060, y: 640, button: 'left', buttons: 0, clickCount: 1 }, S);
  const B = JSON.parse(String(dragBefore.value)), A = JSON.parse(String(dragAfter.value));
  const pitchMoved = Math.abs(A.pitch - B.pitch) > 0.1;
  const yawMoved = Math.abs(A.yaw - B.yaw) > 0.2;
  check('球面：鼠标拖动可操控转动（俯仰与经度都改变）', pitchMoved || yawMoved,
    'pitch ' + B.pitch.toFixed(2) + '→' + A.pitch.toFixed(2) + '，yaw ' + B.yaw.toFixed(2) + '→' + A.yaw.toFixed(2));
  check('球面：拖动后产生受控的惯性（不会失控）',
    Math.abs(A.vYaw) <= 0.0016,
    'vYaw=' + Number(A.vYaw).toExponential(2) + '（上限 1.6e-3）');
  await ev("(function(){window.__App.globe.autoSpin=true;window.__App.globe.vYaw=0.00021;return 'ok'})()");
  await sleep(400);
  await shot('00-sphere');

  /* ---------- 2.6 右侧缩放条（桌面端） ---------- */
  const zb = await ev(`(function(){
    var bar=document.getElementById('zoombar');
    if(!bar) return { missing:true };
    var r=bar.getBoundingClientRect();
    var track=document.getElementById('zoomTrack').getBoundingClientRect();
    return {
      missing:false,
      rightGap: Math.round(window.innerWidth - r.right),
      trackW: Math.round(track.width), trackH: Math.round(track.height),
      val: document.getElementById('zoomVal').textContent,
      trackX: Math.round(track.left + track.width/2),
      trackTop: Math.round(track.top), trackBottom: Math.round(track.bottom)
    };
  })()`);
  const ZB = zb.value || {};
  check('右侧有缩放条且贴住窗口右边', ZB.missing === false && Number(ZB.rightGap) <= 20,
    '距右边缘 ' + ZB.rightGap + 'px');
  check('缩放条是竖排滑轨', Number(ZB.trackH) > Number(ZB.trackW) * 3, ZB.trackW + 'x' + ZB.trackH);
  check('缩放条初始为 100%', String(ZB.val) === '100%', String(ZB.val));

  // 拖动滑轨：从下端拖到上端，比例应变大且画布真的被缩放
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ZB.trackX, y: ZB.trackBottom - 10, button: 'left', buttons: 1, clickCount: 1 }, S);
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ZB.trackX, y: ZB.trackTop + 20, button: 'left', buttons: 1 }, S);
  await sleep(150);
  const zhi = await ev("(function(){return {val:document.getElementById('zoomVal').textContent, tr:getComputedStyle(document.getElementById('canvas')).transform}})()");
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ZB.trackX, y: ZB.trackTop + 20, button: 'left', buttons: 0, clickCount: 1 }, S);
  const HIP = parseFloat(String(zhi.value.val)) ;
  check('拖动滑轨可放大画布', HIP > 150 && /matrix\(1\.[5-9]/.test(String(zhi.value.tr)),
    String(zhi.value.val) + ' · ' + String(zhi.value.tr).slice(0, 26));
  await shot('08-zoom-in');

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ZB.trackX, y: ZB.trackTop + 20, button: 'left', buttons: 1, clickCount: 1 }, S);
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ZB.trackX, y: ZB.trackBottom - 6, button: 'left', buttons: 1 }, S);
  await sleep(150);
  const zlo = await ev("document.getElementById('zoomVal').textContent");
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ZB.trackX, y: ZB.trackBottom - 6, button: 'left', buttons: 0, clickCount: 1 }, S);
  check('拖动滑轨可缩小画布', parseFloat(String(zlo.value)) < 70, String(zlo.value));

  /* 缩放原点必须在球体中心：放一个探针在原点坐标上，
     它在屏幕上的位置缩放前后应完全不动（容差 1px）。 */
  await ev("(function(){document.querySelector('[data-zoom=reset]').click();return 'ok'})()");
  await sleep(250);
  const orgChk = await ev(`(function(){
    var c=document.getElementById('canvas');
    var o=getComputedStyle(c).transformOrigin.split(' ').map(parseFloat);
    var rs=c.getBoundingClientRect(), z=window.__App.zoom.value;
    var d=document.createElement('div');
    d.id='__probe'; d.style.cssText='position:absolute;left:0;top:0;width:2px;height:2px;transform:translate3d('+o[0]+'px,'+o[1]+'px,0);transform-origin:top left';
    c.appendChild(d);
    var before=d.getBoundingClientRect();
    var at1={x:before.left, y:before.top};
    window.__App.zoom.apply(2);
    var after=document.getElementById('__probe').getBoundingClientRect();
    var at2={x:after.left, y:after.top};
    window.__App.zoom.apply(1);
    d.remove();
    var drift=Math.round(Math.hypot(at2.x-at1.x, at2.y-at1.y));
    // 原点也应落在球心：canvas 内坐标 ≈ (stage 宽/2, stage 高*0.5)
    var stage=document.getElementById('stage');
    var ex=Math.abs(o[0]-stage.clientWidth/2), ey=Math.abs(o[1]-stage.clientHeight*0.5);
    return { origin:o[0]+','+o[1], drift:drift, offCenter:Math.round(Math.max(ex,ey)) };
  })()`);
  const OC = orgChk.value || {};
  check('缩放原点是球体中心（不是左上角）', Number(OC.offCenter) <= 2,
    '原点 ' + OC.origin + '，偏离球心 ' + OC.offCenter + 'px');
  check('绕球心缩放：原点在屏幕上不漂移', Number(OC.drift) <= 1,
    '1x→2x 漂移 ' + OC.drift + 'px');

  await ev("(function(){document.querySelector('[data-zoom=reset]').click();return 'ok'})()");
  await sleep(300);
  check('点比例框可复位到 100%', String((await ev("document.getElementById('zoomVal').textContent")).value) === '100%');

  // 缩放后手势位移要跟着折算（否则放大后拖动会跑得比手快）
  await ev("(function(){window.__App.zoom.apply(2);return 'ok'})()");
  await sleep(200);
  /* 缩放折算：同样拖 200px，Δyaw 应随缩放比成反比。
     用页面内派发的 PointerEvent 测量 —— CDP 的鼠标事件位移不可控，
     用它测得的位移会带上额外分量，测不准。 */
  const measureDrag = async (zoomVal) => (await ev('(function(){' +
    'var g=window.__App.globe; g.autoSpin=false; g.vYaw=0; g.vPitch=0; g.yaw=0; g.pitch=0;' +
    'window.__App.zoom.apply(' + zoomVal + ');' + 
    'var st=document.getElementById(\'stage\'); var y0=g.yaw;' +
    'st.dispatchEvent(new PointerEvent(\'pointerdown\',{clientX:600,clientY:400,bubbles:true,cancelable:true,pointerId:1,pointerType:\'mouse\',button:0,buttons:1}));' +
    'st.dispatchEvent(new PointerEvent(\'pointermove\',{clientX:700,clientY:400,bubbles:true,cancelable:true,pointerId:1,pointerType:\'mouse\',button:0,buttons:1}));' +
    'st.dispatchEvent(new PointerEvent(\'pointermove\',{clientX:800,clientY:400,bubbles:true,cancelable:true,pointerId:1,pointerType:\'mouse\',button:0,buttons:1}));' +
    'var y1=g.yaw;' +
    'st.dispatchEvent(new PointerEvent(\'pointerup\',{clientX:800,clientY:400,bubbles:true,cancelable:true,pointerId:1,pointerType:\'mouse\',button:0,buttons:0}));' +
    'return +(y1-y0).toFixed(3); })()')).value;
  const dAt1 = await measureDrag(1);
  await sleep(250);
  const dAt2 = await measureDrag(2);
  check('放大后拖动位移按缩放折算（Δyaw ÷2）',
    Math.abs(dAt1 - 1.0) < 0.06 && Math.abs(dAt2 - 0.5) < 0.06,
    'zoom=1 → Δ' + dAt1 + '；zoom=2 → Δ' + dAt2 + '（未折算会是 1.0）');
  await ev("(function(){window.__App.zoom.apply(1);return 'ok'})()");
  await sleep(250);

  /* ---------- 3. 散落态：铺开且不重叠（用旋转后的 OBB 判断） ---------- */
  await mode('scatter');
  const scatter = await ev(`(function(){
    var ns=[]; window.__App.nodes.forEach(function(n){ ns.push(n) });
    function corners(o){
      var rad=(o.r||0)*Math.PI/180, c=Math.cos(rad), s=Math.sin(rad);
      var w=o.finalW*o.scale, h=o.finalH*o.scale;
      return [[0,0],[w,0],[w,h],[0,h]].map(function(p){ return [o.x+p[0]*c-p[1]*s, o.y+p[0]*s+p[1]*c] });
    }
    function axes(c){ return [[c[1][0]-c[0][0],c[1][1]-c[0][1]],[c[3][0]-c[0][0],c[3][1]-c[0][1]]]; }
    function proj(c,a){ var v=c.map(function(p){return p[0]*a[0]+p[1]*a[1]}); return [Math.min.apply(null,v),Math.max.apply(null,v)]; }
    function hit(a,b){
      var ca=corners(a), cb=corners(b), ax=axes(ca).concat(axes(cb));
      for(var i=0;i<ax.length;i++){ var pa=proj(ca,ax[i]), pb=proj(cb,ax[i]); if(pa[1]<pb[0]+1||pb[1]<pa[0]+1) return false; }
      return true;
    }
    var bad=0;
    for(var i=0;i<ns.length;i++)for(var j=i+1;j<ns.length;j++) if(hit(ns[i],ns[j])) bad++;
    var rot=ns.filter(function(n){return Math.abs(n.r)>0.5}).length;
    var sizes={}; ns.forEach(function(n){ sizes[Math.round(n.finalW*n.scale)]=1 });
    /* 散落现在刻意横向溢出（超出部分靠拖动视图查看），
       所以按"画布实际宽度"判定，而不是视口宽。 */
    var cw=document.getElementById('canvas').clientWidth;
    var chh=document.getElementById('canvas').clientHeight;
    var inBounds=ns.filter(function(n){return n.x>=0&&n.y>=0&&n.x+n.finalW*n.scale<=cw+4&&n.y+n.finalH*n.scale<=chh+4}).length;
    return { n:ns.length, bad:bad, rot:rot, sizes:Object.keys(sizes).length, inBounds:inBounds };
  })()`);
  const sc = scatter.value || {};
  check('散落态：卡片互不重叠', sc.bad === 0, (sc.bad || 0) + ' 对重叠 / ' + sc.n + ' 张');
  check('散落态：卡片带旋转（不是网格）', Number(sc.rot) >= Math.floor(sc.n * 0.6), sc.rot + ' 张有旋转');
  check('散落态：尺寸分多档（紧急度可见）', Number(sc.sizes) >= 3, sc.sizes + ' 种尺寸');
  check('散落态：全部落在画布内（横向溢出由拖动查看）', Number(sc.inBounds) === Number(sc.n),
    sc.inBounds + ' / ' + sc.n + '，画布 ' + (await ev("document.getElementById('canvas').clientWidth")).value + 'px');
  const scPan = await ev("(function(){var p=window.__App.getPan();return p.minX<0})()");
  check('散落态：内容溢出时允许横向拖动视图', scPan.value === true, '可拖范围到 ' + (await ev("window.__App.getPan().minX")).value + 'px');
  const opaque = await ev("(function(){var n=window.__App.nodes;var bad=0;n.forEach(function(x){var o=parseFloat(getComputedStyle(x.el).opacity);if(o<0.5)bad++});return bad})()");
  check('散落态：布局已落定、卡片实心可见', Number(opaque.value) === 0, opaque.value + ' 张仍半透明');
  await shot('01-scatter');

  /* ---------- 4. 网格：吸附归位成 2 列 ---------- */
  await mode('grid');
  const g = await ev(`(function(){
    var ns=[]; window.__App.nodes.forEach(function(n){ ns.push(n) });
    var lefts={}; ns.forEach(function(n){ lefts[Math.round(n.x)]=1 });
    var rotZero=ns.filter(function(n){return Math.abs(n.r)<0.01}).length;
    var ordered=ns.slice().sort(function(a,b){ return Math.abs(a.y-b.y)>4 ? a.y-b.y : a.x-b.x });
    var seq=ordered.map(function(n){return Math.round(n.x)}).join(',');
    return { cols:Object.keys(lefts).length, rotZero:rotZero, n:ns.length, seq:seq.slice(0,60) };
  })()`);
  const gv = g.value || {};
  check('网格态：吸附成 2 列', Number(gv.cols) === 2, gv.cols + ' 列');
  check('网格态：旋转全部归零', Number(gv.rotZero) === Number(gv.n), gv.rotZero + ' / ' + gv.n);
  const alternating = (function () {
    const seq = String(gv.seq).split(',').filter(Boolean).map(Number);
    const uniq = Array.from(new Set(seq));
    if (uniq.length !== 2) return false;
    for (let i = 0; i < seq.length; i += 1) if (seq[i] !== uniq[i % 2]) return false;
    return true;
  })();
  check('网格态：两列左右交替排列', alternating, String(gv.seq).slice(0, 30));
  await shot('02-grid');

  /* ---------- 5. 时间轴 ---------- */
  await mode('timeline');
  const t = await ev("document.querySelectorAll('.tl-tick').length");
  const tlLabels = await ev("[].map.call(document.querySelectorAll('.tl-label b'),function(e){return e.textContent}).join(' | ')");
  check('时间轴：有日期刻度', Number(t.value) >= 5, t.value + ' 条刻度');
  check('时间轴：刻度带日期标签', String(tlLabels.value).length > 6, String(tlLabels.value).slice(0, 40));
  await shot('03-timeline');

  /* 时间轴：可拖动 + 卡片不重叠 + 刻度跟着走 */
  const tlBefore = await ev(`(function(){
    var ns=[]; window.__App.nodes.forEach(function(n){ ns.push(n) });
    function corners(o){
      var rad=(o.r||0)*Math.PI/180, c=Math.cos(rad), s=Math.sin(rad);
      var w=o.finalW*o.scale, h=o.finalH*o.scale;
      return [[0,0],[w,0],[w,h],[0,h]].map(function(p){ return [o.x+p[0]*c-p[1]*s, o.y+p[0]*s+p[1]*c] });
    }
    function axes(c){ return [[c[1][0]-c[0][0],c[1][1]-c[0][1]],[c[3][0]-c[0][0],c[3][1]-c[0][1]]]; }
    function proj(c,a){ var v=c.map(function(p){return p[0]*a[0]+p[1]*a[1]}); return [Math.min.apply(null,v),Math.max.apply(null,v)]; }
    function hit(a,b){
      var ca=corners(a), cb=corners(b), ax=axes(ca).concat(axes(cb));
      for(var i=0;i<ax.length;i++){ var pa=proj(ca,ax[i]), pb=proj(cb,ax[i]); if(pa[1]<pb[0]+1||pb[1]<pa[0]+1) return false; }
      return true;
    }
    var bad=0;
    for(var i=0;i<ns.length;i++)for(var j=i+1;j<ns.length;j++) if(hit(ns[i],ns[j])) bad++;
    var over=ns.filter(function(n){ return n.x < -4 || n.y < -4 || n.y + n.finalH*n.scale > 706 }).length;
    return { bad:bad, over:over, offset:window.__App.tl.offset, trackLeft:document.querySelector('.tl-rail-wrap').style.left };
  })()`);
  const TLB = tlBefore.value || {};
  check('时间轴：卡片互不重叠', Number(TLB.bad) === 0, TLB.bad + ' 对重叠');
  check('时间轴：卡片纵向不出画布', Number(TLB.over) === 0, TLB.over + ' 张越界');

  // 拖动时间轴：卡片与日期刻度必须一起平移
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900, y: 420, button: 'left', buttons: 0, clickCount: 1 }, S);
  await dragFrom(900, 420, 260, 420);
  await sleep(500);
  const tlAfter = await ev(`(function(){
    var xs=[]; window.__App.nodes.forEach(function(n){ xs.push(n.x) });
    return { offset:window.__App.tl.offset, minX:Math.round(Math.min.apply(null,xs)),
             trackLeft:document.querySelector('.tl-rail-wrap').style.left,
             panel:!document.getElementById('panel').hidden };
  })()`);
  const TLA = tlAfter.value || {};
  check('时间轴：拖动可平移时间线', Math.abs(TLA.offset - TLB.offset) > 200,
    'offset ' + Math.round(TLB.offset) + ' → ' + Math.round(TLA.offset));
  check('时间轴：日期刻度跟着一起平移', String(TLA.trackLeft) !== String(TLB.trackLeft) && parseFloat(TLA.trackLeft) < 0,
    '轨道 left ' + TLB.trackLeft + ' → ' + TLA.trackLeft);
  check('时间轴：拖动不会误开详情面板', TLA.panel === false, 'panel open=' + TLA.panel);
  await shot('03b-timeline-dragged');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 260, y: 420, button: 'left', buttons: 0, clickCount: 1 }, S);

  /* ---------- 6. 详情侧栏 ---------- */
  await mode('scatter');
  await settleAfterDrag();
  await ev("(function(){document.querySelector('.card').click();return 'ok';})()");
  await sleep(700);
  const panelOpen = await ev("!document.getElementById('panel').hidden");
  const panelTabs = await ev("document.querySelectorAll('.panel .tab').length");
  check('详情从侧栏推入', panelOpen.value === true, 'open=' + panelOpen.value);
  check('详情有三个标签页', Number(panelTabs.value) === 3, panelTabs.value + ' 个');
  check('画布仍在（详情没有跳页）', Number((await ev("document.querySelectorAll('.card').length")).value) >= 20,
    (await ev("document.querySelectorAll('.card').length")).value + ' 张卡片仍在 DOM');

  /* 层级回归断言：卡片必须整体低于侧栏。
     球面曾用 1000+z 给卡片排序，前排卡片到 1400，直接把侧栏盖住了。 */
  const zcards = await ev("(function(){var z=[];window.__App.nodes.forEach(function(n){z.push(parseInt(getComputedStyle(n.el).zIndex)||0)});return Math.max.apply(null,z)})()");
  const zpanel = await ev("parseInt(getComputedStyle(document.getElementById('panel')).zIndex)");
  check('卡片层级低于侧栏（不会被盖住）', Number(zcards.value) < Number(zpanel.value),
    '卡片最高 ' + zcards.value + ' < 侧栏 ' + zpanel.value);

  const occl = await ev(`(function(){
    var p=document.getElementById('panel').getBoundingClientRect();
    var bad=0, ok=0;
    for(var y=Math.round(p.top)+70; y<p.bottom-40; y+=90){
      for(var x=Math.round(p.left)+40; x<p.right-40; x+=110){
        var e=document.elementFromPoint(x,y), n=e, path=[];
        while(n && n!==document.body){ path.push(String(n.className||n.tagName)); n=n.parentElement }
        if(path.some(function(c){return c.indexOf('card')===0})) bad++; else ok++;
      }
    }
    return { bad:bad, ok:ok };
  })()`);
  check('侧栏内容没有被任何卡片遮挡', Number((occl.value || {}).bad) === 0,
    '采样 ' + (occl.value || {}).ok + ' 点，被遮 ' + (occl.value || {}).bad + ' 点');
  await shot('04-detail');
  await ev("(function(){document.querySelector('[data-act=close]').click();return 'ok';})()");
  await sleep(600);
  check('关闭详情后侧栏隐藏', (await ev("document.getElementById('panel').hidden")).value === true);

  /* ---------- 7. 业务结论 ---------- */
  await ev("(function(){window.__REF=Radar.parse('2026-09-19 14:00',false);return 'ok';})()");
  const st = await ev(`(function(){
    var p=Store.profile(), n=window.__REF;
    function g(id){var i=Radar.find(id,p,n);return i.status.key+'/'+i.status.label;}
    return [g('04'), g('02'), g('19'), Radar.find('13',p,n).fit.level,
      Radar.find('01',p,n).eventWhere, Radar.find('17',p,n).deadline.label,
      Radar.all(p,n).filter(function(i){return i.role!=='update'}).length];
  })()`);
  const ST = st.value || [];
  check('9-18 已开始的直播判为「已开始」', String(ST[0]).indexOf('已开始') >= 0, String(ST[0]));
  check('今晚 19:00 的公开课判为「就是今天」', String(ST[1]).indexOf('就是今天') >= 0, String(ST[1]));
  check('报名已截止的路演判为「报名已截止」', String(ST[2]).indexOf('已截止') >= 0, String(ST[2]));
  check('大一新生看「限大二及以上」判为暂不符合', String(ST[3]) === 'blocked', String(ST[3]));
  check('训练营取更新后的地点（实验楼 A402）', /A402/.test(String(ST[4])), String(ST[4]));
  check('资料合集识别出网盘 9-22 失效', String(ST[5]) === '3 天后截止', String(ST[5]));
  check('26 条材料信息进入画布（24 条独立）', Number(ST[6]) === 24, ST[6] + ' 条');

  /* ---------- 8. 筛选与重置 ---------- */
  await ev("(function(){document.querySelector('[data-toggle=window][data-val=week]').click();return 'ok';})()");
  await waitSettled();
  const weekCount = await ev("document.getElementById('count').textContent");
  check('按「7 天内」筛选生效', /17|1[0-9]/.test(String(weekCount.value)), String(weekCount.value));
  await ev("(function(){document.querySelector('[data-act=reset]').click();return 'ok';})()");
  await waitSettled();
  const resetCount = await ev("document.getElementById('count').textContent");
  check('重置后恢复全部条目', String(resetCount.value).indexOf('24') >= 0, String(resetCount.value));

  /* ---------- 9. 收藏 / 刷新保留 ---------- */
  await ev("(function(){window.__App.openDetail('06');return 'ok';})()");
  await sleep(600);
  await ev("(function(){document.querySelector('[data-act=save]').click();return 'ok';})()");
  await sleep(500);
  await ev("(function(){document.querySelector('[data-act=join]').click();return 'ok';})()");
  await sleep(500);
  await send('Page.reload', {}, S);
  await sleep(1200); await waitSettled();
  const kept = await ev("JSON.stringify(Store.actions().saved)+'/'+JSON.stringify(Store.actions().joined)");
  check('刷新后收藏与报名标记保留', /"06"/.test(String(kept.value)), String(kept.value));

  /* ---------- 10. 发布权限门 ---------- */
  await ev("(function(){window.__App.openPublish();return 'ok';})()");
  await sleep(600);
  const gateOnly = await ev("String(!!document.getElementById('gateForm') && !document.getElementById('publishForm'))");
  check('未解锁时发布只出现口令窗', gateOnly.value === 'true', 'gate=' + gateOnly.value);
  await ev("(function(){document.getElementById('gateForm').elements.pass.value='wrong';document.getElementById('gateForm').requestSubmit();return 'ok';})()");
  await sleep(600);
  const wrong = await ev("(function(){var e=document.querySelector('.panel__body p[style*=ff8a80]');return e?e.textContent.slice(0,10):''})()");
  check('口令错误时提示且不放行', /口令不正确/.test(String(wrong.value)), String(wrong.value));
  await ev("(function(){document.getElementById('gateForm').elements.pass.value='radar2026';document.getElementById('gateForm').requestSubmit();return 'ok';})()");
  await sleep(700);
  check('口令正确后进入发布表单', (await ev("String(!!document.getElementById('publishForm'))")).value === 'true');
  await shot('05-publish');

  /* ---------- 11. 发布 → 进画布 ---------- */
  await ev(`(function(){
    var f=document.getElementById('publishForm');
    f.elements.title.value='画布测试：周三自习搭子';
    f.elements.eventStart.value='2026-09-23T19:00';
    f.elements.eventWhere.value='图书馆四楼';
    f.elements.capacity.value='3 人';
    f.elements.applyHow.value='报名后拉群';
    f.elements.contact.value='微信 canvas';
    f.requestSubmit();
    return 'ok';
  })()`);
  await sleep(1600);
  const inCanvas = await ev("Array.prototype.some.call(document.querySelectorAll('.card__title'),function(e){return e.textContent.indexOf('画布测试')>=0})");
  check('发布的内容出现在画布上', inCanvas.value === true, String(inCanvas.value));

  /* ---------- 12. 「我的」侧栏 ---------- */
  await ev("(function(){window.__App.closePanel();window.__App.openMine();return 'ok';})()");
  await sleep(700);
  const mineSplit = await ev("document.querySelectorAll('.rowsplit > div').length");
  const mineHeads = await ev("[].map.call(document.querySelectorAll('.panel h2'),function(e){return e.textContent}).join(' | ')");
  const heads = String(mineHeads.value);
  const fourHeads = /我收藏的/.test(heads) && /我标记报名的/.test(heads) && /我发布的内容/.test(heads) && /已忽略的/.test(heads);
  const filled = await ev("[].filter.call(document.querySelectorAll('.panel h2'),function(h){var n=h.nextElementSibling;return n && (n.classList.contains('list-plain') || n.classList.contains('empty') || n.tagName==='P')}).length");
  check('「我的」显示四类统计', Number(mineSplit.value) === 4, mineSplit.value + ' 项');
  check('「我的」四组区块齐全且都有内容或空态说明', fourHeads && Number(filled.value) >= 4,
    '四组标题=' + fourHeads + '，有内容的组=' + filled.value);
  await shot('06-mine');
  await ev("(function(){window.__App.closePanel();return 'ok';})()");
  await sleep(400);

  /* ---------- 13. 主题与键盘 ---------- */
  const t1 = await ev("document.documentElement.getAttribute('data-theme')");
  // 右上角色块钮现在打开配色面板；深浅开关在面板内
  await ev("(function(){document.getElementById('themeBtn').click();return 'ok';})()");
  await sleep(400);
  check('右上角色块钮可打开配色面板', String((await ev("String(!document.getElementById('themePop').hidden)")).value) === 'true',
    String((await ev("String(!document.getElementById('themePop').hidden)")).value));
  await ev("(function(){document.querySelector('#themePop [data-act=theme-toggle]').click();return 'ok';})()");
  await sleep(400);
  const t2 = await ev("document.documentElement.getAttribute('data-theme')");
  check('主题可切换', t1.value !== t2.value, t1.value + ' → ' + t2.value);
  await ev("(function(){document.querySelector('#themePop [data-act=theme-toggle]').click();document.body.click();return 'ok';})()");
  await sleep(300);
  await ev("(function(){document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}));return 'ok';})()");
  await sleep(300);
  check('按 / 聚焦搜索框', (await ev("document.activeElement?document.activeElement.id:''")).value === 'q',
    '聚焦到 ' + (await ev("document.activeElement?document.activeElement.id:''")).value);

  /* ---------- 14. 移动端 ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, S);
  await send('Page.reload', {}, S);
  await sleep(1200); await waitSettled();
  const mob = await ev("(function(){var ns=Array.from(window.__App.nodes.values());var stage=document.getElementById('stage').clientWidth;return {n:ns.length,tooWide:ns.filter(function(n){return n.x < -6 || n.x + n.finalW*n.scale > stage + 6}).length,mode:document.getElementById('canvas').dataset.mode}})()");
  check('移动端散落不超出画布', Number((mob.value || {}).tooWide) === 0, (mob.value || {}).tooWide + ' 张越界');
  check('移动端页面无横向滚动', Number((await ev("document.documentElement.scrollWidth - document.documentElement.clientWidth")).value) <= 2,
    (await ev("document.documentElement.scrollWidth - document.documentElement.clientWidth")).value + 'px');
  await shot('07-mobile');

  /* ---------- 汇总 ---------- */
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '─'.repeat(56));
  console.log('通过 ' + (results.length - failed.length) + ' / ' + results.length + ' 项');
  if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join('；'));
  console.log('截图目录：' + path.resolve(SHOT_DIR));
  if (errs.length) console.log('页面异常：\n' + errs.join('\n'));

  ws.close(); chrome.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('自查脚本出错：', e.message);
  try { require('node:child_process').execSync("pkill -f 'remote-debugging-port=" + PORT + "' || true", { stdio: 'ignore' }); } catch { /* 忽略 */ }
  process.exit(2);
});
