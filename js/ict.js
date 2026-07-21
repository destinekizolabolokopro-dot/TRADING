/*
 * TRADEassist — Moteur d'analyse ICT / SMC
 * ========================================
 * Détecte des setups fondés sur les concepts ICT/SMC et produit en plus des
 * métadonnées destinées au graphique (chandeliers façon TradingView) :
 *   - Dealing range + Fibonacci (equilibrium 0.5 → discount / premium, zone OTE)
 *   - PD Arrays : Fair Value Gaps + Order Blocks
 *   - CRT (Candle Range Theory) : sweep de liquidité + retour dans le range
 *   - Clôture au-dessus / en-dessous d'un PD Array (reclaim)
 *   - Filtres de contexte : tendance (EMA), structure de marché (BOS/CHoCH),
 *     liquidité (equal highs / equal lows)
 *
 * Bougie : { time, open, high, low, close, volume }
 * Compatible navigateur (window.ICT) et Node (module.exports).
 */
(function (root) {
  'use strict';

  var CONFIG = {
    swingLookback: 2,
    oteLow: 0.62,
    oteHigh: 0.79,
    equilibrium: 0.5,
    fvgLookback: 60,
    obLookback: 60,
    slBufferPct: 0.0015,
    minRR: 1.2,
    emaFast: 20,
    emaSlow: 50,
    eqTolerance: 0.0012, // 0.12 % pour considérer deux extrêmes « égaux »
    viewBars: 90         // fenêtre conseillée pour le graphique
  };

  // --- Utilitaires ------------------------------------------------------------
  function round(v, d) {
    if (v == null || isNaN(v)) return v;
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * p) / p;
  }
  function precisionFor(price) {
    var p = Math.abs(price);
    if (p >= 1000) return 2;
    if (p >= 100) return 3;
    if (p >= 1) return 4;
    if (p >= 0.01) return 5;
    return 7;
  }
  function ema(values, period) {
    var out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    var k = 2 / (period + 1);
    var sum = 0;
    for (var i = 0; i < period; i++) sum += values[i];
    var prev = sum / period;
    out[period - 1] = prev;
    for (var j = period; j < values.length; j++) {
      prev = values[j] * k + prev * (1 - k);
      out[j] = prev;
    }
    return out;
  }

  // --- Swings (fractales) -----------------------------------------------------
  function findSwings(candles, lb) {
    var highs = [], lows = [];
    for (var i = lb; i < candles.length - lb; i++) {
      var isHigh = true, isLow = true;
      for (var j = 1; j <= lb; j++) {
        if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
        if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
      }
      if (isHigh) highs.push({ index: i, price: candles[i].high });
      if (isLow) lows.push({ index: i, price: candles[i].low });
    }
    return { highs: highs, lows: lows };
  }

  function dealingRange(candles, swings) {
    if (!swings.highs.length || !swings.lows.length) return null;
    var lastHigh = swings.highs[swings.highs.length - 1];
    var lastLow = swings.lows[swings.lows.length - 1];
    if (lastHigh.price <= lastLow.price) return null;
    return {
      high: lastHigh.price, low: lastLow.price,
      highIndex: lastHigh.index, lowIndex: lastLow.index,
      size: lastHigh.price - lastLow.price,
      bullishLeg: lastLow.index < lastHigh.index
    };
  }

  function fibPosition(range, price) {
    if (!range || range.size <= 0) return null;
    return (price - range.low) / range.size;
  }
  function zoneOf(pos) {
    if (pos == null) return 'inconnu';
    if (pos < CONFIG.equilibrium) return 'discount';
    if (pos > CONFIG.equilibrium) return 'premium';
    return 'equilibrium';
  }

  // --- Fair Value Gaps --------------------------------------------------------
  function findFVGs(candles) {
    var out = [];
    var start = Math.max(1, candles.length - CONFIG.fvgLookback);
    for (var i = start; i < candles.length - 1; i++) {
      var prev = candles[i - 1], next = candles[i + 1];
      if (prev.high < next.low) out.push({ type: 'bullish', top: next.low, bottom: prev.high, index: i, mid: (next.low + prev.high) / 2 });
      else if (prev.low > next.high) out.push({ type: 'bearish', top: prev.low, bottom: next.high, index: i, mid: (prev.low + next.high) / 2 });
    }
    return out;
  }
  function latestUnfilledFVG(candles, fvgs, type) {
    var last = candles[candles.length - 1];
    for (var i = fvgs.length - 1; i >= 0; i--) {
      var g = fvgs[i];
      if (g.type !== type) continue;
      if (type === 'bullish' && last.close > g.bottom) return g;
      if (type === 'bearish' && last.close < g.top) return g;
      return g;
    }
    return null;
  }

  // --- Order Blocks -----------------------------------------------------------
  // Bullish OB : dernière bougie baissière avant une impulsion haussière qui
  // dépasse le haut de cette bougie. Bearish OB : symétrique.
  function findOrderBlocks(candles) {
    var out = [];
    var start = Math.max(1, candles.length - CONFIG.obLookback);
    for (var i = start; i < candles.length - 2; i++) {
      var c = candles[i];
      var down = c.close < c.open, up = c.close > c.open;
      if (down && candles[i + 1].close > c.high && candles[i + 2].close >= candles[i + 1].close) {
        out.push({ type: 'bullish', top: Math.max(c.open, c.close), bottom: c.low, index: i });
      } else if (up && candles[i + 1].close < c.low && candles[i + 2].close <= candles[i + 1].close) {
        out.push({ type: 'bearish', top: c.high, bottom: Math.min(c.open, c.close), index: i });
      }
    }
    return out;
  }
  function latestOB(obs, type) {
    for (var i = obs.length - 1; i >= 0; i--) if (obs[i].type === type) return obs[i];
    return null;
  }

  // --- Liquidité : equal highs / equal lows ----------------------------------
  function findLiquidity(swings) {
    var res = [];
    function cluster(arr, kind) {
      for (var i = arr.length - 1; i >= 1; i--) {
        for (var j = i - 1; j >= 0; j--) {
          var a = arr[i].price, b = arr[j].price;
          if (Math.abs(a - b) / ((a + b) / 2) <= CONFIG.eqTolerance) {
            res.push({ type: kind, price: (a + b) / 2, indexes: [arr[j].index, arr[i].index] });
            return; // un seul cluster le plus récent par côté
          }
        }
      }
    }
    cluster(swings.highs, 'buyside');
    cluster(swings.lows, 'sellside');
    return res;
  }

  // --- Structure de marché (BOS / CHoCH) -------------------------------------
  function marketStructure(candles, swings) {
    var last = candles[candles.length - 1];
    var h = swings.highs, l = swings.lows;
    if (!h.length || !l.length) return { label: 'indéterminée', bias: 'neutre' };
    var lastH = h[h.length - 1], lastL = l[l.length - 1];
    // Tendance selon la séquence des deux derniers swings de chaque type.
    var upTrend = h.length >= 2 && h[h.length - 1].price > h[h.length - 2].price &&
                  l.length >= 2 && l[l.length - 1].price > l[l.length - 2].price;
    var downTrend = h.length >= 2 && h[h.length - 1].price < h[h.length - 2].price &&
                    l.length >= 2 && l[l.length - 1].price < l[l.length - 2].price;
    var label = 'range', bias = 'neutre';
    if (last.close > lastH.price) { label = 'BOS haussier'; bias = 'haussier'; }
    else if (last.close < lastL.price) { label = 'BOS baissier'; bias = 'baissier'; }
    else if (upTrend) { label = 'structure haussière'; bias = 'haussier'; }
    else if (downTrend) { label = 'structure baissière'; bias = 'baissier'; }
    return { label: label, bias: bias };
  }

  // --- CRT --------------------------------------------------------------------
  function detectCRT(candles) {
    if (candles.length < 3) return null;
    var last = candles[candles.length - 1];
    var rangeCandle = candles[candles.length - 2];
    var sweptLow = last.low < rangeCandle.low && last.close > rangeCandle.low;
    var sweptHigh = last.high > rangeCandle.high && last.close < rangeCandle.high;
    if (sweptLow && last.close > last.open) return { type: 'bullish', sweepLevel: rangeCandle.low };
    if (sweptHigh && last.close < last.open) return { type: 'bearish', sweepLevel: rangeCandle.high };
    return null;
  }

  function closeReclaim(candles, pd) {
    if (!pd) return false;
    var last = candles[candles.length - 1];
    if (pd.type === 'bullish') return last.close > pd.top;
    if (pd.type === 'bearish') return last.close < pd.bottom;
    return false;
  }

  // --- Trade ------------------------------------------------------------------
  function buildLong(candles, range, pd, crt) {
    var last = candles[candles.length - 1];
    var entry = last.close;
    var slBase = range.low;
    if (crt && crt.type === 'bullish') slBase = Math.min(slBase, last.low);
    if (pd && pd.type === 'bullish') slBase = Math.min(slBase, pd.bottom);
    var sl = slBase * (1 - CONFIG.slBufferPct);
    var eq = range.low + range.size * CONFIG.equilibrium;
    var trade = { direction: 'LONG', entry: entry, sl: sl, tp1: eq, tp2: range.high, tp3: range.high + range.size * 0.5 };
    var risk = entry - sl;
    trade.rr = risk > 0 ? (trade.tp2 - entry) / risk : 0;
    return trade;
  }
  function buildShort(candles, range, pd, crt) {
    var last = candles[candles.length - 1];
    var entry = last.close;
    var slBase = range.high;
    if (crt && crt.type === 'bearish') slBase = Math.max(slBase, last.high);
    if (pd && pd.type === 'bearish') slBase = Math.max(slBase, pd.top);
    var sl = slBase * (1 + CONFIG.slBufferPct);
    var eq = range.low + range.size * CONFIG.equilibrium;
    var trade = { direction: 'SHORT', entry: entry, sl: sl, tp1: eq, tp2: range.low, tp3: range.low - range.size * 0.5 };
    var risk = sl - entry;
    trade.rr = risk > 0 ? (entry - trade.tp2) / risk : 0;
    return trade;
  }

  function fibLevels(range) {
    var lv = [0, CONFIG.oteLow === 0.62 ? 0.62 : 0.62, 0.705, 0.79, 0.5, 1];
    var set = [0, 0.5, 0.62, 0.705, 0.79, 1];
    return set.map(function (f) {
      return { f: f, price: range.low + range.size * f, label: f === 0.5 ? 'EQ' : (f === 0 ? 'Low' : (f === 1 ? 'High' : f.toFixed(3))) };
    });
  }

  // --- Analyse complète -------------------------------------------------------
  function analyze(symbol, timeframe, candles) {
    var base = { symbol: symbol, timeframe: timeframe, hasSignal: false };
    if (!candles || candles.length < 25) return Object.assign(base, { reason: 'Données insuffisantes' });

    var swings = findSwings(candles, CONFIG.swingLookback);
    var range = dealingRange(candles, swings);
    if (!range) return Object.assign(base, { reason: 'Aucun dealing range clair' });

    var last = candles[candles.length - 1];
    var pos = fibPosition(range, last.close);
    var zone = zoneOf(pos);
    var fvgs = findFVGs(candles);
    var obs = findOrderBlocks(candles);
    var crt = detectCRT(candles);
    var liquidity = findLiquidity(swings);
    var structure = marketStructure(candles, swings);

    var closes = candles.map(function (c) { return c.close; });
    var emaF = ema(closes, CONFIG.emaFast);
    var emaS = ema(closes, CONFIG.emaSlow);
    var i = candles.length - 1;
    var trend = 'neutre';
    if (emaF[i] != null && emaS[i] != null) trend = emaF[i] > emaS[i] ? 'haussière' : 'baissière';

    var confluences = [];
    var direction = null, pd = null;

    if (zone === 'discount') {
      var fvgB = latestUnfilledFVG(candles, fvgs, 'bullish');
      var obB = latestOB(obs, 'bullish');
      pd = fvgB || obB;
      var pdInDiscount = pd && fibPosition(range, (pd.top + pd.bottom) / 2) < CONFIG.equilibrium;
      var reclaim = closeReclaim(candles, pd);
      var crtBull = crt && crt.type === 'bullish';
      var inOTE = pos >= (1 - CONFIG.oteHigh) && pos <= (1 - CONFIG.oteLow);

      if (pdInDiscount) confluences.push('PD Array (' + (pd === fvgB ? 'FVG' : 'Order Block') + ') en discount');
      if (inOTE) confluences.push('Prix dans la zone OTE (0.62–0.79)');
      if (crtBull) confluences.push('CRT haussier (sweep + retour)');
      if (reclaim) confluences.push('Clôture au-dessus du PD Array');
      if (trend === 'haussière') confluences.push('Tendance haussière (EMA ' + CONFIG.emaFast + '/' + CONFIG.emaSlow + ')');
      if (structure.bias === 'haussier') confluences.push('Structure : ' + structure.label);
      confluences.push('Prix en discount (sous l’equilibrium)');

      if (pdInDiscount && (crtBull || reclaim)) direction = 'LONG';
    } else if (zone === 'premium') {
      var fvgS = latestUnfilledFVG(candles, fvgs, 'bearish');
      var obS = latestOB(obs, 'bearish');
      pd = fvgS || obS;
      var pdInPremium = pd && fibPosition(range, (pd.top + pd.bottom) / 2) > CONFIG.equilibrium;
      var reclaimS = closeReclaim(candles, pd);
      var crtBear = crt && crt.type === 'bearish';
      var inOTEs = pos >= CONFIG.oteLow && pos <= CONFIG.oteHigh;

      if (pdInPremium) confluences.push('PD Array (' + (pd === fvgS ? 'FVG' : 'Order Block') + ') en premium');
      if (inOTEs) confluences.push('Prix dans la zone OTE (0.62–0.79)');
      if (crtBear) confluences.push('CRT baissier (sweep + retour)');
      if (reclaimS) confluences.push('Clôture en-dessous du PD Array');
      if (trend === 'baissière') confluences.push('Tendance baissière (EMA ' + CONFIG.emaFast + '/' + CONFIG.emaSlow + ')');
      if (structure.bias === 'baissier') confluences.push('Structure : ' + structure.label);
      confluences.push('Prix en premium (au-dessus de l’equilibrium)');

      if (pdInPremium && (crtBear || reclaimS)) direction = 'SHORT';
    }

    var precision = precisionFor(last.close);
    var chart = {
      candles: candles,
      view: { from: Math.max(0, candles.length - CONFIG.viewBars), to: candles.length - 1 },
      range: range,
      fib: fibLevels(range),
      ote: zone === 'premium'
        ? { top: range.low + range.size * CONFIG.oteHigh, bottom: range.low + range.size * CONFIG.oteLow }
        : { top: range.low + range.size * (1 - CONFIG.oteLow), bottom: range.low + range.size * (1 - CONFIG.oteHigh) },
      fvgs: fvgs, obs: obs, swings: swings, liquidity: liquidity,
      emaFast: emaF, emaSlow: emaS,
      emaFastPeriod: CONFIG.emaFast, emaSlowPeriod: CONFIG.emaSlow
    };

    var result = Object.assign(base, {
      price: last.close, zone: zone, fibPos: pos, range: range,
      confluences: confluences, precision: precision,
      trend: trend, structure: structure.label, structureBias: structure.bias,
      chart: chart
    });

    if (!direction) {
      result.reason = zone === 'equilibrium'
        ? 'Prix à l’equilibrium — pas d’edge'
        : 'Confluences incomplètes (PD Array + déclencheur requis)';
      return result;
    }

    var trade = direction === 'LONG' ? buildLong(candles, range, pd, crt) : buildShort(candles, range, pd, crt);
    if (!(trade.rr >= CONFIG.minRR)) { result.reason = 'R:R insuffisant (' + round(trade.rr, 2) + ')'; return result; }

    var strong = confluences.filter(function (c) { return c.indexOf('en discount') === -1 && c.indexOf('en premium') === -1; }).length;
    result.hasSignal = true;
    result.trade = trade;
    result.pd = pd;
    result.confidence = Math.min(100, 35 + strong * 12);
    chart.trade = trade;
    chart.pd = pd;
    return result;
  }

  var api = {
    CONFIG: CONFIG, ema: ema, findSwings: findSwings, dealingRange: dealingRange,
    fibPosition: fibPosition, zoneOf: zoneOf, findFVGs: findFVGs, findOrderBlocks: findOrderBlocks,
    findLiquidity: findLiquidity, marketStructure: marketStructure, detectCRT: detectCRT,
    analyze: analyze, precisionFor: precisionFor, round: round
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICT = api;
})(typeof window !== 'undefined' ? window : this);
