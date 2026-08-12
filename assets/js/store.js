/* 端末内（IndexedDB）への保存。外部には一切送信しない。 */
(function (global) {
  'use strict';

  var DB_NAME = 'yt-history-viewer';
  var STORE = 'dataset';
  var KEY = 'current';
  var Store = {};

  function open() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB が使えません')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var req = fn(store);
        t.oncomplete = function () { db.close(); resolve(req ? req.result : undefined); };
        t.onerror = function () { db.close(); reject(t.error); };
        t.onabort = function () { db.close(); reject(t.error); };
      });
    });
  }

  Store.save = function (payload) {
    return tx('readwrite', function (s) { return s.put(payload, KEY); });
  };

  Store.load = function () {
    return tx('readonly', function (s) { return s.get(KEY); });
  };

  Store.clear = function () {
    return tx('readwrite', function (s) { return s.delete(KEY); });
  };

  global.Store = Store;
})(window);
