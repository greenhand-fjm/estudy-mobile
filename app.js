/* estudy 离线学习。题库、判分、作答事件均在本机；同步文件不依赖局域网服务。 */
(function () {
  'use strict';
  var D = window.ESTUDY_DATA || {};
  var E = window.EstudyEngine.create(D);
  var SENTENCES = D.sentences || [];
  var BY_ID = Object.create(null);
  SENTENCES.forEach(function (s) { BY_ID[s.id] = s; });
  var KEY = 'estudy.standalone.v1';
  var state = {
    v: 1, device_id: uid('phone'), book: [], book_day: D.day || today(), books: [],
    baseline: D.records || {}, acknowledged: [], attempts: [], imports: [],
    records: {}, queue: [], idx: 0, answers: [], graded: null, tab: 'today', mode: 'book'
  };
  var view = document.getElementById('view');
  var storageError = '';
  var toastTimer;

  function uid(prefix) {
    var id;
    if (window.crypto && crypto.randomUUID) id = crypto.randomUUID();
    else if (window.crypto && crypto.getRandomValues) {
      var a = new Uint32Array(4); crypto.getRandomValues(a);
      id = Array.from(a).map(function (n) { return n.toString(16); }).join('-');
    } else id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return prefix + '-' + id;
  }
  function today() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cleanBook(entries) {
    if (!Array.isArray(entries) || entries.length > 30000) throw new Error('词单格式不正确');
    var seen = Object.create(null);
    return entries.map(function (x) {
      if (typeof x === 'string') x = { word: x };
      return { word: String(x.word || '').trim(), meaning: String(x.meaning || '').slice(0, 2000) };
    }).filter(function (x) {
      var k = x.word.toLowerCase();
      if (!/^[A-Za-z][A-Za-z'’\- ]{0,79}$/.test(x.word) || seen[k]) return false;
      seen[k] = true; return true;
    });
  }
  function archive(day, entries) {
    var b = state.books.find(function (b) { return b.day === day; });
    if (!b) { b = { day: day, entries: [] }; state.books.push(b); }
    b.entries = cleanBook(b.entries.concat(entries));
  }
  function eventKey(a) {
    if (a.event_id) return a.event_id;
    return 'legacy-' + JSON.stringify([a.id, a.ts, (a.slots || []).map(function (x) { return x.typed || ''; })]);
  }
  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); }
    catch (e) { storageError = '浏览器禁止保存数据，请退出隐私浏览后使用。'; return false; }
    if (!raw) return false;
    try {
      var obj = JSON.parse(raw);
      if (!obj || obj.v !== 1 || !Array.isArray(obj.attempts)) throw new Error('存储格式异常');
      state.device_id = obj.device_id || state.device_id;
      state.book = cleanBook(obj.book || []);
      state.book_day = obj.book_day || D.day || today();
      state.books = obj.books || [];
      state.attempts = obj.attempts;
      state.baseline = obj.baseline || obj.records || {};
      // 旧版 records 已含旧版作答，迁移时先标记这些事件，防止重加。
      state.acknowledged = obj.acknowledged || (obj.baseline ? [] : obj.attempts.map(eventKey));
      state.imports = obj.imports || [];
      if (obj.session) {
        state.queue = (obj.session.queue || []).filter(function (id) { return !!BY_ID[id]; });
        state.idx = obj.session.idx || 0;
        state.answers = obj.session.answers || [];
        state.graded = obj.session.graded || null;
        state.mode = obj.session.mode || 'book';
      }
      archive(state.book_day, state.book);
      return true;
    } catch (e) {
      storageError = '原有记录无法读取，已保留原数据。请先导出备份，不要清除浏览器数据。';
      return true; // 绝不静默覆盖坏数据。
    }
  }
  function save() {
    if (storageError) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 1, device_id: state.device_id, book: state.book, book_day: state.book_day,
        books: state.books, baseline: state.baseline, acknowledged: state.acknowledged,
        attempts: state.attempts, imports: state.imports,
        session: { queue: state.queue, idx: state.idx, answers: state.answers,
                   graded: state.graded, mode: state.mode }, at: Date.now()
      }));
      return true;
    } catch (e) {
      storageError = '本机空间不足，记录尚未保存。请立即导出记录备份。';
      showStorageError(); return false;
    }
  }
  function showStorageError() {
    var el = document.getElementById('storage-warning');
    if (el) { el.textContent = storageError; el.hidden = !storageError; }
  }
  function applyEvent(a) {
    var s = BY_ID[a.id];
    if (!s) return;
    s.t.forEach(function (target, i) {
      var x = (a.slots || [])[i] || {};
      var typed = x.typed || '';
      if (!typed.trim()) return;
      var r = E.judge(typed, target, E.slotOf(s, i), { siblings: s.t });
      var k = E.normalize(target);
      var rec = state.records[k] || { seen: 0, correct: 0, wrong: 0, box: 1 };
      rec.seen += 1;
      // 与桌面 record_attempt 一致：warn 不是 ok，保留其错误计数语义。
      if (r.status === 'ok') { rec.correct += 1; rec.box = Math.min(5, rec.box + 1); }
      else { rec.wrong += 1; rec.box = 1; }
      state.records[k] = rec;
    });
  }
  function rebuildRecords() {
    state.records = clone(state.baseline);
    var ack = new Set(state.acknowledged);
    state.attempts.forEach(function (a) { if (!ack.has(eventKey(a))) applyEvent(a); });
  }

  // 题库索引：只处理词形键，几千词的选题也不需要两两匹配。
  var stemIndex = Object.create(null);
  SENTENCES.forEach(function (s) {
    s.t.forEach(function (t) {
      Object.keys(E.stemKeys(t)).forEach(function (k) {
        if (!stemIndex[k]) stemIndex[k] = new Set();
        stemIndex[k].add(s.id);
      });
    });
  });
  function wrongWords() {
    return Object.keys(state.records).filter(function (k) { return state.records[k].wrong > 0; })
      .map(function (k) { return Object.assign({ word: k }, state.records[k]); })
      .sort(function (a, b) { return b.wrong - a.wrong; });
  }
  function pickQueue(words) {
    var hits = Object.create(null);
    var previous = new Set(state.attempts.map(function (a) { return a.id; }));
    (words || []).forEach(function (w) {
      var ids = new Set();
      Object.keys(E.stemKeys(w)).forEach(function (k) {
        if (stemIndex[k]) stemIndex[k].forEach(function (id) { ids.add(id); });
      });
      ids.forEach(function (id) { hits[id] = (hits[id] || 0) + 1; });
    });
    return Object.keys(hits).sort(function (a, b) {
      return Number(previous.has(a)) - Number(previous.has(b)) || hits[b] - hits[a] ||
        (BY_ID[a].lvl || 4) - (BY_ID[b].lvl || 4) || a.localeCompare(b);
    }).slice(0, 20);
  }
  function start(mode) {
    state.mode = mode;
    if (mode === 'all') state.queue = SENTENCES.slice().sort(function (a,b) { return (a.lvl || 4) - (b.lvl || 4); }).slice(0,20).map(function (s) { return s.id; });
    else state.queue = pickQueue(mode === 'wrong' ? wrongWords().map(function (w) { return w.word; }) : state.book.map(function (w) { return w.word; }));
    state.idx = 0; state.answers = []; state.graded = null; state.tab = 'drill'; save(); render();
  }
  function submit() {
    var s = BY_ID[state.queue[state.idx]];
    if (!s || state.graded || storageError) return;
    var slots = [], ok = true;
    s.t.forEach(function (target, i) {
      var typed = (state.answers[i] || '').trim();
      var r = E.judge(typed, target, E.slotOf(s, i), { siblings: s.t });
      slots.push(Object.assign({ index: i, target: target, typed: typed }, r));
      if (r.status === 'bad' || r.status === 'empty') ok = false;
    });
    var a = { event_id: uid(state.device_id), device_id: state.device_id,
      ts: new Date().toISOString(), id: s.id, ok: ok, slots: slots, book_day: state.book_day };
    state.attempts.push(a); applyEvent(a);
    state.graded = { ok: ok, slots: slots, sentence: E.sentenceDisplay(s) };
    save(); render();
  }

  function renderToday() {
    var n = state.attempts.length, correct = state.attempts.filter(function (a) { return a.ok; }).length;
    var matches = pickQueue(state.book.map(function (w) { return w.word; }));
    var html = '<h1>今日</h1><p class="sub">词单归档于 ' + esc(state.book_day) + '，练习和批改在手机完成</p>';
    html += '<div class="stats"><div class="stat"><b>' + state.book.length + '</b><span>词单单词</span></div>' +
      '<div class="stat"><b>' + matches.length + '</b><span>本轮可练句子</span></div><div class="stat"><b>' + wrongWords().length + '</b><span>累计错词</span></div></div>';
    html += '<p class="sub">手机保存 ' + n + ' 次作答' + (n ? '，正确率 ' + Math.round(correct/n*100) + '%' : '') + '。导出记录后可并回电脑。</p>';
    if (state.book.length) {
      html += '<div class="card"><h2>这批背过的词</h2><div class="chips">' + state.book.slice(0,60).map(function (w) {
        return '<span class="chip">' + esc(w.word) + '</span>';
      }).join('') + '</div>' + (state.book.length > 60 ? '<p class="sub">还有 ' + (state.book.length-60) + ' 个词</p>' : '') + '</div>';
    } else html += '<div class="empty"><b>导入背过的词</b><p>在电脑导出词单 JSON，传到 iPhone 的“文件”，再点下方“导入桌面记录”。现在也能先练内置题库。</p></div>';
    html += '<button class="primary big" data-act="book">练这批词的句子</button><div class="row">' +
      '<button class="ghost" data-act="all">先练内置句子</button><button class="ghost" data-act="export">导出记录</button>' +
      '<button class="ghost" data-act="import">导入桌面记录</button></div>';
    if (state.books.length > 1) html += '<details class="archive"><summary>历史词单（' + state.books.length + ' 天）</summary>' + state.books.map(function (b,i) {
      return '<button class="ghost" data-archive="' + i + '">' + esc(b.day) + '，' + b.entries.length + ' 个词</button>';
    }).join('') + '</details>';
    html += '<p class="hint">保存在本机的学习记录不会上传。定期导出备份；清除 Safari 网站数据会删除本机记录。</p>';
    view.innerHTML = html;
  }
  function renderDrill() {
    var s = BY_ID[state.queue[state.idx]];
    if (!s) {
      view.innerHTML = '<div class="empty"><b>' + (state.queue.length ? '这一轮做完了' : '这批词暂无对应句子') + '</b><p>' +
        (state.queue.length ? '错词已保存在手机，可以到错词页重练。' : '题库尚未覆盖所有单词。可以先练内置句子，或导入另一批词。') +
        '</p><button class="primary" data-act="all">练内置句子</button></div>'; return;
    }
    if (state.answers.length !== s.t.length) state.answers = new Array(s.t.length).fill('');
    var g = state.graded;
    var html = '<p class="sub">第 ' + (state.idx+1) + ' / ' + state.queue.length + ' 题' + (state.mode === 'wrong' ? '，错词专项' : '') + '</p>';
    html += '<progress aria-label="本轮进度" max="' + state.queue.length + '" value="' + (state.idx + (g ? 1 : 0)) + '"></progress><h1 class="zh">' + esc(s.zh) + '</h1><div class="blanks">';
    s.t.forEach(function (tok,i) {
      var r = g && g.slots[i];
      html += '<span class="word-slot"><input class="blank' + (r ? (r.status === 'ok' ? ' good' : r.status === 'warn' ? ' warn' : ' bad') : '') + '" data-i="' + i +
        '" aria-label="第 ' + (i+1) + ' 个单词" value="' + esc(state.answers[i]) + '" size="' + Math.max(2,tok.length+1) + '" maxlength="120" enterkeyhint="' +
        (i === s.t.length-1 ? 'done' : 'next') + '" ' + (g ? 'readonly ' : '') + 'autocomplete="off" autocapitalize="off" spellcheck="false">';
      var mark = (s.punct || {})[String(i)] || (i === s.t.length-1 ? s.punc : '');
      if (mark) html += '<span class="punct">' + esc(mark) + '</span>';
      html += '</span>';
    });
    html += '</div>';
    if (g) {
      html += '<div class="card ' + (g.ok ? 'okcard' : 'badcard') + '"><b>' + (g.ok ? '全对，已保存' : '已保存，看看这些空') + '</b><p class="mono">' + esc(g.sentence) + '</p>';
      g.slots.forEach(function (x) { if (x.status !== 'ok') html += '<p class="why"><em>' + esc(x.title) + '</em> ' + esc(x.detail) + '</p>'; });
      html += '</div><button class="primary big" data-act="next">下一题</button>';
    } else html += '<button class="primary big" data-act="check">检查</button>';
    view.innerHTML = html;
    view.querySelectorAll('input.blank').forEach(function (inp) {
      inp.addEventListener('input', function () { state.answers[+inp.dataset.i] = inp.value; save(); });
      inp.addEventListener('focus', function () { setTimeout(function () { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); },300); });
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || state.graded) return;
        e.preventDefault();
        var next = view.querySelector('input[data-i="' + (+inp.dataset.i + 1) + '"]');
        if (next) next.focus(); else submit();
      });
    });
  }
  function renderWrong() {
    var ws = wrongWords();
    view.innerHTML = '<h1>错词</h1><p class="sub">来自保存的学习记录，按累计错次排列</p>' + (!ws.length ? '<div class="empty">还没有错词。完成练习后这里会更新。</div>' :
      '<div class="card">' + ws.map(function (w) { return '<div class="wrow"><span class="mono">' + esc(w.word) + '</span><span class="muted">错 ' + w.wrong + ' 次 / ' + w.seen + ' 次作答</span></div>'; }).join('') +
      '</div><button class="primary big" data-act="retry">再练这些词</button><button class="ghost" data-act="export">导出记录带回电脑</button>');
  }
  function render() {
    if (state.tab === 'drill') renderDrill(); else if (state.tab === 'wrong') renderWrong(); else renderToday();
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('is-on',t.dataset.tab === state.tab); });
    showStorageError();
  }

  // 快照为基线，未被电脑确认的作答为增量。双向多次往返不会重复加次数。
  function mergePack(obj) {
    if (!obj || obj.app !== 'estudy-standalone' || obj.v !== 1) throw new Error('请选择 estudy 导出的记录 JSON');
    var incoming = cleanBook(obj.book || []);
    var books = obj.books || [];
    if (!Array.isArray(books) || books.length > 4000 || !Array.isArray(obj.attempts || []) || (obj.attempts || []).length > 100000) throw new Error('文件内容过大或格式异常');
    if (obj.kind === 'desktop-export') {
      if (!obj.export_id || !obj.records || typeof obj.records !== 'object' || Array.isArray(obj.records)) throw new Error('桌面记录缺少快照编号或掌握度');
      if (state.imports.indexOf(obj.export_id) >= 0) return false;
      state.baseline = clone(obj.records);
      state.acknowledged = Array.from(new Set(state.acknowledged.concat(obj.acknowledged_event_ids || [])));
      state.imports.push(obj.export_id);
    } else {
      var ids = new Set(state.attempts.map(eventKey));
      (obj.attempts || []).forEach(function (a) {
        if (!BY_ID[a.id] || !Array.isArray(a.slots) || a.slots.length !== BY_ID[a.id].t.length || !a.ts || isNaN(Date.parse(a.ts))) throw new Error('作答记录不完整');
        var k = eventKey(a);
        if (!ids.has(k)) { state.attempts.push(clone(a)); ids.add(k); }
      });
    }
    books.forEach(function (b) { if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw new Error('归档日期不正确'); archive(b.day,cleanBook(b.entries)); });
    if (incoming.length) {
      state.book = incoming;
      state.book_day = /^\d{4}-\d{2}-\d{2}$/.test(obj.book_day || '') ? obj.book_day : '日期未知';
      archive(state.book_day,incoming);
    }
    rebuildRecords(); state.queue = []; state.answers = []; state.idx = 0; state.graded = null; state.tab = 'today';
    return true;
  }
  function importRecords() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 20*1024*1024) { toast('记录文件超过 20 MB，请在电脑分批导出'); return; }
      f.text().then(function (text) {
        var snapshot = clone(state);
        try {
          var changed = mergePack(JSON.parse(text));
          save(); render(); toast(changed ? '记录已导入，重复作答已跳过' : '这份桌面记录已经导入过');
        } catch (e) { state = snapshot; toast('未导入：' + e.message); }
      }).catch(function (e) { toast('无法读取文件：' + e.message); });
    };
    inp.click();
  }
  async function exportRecords() {
    var payload = { app: 'estudy-standalone', v: 1, device_id: state.device_id,
      exported_at: new Date().toISOString(), book_day: state.book_day, book: state.book,
      books: state.books.filter(function (b) { return /^\d{4}-\d{2}-\d{2}$/.test(b.day); }),
      records: state.records, attempts: state.attempts };
    var text = JSON.stringify(payload,null,2);
    var name = 'estudy-手机记录-' + today() + '.json';
    var blob = new Blob([text],{type:'application/json'});
    try {
      // iPhone 分享表单可直接保存到“文件”或发送到自己的电脑。
      var file = typeof File !== 'undefined' ? new File([text],name,{type:'application/json'}) : null;
      if (file && navigator.canShare && navigator.canShare({files:[file]})) {
        await navigator.share({files:[file],title:'estudy 学习记录'}); return;
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); },3000);
      toast('记录已导出，请保存好这个 JSON 文件');
    } catch (e) { if (e.name !== 'AbortError') toast('导出失败，请重试：' + e.message); }
  }
  function toast(msg) {
    var el = document.getElementById('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; },4500);
  }
  document.addEventListener('click',function (e) {
    var t = e.target.closest('[data-tab],[data-act],[data-archive]'); if (!t) return;
    if (t.hasAttribute('data-tab')) { state.tab = t.dataset.tab; render(); return; }
    if (t.hasAttribute('data-archive')) { var b = state.books[+t.dataset.archive]; state.book = b.entries; state.book_day = b.day; save(); state.tab='today'; render(); return; }
    var act = t.dataset.act;
    if (act === 'book') start('book'); else if (act === 'all') start('all'); else if (act === 'retry') start('wrong');
    else if (act === 'check') submit(); else if (act === 'next') { state.idx++; state.answers=[]; state.graded=null; save(); render(); }
    else if (act === 'import') importRecords(); else if (act === 'export') exportRecords();
  });
  window.addEventListener('pagehide',save);
  window.addEventListener('estudy-before-update',save);
  if (!load()) { state.book=cleanBook(D.book || []); state.book_day=D.day || today(); archive(state.book_day,state.book); save(); }
  rebuildRecords(); render();
}());
