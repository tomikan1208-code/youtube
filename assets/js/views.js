/* 画面ごとの描画 */
(function (global) {
  'use strict';

  var h = U.h;
  var Views = {};

  /* ================= 共通パーツ ================= */

  // 月キーを軸ラベル用に整える（1月は年を表示し、間引きの基準点にする）
  function monthPoint(key, values) {
    var isJan = key.slice(5) === '01';
    return {
      label: U.fmtMonth(key),
      short: isJan ? key.slice(0, 4) + '年' : U.fmtMonthShort(key),
      anchor: isJan,
      values: values
    };
  }

  function statTile(label, value, unit, note) {
    return h('div', { class: 'stat' },
      h('p', { class: 'stat__label' }, label),
      h('p', { class: 'stat__value' }, value, unit ? h('span', { class: 'stat__unit' }, unit) : null),
      note ? h('p', { class: 'stat__note' }, note) : null);
  }

  function titleCell(video, app) {
    return h('div', { class: 'cell-main' },
      h('span', { class: 'cell-title' }, video.title),
      h('span', { class: 'cell-sub' }, video.ch || '（不明なチャンネル）'));
  }

  /**
   * 並べ替え・追加読み込み・CSV 書き出しに対応した表
   * columns: [{key, label, num, sortable, width, render(row), csv(row)}]
   */
  function dataTable(o) {
    var pageSize = o.pageSize || 50;
    var shown = pageSize;
    var sortKey = o.sortKey;
    var sortDir = o.sortDir || 'desc';
    var wrap = h('div');
    var count = h('span', { class: 'result-count' });
    var body = h('tbody');
    var more = h('div', { class: 'more' });

    function sorted() {
      if (!sortKey) return o.rows;
      var col = o.columns.filter(function (c) { return c.key === sortKey; })[0];
      var val = (col && col.sortValue) || function (r) { return r[sortKey]; };
      var s = sortDir === 'asc' ? 1 : -1;
      return o.rows.slice().sort(function (a, b) {
        var x = val(a), y = val(b);
        if (typeof x === 'string' || typeof y === 'string') {
          return String(x || '').localeCompare(String(y || ''), 'ja') * s;
        }
        if (x === y) return 0;
        return (x < y ? -1 : 1) * s;
      });
    }

    function renderBody() {
      var rows = sorted();
      U.clear(body);
      rows.slice(0, shown).forEach(function (r, i) {
        var tr = h('tr', {
          class: o.onRowClick ? 'clickable' : '',
          tabindex: o.onRowClick ? 0 : null,
          onclick: o.onRowClick ? function () { o.onRowClick(r); } : null,
          onkeydown: o.onRowClick ? function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); o.onRowClick(r); }
          } : null
        });
        if (o.rank) tr.appendChild(h('td', { class: 'rank' }, i + 1));
        o.columns.forEach(function (c) {
          if (c.hidden) return; // 表には出さず CSV にだけ含める列
          var v = c.render ? c.render(r, i) : r[c.key];
          tr.appendChild(h('td', { class: c.num ? 'num' : '' }, v));
        });
        body.appendChild(tr);
      });

      U.clear(more);
      if (rows.length > shown) {
        more.appendChild(h('button', {
          type: 'button', class: 'btn',
          onclick: function () { shown += pageSize * 2; renderBody(); }
        }, 'さらに表示（残り ' + U.int(rows.length - shown) + ' 件）'));
      }
      U.clear(count).appendChild(document.createTextNode(U.int(rows.length) + ' 件'));
      updateHeaders();
    }

    var headCells = [];
    function updateHeaders() {
      headCells.forEach(function (th) {
        var k = th.dataset.key;
        th.setAttribute('aria-sort', k === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        var arrow = U.$('.sort-arrow', th);
        if (arrow) arrow.textContent = k === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
      });
    }

    var tr = h('tr');
    if (o.rank) tr.appendChild(h('th', { class: 'rank' }, '#'));
    o.columns.forEach(function (c) {
      if (c.hidden) return;
      var th = h('th', {
        class: (c.num ? 'num' : '') + (c.sortable === false ? '' : ' sortable'),
        dataset: { key: c.key },
        style: c.width ? { width: c.width } : null
      }, c.label);
      if (c.sortable !== false) {
        th.appendChild(h('span', { class: 'sort-arrow' }, '⇅'));
        th.addEventListener('click', function () {
          if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortKey = c.key; sortDir = c.defaultDir || 'desc'; }
          shown = pageSize;
          renderBody();
        });
      }
      headCells.push(th);
      tr.appendChild(th);
    });

    var toolbar = h('div', { class: 'toolbar' }, count, h('span', { class: 'toolbar__spacer' }));
    if (o.csvName) {
      toolbar.appendChild(h('button', {
        type: 'button', class: 'btn btn--ghost',
        onclick: function () {
          var cols = o.columns.filter(function (c) { return c.csv !== false; });
          var rows = [cols.map(function (c) { return c.label; })];
          sorted().forEach(function (r) {
            rows.push(cols.map(function (c) { return c.csv ? c.csv(r) : r[c.key]; }));
          });
          U.download(o.csvName, U.toCsv(rows));
        }
      }, 'CSV で書き出す'));
    }

    wrap.appendChild(toolbar);
    wrap.appendChild(h('div', { class: 'card', style: { padding: '0' } },
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, tr), body))));
    wrap.appendChild(more);

    if (!o.rows.length) {
      U.clear(wrap).appendChild(h('p', { class: 'empty' }, o.emptyText || '該当する記録がありません。'));
      return wrap;
    }
    renderBody();
    return wrap;
  }

  Views.dataTable = dataTable;

  function countCell(value, max) {
    return h('div', null,
      h('span', { class: 'count-badge' }, U.int(value)),
      h('span', { class: 'bar-cell-track' },
        h('span', { class: 'bar-cell', style: { width: Math.max(2, (value / max) * 100) + '%' } })));
  }

  /* ================= ダッシュボード ================= */

  Views.dashboard = function (an, app) {
    var t = an.totals;
    var root = h('div', { class: 'stack' });

    if (!t.plays) {
      return h('p', { class: 'empty' }, '条件に合う視聴記録がありません。絞り込みを見直してください。');
    }

    /* ヒーロー数値（1 画面に 1 つだけ） */
    root.appendChild(h('div', { class: 'hero' },
      h('div', null,
        h('p', { class: 'hero__label' }, '総再生回数'),
        h('p', { class: 'hero__value' }, U.int(t.plays), h('span', { class: 'hero__unit' }, '回'))),
      h('p', { class: 'hero__aside' },
        U.fmtDate(t.first) + ' 〜 ' + U.fmtDate(t.last) +
        '（' + U.fmtSpan(t.last - t.first) + '）　1日あたり ' + U.dec(t.perDay, 1) + ' 回')));

    /* スタットタイル */
    var topDayNote = t.topDay ? U.fmtDateW(new Date(t.topDay.day + 'T00:00:00').getTime()) : '—';
    root.appendChild(h('div', { class: 'grid grid--stats' },
      statTile('見た動画の数', U.int(t.uniqueVideos), '本', '重複を除いた本数'),
      statTile('チャンネル数', U.int(t.uniqueChannels), '', '1本以上見たチャンネル'),
      statTile('再生に占める再視聴', U.pct(t.repeatShare), '',
        U.int(t.repeatPlays) + ' 回が2回目以降の視聴'),
      statTile('繰り返し見た動画', U.int(t.repeatedVideos), '本',
        '全体の ' + U.pct(t.repeatRatio) + ' が2回以上'),
      statTile('1本あたりの再生回数', U.dec(t.avgPerVideo, 2), '回'),
      statTile('視聴した日数', U.int(t.activeDays), '日',
        t.spanDays + '日中（' + U.pct(t.activeDays / t.spanDays) + '）'),
      statTile('最長連続視聴', U.int(t.bestStreak), '日',
        t.bestStreakEnd ? '〜' + U.fmtDate(new Date(t.bestStreakEnd + 'T00:00:00').getTime()) : ''),
      statTile('最も見た日', t.topDay ? U.int(t.topDay.count) + ' 回' : '—', '', topDayNote),
      statTile('よく見る時間帯', an.peakHour + '時台', '',
        U.int(an.hourTotals[an.peakHour]) + ' 回'),
      t.musicPlays ? statTile('YouTube Music', U.int(t.musicPlays), '回',
        '全体の ' + U.pct(t.musicPlays / t.plays)) : null));

    /* 月別：初めて見た / もう一度見た */
    var months = an.months;
    var series = [
      { name: 'もう一度見た', color: U.cssVar('--series-1') },
      { name: '初めて見た', color: U.cssVar('--series-2') }
    ];
    root.appendChild(Charts.figure({
      title: '月ごとの再生回数',
      sub: '「初めて見た」＝その動画をはじめて再生した回。積み上げの合計がその月の総再生回数。',
      legend: series,
      draw: Charts.stackedColumns({
        title: '月ごとの再生回数',
        data: months.map(function (m) { return monthPoint(m.key, [m.repeat, m.discovery]); }),
        series: series,
        height: 280
      }),
      table: {
        head: ['月', 'もう一度見た', '初めて見た', '合計'],
        rows: months.map(function (m) {
          return [U.fmtMonth(m.key), U.int(m.repeat), U.int(m.discovery), U.int(m.total)];
        })
      }
    }));

    var half = h('div', { class: 'grid grid--2' });

    /* 累計の開拓 */
    var cumSeries = [
      { name: '見つけた動画（累計）', color: U.cssVar('--series-1'), type: 'line' },
      { name: '見つけたチャンネル（累計）', color: U.cssVar('--series-2'), type: 'line' }
    ];
    half.appendChild(Charts.figure({
      title: 'はじめて見たものの累計',
      sub: '線の傾きが緩むほど、同じ動画・同じチャンネルに落ち着いてきたことを表す。',
      legend: cumSeries,
      draw: Charts.lines({
        title: 'はじめて見たものの累計',
        data: months.map(function (m) { return monthPoint(m.key, [m.cumVideos, m.cumChannels]); }),
        series: cumSeries,
        height: 260
      }),
      table: {
        head: ['月', '動画（累計）', 'チャンネル（累計）'],
        rows: months.map(function (m) { return [U.fmtMonth(m.key), U.int(m.cumVideos), U.int(m.cumChannels)]; })
      }
    }));

    /* 曜日 × 時間帯 */
    var heatMax = 0;
    an.heat.forEach(function (r) { r.forEach(function (v) { if (v > heatMax) heatMax = v; }); });
    var heatCard = Charts.figure({
      title: '曜日と時間帯',
      sub: 'いつ YouTube を開いているか。色が濃いほど再生回数が多い。',
      draw: Charts.heatmap({
        title: '曜日と時間帯',
        rows: U.WEEKDAYS,
        values: an.heat
      }),
      table: {
        head: ['曜日'].concat(Array.from({ length: 24 }, function (_, i) { return i + '時'; })),
        rows: U.WEEKDAYS.map(function (w, i) {
          return [w].concat(an.heat[i].map(function (v) { return U.int(v); }));
        })
      }
    });
    heatCard.insertBefore(Charts.scaleLegend(heatMax), U.$('.tableview', heatCard));
    half.appendChild(heatCard);
    root.appendChild(half);

    /* ランキング 2 種 */
    var topCh = an.channels.slice(0, 10);
    var half2 = h('div', { class: 'grid grid--2' });

    half2.appendChild(Charts.figure({
      title: 'チャンネル別の再生回数 上位10',
      sub: '行を選ぶとそのチャンネルの詳細を表示します。',
      draw: Charts.barsH({
        title: 'チャンネル別の再生回数',
        data: topCh.map(function (c) {
          return { label: c.name, value: c.plays, sub: U.int(c.uniqueVideos) + ' 本', ref: c };
        }),
        valueName: '回',
        onSelect: function (d) { app.openChannel(d.ref.id); }
      }),
      table: {
        head: ['チャンネル', '再生回数', '動画数'],
        rows: topCh.map(function (c) { return [c.name, U.int(c.plays), U.int(c.uniqueVideos)]; })
      }
    }));

    var topRepeat = an.videos.filter(function (v) { return v.count >= 2; }).slice(0, 10);
    half2.appendChild(Charts.figure({
      title: '繰り返し見た動画 上位10',
      sub: '同じ動画を何回再生したか。行を選ぶと視聴した日時の一覧を表示します。',
      draw: Charts.barsH({
        title: '繰り返し見た動画',
        data: topRepeat.map(function (v) {
          return { label: v.title, value: v.count, sub: v.ch || '', ref: v };
        }),
        valueName: '回',
        onSelect: function (d) { app.openVideo(d.ref.key); }
      }),
      table: {
        head: ['動画', '再生回数', 'チャンネル'],
        rows: topRepeat.map(function (v) { return [v.title, U.int(v.count), v.ch || '—']; })
      }
    }));
    root.appendChild(half2);

    return root;
  };

  /* ================= 動画ランキング ================= */

  Views.videos = function (an, app) {
    var max = an.videos.length ? an.videos[0].count : 1;
    var root = h('div');
    root.appendChild(h('h2', { class: 'section-title' }, '動画ランキング'));
    root.appendChild(h('p', { class: 'section-lead' },
      '同じ動画を何回見たかの一覧です。見出しを押すと並べ替えられます（初めて見た日・最後に見た日でも並べ替えできます）。'));

    root.appendChild(dataTable({
      rows: an.videos,
      rank: true,
      sortKey: 'count',
      sortDir: 'desc',
      csvName: 'youtube-videos.csv',
      onRowClick: function (v) { app.openVideo(v.key); },
      columns: [
        {
          key: 'title', label: '動画 / チャンネル', width: '46%',
          render: function (v) {
            return h('div', { class: 'cell-main' },
              h('span', { class: 'cell-title' }, v.title),
              h('span', { class: 'cell-sub' },
                v.ch || '（不明なチャンネル）',
                v.music ? ' ・ Music' : ''));
          },
          csv: function (v) { return v.title; }
        },
        { key: 'ch', label: 'チャンネル', hidden: true, csv: function (v) { return v.ch || ''; } },
        {
          key: 'count', label: '再生回数', num: true,
          render: function (v) { return countCell(v.count, max); },
          csv: function (v) { return v.count; }
        },
        {
          key: 'first', label: '初めて見た日', num: true, defaultDir: 'asc',
          render: function (v) { return U.fmtDate(v.first); },
          csv: function (v) { return U.fmtDateTime(v.first); }
        },
        {
          key: 'last', label: '最後に見た日', num: true,
          render: function (v) { return U.fmtDate(v.last); },
          csv: function (v) { return U.fmtDateTime(v.last); }
        },
        {
          key: 'span', label: '見続けた期間', num: true,
          sortValue: function (v) { return v.last - v.first; },
          render: function (v) { return v.count < 2 ? '—' : U.fmtSpan(v.last - v.first); },
          csv: function (v) { return v.count < 2 ? '' : Math.round((v.last - v.first) / 86400000) + '日'; }
        }
      ]
    }));

    return root;
  };

  /* ================= チャンネル ================= */

  Views.channels = function (an, app) {
    var max = an.channels.length ? an.channels[0].plays : 1;
    var root = h('div');
    root.appendChild(h('h2', { class: 'section-title' }, 'チャンネル別の再生回数'));
    root.appendChild(h('p', { class: 'section-lead' },
      'そのチャンネルの動画を合計何回見たか、何本見たか、そして最初に見た1本。行を選ぶと詳細が開きます。'));

    root.appendChild(dataTable({
      rows: an.channels,
      rank: true,
      sortKey: 'plays',
      sortDir: 'desc',
      csvName: 'youtube-channels.csv',
      onRowClick: function (c) { app.openChannel(c.id); },
      columns: [
        {
          key: 'name', label: 'チャンネル', width: '26%',
          render: function (c) {
            return h('div', { class: 'cell-main' },
              h('span', { class: 'cell-title' }, c.name),
              h('span', { class: 'cell-sub' },
                U.fmtDate(c.first) + ' 〜 ' + U.fmtDate(c.last)));
          },
          csv: function (c) { return c.name; }
        },
        {
          key: 'plays', label: '再生回数', num: true,
          render: function (c) { return countCell(c.plays, max); },
          csv: function (c) { return c.plays; }
        },
        { key: 'uniqueVideos', label: '動画数', num: true, render: function (c) { return U.int(c.uniqueVideos); }, csv: function (c) { return c.uniqueVideos; } },
        {
          key: 'avg', label: '1本あたり', num: true,
          sortValue: function (c) { return c.plays / c.uniqueVideos; },
          render: function (c) { return U.dec(c.plays / c.uniqueVideos, 2); },
          csv: function (c) { return (c.plays / c.uniqueVideos).toFixed(2); }
        },
        {
          key: 'firstVideoTitle', label: 'そのチャンネルで初めて見た動画', width: '30%',
          render: function (c) {
            return h('div', { class: 'cell-main' },
              h('span', { class: 'cell-title' }, c.firstVideoTitle),
              h('span', { class: 'cell-sub' }, U.fmtDateTime(c.first)));
          },
          csv: function (c) { return c.firstVideoTitle; }
        },
        {
          key: 'first', label: '初回', num: true, defaultDir: 'asc',
          render: function (c) { return U.fmtDate(c.first); },
          csv: function (c) { return U.fmtDateTime(c.first); }
        }
      ]
    }));
    return root;
  };

  /* ================= はじめて見た記録 ================= */

  Views.discovery = function (an, app) {
    var root = h('div', { class: 'stack' });
    var chrono = Analytics.channelDiscovery(an);

    root.appendChild(h('div', null,
      h('h2', { class: 'section-title' }, 'はじめて見た記録'),
      h('p', { class: 'section-lead' },
        'チャンネルを見つけた順に並べています。「きっかけの動画」は、そのチャンネルで最初に再生した1本です。')));

    /* 年ごとのまとめ */
    var byYear = new Map();
    an.videos.forEach(function (v) {
      var y = new Date(v.first).getFullYear();
      var e = byYear.get(y) || { year: y, videos: 0, channels: 0, plays: 0 };
      e.videos++; byYear.set(y, e);
    });
    chrono.forEach(function (c) {
      var y = new Date(c.first).getFullYear();
      var e = byYear.get(y) || { year: y, videos: 0, channels: 0, plays: 0 };
      e.channels++; byYear.set(y, e);
    });
    an.events.forEach(function (ev) {
      var y = new Date(ev.t).getFullYear();
      var e = byYear.get(y);
      if (e) e.plays++;
    });
    var years = Array.from(byYear.values()).sort(function (a, b) { return a.year - b.year; });

    if (years.length) {
      var yearSeries = [
        { name: '初めて見たチャンネル', color: U.cssVar('--series-1') },
        { name: '初めて見た動画', color: U.cssVar('--series-2') }
      ];
      root.appendChild(Charts.figure({
        title: '年ごとの開拓',
        sub: 'その年に「初めて見た」動画とチャンネルの数。',
        legend: yearSeries,
        draw: Charts.stackedColumns({
          title: '年ごとの開拓',
          data: years.map(function (y) {
            return { label: y.year + '年', short: String(y.year), values: [y.channels, y.videos] };
          }),
          series: yearSeries,
          height: 200
        }),
        table: {
          head: ['年', '初めて見た動画', '初めて見たチャンネル', 'その年の再生回数'],
          rows: years.map(function (y) { return [y.year + '年', U.int(y.videos), U.int(y.channels), U.int(y.plays)]; })
        }
      }));
    }

    root.appendChild(h('div', null,
      h('h3', { class: 'section-title', style: { 'font-size': '15px', 'margin-top': '8px' } }, 'チャンネルを見つけた順'),
      dataTable({
        rows: chrono,
        rank: true,
        sortKey: 'first',
        sortDir: 'asc',
        csvName: 'youtube-discovery.csv',
        onRowClick: function (c) { app.openChannel(c.id); },
        columns: [
          {
            key: 'first', label: '見つけた日', num: true, defaultDir: 'asc',
            render: function (c) { return U.fmtDate(c.first); },
            csv: function (c) { return U.fmtDateTime(c.first); }
          },
          {
            key: 'name', label: 'チャンネル',
            render: function (c) { return h('span', { class: 'cell-title' }, c.name); },
            csv: function (c) { return c.name; }
          },
          {
            key: 'firstVideoTitle', label: 'きっかけの動画', width: '36%',
            render: function (c) {
              return h('div', { class: 'cell-main' },
                h('span', null, c.firstVideoTitle),
                h('span', { class: 'cell-sub' }, U.fmtTime(c.first) + ' に視聴'));
            },
            csv: function (c) { return c.firstVideoTitle; }
          },
          {
            key: 'plays', label: '再生回数', num: true,
            render: function (c) { return U.int(c.plays); },
            csv: function (c) { return c.plays; }
          },
          {
            key: 'last', label: '最後に見た日', num: true,
            render: function (c) {
              var days = Math.round((Date.now() - c.last) / 86400000);
              return h('div', null,
                U.fmtDate(c.last),
                h('div', { class: 'cell-sub' }, days > 0 ? days + '日前' : '今日'));
            },
            csv: function (c) { return U.fmtDate(c.last); }
          }
        ]
      })));

    return root;
  };

  /* ================= 履歴 ================= */

  Views.history = function (an, app) {
    var root = h('div');
    root.appendChild(h('h2', { class: 'section-title' }, '視聴履歴'));
    root.appendChild(h('p', { class: 'section-lead' },
      '新しい順に並べています。バッジはその動画を通算で何回目に見たかを表します。'));

    // 通算何回目かを昇順で数える
    var nth = new Array(an.events.length);
    var seen = new Map();
    for (var i = 0; i < an.events.length; i++) {
      var k = an.events[i].key;
      var c = (seen.get(k) || 0) + 1;
      seen.set(k, c);
      nth[i] = c;
    }

    var list = h('div', { class: 'timeline' });
    var pageSize = 200;
    var shown = pageSize;
    var more = h('div', { class: 'more' });

    function render() {
      U.clear(list);
      var currentDay = null;
      var dayBox = null;
      var end = an.events.length - 1;
      var stop = Math.max(-1, end - shown);

      for (var j = end; j > stop; j--) {
        var e = an.events[j];
        var dk = U.dayKey(e.t);
        if (dk !== currentDay) {
          currentDay = dk;
          dayBox = h('div', { class: 'tl-day' },
            h('div', { class: 'tl-day__date' }, U.fmtDateW(e.t)));
          list.appendChild(dayBox);
        }
        (function (ev, n) {
          dayBox.appendChild(h('div', {
            class: 'tl-item', tabindex: 0,
            onclick: function () { app.openVideo(ev.key); },
            onkeydown: function (kev) { if (kev.key === 'Enter') { kev.preventDefault(); app.openVideo(ev.key); } }
          },
            h('span', { class: 'tl-item__time' }, U.fmtTime(ev.t)),
            h('div', { class: 'tl-item__body' },
              h('div', { class: 'tl-item__title' }, ev.title),
              h('div', { class: 'tl-item__meta' },
                h('span', null, ev.ch || '（不明なチャンネル）'),
                n === 1
                  ? h('span', { class: 'pill pill--first' }, 'はじめて見た')
                  : h('span', { class: 'pill' }, n + ' 回目'),
                ev.music ? h('span', { class: 'pill pill--music' }, 'Music') : null))));
        })(e, nth[j]);
      }

      U.clear(more);
      if (an.events.length > shown) {
        more.appendChild(h('button', {
          type: 'button', class: 'btn',
          onclick: function () { shown += pageSize * 2; render(); }
        }, 'さらに表示（残り ' + U.int(an.events.length - shown) + ' 件）'));
      }
    }

    if (!an.events.length) {
      root.appendChild(h('p', { class: 'empty' }, '該当する視聴記録がありません。'));
      return root;
    }

    root.appendChild(h('div', { class: 'toolbar' },
      h('span', { class: 'result-count' }, U.int(an.events.length) + ' 件'),
      h('span', { class: 'toolbar__spacer' }),
      h('button', {
        type: 'button', class: 'btn btn--ghost',
        onclick: function () {
          var rows = [['日時', '動画', 'チャンネル', '通算何回目', 'URL']];
          for (var x = an.events.length - 1; x >= 0; x--) {
            var e2 = an.events[x];
            rows.push([U.fmtDateTime(e2.t), e2.title, e2.ch || '', nth[x], e2.url || '']);
          }
          U.download('youtube-history.csv', U.toCsv(rows));
        }
      }, 'CSV で書き出す')));
    root.appendChild(list);
    root.appendChild(more);
    render();
    return root;
  };

  /* ================= 詳細（動画） ================= */

  Views.videoDetail = function (an, video, app) {
    var box = h('div');
    var gaps = Analytics.gaps(video.times);
    var avgGap = gaps.length ? gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length : null;

    box.appendChild(h('div', { class: 'kv' },
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '再生回数'),
        h('div', { class: 'kv__v' }, U.int(video.count), h('small', null, ' 回'))),
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '初めて見た'),
        h('div', { class: 'kv__v' }, U.fmtDate(video.first), h('small', null, ' ' + U.fmtTime(video.first)))),
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '最後に見た'),
        h('div', { class: 'kv__v' }, U.fmtDate(video.last), h('small', null, ' ' + U.fmtTime(video.last)))),
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '見続けた期間'),
        h('div', { class: 'kv__v' }, video.count < 2 ? '—' : U.fmtSpan(video.last - video.first))),
      avgGap ? h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '平均の間隔'),
        h('div', { class: 'kv__v' }, U.fmtSpan(avgGap))) : null));

    if (video.ch) {
      box.appendChild(h('p', { class: 'link-out' },
        'チャンネル：',
        h('a', {
          href: '#', onclick: function (ev) {
            ev.preventDefault();
            app.openChannel(video.chId || 'n:' + video.ch);
          }
        }, video.ch)));
    }
    if (video.url && !video.gone) {
      box.appendChild(h('p', { class: 'link-out' },
        h('a', { href: video.url, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube で開く ↗')));
    }

    /* 月別の再生 */
    if (video.count >= 3) {
      var byMonth = new Map();
      video.times.forEach(function (t) {
        var k = U.monthKey(t);
        byMonth.set(k, (byMonth.get(k) || 0) + 1);
      });
      var keys = U.monthRange(video.first, video.last);
      box.appendChild(h('div', { class: 'detail-title' }, '月ごとの再生回数'));
      box.appendChild(Charts.figure({
        draw: Charts.sparkColumns({
          data: keys.map(function (k) {
            var p = monthPoint(k);
            p.value = byMonth.get(k) || 0;
            return p;
          }),
          color: U.cssVar('--series-1'),
          height: 90
        })
      }));
    }

    box.appendChild(h('div', { class: 'detail-title' }, '視聴した日時（' + U.int(video.count) + ' 件）'));
    box.appendChild(h('ul', { class: 'watch-list' },
      video.times.map(function (t, i) {
        return h('li', null,
          h('span', { class: 'watch-list__n' }, (i + 1) + '回目'),
          h('span', null, U.fmtDateW(t) + ' ' + U.fmtTime(t)),
          i > 0 ? h('span', { class: 'watch-list__gap' }, '前回から ' + U.fmtSpan(t - video.times[i - 1])) : null);
      })));

    return box;
  };

  /* ================= 詳細（チャンネル） ================= */

  Views.channelDetail = function (an, channel, app) {
    var box = h('div');
    var vids = Analytics.channelVideos(an, channel);
    var maxCount = vids.length ? vids[0].count : 1;

    box.appendChild(h('div', { class: 'kv' },
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '総再生回数'),
        h('div', { class: 'kv__v' }, U.int(channel.plays), h('small', null, ' 回'))),
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '見た動画'),
        h('div', { class: 'kv__v' }, U.int(channel.uniqueVideos), h('small', null, ' 本'))),
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '1本あたり'),
        h('div', { class: 'kv__v' }, U.dec(channel.plays / channel.uniqueVideos, 2), h('small', null, ' 回'))),
      h('div', { class: 'kv__item' }, h('div', { class: 'kv__k' }, '見ていた期間'),
        h('div', { class: 'kv__v' }, U.fmtSpan(channel.last - channel.first)))));

    box.appendChild(h('div', { class: 'detail-title' }, 'このチャンネルで初めて見た動画'));
    box.appendChild(h('div', { class: 'card', style: { 'background': 'var(--surface-2)' } },
      h('div', { class: 'cell-main' },
        h('span', { class: 'cell-title' }, channel.firstVideoTitle),
        h('span', { class: 'cell-sub' }, U.fmtDateW(channel.first) + ' ' + U.fmtTime(channel.first) + ' に視聴')),
      h('p', { style: { margin: '10px 0 0' } },
        h('button', {
          type: 'button', class: 'btn',
          onclick: function () { app.openVideo(channel.firstVideoKey); }
        }, 'この動画の詳細'))));

    /* 月別の再生 */
    var byMonth = new Map();
    an.events.forEach(function (e) {
      if ((e.chId || (e.ch ? 'n:' + e.ch : null)) !== channel.id) return;
      var k = U.monthKey(e.t);
      byMonth.set(k, (byMonth.get(k) || 0) + 1);
    });
    var keys = U.monthRange(channel.first, channel.last);
    if (keys.length > 1) {
      box.appendChild(h('div', { class: 'detail-title' }, '月ごとの再生回数'));
      box.appendChild(Charts.figure({
        draw: Charts.sparkColumns({
          data: keys.map(function (k) {
            var p = monthPoint(k);
            p.value = byMonth.get(k) || 0;
            return p;
          }),
          color: U.cssVar('--series-1'),
          height: 100
        })
      }));
    }

    box.appendChild(h('div', { class: 'detail-title' }, 'よく見た動画'));
    box.appendChild(dataTable({
      rows: vids,
      rank: true,
      pageSize: 20,
      sortKey: 'count',
      onRowClick: function (v) { app.openVideo(v.key); },
      columns: [
        {
          key: 'title', label: '動画',
          render: function (v) { return h('span', { class: 'cell-title' }, v.title); }
        },
        {
          key: 'count', label: '回数', num: true,
          render: function (v) { return countCell(v.count, maxCount); }
        },
        {
          key: 'first', label: '初回', num: true, defaultDir: 'asc',
          render: function (v) { return U.fmtDate(v.first); }
        },
        {
          key: 'last', label: '最終', num: true,
          render: function (v) { return U.fmtDate(v.last); }
        }
      ]
    }));

    return box;
  };

  global.Views = Views;
})(window);
