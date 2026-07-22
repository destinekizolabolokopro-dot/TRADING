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
    ignoreSession: false, // true uniquement pour la démo (affiche le scalp hors session)
    eqTolerance: 0.0012, // 0.12 % pour considérer deux extrêmes « égaux »
    srTolerance: 0.005,  // 0.5 % pour regrouper des extrêmes en une zone S/R
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
    return { strategy: 'ote', strategyLabel: 'Retracement OTE', direction: bull ? 'LONG' : 'SHORT',
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
    return { strategy: 'daily', strategyLabel: 'Previous Daily', direction: bull ? 'LONG' : 'SHORT',
      trade: trade, pd: pdArr, confluences: conf, confidence: scoreConfidence(conf) };
  }

  // --- Stratégie 3 : Scalping (multi-timeframe) ------------------------------
  // Tendance sur M5 (agrégée depuis M1) → retour sur zone clé (MM / OB) sur M1
  // → confirmation (bougie de retournement / rejet) → SL serré, objectif ≥ 2R.
  // Filtre de session : Londres / New York.
  function aggregate(candles, n) {
    var out = [];
    for (var i = 0; i < candles.length; i += n) {
      var slice = candles.slice(i, i + n); if (!slice.length) continue;
      var hi = -Infinity, lo = Infinity, vol = 0;
      slice.forEach(function (c) { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); vol += c.volume || 0; });
      out.push({ time: slice[0].time, open: slice[0].open, high: hi, low: lo, close: slice[slice.length - 1].close, volume: vol });
    }
    return out;
  }
  function tradingSession(date) {
    var h = (date || new Date()).getUTCHours();
    var london = h >= 7 && h < 16, ny = h >= 12 && h < 21;
    return { active: london || ny, overlap: h >= 12 && h < 16, name: (london && ny) ? 'Londres + New York' : (london ? 'Londres' : (ny ? 'New York' : 'hors session')) };
  }
  function basicChart(c, trade) {
    var closes = c.map(function (x) { return x.close; });
    return {
      candles: c, view: { from: Math.max(0, c.length - CONFIG.viewBars), to: c.length - 1 },
      fvgs: findFVGs(c), obs: findOrderBlocks(c), swings: findSwings(c, CONFIG.swingLookback),
      emaFast: ema(closes, CONFIG.emaFast), emaSlow: ema(closes, CONFIG.emaSlow),
      emaFastPeriod: CONFIG.emaFast, emaSlowPeriod: CONFIG.emaSlow, liquidity: [], trade: trade
    };
  }
  function evalScalping(ctx) {
    var m1 = ctx.m1;
    if (!m1 || m1.length < 70) return null;
    // Le scalping ne se déclenche QUE pendant les sessions de Londres / New York.
    var sess = tradingSession();
    if (!sess.active && !CONFIG.ignoreSession) return null;
    // 1) Tendance sur M5 (agrégée)
    var m5 = aggregate(m1, 5);
    if (m5.length < CONFIG.emaSlow + 2) return null;
    var c5 = m5.map(function (c) { return c.close; });
    var ef = ema(c5, CONFIG.emaFast), es = ema(c5, CONFIG.emaSlow);
    var j = m5.length - 1;
    if (ef[j] == null || es[j] == null) return null;
    var up = ef[j] > es[j];
    var trend = up ? 'haussière' : 'baissière';

    // 2) Zone clé sur M1 : retour sur la moyenne mobile (EMA 50) ou un Order Block
    var c1 = m1.map(function (c) { return c.close; });
    var e50 = ema(c1, 50);
    var i = m1.length - 1, last = m1[i], prev = m1[i - 1];
    if (e50[i] == null) return null;
    function touched(c) { return c.low <= e50[i] * 1.0012 && c.high >= e50[i] * 0.9988; }
    var pullback = touched(last) || touched(prev);
    var obs1 = findOrderBlocks(m1);
    var ob = up ? latestOB(obs1, 'bullish') : latestOB(obs1, 'bearish');

    // 3) Confirmation sur M1 (bougie de retournement / cassure)
    var confirmLong = up && last.close > last.open && (last.close > prev.high || (last.close - last.low) > (last.high - last.close));
    var confirmShort = !up && last.close < last.open && (last.close < prev.low || (last.high - last.close) > (last.close - last.low));
    var dirLong = confirmLong, dirShort = confirmShort;
    if (!dirLong && !dirShort) return null;
    if (!pullback && !ob) return null; // il faut un retour sur une zone clé

    var conf = ['Tendance ' + trend + ' (M5)'];
    if (pullback) conf.push('Retour sur la moyenne mobile (M1)');
    if (ob) conf.push('Order Block M1 dans le sens');
    conf.push('Confirmation M1 (' + (dirLong ? 'bougie haussière' : 'bougie baissière') + ')');
    if (sess.overlap) conf.push('Chevauchement Londres/New York (volatilité max)');
    else conf.push('Session ' + sess.name + ' active');

    // 4) Trade : SL derrière le dernier creux/sommet M1, objectif 2R
    var lookback = 6, entry = last.close, trade, k;
    if (dirLong) {
      var lo = Infinity; for (k = Math.max(0, m1.length - lookback); k < m1.length; k++) lo = Math.min(lo, m1[k].low);
      var sl = lo * (1 - CONFIG.slBufferPct), risk = entry - sl;
      trade = { direction: 'LONG', entry: entry, sl: sl, tp1: entry + risk, tp2: entry + 2 * risk, tp3: entry + 3 * risk };
      trade.rr = risk > 0 ? (trade.tp2 - entry) / risk : 0;
    } else {
      var hi = -Infinity; for (k = Math.max(0, m1.length - lookback); k < m1.length; k++) hi = Math.max(hi, m1[k].high);
      var slh = hi * (1 + CONFIG.slBufferPct), risk2 = slh - entry;
      trade = { direction: 'SHORT', entry: entry, sl: slh, tp1: entry - risk2, tp2: entry - 2 * risk2, tp3: entry - 3 * risk2 };
      trade.rr = risk2 > 0 ? (entry - trade.tp2) / risk2 : 0;
    }
    if (!(trade.rr >= CONFIG.minRR)) return null;
    return { strategy: 'scalp', strategyLabel: 'Scalping (M1)', direction: dirLong ? 'LONG' : 'SHORT',
      trade: trade, pd: ob, confluences: conf, confidence: scoreConfidence(conf), trend: trend, m1: m1 };
  }

  // --- Stratégie 4 : Smart Money (SMC) ---------------------------------------
  // Tendance sur unité supérieure (agrégée) → retour sur une zone d'offre/demande
  // (Order Block / FVG) → confirmation BOS/CHoCH ou rejet → objectif sur la
  // prochaine liquidité (swing opposé / equal highs-lows). Ratio visé > 1:2.
  function nearestSwingAbove(swings, price) { for (var i = swings.highs.length - 1; i >= 0; i--) if (swings.highs[i].price > price) return swings.highs[i].price; return null; }
  function nearestSwingBelow(swings, price) { for (var i = swings.lows.length - 1; i >= 0; i--) if (swings.lows[i].price < price) return swings.lows[i].price; return null; }

  function evalSMC(ctx) {
    var candles = ctx.candles;

    // Tendance sur unité supérieure : agrégation ×4 du timeframe courant.
    var htf = aggregate(candles, 4), trend = ctx.trend;
    if (htf.length >= CONFIG.emaSlow + 2) {
      var hc = htf.map(function (c) { return c.close; });
      var ef = ema(hc, CONFIG.emaFast), es = ema(hc, CONFIG.emaSlow), j = htf.length - 1;
      if (ef[j] != null && es[j] != null) trend = ef[j] > es[j] ? 'haussière' : 'baissière';
    }
    if (trend !== 'haussière' && trend !== 'baissière') return null;
    var bull = trend === 'haussière';
    var last = candles[candles.length - 1];

    // Zone d'offre/demande : Order Block prioritaire, sinon FVG, dans le sens.
    var ob = bull ? latestOB(ctx.obs, 'bullish') : latestOB(ctx.obs, 'bearish');
    var fvg = latestUnfilledFVG(candles, ctx.fvgs, bull ? 'bullish' : 'bearish');
    var zone = ob || fvg;
    if (!zone) return null;
    var isFvg = zone === fvg && !ob;
    var zTop = zone.top, zBot = zone.bottom;

    // Le prix est revenu SUR la zone (il l'a touchée récemment).
    var returned = bull ? (last.low <= zTop * 1.002 && last.close >= zBot * 0.995)
                        : (last.high >= zBot * 0.998 && last.close <= zTop * 1.005);
    if (!returned) return null;

    // Confirmation : BOS/CHoCH dans le sens OU rejet (bougie de retournement).
    var bosOk = ctx.structure && ((bull && ctx.structure.bias === 'haussier') || (!bull && ctx.structure.bias === 'baissier'));
    var rejection = bull ? (last.close > last.open && (last.close - last.low) > (last.high - last.close))
                         : (last.close < last.open && (last.high - last.close) > (last.close - last.low));
    if (!bosOk && !rejection) return null;

    var conf = ['Tendance ' + trend + ' (unité supérieure)'];
    conf.push('Retour sur une zone d’offre/demande (' + (isFvg ? 'FVG' : 'Order Block') + ')');
    if (bosOk) conf.push('Structure : ' + ctx.structure.label);
    if (rejection) conf.push('Rejet de la zone (bougie de retournement)');
    var inOTE = bull ? (ctx.pos >= (1 - CONFIG.oteHigh) && ctx.pos <= (1 - CONFIG.oteLow)) : (ctx.pos >= CONFIG.oteLow && ctx.pos <= CONFIG.oteHigh);
    if (inOTE) conf.push('Prix dans la zone OTE (0.62–0.79)');
    conf.push('Objectif sur la prochaine liquidité');

    // Objectif = prochaine liquidité (swing opposé) ; sinon projection à ~2.5R.
    var entry = last.close, trade;
    if (bull) {
      var sl = zBot * (1 - CONFIG.slBufferPct), risk = entry - sl;
      var target = nearestSwingAbove(ctx.swings, entry);
      if (target == null || target < entry + 1.5 * risk) target = entry + 2.5 * risk;
      trade = { direction: 'LONG', entry: entry, sl: sl, tp1: entry + (target - entry) * 0.5, tp2: target, tp3: target + (target - entry) * 0.5 };
      trade.rr = risk > 0 ? (target - entry) / risk : 0;
    } else {
      var slh = zTop * (1 + CONFIG.slBufferPct), risk2 = slh - entry;
      var target2 = nearestSwingBelow(ctx.swings, entry);
      if (target2 == null || target2 > entry - 1.5 * risk2) target2 = entry - 2.5 * risk2;
      trade = { direction: 'SHORT', entry: entry, sl: slh, tp1: entry - (entry - target2) * 0.5, tp2: target2, tp3: target2 - (entry - target2) * 0.5 };
      trade.rr = risk2 > 0 ? (entry - target2) / risk2 : 0;
    }
    if (!(trade.rr >= CONFIG.minRR)) return null;
    return { strategy: 'smc', strategyLabel: 'Smart Money (SMC)', direction: bull ? 'LONG' : 'SHORT',
      trade: trade, pd: zone, confluences: conf, confidence: scoreConfidence(conf) };
  }

  // --- Stratégie 5 : Support & Résistance (zones H4/Daily) -------------------
  // Zones où le prix a réagi PLUSIEURS fois (rectangle, pas une ligne) sur une
  // grande unité de temps. On attend le RETOUR sur la zone + une confirmation
  // (rejet longue mèche / engloutissement / BOS-CHoCH), stop derrière la zone,
  // objectif sur la prochaine zone clé. Ratio visé > 1:2.
  function findSRZones(swings, tol) {
    function cluster(points) {
      var zones = [];
      points.forEach(function (pt) {
        var placed = false;
        for (var i = 0; i < zones.length; i++) {
          var z = zones[i];
          if (Math.abs(pt.price - z.mid) / z.mid <= tol) {
            z.prices.push(pt.price); z.lastIdx = Math.max(z.lastIdx, pt.index);
            z.mid = z.prices.reduce(function (a, b) { return a + b; }, 0) / z.prices.length; placed = true; break;
          }
        }
        if (!placed) zones.push({ prices: [pt.price], lastIdx: pt.index, mid: pt.price });
      });
      return zones.filter(function (z) { return z.prices.length >= 2; }).map(function (z) {
        return { top: Math.max.apply(null, z.prices), bottom: Math.min.apply(null, z.prices), mid: z.mid, touches: z.prices.length, lastIdx: z.lastIdx };
      });
    }
    return { resistance: cluster(swings.highs), support: cluster(swings.lows) };
  }
  function evalSR(ctx) {
    var candles = ctx.candles;
    var htf = aggregate(candles, 4), trend = ctx.trend;
    if (htf.length >= CONFIG.emaSlow + 2) {
      var hc = htf.map(function (c) { return c.close; });
      var ef = ema(hc, CONFIG.emaFast), es = ema(hc, CONFIG.emaSlow), j = htf.length - 1;
      if (ef[j] != null && es[j] != null) trend = ef[j] > es[j] ? 'haussière' : 'baissière';
    }
    if (trend !== 'haussière' && trend !== 'baissière') return null;
    var bull = trend === 'haussière';
    // Zones tracées sur le timeframe courant (choisi H4/Daily) — pas l'agrégation.
    var zones = findSRZones(ctx.swings, CONFIG.srTolerance);
    var last = candles[candles.length - 1], prev = candles[candles.length - 2], entry = last.close;

    var pool = bull ? zones.support : zones.resistance;
    var zone = null;
    pool.forEach(function (z) {
      var touched = bull ? (last.low <= z.top * 1.002 && entry >= z.bottom * 0.99 && entry <= z.top * 1.02)
                         : (last.high >= z.bottom * 0.998 && entry <= z.top * 1.01 && entry >= z.bottom * 0.98);
      if (touched && (!zone || z.touches > zone.touches)) zone = z;
    });
    if (!zone) return null;

    var bosOk = ctx.structure && ((bull && ctx.structure.bias === 'haussier') || (!bull && ctx.structure.bias === 'baissier'));
    var rejection = bull ? (last.close > last.open && (last.close - last.low) > (last.high - last.close)) : (last.close < last.open && (last.high - last.close) > (last.close - last.low));
    var engulf = bull ? (last.close > last.open && last.close > prev.high) : (last.close < last.open && last.close < prev.low);
    if (!bosOk && !rejection && !engulf) return null;

    var conf = ['Tendance ' + trend + ' (H4/Daily)'];
    conf.push('Zone ' + (bull ? 'de support' : 'de résistance') + ' testée ' + zone.touches + ' fois');
    if (bosOk) conf.push('Structure : ' + ctx.structure.label);
    if (rejection) conf.push('Rejet avec longue mèche');
    if (engulf) conf.push('Bougie d’engloutissement');
    conf.push('Objectif sur la prochaine zone clé');

    var trade;
    if (bull) {
      var sl = zone.bottom * (1 - CONFIG.slBufferPct), risk = entry - sl, tgt = null;
      zones.resistance.forEach(function (z) { if (z.bottom > entry && (tgt == null || z.bottom < tgt)) tgt = z.bottom; });
      if (tgt == null || tgt < entry + 1.5 * risk) tgt = entry + 2 * risk;
      trade = { direction: 'LONG', entry: entry, sl: sl, tp1: entry + (tgt - entry) * 0.5, tp2: tgt, tp3: tgt + (tgt - entry) * 0.5 };
      trade.rr = risk > 0 ? (tgt - entry) / risk : 0;
    } else {
      var slh = zone.top * (1 + CONFIG.slBufferPct), risk2 = slh - entry, tgt2 = null;
      zones.support.forEach(function (z) { if (z.top < entry && (tgt2 == null || z.top > tgt2)) tgt2 = z.top; });
      if (tgt2 == null || tgt2 > entry - 1.5 * risk2) tgt2 = entry - 2 * risk2;
      trade = { direction: 'SHORT', entry: entry, sl: slh, tp1: entry - (entry - tgt2) * 0.5, tp2: tgt2, tp3: tgt2 - (entry - tgt2) * 0.5 };
      trade.rr = risk2 > 0 ? (entry - tgt2) / risk2 : 0;
    }
    if (!(trade.rr >= CONFIG.minRR)) return null;
    return { strategy: 'sr', strategyLabel: 'Support & Résistance', direction: bull ? 'LONG' : 'SHORT',
      trade: trade, pd: { type: bull ? 'bullish' : 'bearish', top: zone.top, bottom: zone.bottom, index: zone.lastIdx }, confluences: conf, confidence: scoreConfidence(conf) };
  }

  // --- Analyse complète -------------------------------------------------------
  // opts : { pdh, pdl } (daily) · { m1 } (scalping) · { strategies } (activées)
  function analyze(symbol, timeframe, candles, opts) {
    opts = opts || {};
    var base = { symbol: symbol, timeframe: timeframe, hasSignal: false };
    if (!candles || candles.length < 25) return Object.assign(base, { reason: 'Données insuffisantes' });

    var swings = findSwings(candles, CONFIG.swingLookback);
    var range = dealingRange(candles, swings);
    // Le range du timeframe courant sert à OTE/Daily ; scalping et SMC n'en dépendent pas.
    var st = opts.strategies || {};
    var canRunWithoutRange = (st.scalp !== false) || (st.smc !== false) || (st.sr !== false);
    if (!range && !canRunWithoutRange) {
      return Object.assign(base, { reason: 'Aucun dealing range clair' });
    }

    var last = candles[candles.length - 1];
    var pos = range ? fibPosition(range, last.close) : null;
    var zone = range ? zoneOf(pos) : 'inconnu';
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
      trend: trend, structure: structure, swings: swings, liquidity: liquidity,
      pdh: opts.pdh, pdl: opts.pdl, m1: opts.m1
    };

    // Stratégies activées (par défaut toutes) ; on retient le meilleur signal.
    var enabled = opts.strategies || {};
    var cands = [];
    if (enabled.ote !== false && range) { var s1 = evalOTE(ctx); if (s1) cands.push(s1); }
    if (enabled.daily !== false && range) { var s2 = evalDaily(ctx); if (s2) cands.push(s2); }
    if (enabled.scalp !== false) { var s3 = evalScalping(ctx); if (s3) cands.push(s3); }
    if (enabled.smc !== false) { var s4 = evalSMC(ctx); if (s4) cands.push(s4); }
    if (enabled.sr !== false) { var s5 = evalSR(ctx); if (s5) cands.push(s5); }
    cands.sort(function (a, b) { return b.confidence - a.confidence; });
    var best = cands[0] || null;

    var precision = precisionFor(last.close);
    // Graphique : M1 pour un setup de scalping, sinon le timeframe courant.
    var chart;
    if (best && best.strategy === 'scalp') {
      chart = basicChart(best.m1, best.trade);
    } else if (!range) {
      chart = basicChart(candles, best ? best.trade : null);
    } else {
      chart = {
        candles: candles,
        view: { from: Math.max(0, candles.length - CONFIG.viewBars), to: candles.length - 1 },
        range: range, fib: fibLevels(range),
        ote: zone === 'premium'
          ? { top: range.low + range.size * CONFIG.oteHigh, bottom: range.low + range.size * CONFIG.oteLow }
          : { top: range.low + range.size * (1 - CONFIG.oteLow), bottom: range.low + range.size * (1 - CONFIG.oteHigh) },
        fvgs: fvgs, obs: obs, swings: swings, liquidity: liquidity,
        emaFast: emaF, emaSlow: emaS, emaFastPeriod: CONFIG.emaFast, emaSlowPeriod: CONFIG.emaSlow,
        pdh: opts.pdh, pdl: opts.pdl
      };
      if (best) { chart.trade = best.trade; chart.pd = best.pd; }
    }

    var result = Object.assign(base, {
      price: last.close, zone: zone, fibPos: pos, range: range, precision: precision,
      trend: (best && best.trend) ? best.trend : trend,
      structure: structure.label, structureBias: structure.bias, chart: chart
    });

    if (!best) {
      result.reason = !range ? 'Aucun dealing range clair'
        : ((zone === 'discount' || zone === 'premium')
          ? 'Pas de confluence complète (PD Array + CRT requis, ou balayage daily)'
          : 'Prix à l’equilibrium — pas d’edge');
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
    return result;
  }

  var api = {
    CONFIG: CONFIG, ema: ema, findSwings: findSwings, dealingRange: dealingRange,
    fibPosition: fibPosition, zoneOf: zoneOf, findFVGs: findFVGs, findOrderBlocks: findOrderBlocks,
    findLiquidity: findLiquidity, marketStructure: marketStructure, detectCRT: detectCRT,
    aggregate: aggregate, findSRZones: findSRZones,
    analyze: analyze, precisionFor: precisionFor, round: round
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICT = api;
})(typeof window !== 'undefined' ? window : this);
