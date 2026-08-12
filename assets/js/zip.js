/* 最小限の ZIP リーダー
   - Blob.slice で必要な範囲だけを読むので、巨大な Takeout でも全体をメモリに載せない
   - 圧縮方式は「無圧縮(0)」と「deflate(8)」に対応（DecompressionStream を使用）
   - ZIP64 の中央ディレクトリにも対応
*/
(function (global) {
  'use strict';

  var Zip = {};

  function dv(buf) { return new DataView(buf); }

  async function slice(file, start, end) {
    if (start < 0) start = 0;
    if (end > file.size) end = file.size;
    return await file.slice(start, end).arrayBuffer();
  }

  Zip.supported = function () {
    return typeof DecompressionStream === 'function';
  };

  // 末尾から EOCD(0x06054b50) を探す
  async function findEocd(file) {
    var maxTail = Math.min(file.size, 66000);
    var buf = await slice(file, file.size - maxTail, file.size);
    var d = dv(buf);
    for (var i = buf.byteLength - 22; i >= 0; i--) {
      if (d.getUint32(i, true) === 0x06054b50) {
        return { view: d, offset: i, tailStart: file.size - maxTail };
      }
    }
    return null;
  }

  async function readCentralDirectoryInfo(file) {
    var eocd = await findEocd(file);
    if (!eocd) throw new Error('ZIP の終端レコードが見つかりません（zip ファイルではない可能性があります）');

    var d = eocd.view, o = eocd.offset;
    var entries = d.getUint16(o + 10, true);
    var cdSize = d.getUint32(o + 12, true);
    var cdOffset = d.getUint32(o + 16, true);

    // ZIP64 の場合は EOCD ロケータ(0x07064b50)を手前から探す
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entries === 0xffff) {
      for (var i = o - 20; i >= 0; i--) {
        if (d.getUint32(i, true) === 0x07064b50) {
          var z64Offset = Number(d.getBigUint64(i + 8, true));
          var zbuf = await slice(file, z64Offset, z64Offset + 56);
          var zd = dv(zbuf);
          if (zd.getUint32(0, true) === 0x06064b50) {
            entries = Number(zd.getBigUint64(32, true));
            cdSize = Number(zd.getBigUint64(40, true));
            cdOffset = Number(zd.getBigUint64(48, true));
          }
          break;
        }
      }
    }
    return { entries: entries, cdSize: cdSize, cdOffset: cdOffset };
  }

  // 拡張フィールドから ZIP64 の実サイズ／オフセットを取り出す
  function readZip64Extra(d, start, len, entry) {
    var p = start, end = start + len;
    while (p + 4 <= end) {
      var id = d.getUint16(p, true);
      var size = d.getUint16(p + 2, true);
      var q = p + 4;
      if (id === 0x0001) {
        if (entry.size === 0xffffffff && q + 8 <= end) { entry.size = Number(d.getBigUint64(q, true)); q += 8; }
        if (entry.compressedSize === 0xffffffff && q + 8 <= end) { entry.compressedSize = Number(d.getBigUint64(q, true)); q += 8; }
        if (entry.headerOffset === 0xffffffff && q + 8 <= end) { entry.headerOffset = Number(d.getBigUint64(q, true)); }
        return;
      }
      p = q + size;
    }
  }

  /** zip 内のファイル一覧を返す */
  Zip.list = async function (file) {
    var info = await readCentralDirectoryInfo(file);
    var buf = await slice(file, info.cdOffset, info.cdOffset + info.cdSize);
    var d = dv(buf);
    var utf8 = new TextDecoder('utf-8');
    var out = [];
    var p = 0;

    while (p + 46 <= buf.byteLength) {
      if (d.getUint32(p, true) !== 0x02014b50) break;
      var flags = d.getUint16(p + 8, true);
      var entry = {
        method: d.getUint16(p + 10, true),
        compressedSize: d.getUint32(p + 20, true),
        size: d.getUint32(p + 24, true),
        headerOffset: d.getUint32(p + 42, true)
      };
      var nameLen = d.getUint16(p + 28, true);
      var extraLen = d.getUint16(p + 30, true);
      var commentLen = d.getUint16(p + 32, true);
      entry.name = utf8.decode(new Uint8Array(buf, p + 46, nameLen));
      readZip64Extra(d, p + 46 + nameLen, extraLen, entry);
      entry.encrypted = (flags & 0x1) === 1;
      if (!/\/$/.test(entry.name)) out.push(entry);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  };

  /** 指定エントリを Blob として取り出す */
  Zip.read = async function (file, entry) {
    if (entry.encrypted) throw new Error('パスワード付きの zip には対応していません');

    // ローカルヘッダを読んで実データの開始位置を求める
    var head = await slice(file, entry.headerOffset, entry.headerOffset + 30);
    var hd = dv(head);
    if (hd.getUint32(0, true) !== 0x04034b50) throw new Error('zip の内部構造を読み取れませんでした');
    var nameLen = hd.getUint16(26, true);
    var extraLen = hd.getUint16(28, true);
    var dataStart = entry.headerOffset + 30 + nameLen + extraLen;
    var dataBlob = file.slice(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return dataBlob;
    if (entry.method !== 8) throw new Error('未対応の圧縮方式です（method=' + entry.method + '）');
    if (!Zip.supported()) throw new Error('このブラウザは zip の解凍に対応していません。zip を展開してから読み込ませてください');

    var stream = dataBlob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).blob();
  };

  global.Zip = Zip;
})(window);
