/* アプリ本体：取り込み・絞り込み・画面遷移 */
(function (global) {
  'use strict';

  var h = U.h;

  var state = {
    events: [],
    meta: null,
    analysis: null,
    view: 'dashboard',
    filters: {
      range: 'all',
      from: null,
      to: null,
      q: '',
      music: true,
      shorts: true,
      quick: true,
      dedupe: 300000
    }
  };

  var el = {};

  /* ================= 配色 ================= */

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('yt-theme'); } catch (e) { /* 保存できない設定でも動く */ }
    if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);

    el.theme.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var isDark = cur ? cur === 'dark'
        : global.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('yt-theme', next); } catch (e) { /* 無視 */ }
      document.dispatchEvent(new CustomEvent('themechange'));
    });
  }

  /* ================= 取り込み ================= */

  function showProgress(ratio, label) {
    el.progress.hidden = false;
    el.progressFill.style.width = Math.round(ratio * 100) + '%';
    if (label) el.progressLabel.textContent = label;
  }

  function showError(msg) {
    el.error.hidden = false;
    el.error.textContent = msg;
    el.progress.hidden = true;
  }

  function showNotice(msg) {
    el.notice.hidden = false;
    el.notice.textContent = msg;
  }

  /**
   * @param {FileList|File[]} files
   * @param {boolean} append 既に読み込んだデータに足すか（false なら置き換え）
   */
  async function handleFiles(files, append) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    el.error.hidden = true;
    el.notice.hidden = true;
    showProgress(0.02, '読み込みを開始しています…');
    try {
      var result = await Parser.loadFiles(list, showProgress);

      // 既存データがある場合は置き換えずに統合する
      if (append && state.events.length) {
        var merged = Parser.merge([
          { name: '読み込み済みのデータ', events: state.events },
          { name: result.meta.sourceName, events: result.events }
        ]);
        var added = merged.sources[1].added;
        result = {
          events: merged.events,
          meta: {
            sourceName: (state.meta && state.meta.sourceName ? state.meta.sourceName + '、' : '') + result.meta.sourceName,
            sources: (state.meta && state.meta.sources ? state.meta.sources : []).concat(result.meta.sources),
            importedAt: Date.now(),
            skipped: result.meta.skipped,
            warnings: result.meta.warnings
          }
        };
        showNotice('追加で ' + U.int(added) + ' 件が増えました（重複を除いて合計 ' + U.int(merged.events.length) + ' 件）');
      }

      showProgress(1, '完了');
      await adopt(result, el.persist.checked);

      if (result.meta.warnings && result.meta.warnings.length) {
        showNotice(result.meta.warnings.join('\n'));
      }
    } catch (err) {
      console.error(err);
      showError(err && err.message ? err.message : '読み込みに失敗しました');
    }
  }

  async function adopt(result, persist) {
    state.events = result.events;
    state.meta = result.meta;

    if (persist) {
      try {
        await Store.save({ events: result.events, meta: result.meta });
      } catch (e) {
        console.warn('保存できませんでした', e);
      }
    }
    enterApp();
  }

  /* ---- 統合データの書き出し ---- */

  function exportMerged() {
    if (!state.events.length) return;
    var payload = Parser.buildMergedFile(state.events, (state.meta && state.meta.sources) || []);
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var stamp = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'youtube-history-merged_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function initImport() {
    el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
    el.dropzone.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.fileInput.click(); }
    });
    el.fileInput.addEventListener('change', function () {
      handleFiles(el.fileInput.files, false);
    });

    // 分析画面から追加で読み込む
    el.addInput.addEventListener('change', function () {
      handleFiles(el.addInput.files, true);
      el.addInput.value = '';
    });
    el.add.addEventListener('click', function () { el.addInput.click(); });
    el.export.addEventListener('click', exportMerged);

    ['dragenter', 'dragover'].forEach(function (t) {
      el.dropzone.addEventListener(t, function (ev) {
        ev.preventDefault();
        el.dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      el.dropzone.addEventListener(t, function (ev) {
        ev.preventDefault();
        el.dropzone.classList.remove('is-over');
      });
    });
    el.dropzone.addEventListener('drop', function (ev) {
      var fs = ev.dataTransfer && ev.dataTransfer.files;
      if (fs && fs.length) handleFiles(fs, false);
    });
    // ページ外へのドロップでブラウザが遷移しないようにする
    global.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    global.addEventListener('drop', function (ev) { ev.preventDefault(); });

    el.demo.addEventListener('click', function () {
      adopt(Demo.generate(), false);
    });
  }

  /* ================= 絞り込み ================= */

  function buildRangeOptions() {
    var years = new Set();
    state.events.forEach(function (e) { years.add(new Date(e.t).getFullYear()); });
    var list = [
      { v: 'all', l: '全期間' },
      { v: '30', l: '直近30日' },
      { v: '90', l: '直近90日' },
      { v: '365', l: '直近1年' }
    ];
    Array.from(years).sort(function (a, b) { return b - a; }).forEach(function (y) {
      list.push({ v: 'y' + y, l: y + '年' });
    });
    list.push({ v: 'custom', l: '期間を指定' });

    U.clear(el.range);
    list.forEach(function (o) {
      el.range.appendChild(h('option', { value: o.v }, o.l));
    });
    el.range.value = 'all';
  }

  function rangeBounds() {
    var f = state.filters;
    if (f.range === 'all') return { from: null, to: null };
    if (f.range === 'custom') {
      return {
        from: f.from ? new Date(f.from + 'T00:00:00').getTime() : null,
        to: f.to ? new Date(f.to + 'T23:59:59.999').getTime() : null
      };
    }
    if (f.range.charAt(0) === 'y') {
      var y = Number(f.range.slice(1));
      return { from: new Date(y, 0, 1).getTime(), to: new Date(y, 11, 31, 23, 59, 59, 999).getTime() };
    }
    var days = Number(f.range);
    var last = state.events.length ? state.events[state.events.length - 1].t : Date.now();
    return { from: last - days * 86400000, to: null };
  }

  function readFilters() {
    var f = state.filters;
    f.range = el.range.value;
    f.from = el.from.value || null;
    f.to = el.to.value || null;
    f.q = el.search.value;
    f.music = el.music.checked;
    f.shorts = el.shorts.checked;
    f.quick = el.quick.checked;
    f.dedupe = Number(el.dedupe.value);
    el.custom.hidden = f.range !== 'custom';
  }

  function recompute() {
    var b = rangeBounds();
    var f = state.filters;
    var filtered = Analytics.filter(state.events, {
      from: b.from, to: b.to, q: f.q, music: f.music, shorts: f.shorts, quick: f.quick
    });
    var deduped = Analytics.dedupe(filtered, f.dedupe);
    state.analysis = Analytics.analyze(deduped);
    state.removedByDedupe = filtered.length - deduped.length;
    updateSummary();
  }

  function updateSummary() {
    var t = state.analysis.totals;
    var parts = [];
    parts.push(U.int(t.plays) + ' 回の再生');
    parts.push(U.int(t.uniqueVideos) + ' 本の動画');
    parts.push(U.int(t.uniqueChannels) + ' チャンネル');
    if (state.removedByDedupe > 0) {
      parts.push('短時間の重複 ' + U.int(state.removedByDedupe) + ' 件をまとめて集計');
    }
    if (state.events.length !== t.plays) {
      parts.push('全 ' + U.int(state.events.length) + ' 件から絞り込み');
    }
    el.summary.textContent = parts.join('　/　');
  }

  function initFilters() {
    var onChange = function () { readFilters(); recompute(); renderView(); };
    var onChangeDebounced = U.debounce(onChange, 220);

    el.range.addEventListener('change', onChange);
    el.from.addEventListener('change', onChange);
    el.to.addEventListener('change', onChange);
    el.dedupe.addEventListener('change', onChange);
    el.music.addEventListener('change', onChange);
    el.shorts.addEventListener('change', onChange);
    el.quick.addEventListener('change', onChange);
    el.search.addEventListener('input', onChangeDebounced);
  }

  /* ================= 画面 ================= */

  var VIEWS = {
    dashboard: Views.dashboard,
    videos: Views.videos,
    channels: Views.channels,
    discovery: Views.discovery,
    history: Views.history
  };

  function renderView() {
    U.$$('.tab', el.tabs).forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.view === state.view ? 'true' : 'false');
    });
    var fn = VIEWS[state.view] || Views.dashboard;
    U.clear(el.view);
    el.view.appendChild(fn(state.analysis, api));
  }

  function initTabs() {
    el.tabs.setAttribute('role', 'tablist');
    U.$$('.tab', el.tabs).forEach(function (b) {
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () {
        state.view = b.dataset.view;
        renderView();
        // 画面を切り替えたときだけ先頭に戻す（絞り込みの変更では動かさない）
        global.scrollTo(0, 0);
      });
    });
  }

  /* ================= 詳細パネル ================= */

  function openOverlay(title, node) {
    el.overlayTitle.textContent = title;
    U.clear(el.overlayBody).appendChild(node);
    el.overlay.hidden = false;
    el.overlayBody.scrollTop = 0;
    el.overlayClose.focus();
  }

  function closeOverlay() { el.overlay.hidden = true; }

  var api = {
    openVideo: function (key) {
      var v = state.analysis.videoMap.get(key);
      if (!v) return;
      openOverlay(v.title, Views.videoDetail(state.analysis, v, api));
    },
    openChannel: function (id) {
      var c = state.analysis.channelMap.get(id);
      if (!c) return;
      openOverlay(c.name, Views.channelDetail(state.analysis, c, api));
    },
    openMonth: function (key) {
      if (!key) return;
      openOverlay(U.fmtMonth(key), Views.monthDetail(state.analysis, key, api));
    }
  };

  function initOverlay() {
    el.overlayClose.addEventListener('click', closeOverlay);
    U.$('.overlay__backdrop', el.overlay).addEventListener('click', closeOverlay);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !el.overlay.hidden) closeOverlay();
    });
  }

  /* ================= 起動 ================= */

  // ヘッダーの件数表示にマウスを当てたときに出す、ソース別の内訳
  function buildSourceTooltip() {
    var m = state.meta || {};
    var lines = [];
    if (m.sources && m.sources.length) {
      lines.push('読み込んだファイル：');
      m.sources.forEach(function (s) {
        lines.push('  ' + s.name + '  ' + U.int(s.count) + ' 件（新規 ' + U.int(s.added) +
          ' / 重複 ' + U.int(s.duplicates === undefined ? s.count - s.added : s.duplicates) + '）');
      });
    }
    if (m.skipped && m.skipped.ads) {
      lines.push('広告として除外：' + U.int(m.skipped.ads) + ' 件');
    }
    if (m.skipped && m.skipped.search) {
      lines.push('検索の記録として除外：' + U.int(m.skipped.search) + ' 件');
    }
    return lines.join('\n');
  }

  function enterApp() {
    el.import.hidden = true;
    el.app.hidden = false;
    el.reset.hidden = false;
    el.add.hidden = false;
    el.export.hidden = false;
    el.source.hidden = false;

    var span = '';
    if (state.events.length) {
      span = U.fmtMonth(U.monthKey(state.events[0].t)) + '〜' +
             U.fmtMonth(U.monthKey(state.events[state.events.length - 1].t)) + '・';
    }
    // 間隔は絞り込む前の全期間の並びで測る（読み込んだ直後に 1 回だけ）
    Analytics.markGaps(state.events);

    el.source.textContent = span + U.int(state.events.length) + ' 件';
    el.source.title = buildSourceTooltip();

    buildRangeOptions();
    readFilters();
    recompute();
    renderView();
  }

  function initReset() {
    el.reset.addEventListener('click', async function () {
      if (!global.confirm('読み込んだ履歴をこのブラウザから削除します。よろしいですか？')) return;
      try { await Store.clear(); } catch (e) { /* 保存していない場合もある */ }
      state.events = [];
      state.meta = null;
      state.analysis = null;
      el.app.hidden = true;
      el.import.hidden = false;
      el.reset.hidden = true;
      el.add.hidden = true;
      el.export.hidden = true;
      el.source.hidden = true;
      el.progress.hidden = true;
      el.notice.hidden = true;
      el.fileInput.value = '';
    });
  }

  async function boot() {
    el = {
      import: U.$('#screen-import'),
      app: U.$('#screen-app'),
      dropzone: U.$('#dropzone'),
      fileInput: U.$('#file-input'),
      progress: U.$('#import-progress'),
      progressFill: U.$('#progress-fill'),
      progressLabel: U.$('#progress-label'),
      error: U.$('#import-error'),
      notice: U.$('#import-notice'),
      demo: U.$('#btn-demo'),
      persist: U.$('#opt-persist'),
      theme: U.$('#btn-theme'),
      reset: U.$('#btn-reset'),
      add: U.$('#btn-add'),
      addInput: U.$('#add-input'),
      export: U.$('#btn-export'),
      source: U.$('#source-label'),
      range: U.$('#f-range'),
      custom: U.$('#f-custom'),
      from: U.$('#f-from'),
      to: U.$('#f-to'),
      search: U.$('#f-search'),
      dedupe: U.$('#f-dedupe'),
      music: U.$('#f-music'),
      shorts: U.$('#f-shorts'),
      quick: U.$('#f-quick'),
      summary: U.$('#filter-summary'),
      tabs: U.$('#tabs'),
      view: U.$('#view'),
      overlay: U.$('#overlay'),
      overlayTitle: U.$('#overlay-title'),
      overlayBody: U.$('#overlay-body'),
      overlayClose: U.$('#overlay-close')
    };

    initTheme();
    initImport();
    initFilters();
    initTabs();
    initOverlay();
    initReset();

    // 前回この端末に保存した履歴があれば復元する
    try {
      var saved = await Store.load();
      if (saved && saved.events && saved.events.length) {
        state.events = saved.events;
        state.meta = saved.meta || { sourceName: '保存済みのデータ' };
        enterApp();
      }
    } catch (e) {
      console.warn('保存データを読み込めませんでした', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.App = { state: state, api: api };
})(window);
