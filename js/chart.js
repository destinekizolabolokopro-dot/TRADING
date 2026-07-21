/*
 * TRADEassist — Graphique chandeliers (Canvas)
 * ============================================
 * Moteur de rendu maison, sans dépendance externe (fonctionne hors-ligne).
 * Dessine les bougies + superpositions ICT/SMC :
 *   EMA, niveaux Fibonacci + zone OTE, boxes FVG / Order Block,
 *   lignes Entrée / Stop / TP, swings, liquidité (equal highs/lows),
 *   croix de visée avec lecture OHLC.
 *
 * Utilisation : TAChart.render(canvasEl, analysis, { precision, live })
 *   analysis = objet result.chart renvoyé par ICT.analyze
 */
(function (root) {
  'use strict';

  var COL = {
    up: '#26a69a', down: '#ef5350',
    upWick: '#26a69a', downWick: '#ef5350',
    grid: 'rgba(255,255,255,0.05)', axis: '#5b6779', text: '#8a97ac',
    emaFast: '#6aa8ff', emaSlow: '#e8c37a',
    fibLine: 'rgba(232,195,122,0.28)', eqLine: 'rgba(138,151,172,0.5)',
    ote: 'rgba(74,222,128,0.08)', oteShort: 'rgba(248,113,113,0.08)',
    fvgBull: 'rgba(38,166,154,0.12)', fvgBear: 'rgba(239,83,80,0.12)',
    obBull: 'rgba(106,168,255,0.14)', obBear: 'rgba(232,195,122,0.14)',
    entry: '#e6ecf5', sl: '#f87171', tp: '#4ade80',
    liq: 'rgba(232,195,122,0.55)', crosshair: 'rgba(255,255,255,0.25)',
    pdLevel: 'rgba(179,136,255,0.7)',
    bg: 'transparent'
  };
  var PAD = { right: 84, bottom: 22, top: 10, left: 6 };

  function fmt(v, p) { return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: p, maximumFractionDigits: p }); }

  function setup(canvas) {
    var dpr = root.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(320, rect.width || canvas.clientWidth || 640);
    var h = Math.max(220, rect.height || canvas.clientHeight || 340);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function computeLayout(a, w, h, p) {
    var from = a.view.from, to = a.view.to;
    var candles = a.candles.slice(from, to + 1);
    var n = candles.length;
    var plotW = w - p.left - p.right;
    var plotH = h - p.top - p.bottom;

    var lo = Infinity, hi = -Infinity;
    candles.forEach(function (c) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; });
    // inclure les niveaux de trade importants dans l'échelle
    var extra = [];
    if (a.trade) { extra.push(a.trade.entry, a.trade.sl, a.trade.tp1, a.trade.tp2); }
    if (a.range) { extra.push(a.range.low, a.range.high); }
    extra.forEach(function (v) { if (v != null && !isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    var span = (hi - lo) || (hi * 0.01) || 1;
    lo -= span * 0.06; hi += span * 0.06;

    var barW = plotW / n;
    var candleW = Math.max(1, Math.min(14, barW * 0.62));

    function x(iAbs) { return p.left + (iAbs - from + 0.5) * barW; }
    function y(price) { return p.top + (hi - price) / (hi - lo) * plotH; }

    return { candles: candles, from: from, to: to, n: n, lo: lo, hi: hi, barW: barW, candleW: candleW, x: x, y: y, plotW: plotW, plotH: plotH, p: p, w: w, h: h };
  }

  function drawGridAxis(ctx, L, precision) {
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    var ticks = 5;
    for (var t = 0; t <= ticks; t++) {
      var price = L.lo + (L.hi - L.lo) * (t / ticks);
      var yy = L.y(price);
      ctx.strokeStyle = COL.grid;
      ctx.beginPath(); ctx.moveTo(L.p.left, yy); ctx.lineTo(L.w - L.p.right, yy); ctx.stroke();
      ctx.fillStyle = COL.text; ctx.textAlign = 'left';
      ctx.fillText(fmt(price, precision), L.w - L.p.right + 6, yy);
    }
  }

  function priceTag(ctx, L, price, color, label, precision, align) {
    var yy = L.y(price);
    if (yy < L.p.top - 2 || yy > L.h - L.p.bottom + 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(L.p.left, yy); ctx.lineTo(L.w - L.p.right, yy); ctx.stroke();
    ctx.setLineDash([]);
    // étiquette prix à droite
    var txt = fmt(price, precision);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    var tw = ctx.measureText(txt).width + 8;
    ctx.fillStyle = color;
    ctx.fillRect(L.w - L.p.right, yy - 7, tw, 14);
    ctx.fillStyle = '#08120b'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, L.w - L.p.right + 4, yy);
    // libellé à gauche
    if (label) {
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.fillStyle = color; ctx.textAlign = 'left';
      ctx.fillText(label, L.p.left + 4, yy - 8);
    }
  }

  function drawZoneBox(ctx, L, top, bottom, fill, iStart) {
    var yT = L.y(top), yB = L.y(bottom);
    var x0 = iStart != null ? Math.max(L.p.left, L.x(iStart)) : L.p.left;
    ctx.fillStyle = fill;
    ctx.fillRect(x0, Math.min(yT, yB), (L.w - L.p.right) - x0, Math.abs(yB - yT));
  }

  function drawEMA(ctx, L, arr, from, to, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath();
    var started = false;
    for (var i = from; i <= to; i++) {
      if (arr[i] == null) continue;
      var xx = L.x(i), yy = L.y(arr[i]);
      if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }

  function drawCandles(ctx, L) {
    for (var i = L.from; i <= L.to; i++) {
      var c = L.candles[i - L.from];
      var up = c.close >= c.open;
      var xx = L.x(i);
      ctx.strokeStyle = up ? COL.upWick : COL.downWick;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xx, L.y(c.high)); ctx.lineTo(xx, L.y(c.low)); ctx.stroke();
      var yO = L.y(c.open), yC = L.y(c.close);
      var top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yC - yO));
      ctx.fillStyle = up ? COL.up : COL.down;
      ctx.fillRect(xx - L.candleW / 2, top, L.candleW, hgt);
    }
  }

  function drawSwings(ctx, L, swings) {
    ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
    function mark(pt, isHigh) {
      if (pt.index < L.from || pt.index > L.to) return;
      var xx = L.x(pt.index), yy = L.y(pt.price);
      ctx.fillStyle = COL.text;
      ctx.beginPath(); ctx.arc(xx, yy + (isHigh ? -6 : 6), 1.6, 0, Math.PI * 2); ctx.fill();
    }
    (swings.highs || []).slice(-6).forEach(function (p) { mark(p, true); });
    (swings.lows || []).slice(-6).forEach(function (p) { mark(p, false); });
  }

  function baseDraw(canvas, a, opts) {
    var s = setup(canvas);
    var ctx = s.ctx;
    var precision = (opts && opts.precision) || 2;
    ctx.clearRect(0, 0, s.w, s.h);
    var L = computeLayout(a, s.w, s.h, PAD);
    canvas._taLayout = L;

    drawGridAxis(ctx, L, precision);

    // zone OTE
    if (a.ote) drawZoneBox(ctx, L, a.ote.top, a.ote.bottom, (a.trade && a.trade.direction === 'SHORT') ? COL.oteShort : COL.ote, a.range ? Math.min(a.range.highIndex, a.range.lowIndex) : null);

    // FVG (les plus récents, dans la vue)
    (a.fvgs || []).slice(-8).forEach(function (g) {
      if (g.index < L.from - 2) return;
      drawZoneBox(ctx, L, g.top, g.bottom, g.type === 'bullish' ? COL.fvgBull : COL.fvgBear, g.index);
    });
    // Order Blocks
    (a.obs || []).slice(-4).forEach(function (o) {
      if (o.index < L.from - 2) return;
      drawZoneBox(ctx, L, o.top, o.bottom, o.type === 'bullish' ? COL.obBull : COL.obBear, o.index);
    });

    // Fibonacci
    (a.fib || []).forEach(function (f) {
      var yy = L.y(f.price);
      if (yy < L.p.top || yy > L.h - L.p.bottom) return;
      ctx.strokeStyle = f.f === 0.5 ? COL.eqLine : COL.fibLine;
      ctx.lineWidth = 1; ctx.setLineDash(f.f === 0.5 ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(L.p.left, yy); ctx.lineTo(L.w - L.p.right, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.text; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'right';
      ctx.fillText(f.label, L.w - L.p.right - 4, yy - 5);
    });

    // EMA
    if (a.emaFast) drawEMA(ctx, L, a.emaFast, L.from, L.to, COL.emaFast);
    if (a.emaSlow) drawEMA(ctx, L, a.emaSlow, L.from, L.to, COL.emaSlow);

    drawCandles(ctx, L);
    if (a.swings) drawSwings(ctx, L, a.swings);

    // liquidité
    (a.liquidity || []).forEach(function (lq) {
      var yy = L.y(lq.price);
      if (yy < L.p.top || yy > L.h - L.p.bottom) return;
      ctx.strokeStyle = COL.liq; ctx.lineWidth = 1; ctx.setLineDash([1, 4]);
      ctx.beginPath(); ctx.moveTo(L.p.left, yy); ctx.lineTo(L.w - L.p.right, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.liq; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left';
      ctx.fillText(lq.type === 'buyside' ? 'BSL' : 'SSL', L.p.left + 4, yy - 5);
    });

    // plus-haut / plus-bas de la veille (stratégie Previous Daily)
    [['pdh', a.pdh, 'PDH'], ['pdl', a.pdl, 'PDL']].forEach(function (d) {
      var price = d[1]; if (price == null) return;
      var yy = L.y(price); if (yy < L.p.top || yy > L.h - L.p.bottom) return;
      ctx.strokeStyle = COL.pdLevel; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(L.p.left, yy); ctx.lineTo(L.w - L.p.right, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.pdLevel; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left';
      ctx.fillText(d[2], L.p.left + 4, yy - 5);
    });

    // niveaux de trade
    if (a.trade) {
      priceTag(ctx, L, a.trade.entry, COL.entry, 'Entrée', precision);
      priceTag(ctx, L, a.trade.sl, COL.sl, 'SL', precision);
      priceTag(ctx, L, a.trade.tp1, COL.tp, 'TP1', precision);
      priceTag(ctx, L, a.trade.tp2, COL.tp, 'TP2', precision);
    }

    return L;
  }

  function drawCrosshair(canvas, a, opts, mx, my) {
    var L = baseDraw(canvas, a, opts);
    var ctx = canvas.getContext('2d');
    var precision = (opts && opts.precision) || 2;
    if (mx == null) return;
    if (mx < L.p.left || mx > L.w - L.p.right || my < L.p.top || my > L.h - L.p.bottom) return;
    // index de bougie sous le curseur
    var idx = Math.round((mx - L.p.left) / L.barW - 0.5) + L.from;
    idx = Math.max(L.from, Math.min(L.to, idx));
    var cx = L.x(idx);
    ctx.strokeStyle = COL.crosshair; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, L.p.top); ctx.lineTo(cx, L.h - L.p.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L.p.left, my); ctx.lineTo(L.w - L.p.right, my); ctx.stroke();
    ctx.setLineDash([]);
    // prix au curseur
    var price = L.lo + (L.hi - L.lo) * (1 - (my - L.p.top) / L.plotH);
    ctx.fillStyle = '#2a3446'; ctx.fillRect(L.w - L.p.right, my - 7, L.p.right, 14);
    ctx.fillStyle = '#e6ecf5'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(price, precision), L.w - L.p.right + 4, my);
    // OHLC
    var c = L.candles[idx - L.from];
    if (c) {
      var up = c.close >= c.open;
      var s = 'O ' + fmt(c.open, precision) + '  H ' + fmt(c.high, precision) + '  B ' + fmt(c.low, precision) + '  C ' + fmt(c.close, precision);
      ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(10,14,20,0.85)';
      var tw = ctx.measureText(s).width + 12;
      ctx.fillRect(L.p.left + 2, L.p.top + 2, tw, 16);
      ctx.fillStyle = up ? COL.up : COL.down;
      ctx.fillText(s, L.p.left + 8, L.p.top + 5);
    }
  }

  function render(canvas, a, opts) {
    if (!canvas || !a || !a.candles || !a.candles.length) return;
    canvas._ta = { a: a, opts: opts || {} };
    baseDraw(canvas, a, opts || {});
    if (!canvas._taBound) {
      canvas._taBound = true;
      canvas.addEventListener('mousemove', function (e) {
        var r = canvas.getBoundingClientRect();
        if (canvas._ta) drawCrosshair(canvas, canvas._ta.a, canvas._ta.opts, e.clientX - r.left, e.clientY - r.top);
      });
      canvas.addEventListener('mouseleave', function () {
        if (canvas._ta) baseDraw(canvas, canvas._ta.a, canvas._ta.opts);
      });
    }
  }

  var api = { render: render, COL: COL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TAChart = api;
})(typeof window !== 'undefined' ? window : this);
