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
     gone:    boolean       削除・非公開でタイトルが取れなかったか

   広告（「Google 広告から」の記録）は視聴ではないので、読み込む時点で捨てる。
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

  // 広告の印。Takeout は言語ごとに表記が変わるので、日本語も必ず入れておく。
  // 日本語で書き出したファイルには「Google 広告から」しか現れない（英語表記は 0 件だった）。
  // 動画タイトルに「広告」が入っていても誤爆しないよう、「Google」まで含めて照合する。
  var AD_MARKER = /Google\s広告から|From Google Ads|Google Ads|Google 광고|Anuncios de Google|Annonces Google/;

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

  // 「〜を視聴しました」の行だけが視聴。マイアクティビティの書き出しには
  // 「高く評価しました」「低く評価しました」「非表示:」など別の操作も混ざっていて、
  // これらは動画リンクを持つので、放っておくと視聴として数えられてしまう。
  // cleanTitle が何か削れた＝視聴を表す言い回しが付いていた、と判定する。
  function isWatchText(raw) {
    if (!raw) return false;
    return cleanTitle(raw) !== String(raw).trim();
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

  // ショート動画の判定。
  // Takeout はショートも通常の watch?v= として記録するため、URL では判別できない
  // （実データ 166,609 件のうち /shorts/ 形式の URL は 0 件だった）。
  // 唯一の手がかりが、投稿者がタイトルに付ける #shorts などのタグ。
  // 「Beautiful shorts」のような普通の英単語を拾わないよう、記号付きだけを見る。
  var SHORTS_TAG = /[#＃@][ 　]*shorts?\b|[【[（(][ 　]*shorts?[ 　]*[】\]）)]/i;

  Parser.isShorts = function (title, url) {
    if (url && url.indexOf('/shorts/') >= 0) return true;
    return SHORTS_TAG.test(title || '');
  };

  function makeEvent(t, title, url, chName, chUrl, music) {
    var videoId = videoIdFromUrl(url);
    var gone = false;
    var shorts = Parser.isShorts(title, url);

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
      shorts: shorts,
      gone: gone
    };
  }

  /* ---------------- JSON 形式 ---------------- */

  function fromJson(raw, onProgress) {
    if (!Array.isArray(raw)) throw new Error('JSON の形式が想定と違います（配列ではありません）');

    var events = [];
    var skipped = { search: 0, noTime: 0, other: 0, ads: 0, notYouTube: 0, otherAction: 0 };

    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (!r || typeof r !== 'object') { skipped.other++; continue; }
      if (r.products && r.products.indexOf && r.products.indexOf('YouTube') < 0 &&
          r.products.indexOf('YouTube Music') < 0) { skipped.notYouTube++; continue; }

      var url = r.titleUrl || null;
      if (isSearchEntry(r.title, url)) { skipped.search++; continue; }

      var t = r.time ? Date.parse(r.time) : NaN;
      if (!isFinite(t)) { skipped.noTime++; continue; }

      // 広告は視聴ではないので数に入れない
      var ad = false;
      if (Array.isArray(r.details)) {
        for (var d = 0; d < r.details.length; d++) {
          if (r.details[d] && AD_MARKER.test(r.details[d].name || '')) { ad = true; break; }
        }
      }
      if (ad) { skipped.ads++; continue; }

      // 高く評価した・低く評価した等は視聴ではないので取り込まない
      if (!isWatchText(r.title)) { skipped.otherAction++; continue; }

      var sub = Array.isArray(r.subtitles) && r.subtitles.length ? r.subtitles[0] : null;
      events.push(makeEvent(
        t,
        cleanTitle(r.title),
        url,
        sub ? sub.name : null,
        sub ? sub.url : null,
        r.header === 'YouTube Music'
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
  // ブロック先頭の見出しがサービス名（「YouTube」「検索」「Chrome」など）
  var RE_HEADER_CELL = /<div[^>]*class="[^"]*header-cell[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

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
    var skipped = { search: 0, noTime: 0, other: 0, ads: 0, notYouTube: 0, otherAction: 0 };
    var MARK = 'outer-cell';
    var pos = text.indexOf(MARK);
    var total = text.length;
    var sinceYield = 0;

    while (pos >= 0) {
      var next = text.indexOf(MARK, pos + MARK.length);
      var block = text.slice(pos, next < 0 ? text.length : next);
      pos = next;

      var isMusic = block.indexOf('YouTube Music') >= 0 && /class="mdl-typography--title"[^>]*>\s*YouTube Music/.test(block);

      // 「マイ アクティビティ」の書き出しには検索・Chrome など他サービスの記録も
      // 混ざる。見出しのサービス名を見て、YouTube 以外は数に入れない。
      // （Google 検索の結果から YouTube を開いた記録などが視聴として紛れ込むのを防ぐ）
      var head = RE_HEADER_CELL.exec(block);
      var service = head ? stripTags(head[1]) : '';
      var isYouTube = service ? service.indexOf('YouTube') >= 0 : true;

      // 広告は視聴ではないので、解析する前に捨てる
      var isAd = isYouTube && AD_MARKER.test(block);
      var cell = (!isYouTube || isAd) ? null : RE_CONTENT_CELL.exec(block);

      if (!isYouTube) {
        skipped.notYouTube++;
      } else if (isAd) {
        skipped.ads++;
      } else if (cell) {
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
          if (!video && /watch\?|youtu\.be\/|\/shorts\/|\/live\/|\/embed\//.test(href)) video = links[i];
          else if (!channel && /\/channel\/|youtube\.com\/@/.test(href)) channel = links[i];
        }

        // 最後の行に日時が入っている
        var plain = stripTags(inner).split('\n');
        var dateStr = '';
        for (var p = plain.length - 1; p >= 0; p--) {
          if (plain[p] && /\d{4}/.test(plain[p])) { dateStr = plain[p]; break; }
        }
        var t = Parser.parseLocalizedDate(dateStr);

        // 検索の記録は動画リンクを持たないので、video の有無だけでは判別できない。
        // 1 行目の文言（「〜を検索しました」など）と検索結果 URL の両方を見る。
        var looksSearch = isSearchEntry(video ? video.text : plain[0], video ? video.href : null) ||
          links.some(function (l) { return /\/results\?/.test(l.href) || /google\.[^/]*\/search\?/.test(l.href); });

        if (looksSearch) {
          skipped.search++;
        } else if (!isFinite(t)) {
          skipped.noTime++;
        } else if (!video) {
          skipped.other++;
        } else if (!isWatchText(plain[0])) {
          // 高く評価した・低く評価した・非表示にした等。動画リンクはあるが視聴ではない
          skipped.otherAction++;
        } else {
          events.push(makeEvent(t, cleanTitle(video.text), video.href,
            channel ? channel.text : null, channel ? channel.href : null, isMusic));
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

  /* ---------------- 統合ファイル（このアプリが書き出す形式） ---------------- */

  var MERGED_FORMAT = 'yt-history-merged';

  Parser.MERGED_FORMAT = MERGED_FORMAT;

  Parser.buildMergedFile = function (events, sources) {
    return {
      format: MERGED_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      count: events.length,
      sources: sources || [],
      events: events
    };
  };

  function isMergedFile(data) {
    return data && !Array.isArray(data) && data.format === MERGED_FORMAT && Array.isArray(data.events);
  }

  /* ---------------- 重複排除 ---------------- */

  // 同じ視聴かどうかは「動画 ID ＋ 秒までの時刻」で判定する。
  // JSON はミリ秒まで、HTML は秒までしか持たないので、秒に丸めないと
  // 同じ視聴が別物として二重に残る。
  function dedupeKey(e) {
    return (e.videoId ? 'v:' + e.videoId : e.key) + '|' + Math.floor(e.t / 1000);
  }

  // 同じ視聴が複数のファイルにある場合、情報が多い方を残す。
  // マイアクティビティ側はチャンネル名が入っていない行が 1 割ほどある。
  function score(e) {
    return (e.gone ? 0 : 4) + (e.ch ? 2 : 0) + (e.chId ? 1 : 0);
  }

  /**
   * 複数ソースのイベントを 1 本にまとめる
   * @param {Array<{name:string, events:Array, skipped?:Object}>} lists 先に渡した方が優先
   * @returns {{events:Array, sources:Array}}
   */
  Parser.merge = function (lists) {
    var map = new Map();
    var stats = [];

    lists.forEach(function (src) {
      var before = map.size;
      var events = src.events || [];
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        var k = dedupeKey(e);
        var cur = map.get(k);
        if (cur === undefined) map.set(k, e);
        else if (score(e) > score(cur)) map.set(k, e);
      }
      var added = map.size - before;
      stats.push({
        name: src.name,
        count: events.length,
        added: added,
        duplicates: events.length - added,
        skipped: src.skipped || null
      });
    });

    var events = [];
    map.forEach(function (v) { events.push(v); });
    events.sort(function (a, b) { return a.t - b.t; });
    return { events: events, sources: stats };
  };

  /* ---------------- 入口 ---------------- */

  // 「マイアクティビティ.html」も再生履歴として扱う。watch-history とは別の
  // ストリームだが、視聴の記録という点では同じで、古い期間はこちらにしか残らない。
  var HISTORY_NAME =
    /(watch[-_ ]?history|再生履歴|視聴履歴|マイ ?アクティビティ|my ?activity|시청_기록|시청 기록|verlauf|historial|historique)[^/\\]*\.(json|html?|txt)$/i;

  // 検索履歴・コメント・チャットなど、視聴履歴ではないもの
  var NOT_HISTORY = /(search|検索|コメント|comment|chat|チャット|subscri|登録チャンネル|再生リスト|playlist|クリップ|clip)/i;

  function pickHistoryEntries(entries) {
    var candidates = entries.filter(function (e) {
      return HISTORY_NAME.test(e.name) && !NOT_HISTORY.test(e.name);
    });
    if (!candidates.length) {
      // ファイル名が言語依存で一致しない場合は「YouTube」を含むパスから拾う
      candidates = entries.filter(function (e) {
        return /youtube/i.test(e.name) && /\.(json|html?|txt)$/i.test(e.name) &&
               !NOT_HISTORY.test(e.name);
      });
    }
    // 同じ zip に JSON と HTML の両方が入っていることがある。どちらか一方を
    // 選ぶのではなく全部読んで、後で重複排除する（片方にしか無い行があるため）。
    candidates.sort(function (a, b) {
      var aj = /\.json$/i.test(a.name) ? 0 : 1;
      var bj = /\.json$/i.test(b.name) ? 0 : 1;
      if (aj !== bj) return aj - bj;
      return b.size - a.size;
    });
    return candidates;
  }

  // 1 つの blob を読んでイベント配列にする
  async function readBlob(blob, name, report) {
    report(0.25, '「' + name + '」を読み込んでいます…');
    var text = await blob.text();
    report(0.45, '「' + name + '」を解析しています…');
    await U.nextFrame();

    var looksJson = /\.json$/i.test(name) || /^\s*[[{]/.test(text.slice(0, 200));
    if (!looksJson) {
      return await fromHtml(text, function (r) { report(0.45 + r * 0.5, '「' + name + '」を解析しています…'); });
    }

    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON を解釈できませんでした（ファイルが壊れている可能性があります）');
    }

    // このアプリが書き出した統合ファイルなら、解析し直さずそのまま使う
    if (isMergedFile(data)) {
      // ショート判定を入れる前に書き出した統合ファイルには shorts が無いので補う
      for (var i = 0; i < data.events.length; i++) {
        var ev = data.events[i];
        if (ev.shorts === undefined) ev.shorts = Parser.isShorts(ev.title, ev.url);
      }
      return {
        events: data.events,
        skipped: { search: 0, noTime: 0, other: 0, ads: 0, notYouTube: 0, otherAction: 0 },
        merged: true
      };
    }
    return fromJson(data, function (r) { report(0.45 + r * 0.5, '「' + name + '」を解析しています…'); });
  }

  // File 1 つを「読むべき blob の一覧」に展開する（zip なら複数になる）
  async function expand(file, report) {
    var name = file.name || '';
    if (!/\.zip$/i.test(name)) return [{ name: name, blob: file }];

    report(0.02, 'zip の中身を確認しています…');
    var entries = await Zip.list(file);
    var picked = pickHistoryEntries(entries);
    if (!picked.length) {
      throw new Error('zip「' + name + '」の中に再生履歴が見つかりませんでした。' +
        'Takeout で「YouTube と YouTube Music → 履歴」を含めて書き出したか確認してください。');
    }
    var out = [];
    for (var i = 0; i < picked.length; i++) {
      report(0.04, '「' + picked[i].name.split('/').pop() + '」を取り出しています…');
      out.push({ name: picked[i].name.split('/').pop(), blob: await Zip.read(file, picked[i]) });
    }
    return out;
  }

  /**
   * 複数ファイル（json / html / txt / zip / 統合 json）を読み込んで 1 本にまとめる
   * @param {FileList|File[]} files
   * @param {(ratio:number, label:string)=>void} onProgress
   */
  Parser.loadFiles = async function (files, onProgress) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) throw new Error('ファイルが選ばれていません');

    var report = function (r, label) { if (onProgress) onProgress(Math.min(0.99, r), label); };
    var lists = [];
    var warnings = [];
    var total = { search: 0, noTime: 0, other: 0, ads: 0, notYouTube: 0, otherAction: 0 };
    var hadMerged = false;

    for (var i = 0; i < list.length; i++) {
      var base = i / list.length;
      var span = 1 / list.length;
      var step = (function (b, s) {
        return function (r, label) { report(b + r * s, label); };
      })(base, span);

      var parts;
      try {
        parts = await expand(list[i], step);
      } catch (err) {
        warnings.push((list[i].name || 'ファイル') + '：' + err.message);
        continue;
      }

      for (var j = 0; j < parts.length; j++) {
        try {
          var res = await readBlob(parts[j].blob, parts[j].name, step);
          if (res.merged) hadMerged = true;
          if (!res.events.length) {
            var why = 'に視聴の記録が 1 件もありませんでした。読み飛ばしました。';
            if (res.skipped.notYouTube > res.skipped.search) {
              why = 'は YouTube 以外のアクティビティ（検索や Chrome など）のようです。読み飛ばしました。';
            } else if (res.skipped.search > 0) {
              why = 'は検索履歴のようです。視聴の記録が無いので読み飛ばしました。';
            }
            warnings.push('「' + parts[j].name + '」' + why);
            continue;
          }
          total.search += res.skipped.search || 0;
          total.noTime += res.skipped.noTime || 0;
          total.other += res.skipped.other || 0;
          total.ads += res.skipped.ads || 0;
          total.notYouTube += res.skipped.notYouTube || 0;
          total.otherAction += res.skipped.otherAction || 0;
          lists.push({ name: parts[j].name, events: res.events, skipped: res.skipped });
        } catch (err) {
          warnings.push('「' + parts[j].name + '」：' + err.message);
        }
      }
    }

    if (!lists.length) {
      throw new Error(warnings.length
        ? warnings.join('\n')
        : '視聴の記録が 1 件も見つかりませんでした。再生履歴のファイルか確認してください。');
    }

    report(0.99, 'まとめています…');
    await U.nextFrame();
    var merged = Parser.merge(lists);

    return {
      events: merged.events,
      meta: {
        sourceName: lists.map(function (s) { return s.name; }).join('、'),
        sources: merged.sources,
        importedAt: Date.now(),
        skipped: total,
        warnings: warnings,
        fromMergedFile: hadMerged
      }
    };
  };

  /** 1 ファイル版（従来の入口） */
  Parser.loadFile = function (file, onProgress) {
    return Parser.loadFiles([file], onProgress);
  };

  Parser.cleanTitle = cleanTitle;
  global.Parser = Parser;
})(window);
