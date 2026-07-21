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

  // Sweep récent d'un niveau : sur les dernières bougies, le prix a dépassé le
  // niveau puis a clôturé du bon côté (retour). Renvoie l'extrême balayé.
  function recentSweepBelow(candles, level, lookback) {
    var last = candles[candles.length - 1];
    if (last.close <= level) return null;
    var lo = Infinity, ok = false;
    for (var i = Math.max(0, candles.length - lookback); i < candles.length; i++) {
      if (candles[i].low < level) { ok = true; if (candles[i].low < lo) lo = candles[i].low; }
    }
    return ok ? lo : null;
  }
  function recentSweepAbove(candles, level, lookback) {
    var last = candles[candles.length - 1];
    if (last.close >= level) return null;
    var hi = -Infinity, ok = false;
    for (var i = Math.max(0, candles.length - lookback); i < candles.length; i++) {
      if (candles[i].high > level) { ok = true; if (candles[i].high > hi) hi = candles[i].high; }
    }
    return ok ? hi : null;
  }

  // Confiance = proportion de confluences réunies (plus il y en a, plus c'est élevé).
  function scoreConfidence(list) { return Math.min(100, 35 + list.length * 12); }

  // --- Stratégie 1 : OTE + PD Array en discount/premium + CRT (obligatoire) ---
  function evalOTE(ctx) {
    var candles = ctx.candles, range = ctx.range, pos = ctx.pos, zone = ctx.zone, crt = ctx.crt, trend = ctx.trend, structure = ctx.structure;
    if (zone !== 'discount' && zone !== 'premium') return null;
    var bull = zone === 'discount';
    var wantType = bull ? 'bullish' : 'bearish';
    function inZone(mid) { return bull ? fibPosition(range, mid) < CONFIG.equilibrium : fibPosition(range, mid) > CONFIG.equilibrium; }
    // PD Array le plus récent SITUÉ dans la bonne zone (FVG prioritaire, sinon Order Block).
    var pd = null, isFvg = false;
    for (var fi = ctx.fvgs.length - 1; fi >= 0 && !pd; fi--) {
      if (ctx.fvgs[fi].type === wantType && inZone(ctx.fvgs[fi].mid)) { pd = ctx.fvgs[fi]; isFvg = true; }
    }
    if (!pd) for (var oi = ctx.obs.length - 1; oi >= 0 && !pd; oi--) {
      if (ctx.obs[oi].type === wantType && inZone((ctx.obs[oi].top + ctx.obs[oi].bottom) / 2)) pd = ctx.obs[oi];
    }
    var pdInZone = !!pd;
    var crtOk = crt && crt.type === (bull ? 'bullish' : 'bearish');
    var inOTE = bull ? (pos >= (1 - CONFIG.oteHigh) && pos <= (1 - CONFIG.oteLow)) : (pos >= CONFIG.oteLow && pos <= CONFIG.oteHigh);

    // Règle : PD Array dans la zone + CRT obligatoires.
    if (!(pdInZone && crtOk)) return null;

    var conf = [];
    conf.push('PD Array (' + (isFvg ? 'FVG' : 'Order Block') + ') en ' + zone);
    conf.push('CRT ' + (bull ? 'haussier' : 'baissier') + ' (sweep + retour)');
    if (inOTE) conf.push('Prix dans la zone OTE (0.62–0.79)');
    if (closeReclaim(candles, pd)) conf.push('Clôture ' + (bull ? 'au-dessus' : 'en-dessous') + ' du PD Array');
    if (trend === (bull ? 'haussière' : 'baissière')) conf.push('Tendance ' + trend + ' (EMA ' + CONFIG.emaFast + '/' + CONFIG.emaSlow + ')');
    if (structure.bias === (bull ? 'haussier' : 'baissier')) conf.push('Structure : ' + structure.label);

    var trade = bull ? buildLong(candles, range, pd, crt) : buildShort(candles, range, pd, crt);
    if (!(trade.rr >= CONFIG.minRR)) return null;
    return { strategy: 'ote', strategyLabel: 'OTE + PD Array + CRT', direction: bull ? 'LONG' : 'SHORT',
      trade: trade, pd: pd, confluences: conf, confidence: scoreConfidence(conf) };
  }

  // --- Stratégie 2 : Previous Daily CRT --------------------------------------
  // Balayage du plus-bas (PDL) ou plus-haut (PDH) de la veille + retour.
  function evalDaily(ctx) {
    var candles = ctx.candles, pdh = ctx.pdh, pdl = ctx.pdl;
    if (pdh == null || pdl == null || !(pdh > pdl)) return null;
    var lookback = 6;
    var sweepLow = recentSweepBelow(candles, pdl, lookback);
    var sweepHigh = recentSweepAbove(candles, pdh, lookback);
    var last = candles[candles.length - 1];
    var bull = null;
    if (sweepLow != null && last.close > last.open) bull = true;
    else if (sweepHigh != null && last.close < last.open) bull = false;
    if (bull === null) return null;

    var conf = [];
    conf.push(bull ? 'Balayage du plus-bas de la veille (PDL) + retour' : 'Balayage du plus-haut de la veille (PDH) + retour');
    conf.push('CRT sur bougie journalière');
    if (bull && ctx.zone === 'discount') conf.push('Prix en discount');
    if (!bull && ctx.zone === 'premium') conf.push('Prix en premium');
    var inOTE = bull ? (ctx.pos >= (1 - CONFIG.oteHigh) && ctx.pos <= (1 - CONFIG.oteLow)) : (ctx.pos >= CONFIG.oteLow && ctx.pos <= CONFIG.oteHigh);
    if (inOTE) conf.push('Prix dans la zone OTE (0.62–0.79)');
    var pdArr = bull ? (latestUnfilledFVG(candles, ctx.fvgs, 'bullish') || latestOB(ctx.obs, 'bullish'))
                     : (latestUnfilledFVG(candles, ctx.fvgs, 'bearish') || latestOB(ctx.obs, 'bearish'));
    if (pdArr) conf.push('PD Array dans le sens');
    if (ctx.trend === (bull ? 'haussière' : 'baissière')) conf.push('Tendance ' + ctx.trend);
    if (ctx.structure.bias === (bull ? 'haussier' : 'baissier')) conf.push('Structure : ' + ctx.structure.label);

    var entry = last.close, trade;
    if (bull) {
      var sl = sweepLow * (1 - CONFIG.slBufferPct);
      trade = { direction: 'LONG', entry: entry, sl: sl, tp1: (pdl + pdh) / 2, tp2: pdh, tp3: pdh + (pdh - pdl) * 0.5 };
      trade.rr = (entry - sl) > 0 ? (trade.tp2 - entry) / (entry - sl) : 0;
    } else {
      var slh = sweepHigh * (1 + CONFIG.slBufferPct);
      trade = { direction: 'SHORT', entry: entry, sl: slh, tp1: (pdl + pdh) / 2, tp2: pdl, tp3: pdl - (pdh - pdl) * 0.5 };
      trade.rr = (slh - entry) > 0 ? (entry - trade.tp2) / (slh - entry) : 0;
    }
    if (!(trade.rr >= CONFIG.minRR)) return null;
    return { strategy: 'daily', strategyLabel: 'Previous Daily CRT', direction: bull ? 'LONG' : 'SHORT',
      trade: trade, pd: pdArr, confluences: conf, confidence: scoreConfidence(conf) };
  }

  // --- Analyse complète -------------------------------------------------------
  // opts : { pdh, pdl } = plus-haut / plus-bas de la veille (pour la stratégie daily)
  function analyze(symbol, timeframe, candles, opts) {
    opts = opts || {};
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

    var ctx = {
      candles: candles, range: range, pos: pos, zone: zone, fvgs: fvgs, obs: obs, crt: crt,
      trend: trend, structure: structure, pdh: opts.pdh, pdl: opts.pdl
    };

    // Deux stratégies ; on retient le meilleur signal (confiance la plus haute).
    var cands = [];
    var s1 = evalOTE(ctx); if (s1) cands.push(s1);
    var s2 = evalDaily(ctx); if (s2) cands.push(s2);
    cands.sort(function (a, b) { return b.confidence - a.confidence; });
    var best = cands[0] || null;

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
      emaFast: emaF, emaSlow: emaS, emaFastPeriod: CONFIG.emaFast, emaSlowPeriod: CONFIG.emaSlow,
      pdh: opts.pdh, pdl: opts.pdl
    };

    var result = Object.assign(base, {
      price: last.close, zone: zone, fibPos: pos, range: range, precision: precision,
      trend: trend, structure: structure.label, structureBias: structure.bias, chart: chart
    });

    if (!best) {
      result.reason = (zone === 'discount' || zone === 'premium')
        ? 'Pas de confluence complète (PD Array + CRT requis, ou balayage daily)'
        : 'Prix à l’equilibrium — pas d’edge';
      return result;
    }

    result.hasSignal = true;
    result.trade = best.trade;
    result.pd = best.pd;
    result.confluences = best.confluences;
    result.confidence = best.confidence;
    result.strategy = best.strategy;
    result.strategyLabel = best.strategyLabel;
    result.alternatives = cands.length;
    chart.trade = best.trade;
    chart.pd = best.pd;
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
