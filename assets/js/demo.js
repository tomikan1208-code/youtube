/* 動作確認用のサンプル履歴を生成する（実在のデータではない）。
   同じ結果になるよう固定シードの擬似乱数を使う。 */
(function (global) {
  'use strict';

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var CHANNELS = [
    { n: 'ゆるコンピュータ科学ラジオ', topics: ['なぜ人は◯◯するのか', '知らないと損する◯◯', '◯◯の歴史がすごい'], w: 9, music: false },
    { n: '料理研究家リュウジ', topics: ['最高の◯◯の作り方', '悪魔の◯◯', '5分でできる◯◯'], w: 8, music: false },
    { n: 'Kurzgesagt – In a Nutshell', topics: ['What If ◯◯?', 'The Truth About ◯◯', 'How ◯◯ Works'], w: 7, music: false },
    { n: 'ピアノ弾きchannel', topics: ['◯◯ / ピアノ演奏', '睡眠用ピアノ ◯◯', '雨の日の◯◯'], w: 7, music: true },
    { n: 'DIY大工の道具箱', topics: ['◯◯を自作する', '10万円で◯◯を作った', '失敗しない◯◯'], w: 5, music: false },
    { n: '登山と焚き火', topics: ['◯◯縦走 1泊2日', '雪の◯◯', 'ソロキャンプ in ◯◯'], w: 5, music: false },
    { n: 'Lo-fi Beats Tokyo', topics: ['lo-fi mix vol.◯◯', 'chill beats to study ◯◯', 'midnight tape ◯◯'], w: 6, music: true },
    { n: '3分でわかる経済ニュース', topics: ['◯◯はなぜ上がったのか', '今週の◯◯', '◯◯を図解する'], w: 4, music: false },
    { n: 'ねこべや', topics: ['子猫が◯◯した日', '猫と◯◯', '保護猫の◯◯'], w: 6, music: false },
    { n: 'Retro Game Archive', topics: ['◯◯ 実況プレイ #', '名作◯◯を振り返る', '◯◯のバグ検証'], w: 4, music: false },
    { n: '英語学習チャンネル EIGO', topics: ['ネイティブが使う◯◯', '◯◯の発音を直す', 'シャドーイング ◯◯'], w: 3, music: false },
    { n: '週末アトリエ', topics: ['水彩で◯◯を描く', '◯◯のスケッチ', '画材レビュー：◯◯'], w: 3, music: false },
    { n: 'ガジェット定点観測', topics: ['◯◯ レビュー', '1年使った◯◯', '買ってはいけない◯◯'], w: 4, music: false },
    { n: '深夜の作業用BGM', topics: ['作業用BGM ◯◯', '集中したい夜の◯◯', 'カフェの◯◯'], w: 5, music: true },
    { n: 'Home Fitness 10min', topics: ['10分◯◯トレーニング', '毎日続く◯◯', '寝る前の◯◯'], w: 3, music: false }
  ];

  var WORDS = ['味噌汁', '線形代数', '宇宙', 'コーヒー', '睡眠', '本棚', '古い地図', '発酵', '低気圧', 'железо',
    '静けさ', 'カレー', '写経', '朝の光', '雪解け', '真空管', '海辺', '古書店', '観葉植物', '定食',
    'ブラックホール', '鉄道', '和音', '手帳', '苔', '中華鍋', '対数', '焚き火', '路地', '短編小説'];

  function fill(template, rnd) {
    var w = WORDS[Math.floor(rnd() * WORDS.length)];
    return template.replace('◯◯', w) + (template.slice(-1) === '#' ? Math.floor(rnd() * 40 + 1) : '');
  }

  /** サンプルの視聴イベントを生成する */
  global.Demo = {
    generate: function () {
      var rnd = mulberry32(20240816);
      var now = new Date();
      now.setHours(21, 40, 0, 0);
      var end = now.getTime();
      var start = end - 1000 * 86400000; // 約2年9か月

      // チャンネルごとに動画の在庫を作る
      var pool = [];
      CHANNELS.forEach(function (c, ci) {
        var count = 8 + Math.floor(rnd() * 26);
        var videos = [];
        for (var i = 0; i < count; i++) {
          var t = c.topics[Math.floor(rnd() * c.topics.length)];
          videos.push({
            title: fill(t, rnd),
            id: 'demo' + ci + '_' + i + 'xx',
            // 一部の動画は「繰り返し見る」性質を強く持つ
            sticky: rnd() < (c.music ? 0.55 : 0.18) ? 2.5 + rnd() * 7 : 1
          });
        }
        pool.push({ ch: c, videos: videos, chId: 'UCdemo' + String(ci).padStart(16, '0') });
      });

      var events = [];
      var totalW = CHANNELS.reduce(function (a, c) { return a + c.w; }, 0);

      // チャンネルごとに「見はじめた時期」をずらす（＝開拓の記録が意味を持つ）
      var debut = pool.map(function () { return start + rnd() * (end - start) * 0.75; });

      for (var day = start; day <= end; day += 86400000) {
        var d = new Date(day);
        var weekend = d.getDay() === 0 || d.getDay() === 6;
        // 見ない日もある
        if (rnd() < 0.12) continue;
        var n = Math.floor((weekend ? 4 : 2) + rnd() * (weekend ? 9 : 6));

        for (var k = 0; k < n; k++) {
          // 重み付きでチャンネルを選ぶ
          var r = rnd() * totalW, pick = 0, acc = 0;
          for (var ci2 = 0; ci2 < pool.length; ci2++) {
            acc += pool[ci2].ch.w;
            if (r <= acc) { pick = ci2; break; }
          }
          if (day < debut[pick]) continue;

          var p = pool[pick];
          // sticky な動画ほど選ばれやすい＝リピート視聴が生まれる
          var vTotal = p.videos.reduce(function (a, v) { return a + v.sticky; }, 0);
          var rv = rnd() * vTotal, vi = 0, acc2 = 0;
          for (var j = 0; j < p.videos.length; j++) {
            acc2 += p.videos[j].sticky;
            if (rv <= acc2) { vi = j; break; }
          }
          var v2 = p.videos[vi];

          // 時間帯：夜に寄せる
          var hour = Math.floor([7, 8, 12, 12, 13, 18, 19, 20, 21, 21, 22, 22, 23, 0, 1][Math.floor(rnd() * 15)]);
          var t2 = day + hour * 3600000 + Math.floor(rnd() * 3600000);
          if (t2 > end) continue;

          events.push({
            t: t2,
            key: 'v:' + v2.id,
            videoId: v2.id,
            title: v2.title,
            url: 'https://www.youtube.com/watch?v=' + v2.id,
            ch: p.ch.n,
            chId: p.chId,
            music: p.ch.music,
            shorts: Parser.isShorts(v2.title, null),
            gone: false
          });
        }
      }

      // 削除済み動画も少しだけ混ぜる（実データには必ず現れる）
      for (var g = 0; g < 24; g++) {
        var tg = start + rnd() * (end - start);
        events.push({
          t: tg, key: 'v:gone' + g, videoId: 'gone' + g + 'zzz',
          title: '（削除・非公開の動画）', url: 'https://www.youtube.com/watch?v=gone' + g,
          ch: null, chId: null, music: false, shorts: false, gone: true
        });
      }

      events.sort(function (a, b) { return a.t - b.t; });
      return {
        events: events,
        meta: { sourceName: 'サンプルデータ', importedAt: Date.now(), demo: true, skipped: { search: 0, noTime: 0, other: 0 } }
      };
    }
  };
})(window);
