/* 視聴イベントの集計 */
(function (global) {
  'use strict';

  var A = {};

  /* ---------------- 絞り込み ---------------- */

  A.filter = function (events, opt) {
    var from = opt.from === null || opt.from === undefined ? -Infinity : opt.from;
    var to = opt.to === null || opt.to === undefined ? Infinity : opt.to;
    var q = (opt.q || '').trim().toLowerCase();
    var out = [];

    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.t < from || e.t > to) continue;
      if (!opt.music && e.music) continue;
      if (!opt.shorts && e.shorts) continue;
      if (q) {
        var hay = e.title.toLowerCase() + ' ' + (e.ch ? e.ch.toLowerCase() : '');
        if (hay.indexOf(q) < 0) continue;
      }
      out.push(e);
    }
    return out;
  };

  /**
   * 短時間に連続して記録された同じ動画を 1 回にまとめる。
   * （途中まで見て開き直す、自動再生でもう一度記録される、といった重複対策）
   * events は時刻の昇順であること。
   */
  A.dedupe = function (events, windowMs) {
    if (!windowMs) return events;
    var last = new Map();
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var prev = last.get(e.key);
      if (prev !== undefined && e.t - prev <= windowMs) continue;
      last.set(e.key, e.t);
      out.push(e);
    }
    return out;
  };

  /* ---------------- 集計 ---------------- */

  /**
   * @param {Array} events 時刻の昇順に並んだ視聴イベント
   */
  A.analyze = function (events) {
    var videoMap = new Map();
    var channelMap = new Map();
    var dayCount = new Map();
    var monthMap = new Map();
    var dayMap = new Map();
    var heat = [];
    for (var w = 0; w < 7; w++) heat.push(new Array(24).fill(0));

    var musicPlays = 0, shortsPlays = 0;

    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var d = new Date(e.t);

      /* --- 動画 --- */
      var v = videoMap.get(e.key);
      var isFirst = false;
      if (!v) {
        isFirst = true;
        v = {
          key: e.key, videoId: e.videoId, title: e.title, url: e.url,
          ch: e.ch, chId: e.chId, music: e.music, gone: e.gone,
          count: 0, first: e.t, last: e.t, times: []
        };
        videoMap.set(e.key, v);
      }
      v.count++;
      v.last = e.t;
      v.times.push(e.t);
      // 後から取得できたタイトルの方が情報量が多いことがある
      if (v.gone && !e.gone) { v.title = e.title; v.gone = false; }
      if (!v.ch && e.ch) { v.ch = e.ch; v.chId = e.chId; }

      /* --- チャンネル --- */
      var cid = e.chId || (e.ch ? 'n:' + e.ch : null);
      if (cid) {
        var c = channelMap.get(cid);
        if (!c) {
          c = {
            id: cid, chId: e.chId, name: e.ch || '（不明なチャンネル）',
            plays: 0, first: e.t, last: e.t,
            firstVideoKey: e.key, firstVideoTitle: e.title, firstVideoUrl: e.url,
            lastVideoKey: e.key, lastVideoTitle: e.title,
            videos: new Map(), music: e.music
          };
          channelMap.set(cid, c);
        }
        c.plays++;
        c.last = e.t;
        c.lastVideoKey = e.key;
        c.lastVideoTitle = e.title;
        c.videos.set(e.key, (c.videos.get(e.key) || 0) + 1);
        if (!e.music) c.music = false;
      }

      /* --- 時系列 --- */
      var dk = U.dayKey(e.t);
      dayCount.set(dk, (dayCount.get(dk) || 0) + 1);

      // 月の棒から日ごとへ掘り下げるための内訳
      var dm = dayMap.get(dk);
      if (!dm) { dm = { key: dk, total: 0, discovery: 0, repeat: 0 }; dayMap.set(dk, dm); }
      dm.total++;
      if (isFirst) dm.discovery++; else dm.repeat++;

      var mk = U.monthKey(e.t);
      var m = monthMap.get(mk);
      if (!m) { m = { key: mk, total: 0, discovery: 0, repeat: 0, channels: new Set() }; monthMap.set(mk, m); }
      m.total++;
      if (isFirst) m.discovery++; else m.repeat++;

      heat[d.getDay()][d.getHours()]++;

      if (e.music) musicPlays++;
      if (e.shorts) shortsPlays++;
    }

    /* --- 配列化 --- */

    var videos = Array.from(videoMap.values());
    videos.sort(function (a, b) { return b.count - a.count || b.last - a.last; });

    var channels = Array.from(channelMap.values());
    channels.forEach(function (c) { c.uniqueVideos = c.videos.size; });
    channels.sort(function (a, b) { return b.plays - a.plays || b.last - a.last; });

    var firstT = events.length ? events[0].t : null;
    var lastT = events.length ? events[events.length - 1].t : null;

    /* --- 月別（空白月も 0 で埋める） --- */
    var months = [];
    if (firstT !== null) {
      var keys = U.monthRange(firstT, lastT);
      var cumV = 0, cumC = 0;
      // 月ごとの「初めて見たチャンネル数」
      var chFirstByMonth = new Map();
      channels.forEach(function (c) {
        var k = U.monthKey(c.first);
        chFirstByMonth.set(k, (chFirstByMonth.get(k) || 0) + 1);
      });
      keys.forEach(function (k) {
        var m = monthMap.get(k) || { key: k, total: 0, discovery: 0, repeat: 0 };
        cumV += m.discovery;
        cumC += (chFirstByMonth.get(k) || 0);
        months.push({
          key: k, total: m.total, discovery: m.discovery, repeat: m.repeat,
          newChannels: chFirstByMonth.get(k) || 0,
          cumVideos: cumV, cumChannels: cumC
        });
      });
    }

    /* --- 最多視聴日・連続視聴日数 --- */
    var topDay = null;
    dayCount.forEach(function (n, k) {
      if (!topDay || n > topDay.count) topDay = { day: k, count: n };
    });

    var dayKeys = Array.from(dayCount.keys()).sort();
    var streak = 0, bestStreak = 0, bestStreakEnd = null, prevTime = null;
    for (var k2 = 0; k2 < dayKeys.length; k2++) {
      var cur = new Date(dayKeys[k2] + 'T00:00:00').getTime();
      streak = (prevTime !== null && Math.round((cur - prevTime) / 86400000) === 1) ? streak + 1 : 1;
      if (streak > bestStreak) { bestStreak = streak; bestStreakEnd = dayKeys[k2]; }
      prevTime = cur;
    }

    var total = events.length;
    var uniqueVideos = videos.length;
    var repeated = videos.filter(function (v) { return v.count >= 2; }).length;
    var spanDays = firstT === null ? 0 : Math.max(1, Math.round((lastT - firstT) / 86400000) + 1);

    /* --- 時間帯の山 --- */
    var hourTotals = new Array(24).fill(0);
    var peakHour = 0;
    for (var wd = 0; wd < 7; wd++) {
      for (var hh = 0; hh < 24; hh++) hourTotals[hh] += heat[wd][hh];
    }
    for (var h2 = 1; h2 < 24; h2++) if (hourTotals[h2] > hourTotals[peakHour]) peakHour = h2;

    return {
      events: events,
      videos: videos,
      videoMap: videoMap,
      channels: channels,
      channelMap: channelMap,
      months: months,
      dayCount: dayCount,
      dayMap: dayMap,
      heat: heat,
      hourTotals: hourTotals,
      peakHour: peakHour,
      totals: {
        plays: total,
        uniqueVideos: uniqueVideos,
        uniqueChannels: channels.length,
        repeatedVideos: repeated,
        repeatPlays: total - uniqueVideos,
        repeatShare: total ? (total - uniqueVideos) / total : 0,
        repeatRatio: uniqueVideos ? repeated / uniqueVideos : 0,
        avgPerVideo: uniqueVideos ? total / uniqueVideos : 0,
        activeDays: dayCount.size,
        spanDays: spanDays,
        perDay: spanDays ? total / spanDays : 0,
        perActiveDay: dayCount.size ? total / dayCount.size : 0,
        musicPlays: musicPlays,
        shortsPlays: shortsPlays,
        first: firstT,
        last: lastT,
        topDay: topDay,
        bestStreak: bestStreak,
        bestStreakEnd: bestStreakEnd
      }
    };
  };

  /* ---------------- 派生ビュー ---------------- */

  /**
   * その月の 1 日ごとの内訳。見ていない日も 0 として埋めるので、
   * 月の途中の空白がグラフでそのまま見える。
   * @returns {{days:Array, total:number, discovery:number, repeat:number, activeDays:number, best:Object|null}}
   */
  A.monthDays = function (analysis, monthKey) {
    var y = Number(monthKey.slice(0, 4));
    var mo = Number(monthKey.slice(5, 7));
    var last = new Date(y, mo, 0).getDate();   // 月末日（翌月の 0 日）
    var days = [];
    var total = 0, discovery = 0, repeat = 0, activeDays = 0, best = null;

    for (var d = 1; d <= last; d++) {
      var key = monthKey + '-' + U.pad2(d);
      var src = analysis.dayMap.get(key);
      var row = {
        key: key,
        day: d,
        total: src ? src.total : 0,
        discovery: src ? src.discovery : 0,
        repeat: src ? src.repeat : 0
      };
      days.push(row);
      total += row.total;
      discovery += row.discovery;
      repeat += row.repeat;
      if (row.total > 0) activeDays++;
      if (!best || row.total > best.total) best = row;
    }
    return {
      days: days, total: total, discovery: discovery, repeat: repeat,
      activeDays: activeDays, best: best && best.total > 0 ? best : null
    };
  };

  /** そのチャンネルで最初に見た動画の一覧（チャンネルを見つけた順） */
  A.channelDiscovery = function (analysis) {
    return analysis.channels.slice().sort(function (a, b) { return a.first - b.first; });
  };

  /** 動画ごとの視聴間隔（2 回目以降） */
  A.gaps = function (times) {
    var out = [];
    for (var i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]);
    return out;
  };

  /** チャンネル内の動画を再生回数順に並べる */
  A.channelVideos = function (analysis, channel) {
    var out = [];
    channel.videos.forEach(function (count, key) {
      var v = analysis.videoMap.get(key);
      if (v) out.push(v);
    });
    out.sort(function (a, b) { return b.count - a.count || a.first - b.first; });
    return out;
  };

  global.Analytics = A;
})(window);
