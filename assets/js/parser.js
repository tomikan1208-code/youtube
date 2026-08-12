/* Google Takeout の YouTube 履歴を、共通の「視聴イベント」配列へ正規化する。

   視聴イベント:
   {
     t:       number   視聴時刻 (epoch ms)
     key:     string   動画の同一性キー（動画 ID、無ければタイトル+チャンネル）
     videoId: string|null
     title:   string
     url:     string|null
     ch:      string|null   チャンネル名
     chId:    string|null   チャンネル ID
     music:   boolean       YouTube Music の再生か
     ad:      boolean       広告か
     gone:    boolean       削除・非公開でタイトルが取れなかったか
   }
*/
(function (global) {
  'use strict';

  var Parser = {};

  /* ---------------- タイトルの言語別の飾りを外す ---------------- */

  // 「〜を視聴しました」「Watched 〜」など、Takeout が言語ごとに付ける文言。
  var TITLE_PREFIXES = [
    'Watched ', 'Has visto ', 'Viste ', 'Vous avez regardé ', 'Hai guardato ',
    'Assistiu a ', 'Assistiu ', 'Je hebt ', 'Sie haben ', 'Obejrzano ',
    'Смотрели ', 'Anda menonton ', 'Ditonton ', 'คุณดู ', 'Đã xem '
  ];
  var TITLE_SUFFIXES = [
    'を視聴しました', ' 시청함', '을(를) 시청함', '를 시청했습니다', '을 시청했습니다',
    ' angesehen', ' bekeken', ' 已觀看', ' 观看过'
  ];

  var SEARCH_MARKERS = [
    /^Searched for /, /を検索しました$/, /^Has buscado /, /^Vous avez recherché /,
    /^Hai cercato /, /^Pesquisou por /, /^Gesucht nach /, / 검색함$/
  ];

  function cleanTitle(raw) {
    if (!raw) return '';
    var s = String(raw);
    for (var i = 0; i < TITLE_PREFIXES.length; i++) {
      if (s.indexOf(TITLE_PREFIXES[i]) === 0) return s.slice(TITLE_PREFIXES[i].length).trim();
    }
    for (var j = 0; j < TITLE_SUFFIXES.length; j++) {
      var suf = TITLE_SUFFIXES[j];
      if (s.length > suf.length && s.slice(-suf.length) === suf) return s.slice(0, -suf.length).trim();
    }
    return s.trim();
  }

  function isSearchEntry(title, url) {
    if (url && url.indexOf('/results?') >= 0) return true;
    if (!title) return false;
    for (var i = 0; i < SEARCH_MARKERS.length; i++) {
      if (SEARCH_MARKERS[i].test(title)) return true;
    }
    return false;
  }

  function videoIdFromUrl(url) {
    if (!url) return null;
    var m = /[?&]v=([\w-]{6,20})/.exec(url);
    if (m) return m[1];
    m = /youtu\.be\/([\w-]{6,20})/.exec(url);
    if (m) return m[1];
    m = /\/(?:shorts|live|embed)\/([\w-]{6,20})/.exec(url);
    return m ? m[1] : null;
  }

  function channelIdFromUrl(url) {
    if (!url) return null;
    var m = /\/channel\/([\w-]+)/.exec(url);
    if (m) return m[1];
    m = /youtube\.com\/(@[^/?#]+)/.exec(url);
    return m ? m[1] : null;
  }

  function makeEvent(t, title, url, chName, chUrl, music, ad) {
    var videoId = videoIdFromUrl(url);
    var gone = false;

    // 削除・非公開の動画はタイトル欄に URL がそのまま入る
    if (!title || /^https?:\/\//.test(title)) {
      gone = true;
      title = videoId ? '（削除・非公開の動画）' : '（不明な動画）';
    }
    return {
      t: t,
      key: videoId ? 'v:' + videoId : 'n:' + title + '\u0000' + (chName || ''),
      videoId: videoId,
      title: title,
      url: url || null,
      ch: chName || null,
      chId: channelIdFromUrl(chUrl),
      music: !!music,
      ad: !!ad,
      gone: gone
    };
  }

  /* ---------------- JSON 形式 ---------------- */

  function fromJson(raw, onProgress) {
    if (!Array.isArray(raw)) throw new Error('JSON の形式が想定と違います（配列ではありません）');

    var events = [];
    var skipped = { search: 0, noTime: 0, other: 0 };

    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (!r || typeof r !== 'object') { skipped.other++; continue; }
      if (r.products && r.products.indexOf && r.products.indexOf('YouTube') < 0 &&
          r.products.indexOf('YouTube Music') < 0) { skipped.other++; continue; }

      var url = r.titleUrl || null;
      if (isSearchEntry(r.title, url)) { skipped.search++; continue; }

      var t = r.time ? Date.parse(r.time) : NaN;
      if (!isFinite(t)) { skipped.noTime++; continue; }

      var ad = false;
      if (Array.isArray(r.details)) {
        for (var d = 0; d < r.details.length; d++) {
          if (r.details[d] && /Google Ads/i.test(r.details[d].name || '')) { ad = true; break; }
        }
      }

      var sub = Array.isArray(r.subtitles) && r.subtitles.length ? r.subtitles[0] : null;
      events.push(makeEvent(
        t,
        cleanTitle(r.title),
        url,
        sub ? sub.name : null,
        sub ? sub.url : null,
        r.header === 'YouTube Music',
        ad
      ));

      if (onProgress && (i & 8191) === 0) onProgress(i / raw.length);
    }
    return { events: events, skipped: skipped };
  }

  /* ---------------- HTML 形式 ---------------- */

  // Takeout の HTML は 1 件が outer-cell ブロック。DOMParser では巨大ファイルで
  // 落ちるため、テキストを走査しながら必要な部分だけ取り出す。
  var RE_ANCHOR = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  var RE_CONTENT_CELL = /<div[^>]*class="[^"]*content-cell[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

  function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1) === 'x' || e.charAt(1) === 'X'
          ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(code) ? String.fromCodePoint(code) : m;
      }
      var map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '39': "'" };
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m;
    });
  }

  function stripTags(s) {
    return decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
  }

  var TZ_OFFSETS = {
    UTC: 0, GMT: 0, Z: 0, JST: 9, KST: 9, IST: 5.5, SGT: 8, HKT: 8, CST: -6, CDT: -5,
    EST: -5, EDT: -4, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8,
    HST: -10, BST: 1, WET: 0, WEST: 1, CET: 1, CEST: 2, EET: 2, EEST: 3,
    MSK: 3, AEST: 10, AEDT: 11, ACST: 9.5, AWST: 8, NZST: 12, NZDT: 13, BRT: -3, ART: -3
  };

  var EN_MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  // 「2024/01/02 15:04:05 JST」「2024年1月2日 15:04:05 JST」
  // 「Jan 2, 2024, 3:04:05 PM PST」などを解釈する
  Parser.parseLocalizedDate = function (str) {
    if (!str) return NaN;
    var s = String(str).replace(/ /g, ' ').trim();

    var tzOffset = null;
    var mTz = /(?:\s|^)(UTC|GMT)?([+-]\d{1,2})(?::?(\d{2}))?$/.exec(s);
    var mAbbr = /\s([A-Z]{2,5})$/.exec(s);
    if (mTz && (mTz[1] || mTz[2])) {
      tzOffset = Number(mTz[2]) + (mTz[3] ? (Number(mTz[2]) < 0 ? -1 : 1) * Number(mTz[3]) / 60 : 0);
      s = s.slice(0, mTz.index).trim();
    } else if (mAbbr && Object.prototype.hasOwnProperty.call(TZ_OFFSETS, mAbbr[1])) {
      tzOffset = TZ_OFFSETS[mAbbr[1]];
      s = s.slice(0, mAbbr.index).trim();
    }

    // 「午後 3:04」のように時刻の前に付く言語があるので、先に取り出しておく
    var meridiem = null;
    var mMeri = /(午前|午後|오전|오후)/.exec(s);
    if (mMeri) {
      meridiem = (mMeri[1] === '午後' || mMeri[1] === '오후') ? 'PM' : 'AM';
      s = (s.slice(0, mMeri.index) + ' ' + s.slice(mMeri.index + mMeri[1].length)).trim();
    }

    var y, mo, d, hh = 0, mm = 0, ss = 0, m;

    m = /^(\d{4})[年/\-.\s]+(\d{1,2})[月/\-.\s]+(\d{1,2})[日.]?[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s);
    if (m) {
      y = +m[1]; mo = +m[2] - 1; d = +m[3];
      hh = +m[4]; mm = +m[5]; ss = m[6] ? +m[6] : 0;
      hh = applyMeridiem(hh, m[7] || meridiem);
    } else {
      m = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s);
      if (m) {
        mo = EN_MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (mo === undefined) return NaN;
        d = +m[2]; y = +m[3];
        hh = +m[4]; mm = +m[5]; ss = m[6] ? +m[6] : 0;
        hh = applyMeridiem(hh, m[7] || meridiem);
      } else {
        m = /^(\d{1,2})[\s.]+([A-Za-z]{3,9})[\s.]+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
        if (m) {
          d = +m[1];
          mo = EN_MONTHS[m[2].slice(0, 3).toLowerCase()];
          if (mo === undefined) return NaN;
          y = +m[3]; hh = +m[4]; mm = +m[5]; ss = m[6] ? +m[6] : 0;
          hh = applyMeridiem(hh, meridiem);
        } else {
          var fallback = Date.parse(str);
          return isFinite(fallback) ? fallback : NaN;
        }
      }
    }

    if (tzOffset === null) return new Date(y, mo, d, hh, mm, ss).getTime();
    return Date.UTC(y, mo, d, hh, mm, ss) - tzOffset * 3600000;
  };

  function applyMeridiem(hh, mark) {
    if (!mark) return hh;
    var pm = /PM/i.test(mark) || mark === '午後';
    if (pm && hh < 12) return hh + 12;
    if (!pm && hh === 12) return 0;
    return hh;
  }

  async function fromHtml(text, onProgress) {
    var events = [];
    var skipped = { search: 0, noTime: 0, other: 0 };
    var MARK = 'outer-cell';
    var pos = text.indexOf(MARK);
    var total = text.length;
    var sinceYield = 0;

    while (pos >= 0) {
      var next = text.indexOf(MARK, pos + MARK.length);
      var block = text.slice(pos, next < 0 ? text.length : next);
      pos = next;

      var isMusic = block.indexOf('YouTube Music') >= 0 && /class="mdl-typography--title"[^>]*>\s*YouTube Music/.test(block);
      var isAd = /From Google Ads/i.test(block);

      var cell = RE_CONTENT_CELL.exec(block);
      if (cell) {
        var inner = cell[1];
        var links = [];
        RE_ANCHOR.lastIndex = 0;
        var a;
        while ((a = RE_ANCHOR.exec(inner)) !== null) {
          links.push({ href: decodeEntities(a[1]), text: stripTags(a[2]) });
        }

        var video = null, channel = null;
        for (var i = 0; i < links.length; i++) {
          var href = links[i].href;
          if (!video && /watch\?|youtu\.be\/|\/shorts\//.test(href)) video = links[i];
          else if (!channel && /\/channel\/|youtube\.com\/@/.test(href)) channel = links[i];
        }

        // 最後の行に日時が入っている
        var plain = stripTags(inner).split('\n');
        var dateStr = '';
        for (var p = plain.length - 1; p >= 0; p--) {
          if (plain[p] && /\d{4}/.test(plain[p])) { dateStr = plain[p]; break; }
        }
        var t = Parser.parseLocalizedDate(dateStr);

        if (video && isSearchEntry(video.text, video.href)) {
          skipped.search++;
        } else if (!isFinite(t)) {
          skipped.noTime++;
        } else if (!video) {
          skipped.other++;
        } else {
          events.push(makeEvent(t, cleanTitle(video.text), video.href,
            channel ? channel.text : null, channel ? channel.href : null, isMusic, isAd));
        }
      } else {
        skipped.other++;
      }

      if (++sinceYield >= 4000) {
        sinceYield = 0;
        if (onProgress) onProgress((pos < 0 ? total : pos) / total);
        await U.nextFrame();
      }
    }
    return { events: events, skipped: skipped };
  }

  /* ---------------- 入口 ---------------- */

  var HISTORY_NAME = /(watch[-_ ]?history|再生履歴|視聴履歴|시청_기록|시청 기록|verlauf|historial|historique)\.(json|html?)$/i;

  function pickHistoryEntry(entries) {
    var candidates = entries.filter(function (e) { return HISTORY_NAME.test(e.name); });
    if (!candidates.length) {
      // ファイル名が言語依存で一致しない場合は「履歴」フォルダ配下から拾う
      candidates = entries.filter(function (e) {
        return /youtube/i.test(e.name) && /\.(json|html?)$/i.test(e.name) &&
               !/(search|検索|コメント|comment|chat|チャット)/i.test(e.name);
      });
    }
    if (!candidates.length) return null;
    // JSON を優先し、同形式なら大きい方（＝件数が多い方）を選ぶ
    candidates.sort(function (a, b) {
      var aj = /\.json$/i.test(a.name) ? 0 : 1;
      var bj = /\.json$/i.test(b.name) ? 0 : 1;
      if (aj !== bj) return aj - bj;
      return b.size - a.size;
    });
    return candidates[0];
  }

  /**
   * ファイル（json / html / zip）を読み込んでイベント配列を返す
   * @param {File} file
   * @param {(ratio:number, label:string)=>void} onProgress
   */
  Parser.loadFile = async function (file, onProgress) {
    var report = function (r, label) { if (onProgress) onProgress(r, label); };
    var name = file.name || '';
    var sourceName = name;
    var blob = file;

    if (/\.zip$/i.test(name)) {
      report(0.02, 'zip の中身を確認しています…');
      var entries = await Zip.list(file);
      var entry = pickHistoryEntry(entries);
      if (!entry) {
        throw new Error('zip の中に再生履歴が見つかりませんでした。Takeout で「YouTube と YouTube Music → 履歴」を含めて書き出したか確認してください。');
      }
      report(0.08, '「' + entry.name.split('/').pop() + '」を取り出しています…');
      blob = await Zip.read(file, entry);
      sourceName = entry.name.split('/').pop();
      name = entry.name;
    }

    report(0.25, 'ファイルを読み込んでいます…');
    var text = await blob.text();
    report(0.45, '解析しています…');
    await U.nextFrame();

    var result;
    var looksJson = /\.json$/i.test(name) || /^\s*[[{]/.test(text.slice(0, 200));

    if (looksJson) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('JSON を解釈できませんでした（ファイルが壊れている可能性があります）');
      }
      result = fromJson(data, function (r) { report(0.45 + r * 0.5, '解析しています…'); });
    } else {
      result = await fromHtml(text, function (r) { report(0.45 + r * 0.5, '解析しています…'); });
    }

    if (!result.events.length) {
      if (result.skipped.search > 0) {
        throw new Error('このファイルは検索履歴のようです。「再生履歴（watch-history）」を読み込ませてください。');
      }
      throw new Error('視聴の記録が 1 件も見つかりませんでした。再生履歴のファイルか確認してください。');
    }

    report(0.97, '並べ替えています…');
    result.events.sort(function (a, b) { return a.t - b.t; });

    return {
      events: result.events,
      meta: {
        sourceName: sourceName,
        importedAt: Date.now(),
        skipped: result.skipped
      }
    };
  };

  Parser.cleanTitle = cleanTitle;
  global.Parser = Parser;
})(window);
