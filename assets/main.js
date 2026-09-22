'use strict';

/* ==========================================================================
   校园雷达 · 壳层（编辑式版）
   路由、全局事件、发布、导出、主题、启动
   ========================================================================== */

(function () {
  const App = window.App;
  const DATA = App.DATA;
  const Store = App.Store;
  const Radar = App.Radar;

  const appEl = document.getElementById('app');
  let lastPath = null;
  let searchTimer = null;

  /* ======================= 路由 ======================= */

  const TITLES = { '': '今天', list: '索引', calendar: '时间轴', item: '详情', publish: '发布', mine: '我的' };

  function render() {
    const { path, query } = App.parseHash();
    const segs = path.split('/').filter(Boolean);
    const V = App.Views;
    let html;

    if (segs.length === 0) html = V.today(query);
    else if (segs[0] === 'list') html = V.list(query);
    else if (segs[0] === 'calendar') html = V.calendar(query);
    else if (segs[0] === 'item') html = V.detail(segs[1]);
    else if (segs[0] === 'publish') html = V.publish(query);
    else if (segs[0] === 'mine') html = V.mine(query);
    else html = V.missing();

    appEl.innerHTML = html;
    document.title = (TITLES[segs[0] || ''] || '页面') + ' · ' + DATA.productName;

    if (lastPath !== path) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      lastPath = path;
    }
    syncNav(segs[0] || '');
    V.afterRender(segs[0] || '', query);
  }

  function syncNav(first) {
    const pub = document.querySelector('#nav a[data-nav="publish"]');
    if (pub) pub.hidden = !Store.adminUnlocked();
    document.querySelectorAll('#nav a[data-nav]').forEach((a) => {
      const target = a.getAttribute('data-nav');
      const active = target === '' ? first === '' : first === target;
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ======================= 事件 ======================= */

  appEl.addEventListener('input', (e) => {
    const role = e.target.getAttribute && e.target.getAttribute('data-role');
    if (role === 'search') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => App.Views.refreshList(readToolbar()), 160);
    }
    if (e.target.closest && e.target.closest('#publishForm')) App.Views.refreshPreview();
  });

  appEl.addEventListener('change', (e) => {
    const role = e.target.getAttribute && e.target.getAttribute('data-role');
    if (role === 'sort') App.Views.refreshList(readToolbar());
    if (e.target.id === 'importFile') handleImport(e.target.files && e.target.files[0]);
  });

  appEl.addEventListener('submit', (e) => {
    const id = e.target.id;

    if (id === 'adminForm') {
      e.preventDefault();
      const pass = String(e.target.elements.pass.value || '');
      if (Store.verifyAdmin(pass)) {
        Store.setAdminUnlocked(true);
        App.toast('口令正确，已进入发布页');
        render();
      } else {
        App.setPublishError('口令不正确，请重试。');
        render();
        const box = document.getElementById('adminPass');
        if (box) box.focus();
      }
      return;
    }

    if (id === 'profileForm') {
      e.preventDefault();
      const f = e.target;
      Store.saveProfile({
        nickname: String(f.elements.nickname.value || '').trim(),
        grade: Number(f.elements.grade.value) || 1,
        hours: Number(f.elements.hours.value) || 0,
        interests: Array.from(f.querySelectorAll('input[name="interests"]:checked')).map((x) => x.value)
      });
      App.toast('已保存，判定已按新情况重算');
      render();
      return;
    }

    if (id === 'adminPassForm') {
      e.preventDefault();
      const f = e.target;
      const cur = String(f.elements.cur.value || '');
      const next = String(f.elements.next.value || '');
      const again = String(f.elements.again.value || '');
      if (!Store.verifyAdmin(cur)) { App.toast('当前口令不正确'); render(); return; }
      if (next.length < 4) { App.toast('新口令至少 4 位'); render(); return; }
      if (next !== again) { App.toast('两次输入的新口令不一致'); render(); return; }
      Store.setAdminPass(next);
      App.toast('管理员口令已更新');
      render();
      return;
    }

    if (id === 'publishForm') {
      e.preventDefault();
      handlePublish(e.target);
    }
  });

  appEl.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');

    if (action === 'save' || action === 'join') {
      const kind = action === 'save' ? 'saved' : 'joined';
      const a = Store.toggle(kind, id);
      const on = a[kind].indexOf(id) >= 0;
      App.toast(on ? (kind === 'saved' ? '已收藏，可在「我的」里查看' : '已标记报名')
                   : (kind === 'saved' ? '已取消收藏' : '已取消报名标记'));
      render();
      return;
    }

    if (action === 'toggle-saved' || action === 'toggle-joined' || action === 'toggle-hidden') {
      const kind = { 'toggle-saved': 'saved', 'toggle-joined': 'joined', 'toggle-hidden': 'hidden' }[action];
      Store.toggle(kind, id);
      App.toast({ saved: '已取消收藏', joined: '已取消报名标记', hidden: '已恢复显示' }[kind]);
      render();
      return;
    }

    if (action === 'hide') {
      Store.toggle('hidden', id);
      App.toast('已设为不感兴趣，可在「我的 → 已忽略的」里恢复');
      history.replaceState(null, '', '#/list');
      render();
      return;
    }

    if (action === 'tab') {
      App.setTab(btn.getAttribute('data-tab'));
      render();
      return;
    }

    if (action === 'copy-link') {
      const url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => App.toast('链接已复制'), () => window.prompt('手动复制：', url));
      } else {
        window.prompt('手动复制：', url);
      }
      return;
    }

    if (action === 'report') {
      const n = Store.report(id);
      App.toast('已记录你的反馈，累计被举报 ' + n + ' 次' + (n >= 3 ? '，已自动降权' : ''));
      render();
      return;
    }

    if (action === 'delete-mine') {
      if (!window.confirm('删除你发布的这条内容？删除后无法恢复。')) return;
      Store.removeUserItem(id);
      App.toast('已删除');
      location.hash = '#/mine';
      render();
      return;
    }

    if (action === 'admin-logout') {
      Store.setAdminUnlocked(false);
      App.toast('已退出发布权限');
      location.hash = '#/';
      render();
      return;
    }

    if (action === 'quick-publish') { App.Views.applyTemplate(btn.getAttribute('data-tpl')); return; }

    if (action === 'export-ics') { exportIcs(); return; }

    if (action === 'export-json') {
      download(Store.exportAll(), DATA.storageKey + '-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
      App.toast('已导出备份');
      return;
    }

    if (action === 'import-trigger') {
      const input = document.getElementById('importFile');
      if (input) input.click();
      return;
    }

    if (action === 'reset-mine') {
      if (!window.confirm('清空我的发布、收藏与报名标记？（材料里的 26 条信息不受影响）')) return;
      Store.resetUserData();
      App.toast('已清空个人数据');
      render();
    }
  });

  function readToolbar() {
    const q = {};
    const term = document.getElementById('q');
    if (term && term.value.trim()) q.q = term.value.trim();
    const sort = document.getElementById('sortSel');
    if (sort && sort.value) q.sort = sort.value;
    const cur = App.parseHash().query;
    ['window', 'cat', 'source', 'feasible', 'hidden'].forEach((k) => { if (cur[k]) q[k] = cur[k]; });
    return q;
  }

  /* ======================= 发布 ======================= */

  function handlePublish(form) {
    if (!Store.adminUnlocked()) {
      App.toast('发布需要管理员口令');
      location.hash = '#/publish';
      return;
    }
    const raw = {
      title: form.elements.title.value,
      cat: form.elements.cat.value,
      type: form.elements.type.value,
      eventStart: form.elements.eventStart.value ? form.elements.eventStart.value.replace('T', ' ') : null,
      whatIf: form.elements.whatIf ? form.elements.whatIf.value : '',
      whereUnconfirmed: !(form.elements.whereConfirmed && form.elements.whereConfirmed.checked),
      eventWhere: form.elements.eventWhere.value,
      capacity: form.elements.capacity.value,
      effort: form.elements.effort.value,
      signupBy: form.elements.signupBy.value ? form.elements.signupBy.value.replace('T', ' ') : null,
      applyHow: form.elements.applyHow.value,
      contact: form.elements.contact.value,
      publisher: Store.profile().nickname ? Store.profile().nickname + '（学生）' : '学生个人发布',
      mustKnow: form.elements.mustKnow.value.split('\n').map((s) => s.trim()).filter(Boolean),
      tags: form.elements.tags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    };
    if (!raw.title.trim()) { App.toast('请先填活动名称'); form.elements.title.focus(); return; }
    if (!raw.contact.trim()) { App.toast('请留一个联系方式'); form.elements.contact.focus(); return; }
    if (!raw.eventStart && !window.confirm('没填具体活动时间，这条会以「时间未注明」发布。确认继续？')) return;

    const item = Store.saveUserItem(raw);
    const gaps = Radar.publishGaps(item);
    App.toast(gaps.length ? '已发布。还缺 ' + gaps.join('、') : '已发布，信息完整度检查通过 ✓');
    location.hash = '#/item/' + item.id;
    render();
  }

  /* ======================= 导入导出 ======================= */

  function handleImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        Store.importAll(String(reader.result));
        App.toast('已导入你的数据');
        render();
      } catch (err) { window.alert('导入失败：' + err.message); }
    };
    reader.readAsText(file);
  }

  function download(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  }

  function icsText(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function exportIcs() {
    const nowD = App.now.value();
    const items = App.visible(Store.profile(), false).filter((it) => it.fit.level !== 'blocked');
    const fmt = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      'T' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '00';
    const stamp = fmt(new Date()) + 'Z';
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CampusRadar//CN\r\nCALSCALE:GREGORIAN\r\n';
    let n = 0;
    for (const it of items) {
      if (it.deadline && it.deadline.ms > 0) {
        n += 1;
        ics += 'BEGIN:VEVENT\r\nUID:' + it.id + '-deadline@campus-radar\r\nDTSTAMP:' + stamp + '\r\n' +
          'DTSTART:' + fmt(it.deadline.at) + '\r\nDTEND:' + fmt(new Date(it.deadline.at.getTime() + 1800000)) + '\r\n' +
          'SUMMARY:【报名截止】' + icsText(it.title) + '\r\n' +
          'DESCRIPTION:' + icsText('报名方式：' + it.applyHow + (it.eventWhere ? ' 地点：' + it.eventWhere : '')) + '\r\n' +
          'BEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:明天报名截止\r\nEND:VALARM\r\nEND:VEVENT\r\n';
      }
      if (it.eventStart) {
        const s = Radar.parse(it.eventStart, true);
        if (s && s >= nowD) {
          n += 1;
          ics += 'BEGIN:VEVENT\r\nUID:' + it.id + '-event@campus-radar\r\nDTSTAMP:' + stamp + '\r\n' +
            'DTSTART:' + fmt(s) + '\r\nDTEND:' + fmt(new Date(s.getTime() + 3600000)) + '\r\n' +
            'SUMMARY:' + icsText(it.title) + '\r\n' +
            'LOCATION:' + icsText(it.eventWhere || '未注明') + '\r\n' +
            'DESCRIPTION:' + icsText(it.audience || '') + '\r\nEND:VEVENT\r\n';
        }
      }
    }
    ics += 'END:VCALENDAR\r\n';
    download(ics, 'campus-radar.ics', 'text/calendar');
    App.toast('已导出 ' + n + ' 个日历事件（报名截止 + 活动开始）');
  }

  /* ======================= 主题 ======================= */

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    const btn = document.getElementById('themeBtn');
    if (btn) {
      btn.textContent = mode === 'dark' ? 'D' : 'L';
      btn.title = '当前：' + (mode === 'dark' ? '深色' : '浅色') + '（点击切换）';
    }
  }

  document.getElementById('themeBtn').addEventListener('click', () => {
    const next = Store.readTheme() === 'dark' ? 'light' : 'dark';
    Store.writeTheme(next);
    applyTheme(next);
    App.toast('已切换为' + (next === 'dark' ? '深色' : '浅色'));
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === '/') {
      const box = document.getElementById('q');
      if (box) { e.preventDefault(); box.focus(); box.select(); }
    }
  });

  window.addEventListener('hashchange', render);

  App.render = render;

  /* ======================= 启动 ======================= */

  (function boot() {
    const added = Store.seedAdded();
    Store.sync();
    document.getElementById('brandName').textContent = DATA.productName;
    document.getElementById('footerText').textContent = DATA.productName + ' · ' + DATA.tagline;
    const tag = document.getElementById('buildTag');
    if (tag) tag.textContent = '构建 ' + (DATA.build || '—');
    if (added.length) console.info('[校园雷达] 新增 ' + added.length + ' 条信息');
    applyTheme(Store.readTheme() === 'dark' ? 'dark' : 'light');
    render();
  })();
})();
