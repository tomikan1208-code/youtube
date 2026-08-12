/* SVG チャート（外部ライブラリなし）
   - 目盛り・軸はヘアラインの実線、マークは細く
   - 積み上げ / 隣接するマークの間は 2px の「面の色」の隙間で分ける
   - すべてのチャートにホバー（＋キーボード操作）と表形式の代替表示を用意する
*/
(function (global) {
  'use strict';

  var Charts = {};
  var h = U.h, svg = U.svg;

  function color(name) { return U.cssVar(name); }

  /* ---------------- 共通の器 ---------------- */

  /**
   * @param {Object} o
   *  title, sub        見出し
   *  legend            [{name, color, type:'rect'|'line'}]
   *  draw(width, ctx)  SVG 要素を返す描画関数
   *  table             {head:[], rows:[[]]} 表形式の代替表示
   *  note              補足テキスト
   */
  Charts.figure = function (o) {
    var chart = h('div', { class: 'chart' });
    var tipEl = h('div', { class: 'tooltip', role: 'status' });
    var tableWrap = null;

    var card = h('div', { class: 'card' });
    var actions = h('div', { class: 'card__actions' });
    if (o.title || o.table) {
      var head = h('div', { class: 'card__head' },
        o.title ? h('h3', { class: 'card__title' }, o.title) : null);
      head.appendChild(actions);
      card.appendChild(head);
    }
    if (o.sub) card.appendChild(h('p', { class: 'card__sub' }, o.sub));

    if (o.legend && o.legend.length > 1) {
      card.appendChild(h('ul', { class: 'chart__legend' }, o.legend.map(function (l) {
        return h('li', { class: 'legend-item' },
          h('span', {
            class: 'legend-item__key' + (l.type === 'line' ? ' legend-item__key--line' : ''),
            style: { background: l.color }
          }),
          l.name);
      })));
    }

    card.appendChild(chart);
    chart.appendChild(tipEl);

    if (o.note) card.appendChild(h('p', { class: 'card__sub', style: { 'margin': '10px 0 0' } }, o.note));

    if (o.table) {
      tableWrap = h('div', { class: 'tableview', hidden: true },
        Charts.table(o.table.head, o.table.rows));
      var btn = h('button', {
        type: 'button', class: 'btn btn--ghost', 'aria-pressed': 'false',
        onclick: function () {
          var open = tableWrap.hasAttribute('hidden');
          if (open) tableWrap.removeAttribute('hidden'); else tableWrap.setAttribute('hidden', '');
          btn.setAttribute('aria-pressed', open ? 'true' : 'false');
        }
      }, '表で見る');
      actions.appendChild(btn);
      card.appendChild(tableWrap);
    }

    var ctx = {
      tip: {
        show: function (x, y, node) {
          U.clear(tipEl).appendChild(node);
          tipEl.dataset.show = '1';
          var w = tipEl.offsetWidth, cw = chart.clientWidth;
          var left = Math.max(0, Math.min(cw - w, x - w / 2));
          tipEl.style.left = left + 'px';
          tipEl.style.top = Math.max(0, y - tipEl.offsetHeight - 10) + 'px';
        },
        hide: function () { tipEl.dataset.show = '0'; }
      }
    };

    function render() {
      var width = chart.clientWidth || 640;
      U.$$('svg', chart).forEach(function (s) { s.remove(); });
      var el = o.draw(width, ctx);
      chart.insertBefore(el, tipEl);
    }

    // 幅とテーマの変化に追従する。画面から外れたチャートは購読を解除する。
    var ro = new ResizeObserver(U.debounce(function () {
      if (chart.isConnected) render(); else ro.disconnect();
    }, 120));
    requestAnimationFrame(function () { render(); ro.observe(chart); });

    function onTheme() {
      if (!chart.isConnected) {
        document.removeEventListener('themechange', onTheme);
        ro.disconnect();
        return;
      }
      render();
    }
    document.addEventListener('themechange', onTheme);

    return card;
  };

  Charts.table = function (head, rows) {
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', null, h('tr', null, head.map(function (c, i) {
          return h('th', { class: i === 0 ? '' : 'num' }, c);
        }))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, r.map(function (c, i) {
            return h('td', { class: i === 0 ? '' : 'num' }, c);
          }));
        }))));
  };

  function tipNode(title, rows) {
    return h('div', null,
      h('div', { class: 'tooltip__title' }, title),
      rows.map(function (r) {
        return h('div', { class: 'tooltip__row' },
          r.color ? h('span', { class: 'tooltip__key', style: { background: r.color } }) : null,
          h('span', { class: 'tooltip__val' }, r.value),
          h('span', { class: 'tooltip__name' }, r.name));
      }));
  }
  Charts.tipNode = tipNode;

  /* ---------------- 目盛りの計算 ---------------- */

  function niceTicks(max, count) {
    if (max <= 0) return [0, 1];
    var raw = max / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var ticks = [];
    for (var v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  // 目盛りラベルを間引くとき、年初など目印になる位置を必ず含める
  function anchorIndex(data) {
    for (var i = 0; i < data.length; i++) if (data[i].anchor) return i;
    return 0;
  }

  function labelAt(i, anchor, every) {
    return ((i - anchor) % every + every) % every === 0;
  }

  // 12.5px の文字を想定した概算幅。全角は約 12.5px、半角は約 6.8px。
  function textWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += /[ -ÿ｡-ﾟ]/.test(s.charAt(i)) ? 6.8 : 12.5;
    }
    return w;
  }

  function fitLabel(s, maxPx) {
    s = String(s === null || s === undefined ? '' : s);
    if (textWidth(s) <= maxPx) return s;
    var out = '';
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var cw = /[ -ÿ｡-ﾟ]/.test(s.charAt(i)) ? 6.8 : 12.5;
      if (w + cw > maxPx - 10) break;
      out += s.charAt(i);
      w += cw;
    }
    return out + '…';
  }

  function roundedTop(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    return 'M' + x + ',' + (y + hgt) +
           'L' + x + ',' + (y + r) +
           'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
           'L' + (x + w - r) + ',' + y +
           'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
           'L' + (x + w) + ',' + (y + hgt) + 'Z';
  }

  function roundedRight(x, y, w, hgt, r) {
    r = Math.min(r, w, hgt / 2);
    return 'M' + x + ',' + y +
           'L' + (x + w - r) + ',' + y +
           'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
           'L' + (x + w) + ',' + (y + hgt - r) +
           'Q' + (x + w) + ',' + (y + hgt) + ' ' + (x + w - r) + ',' + (y + hgt) +
           'L' + x + ',' + (y + hgt) + 'Z';
  }

  /* ---------------- 積み上げ縦棒 ---------------- */

  /**
   * o: { data:[{label, short, values:[]}], series:[{name,color}], height, valueFmt }
   */
  Charts.stackedColumns = function (o) {
    return function (width, ctx) {
      var H = o.height || 260;
      var padL = 46, padR = 14, padT = 16, padB = 30;
      var plotW = Math.max(40, width - padL - padR);
      var plotH = H - padT - padB;
      var n = o.data.length || 1;
      var band = plotW / n;
      var barW = Math.min(24, Math.max(3, band * 0.66));
      var GAP = 2; // 面の色の隙間

      var max = 0;
      o.data.forEach(function (d) {
        var s = d.values.reduce(function (a, b) { return a + b; }, 0);
        if (s > max) max = s;
      });
      var ticks = niceTicks(max, 4);
      var top = ticks[ticks.length - 1] || 1;
      var y = function (v) { return padT + plotH - (v / top) * plotH; };

      var root = svg('svg', {
        viewBox: '0 0 ' + width + ' ' + H,
        role: 'img',
        'aria-label': o.title || '積み上げ棒グラフ'
      });
      var surface = color('--surface-1');

      // 目盛り線
      ticks.forEach(function (t) {
        root.appendChild(svg('line', {
          x1: padL, x2: width - padR, y1: y(t), y2: y(t),
          stroke: t === 0 ? color('--axis') : color('--grid'), 'stroke-width': 1
        }));
        root.appendChild(svg('text', {
          x: padL - 8, y: y(t) + 4, 'text-anchor': 'end',
          fill: color('--text-muted'), 'font-size': 11,
          style: { 'font-variant-numeric': 'tabular-nums' }
        }, U.compact(t)));
      });

      // ラベルは重ならない本数だけ出す。anchor（年初など）が必ず含まれるようずらす。
      var labelEvery = Math.max(1, Math.ceil(42 / band));
      var anchor = anchorIndex(o.data);
      var maxIdx = 0;
      o.data.forEach(function (d, i) {
        var s = d.values.reduce(function (a, b) { return a + b; }, 0);
        var sm = o.data[maxIdx].values.reduce(function (a, b) { return a + b; }, 0);
        if (s > sm) maxIdx = i;
      });

      o.data.forEach(function (d, i) {
        var cx = padL + band * i + band / 2;
        var x0 = cx - barW / 2;
        var acc = 0;
        var total = d.values.reduce(function (a, b) { return a + b; }, 0);

        // 下から積む。最上段だけ角を丸める（データの先端）
        d.values.forEach(function (v, si) {
          if (v <= 0) return;
          var isTop = d.values.slice(si + 1).every(function (x) { return x <= 0; });
          var y1 = y(acc + v), y0 = y(acc);
          var hgt = Math.max(1, y0 - y1 - (acc > 0 ? GAP : 0));
          var yy = y1;
          root.appendChild(svg('path', {
            d: isTop ? roundedTop(x0, yy, barW, hgt, 4) : 'M' + x0 + ',' + yy + 'h' + barW + 'v' + hgt + 'h' + (-barW) + 'Z',
            fill: o.series[si].color
          }));
          acc += v;
        });

        // 直接ラベルは最大の月だけ（すべての点に数値を出さない）
        if (i === maxIdx && total > 0) {
          root.appendChild(svg('text', {
            x: cx, y: y(total) - 8, 'text-anchor': 'middle',
            fill: color('--text-secondary'), 'font-size': 11.5, 'font-weight': 600
          }, U.int(total)));
        }

        if (labelAt(i, anchor, labelEvery)) {
          root.appendChild(svg('text', {
            x: cx, y: H - 10, 'text-anchor': 'middle',
            fill: color('--text-muted'), 'font-size': 11
          }, d.short));
        }

        // 当たり判定は帯の全高（マークより広く取る）
        var hit = svg('rect', {
          x: padL + band * i, y: padT, width: Math.max(band, 1), height: plotH,
          fill: 'transparent', tabindex: 0, role: 'button',
          'aria-label': d.label + ' 合計 ' + total
        });
        var showTip = function () {
          var rows = o.series.map(function (s, si) {
            return { color: s.color, value: U.int(d.values[si]), name: s.name };
          });
          rows.push({ color: null, value: U.int(total), name: '合計' });
          ctx.tip.show(padL + band * i + band / 2, y(total), tipNode(d.label, rows));
          hover.setAttribute('opacity', 1);
          hover.setAttribute('x', padL + band * i);
        };
        hit.addEventListener('pointerenter', showTip);
        hit.addEventListener('focus', showTip);
        hit.addEventListener('pointerleave', function () { ctx.tip.hide(); hover.setAttribute('opacity', 0); });
        hit.addEventListener('blur', function () { ctx.tip.hide(); hover.setAttribute('opacity', 0); });
        root.appendChild(hit);
      });

      var hover = svg('rect', {
        x: 0, y: padT, width: band, height: plotH, opacity: 0,
        fill: color('--text-primary'), 'fill-opacity': 0.04, 'pointer-events': 'none'
      });
      root.appendChild(hover);
      // 隙間は面の色で（マークに枠線は引かない）
      root.style.setProperty('--surface', surface);
      return root;
    };
  };

  /* ---------------- 横棒（単一系列） ---------------- */

  /**
   * o: { data:[{label, sub, value}], color, valueFmt, rowH, onSelect }
   */
  Charts.barsH = function (o) {
    return function (width, ctx) {
      var rowH = o.rowH || 30;
      var padT = 6, padB = 6;
      var labelW = Math.min(230, Math.max(110, width * 0.34));
      var valueW = 56;
      var plotW = Math.max(30, width - labelW - valueW - 12);
      var H = padT + padB + rowH * o.data.length;
      var max = o.data.reduce(function (m, d) { return Math.max(m, d.value); }, 0) || 1;
      var barH = Math.min(14, rowH - 14);
      var fill = o.color || color('--series-1');

      var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + H, role: 'img', 'aria-label': o.title || '横棒グラフ' });

      o.data.forEach(function (d, i) {
        var yTop = padT + rowH * i;
        var cy = yTop + rowH / 2;
        var w = Math.max(2, (d.value / max) * plotW);

        // 全角と半角で 1 文字あたりの幅が違うので、見出しの実幅に合わせて丸める
        root.appendChild(svg('text', {
          x: 0, y: cy + 4, fill: color('--text-primary'), 'font-size': 12.5
        }, fitLabel(d.label, labelW - 8)));

        root.appendChild(svg('path', {
          d: roundedRight(labelW, cy - barH / 2, w, barH, 4), fill: fill
        }));

        // 値は必ず棒の外側（右の余白）に置く＝マークからはみ出して切れない
        root.appendChild(svg('text', {
          x: labelW + w + 8, y: cy + 4, fill: color('--text-secondary'),
          'font-size': 12, style: { 'font-variant-numeric': 'tabular-nums' }
        }, o.valueFmt ? o.valueFmt(d.value) : U.int(d.value)));

        var hit = svg('rect', {
          x: 0, y: yTop, width: width, height: rowH, fill: 'transparent',
          tabindex: 0, role: o.onSelect ? 'button' : 'img',
          style: o.onSelect ? { cursor: 'pointer' } : null,
          'aria-label': d.label + ' ' + d.value
        });
        var show = function () {
          var rows = [{ color: fill, value: o.valueFmt ? o.valueFmt(d.value) : U.int(d.value), name: o.valueName || '回' }];
          if (d.sub) rows.push({ color: null, value: d.sub, name: '' });
          ctx.tip.show(Math.min(width - 60, labelW + w), cy - 6, tipNode(d.label, rows));
        };
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', ctx.tip.hide);
        hit.addEventListener('blur', ctx.tip.hide);
        if (o.onSelect) {
          hit.addEventListener('click', function () { o.onSelect(d); });
          hit.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); o.onSelect(d); }
          });
        }
        root.appendChild(hit);
      });

      return root;
    };
  };

  /* ---------------- ヒートマップ（曜日 × 時間帯） ---------------- */

  var SEQ = ['--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600', '--seq-700'];

  Charts.heatmap = function (o) {
    return function (width, ctx) {
      var rows = o.rows, cols = 24;
      var labelW = 26, padT = 18, padB = 6, gap = 2;
      var cellW = Math.max(6, (width - labelW - 6) / cols);
      var cellH = Math.min(22, Math.max(12, cellW));
      var H = padT + padB + cellH * rows.length;
      var max = 0;
      o.values.forEach(function (r) { r.forEach(function (v) { if (v > max) max = v; }); });

      var steps = SEQ.map(color);
      var zero = color('--seq-0');
      var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + H, role: 'img', 'aria-label': o.title || 'ヒートマップ' });

      // 時刻の目盛り（3 時間おき）
      for (var c = 0; c < cols; c += 3) {
        root.appendChild(svg('text', {
          x: labelW + cellW * c + cellW / 2, y: 11, 'text-anchor': 'middle',
          fill: color('--text-muted'), 'font-size': 10
        }, c));
      }

      rows.forEach(function (rowName, r) {
        root.appendChild(svg('text', {
          x: labelW - 8, y: padT + cellH * r + cellH / 2 + 4, 'text-anchor': 'end',
          fill: color('--text-muted'), 'font-size': 11
        }, rowName));

        for (var c2 = 0; c2 < cols; c2++) {
          var v = o.values[r][c2];
          var idx = v === 0 ? -1 : Math.min(steps.length - 1, Math.floor((v / max) * steps.length * 0.999));
          var x = labelW + cellW * c2, yy = padT + cellH * r;
          root.appendChild(svg('rect', {
            x: x, y: yy,
            width: Math.max(1, cellW - gap), height: Math.max(1, cellH - gap),
            rx: 2, fill: idx < 0 ? zero : steps[idx]
          }));

          (function (val, rr, cc, px, py) {
            var hit = svg('rect', {
              x: px, y: py, width: cellW, height: cellH, fill: 'transparent',
              tabindex: val ? 0 : null, role: 'img',
              'aria-label': rows[rr] + '曜日 ' + cc + '時台 ' + val + '回'
            });
            var show = function () {
              ctx.tip.show(px + cellW / 2, py, tipNode(rows[rr] + '曜日 ' + cc + ':00〜', [
                { color: steps[steps.length - 2], value: U.int(val), name: '回' }
              ]));
            };
            hit.addEventListener('pointerenter', show);
            hit.addEventListener('focus', show);
            hit.addEventListener('pointerleave', ctx.tip.hide);
            hit.addEventListener('blur', ctx.tip.hide);
            root.appendChild(hit);
          })(v, r, c2, x, yy);
        }
      });

      return root;
    };
  };

  Charts.scaleLegend = function (max) {
    return h('div', { class: 'scale-legend' },
      h('span', null, '少'),
      h('div', { class: 'scale-legend__ramp' },
        [U.cssVar('--seq-0')].concat(SEQ.map(function (s) { return U.cssVar(s); })).map(function (c) {
          return h('span', { style: { background: c } });
        })),
      h('span', null, '多（最大 ' + U.int(max) + ' 回）'));
  };

  /* ---------------- 折れ線（累計） ---------------- */

  /**
   * o: { data:[{label, short, values:[]}], series:[{name,color}], height }
   */
  Charts.lines = function (o) {
    return function (width, ctx) {
      var H = o.height || 240;
      var padL = 46, padR = 62, padT = 16, padB = 30;
      var plotW = Math.max(40, width - padL - padR);
      var plotH = H - padT - padB;
      var n = o.data.length;
      var max = 0;
      o.data.forEach(function (d) { d.values.forEach(function (v) { if (v > max) max = v; }); });
      var ticks = niceTicks(max, 4);
      var top = ticks[ticks.length - 1] || 1;
      var X = function (i) { return padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW); };
      var Y = function (v) { return padT + plotH - (v / top) * plotH; };

      var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + H, role: 'img', 'aria-label': o.title || '折れ線グラフ' });

      ticks.forEach(function (t) {
        root.appendChild(svg('line', {
          x1: padL, x2: width - padR, y1: Y(t), y2: Y(t),
          stroke: t === 0 ? color('--axis') : color('--grid'), 'stroke-width': 1
        }));
        root.appendChild(svg('text', {
          x: padL - 8, y: Y(t) + 4, 'text-anchor': 'end', fill: color('--text-muted'), 'font-size': 11
        }, U.compact(t)));
      });

      var labelEvery = Math.max(1, Math.ceil(46 / (plotW / Math.max(1, n - 1))));
      var anchor = anchorIndex(o.data);
      o.data.forEach(function (d, i) {
        if (labelAt(i, anchor, labelEvery)) {
          root.appendChild(svg('text', {
            x: X(i), y: H - 10, 'text-anchor': 'middle', fill: color('--text-muted'), 'font-size': 11
          }, d.short));
        }
      });

      var crosshair = svg('line', {
        y1: padT, y2: padT + plotH, stroke: color('--axis'), 'stroke-width': 1, opacity: 0, 'pointer-events': 'none'
      });
      root.appendChild(crosshair);

      o.series.forEach(function (s, si) {
        var dAttr = o.data.map(function (d, i) {
          return (i ? 'L' : 'M') + X(i) + ',' + Y(d.values[si]);
        }).join('');
        root.appendChild(svg('path', {
          d: dAttr, fill: 'none', stroke: s.color, 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));

        if (n) {
          var last = o.data[n - 1];
          // 端の点は面の色のリングを付けて重なりに強くする
          root.appendChild(svg('circle', {
            cx: X(n - 1), cy: Y(last.values[si]), r: 4.5, fill: s.color,
            stroke: color('--surface-1'), 'stroke-width': 2
          }));
          root.appendChild(svg('text', {
            x: X(n - 1) + 9, y: Y(last.values[si]) + 4, fill: color('--text-secondary'), 'font-size': 11.5, 'font-weight': 600
          }, U.compact(last.values[si])));
        }
      });

      var dots = o.series.map(function (s) {
        return root.appendChild(svg('circle', {
          r: 4.5, fill: s.color, stroke: color('--surface-1'), 'stroke-width': 2, opacity: 0, 'pointer-events': 'none'
        }));
      });

      function focusIndex(i) {
        var d = o.data[i];
        crosshair.setAttribute('opacity', 1);
        crosshair.setAttribute('x1', X(i));
        crosshair.setAttribute('x2', X(i));
        dots.forEach(function (dot, si) {
          dot.setAttribute('opacity', 1);
          dot.setAttribute('cx', X(i));
          dot.setAttribute('cy', Y(d.values[si]));
        });
        ctx.tip.show(X(i), Y(Math.max.apply(null, d.values)), tipNode(d.label, o.series.map(function (s, si) {
          return { color: s.color, value: U.int(d.values[si]), name: s.name };
        })));
      }
      function clearFocus() {
        crosshair.setAttribute('opacity', 0);
        dots.forEach(function (dot) { dot.setAttribute('opacity', 0); });
        ctx.tip.hide();
      }

      var overlay = svg('rect', {
        x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent', tabindex: 0
      });
      overlay.addEventListener('pointermove', function (ev) {
        var box = root.getBoundingClientRect();
        var rel = (ev.clientX - box.left) / box.width * width;
        var i = n <= 1 ? 0 : Math.round(((rel - padL) / plotW) * (n - 1));
        focusIndex(Math.max(0, Math.min(n - 1, i)));
      });
      overlay.addEventListener('pointerleave', clearFocus);
      overlay.addEventListener('blur', clearFocus);
      var kbIdx = n - 1;
      overlay.addEventListener('focus', function () { focusIndex(kbIdx); });
      overlay.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowLeft') { kbIdx = Math.max(0, kbIdx - 1); focusIndex(kbIdx); ev.preventDefault(); }
        if (ev.key === 'ArrowRight') { kbIdx = Math.min(n - 1, kbIdx + 1); focusIndex(kbIdx); ev.preventDefault(); }
      });
      root.appendChild(overlay);

      return root;
    };
  };

  /* ---------------- 小さな棒（詳細パネル用） ---------------- */

  Charts.sparkColumns = function (o) {
    return function (width, ctx) {
      var H = o.height || 90;
      var padB = 18, padT = 6;
      var n = o.data.length || 1;
      var band = width / n;
      var barW = Math.min(18, Math.max(2, band * 0.62));
      var max = o.data.reduce(function (m, d) { return Math.max(m, d.value); }, 0) || 1;
      var fill = o.color || color('--series-1');
      var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + H, role: 'img', 'aria-label': o.title || '推移' });

      root.appendChild(svg('line', {
        x1: 0, x2: width, y1: H - padB, y2: H - padB, stroke: color('--axis'), 'stroke-width': 1
      }));

      var labelEvery = Math.max(1, Math.ceil(40 / band));
      var anchor = anchorIndex(o.data);
      o.data.forEach(function (d, i) {
        var hgt = d.value === 0 ? 0 : Math.max(2, (d.value / max) * (H - padB - padT));
        var x = band * i + (band - barW) / 2;
        if (hgt > 0) {
          root.appendChild(svg('path', { d: roundedTop(x, H - padB - hgt, barW, hgt, 3), fill: fill }));
        }
        if (labelAt(i, anchor, labelEvery)) {
          root.appendChild(svg('text', {
            x: band * i + band / 2, y: H - 5, 'text-anchor': 'middle', fill: color('--text-muted'), 'font-size': 10
          }, d.short));
        }
        var hit = svg('rect', { x: band * i, y: 0, width: band, height: H - padB, fill: 'transparent', tabindex: 0 });
        var show = function () {
          ctx.tip.show(band * i + band / 2, H - padB - hgt, tipNode(d.label, [{ color: fill, value: U.int(d.value), name: '回' }]));
        };
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', ctx.tip.hide);
        hit.addEventListener('blur', ctx.tip.hide);
        root.appendChild(hit);
      });
      return root;
    };
  };

  global.Charts = Charts;
})(window);
