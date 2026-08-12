/* 共通ユーティリティ: DOM 生成・整形・日付 */
(function (global) {
  'use strict';

  var U = {};

  /* ---------- DOM ---------- */

  // h('div', {class:'x', onclick:fn, dataset:{id:1}}, child, 'text', ...)
  // 文字列の子は必ずテキストノードとして挿入する（innerHTML を使わない = 取り込んだ
  // タイトルやチャンネル名がそのまま HTML として解釈されない）。
  U.h = function (tag, attrs) {
    var el = document.createElement(tag);
    applyAttrs(el, attrs);
    appendChildren(el, arguments, 2);
    return el;
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  U.svg = function (tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    applyAttrs(el, attrs, true);
    appendChildren(el, arguments, 2);
    return el;
  };

  function applyAttrs(el, attrs, isSvg) {
    if (!attrs) return;
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'dataset') {
        for (var d in v) el.dataset[d] = v[d];
      } else if (k === 'style' && typeof v === 'object') {
        for (var s in v) el.style.setProperty(s, v[s]);
      } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
        el.addEventListener(k.slice(2), v);
      } else if (!isSvg && (k === 'text' || k === 'textContent')) {
        el.textContent = v;
      } else if (k === 'text') {
        el.textContent = v;
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, v);
      }
    }
  }

  function appendChildren(el, args, from) {
    for (var i = from; i < args.length; i++) {
      var c = args[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) { appendChildren(el, c, 0); continue; }
      el.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
    }
  }

  U.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.cssVar = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  U.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* ---------- 数値・文字列 ---------- */

  U.int = function (n) { return (n === null || n === undefined || isNaN(n)) ? '—' : Math.round(n).toLocaleString('ja-JP'); };

  U.dec = function (n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return n.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  U.pct = function (n) { return U.dec(n * 100, n >= 0.1 ? 0 : 1) + '%'; };

  U.compact = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e8) return U.dec(n / 1e8, 1) + '億';
    if (a >= 1e4) return U.dec(n / 1e4, a >= 1e5 ? 0 : 1) + '万';
    return U.int(n);
  };

  U.truncate = function (s, max) {
    s = String(s === null || s === undefined ? '' : s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  /* ---------- 日付 ---------- */

  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  U.WEEKDAYS = WD;

  U.pad2 = function (n) { return n < 10 ? '0' + n : String(n); };

  U.fmtDate = function (t) {
    var d = new Date(t);
    return d.getFullYear() + '/' + U.pad2(d.getMonth() + 1) + '/' + U.pad2(d.getDate());
  };

  U.fmtDateW = function (t) {
    var d = new Date(t);
    return U.fmtDate(t) + '（' + WD[d.getDay()] + '）';
  };

  U.fmtTime = function (t) {
    var d = new Date(t);
    return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  };

  U.fmtDateTime = function (t) { return U.fmtDate(t) + ' ' + U.fmtTime(t); };

  U.fmtMonth = function (key) {
    var p = key.split('-');
    return p[0] + '年' + Number(p[1]) + '月';
  };

  U.fmtMonthShort = function (key) {
    var p = key.split('-');
    return Number(p[1]) + '月';
  };

  U.dayKey = function (t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };

  U.monthKey = function (t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1);
  };

  U.dateInputValue = function (t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };

  // 経過時間を「〜前」ではなく期間として表現する
  U.fmtSpan = function (ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '—';
    var min = ms / 60000;
    if (min < 1) return '1分未満';
    if (min < 60) return Math.round(min) + '分';
    var hr = min / 60;
    if (hr < 24) return Math.round(hr) + '時間';
    var day = hr / 24;
    if (day < 31) return Math.round(day) + '日';
    var mo = day / 30.44;
    if (mo < 12) return Math.round(mo) + 'か月';
    var yr = day / 365.25;
    return (yr < 10 ? U.dec(yr, 1) : Math.round(yr)) + '年';
  };

  // 月キーの連続列（欠けている月も 0 として埋める）
  U.monthRange = function (fromT, toT) {
    var out = [];
    var d = new Date(fromT);
    d.setDate(1); d.setHours(0, 0, 0, 0);
    var end = new Date(toT);
    end.setDate(1); end.setHours(0, 0, 0, 0);
    var guard = 0;
    while (d <= end && guard++ < 1200) {
      out.push(d.getFullYear() + '-' + U.pad2(d.getMonth() + 1));
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  };

  /* ---------- 並べ替え ---------- */

  U.sortBy = function (arr, key, dir) {
    var s = dir === 'asc' ? 1 : -1;
    return arr.slice().sort(function (a, b) {
      var x = a[key], y = b[key];
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x === undefined ? '' : x).localeCompare(String(y === undefined ? '' : y), 'ja') * s;
      }
      if (x === y) return 0;
      return (x < y ? -1 : 1) * s;
    });
  };

  /* ---------- CSV ---------- */

  U.toCsv = function (rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var v = (c === null || c === undefined) ? '' : String(c);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
  };

  U.download = function (filename, text) {
    // Excel が UTF-8 と判定できるよう BOM を付ける
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = U.h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  /* ---------- 非同期 ---------- */

  U.nextFrame = function () {
    return new Promise(function (res) { setTimeout(res, 0); });
  };

  global.U = U;
})(window);
