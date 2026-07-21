/*
 * Moteur d'analyse ICT / SMC
 * ---------------------------
 * Détecte des setups de trading fondés sur les concepts ICT/SMC :
 *   1. Dealing range + Fibonacci (equilibrium 0.5 => discount / premium)
 *   2. PD Arrays (Fair Value Gaps, Order Blocks) situés en zone discount/premium
 *   3. CRT (Candle Range Theory) : prise de liquidité (sweep) puis retour dans le range
 *   4. Clôture au-dessus / en-dessous du PD Array (reclaim)
 *
 * Chaque bougie est un objet : { time, open, high, low, close, volume }
 *
 * Le module fonctionne dans le navigateur (window.ICT) et sous Node (module.exports)
 * afin de pouvoir être testé unitairement.
 */
(function (root) {
  'use strict';

  // --- Réglages de la stratégie (ajustables) ---------------------------------
  var CONFIG = {
    swingLookback: 2,        // fractale : nb de bougies de chaque côté pour valider un swing
    rangeMinBars: 6,         // distance min. entre le swing haut et le swing bas retenus
    oteLow: 0.62,            // borne basse de l'Optimal Trade Entry
    oteHigh: 0.79,           // borne haute de l'OTE
    equilibrium: 0.5,        // frontière premium/discount
    fvgLookback: 40,         // profondeur de recherche des FVG
    slBufferPct: 0.0015,     // marge ajoutée sous/sur le stop (0.15 %)
    minRR: 1.2               // R:R minimal pour émettre un signal
  };

  // --- Utilitaires ------------------------------------------------------------
  function round(v, d) {
    if (v == null || isNaN(v)) return v;
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * p) / p;
  }

  // Nombre de décimales pertinent selon le prix (BTC ~ 2, altcoins ~ 4-6)
  function precisionFor(price) {
    var p = Math.abs(price);
    if (p >= 1000) return 2;
    if (p >= 10) return 3;
    if (p >= 1) return 4;
    if (p >= 0.01) return 5;
    return 7;
  }

  // --- Détection des swings (fractales) --------------------------------------
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

  // Dealing range = dernier swing haut et dernier swing bas significatifs.
  // On construit le range à partir des deux derniers swings opposés les plus récents.
  function dealingRange(candles) {
    var s = findSwings(candles, CONFIG.swingLookback);
    if (!s.highs.length || !s.lows.length) return null;

    var lastHigh = s.highs[s.highs.length - 1];
    var lastLow = s.lows[s.lows.length - 1];

    // On veut un range exploitable : swing haut au-dessus du swing bas et suffisamment large.
    if (lastHigh.price <= lastLow.price) return null;
    if (Math.abs(lastHigh.index - lastLow.index) < 1) return null;

    // Direction du dernier mouvement : si le swing bas est plus récent => leg baissier
    // (retracement potentiel vers le premium pour un short), et inversement.
    var bullishLeg = lastLow.index < lastHigh.index; // low avant high => impulsion haussière
    return {
      high: lastHigh.price,
      low: lastLow.price,
      highIndex: lastHigh.index,
      lowIndex: lastLow.index,
      size: lastHigh.price - lastLow.price,
      bullishLeg: bullishLeg
    };
  }

  // Position d'un prix dans le range : 0 = swing bas, 1 = swing haut
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

  // --- PD Arrays : Fair Value Gaps -------------------------------------------
  // FVG haussier : le haut de la bougie i-1 est sous le bas de la bougie i+1 (imbalance).
  // FVG baissier : le bas de la bougie i-1 est au-dessus du haut de la bougie i+1.
  function findFVGs(candles) {
    var out = [];
    var start = Math.max(1, candles.length - CONFIG.fvgLookback);
    for (var i = start; i < candles.length - 1; i++) {
      var prev = candles[i - 1], next = candles[i + 1];
      if (prev.high < next.low) {
        out.push({ type: 'bullish', top: next.low, bottom: prev.high, index: i, mid: (next.low + prev.high) / 2 });
      } else if (prev.low > next.high) {
        out.push({ type: 'bearish', top: prev.low, bottom: next.high, index: i, mid: (prev.low + next.high) / 2 });
      }
    }
    return out;
  }

  // FVG non encore totalement comblé et le plus récent de son type
  function latestUnfilledFVG(candles, fvgs, type) {
    var last = candles[candles.length - 1];
    for (var i = fvgs.length - 1; i >= 0; i--) {
      var g = fvgs[i];
      if (g.type !== type) continue;
      if (type === 'bullish' && last.close > g.bottom) return g; // prix repasse au-dessus => reclaim possible
      if (type === 'bearish' && last.close < g.top) return g;
      return g; // sinon on retourne le plus récent quand même
    }
    return null;
  }

  // --- CRT : Candle Range Theory ---------------------------------------------
  // Bullish : la dernière bougie balaie (sweep) le plus bas de la bougie de range
  //           puis clôture au-dessus de ce plus bas (retour dans le range).
  // Bearish : symétrique sur le plus haut.
  function detectCRT(candles) {
    if (candles.length < 3) return null;
    var last = candles[candles.length - 1];
    var rangeCandle = candles[candles.length - 2];

    var sweptLow = last.low < rangeCandle.low && last.close > rangeCandle.low;
    var sweptHigh = last.high > rangeCandle.high && last.close < rangeCandle.high;

    if (sweptLow && last.close > last.open) {
      return { type: 'bullish', sweepLevel: rangeCandle.low, wick: rangeCandle.low - last.low };
    }
    if (sweptHigh && last.close < last.open) {
      return { type: 'bearish', sweepLevel: rangeCandle.high, wick: last.high - rangeCandle.high };
    }
    return null;
  }

  // --- Clôture au-dessus / en-dessous d'un PD Array --------------------------
  function closeReclaim(candles, fvg) {
    if (!fvg) return false;
    var last = candles[candles.length - 1];
    if (fvg.type === 'bullish') return last.close > fvg.top;    // clôture au-dessus du PD array
    if (fvg.type === 'bearish') return last.close < fvg.bottom; // clôture en-dessous
    return false;
  }

  // --- Construction du signal -------------------------------------------------
  function buildLong(candles, range, fvg, crt, reclaim, pos) {
    var last = candles[candles.length - 1];
    var entry = last.close;

    // Stop sous le point le plus bas pertinent (sweep CRT ou bas du FVG ou swing bas)
    var slBase = range.low;
    if (crt && crt.type === 'bullish') slBase = Math.min(slBase, candles[candles.length - 1].low);
    if (fvg && fvg.type === 'bullish') slBase = Math.min(slBase, fvg.bottom);
    var sl = slBase * (1 - CONFIG.slBufferPct);

    var eq = range.low + range.size * CONFIG.equilibrium;
    var tp1 = eq;                              // retour à l'equilibrium
    var tp2 = range.high;                      // liquidité au swing haut
    var tp3 = range.high + range.size * 0.5;   // extension 1.5

    var risk = entry - sl;
    var rr = risk > 0 ? (tp2 - entry) / risk : 0;
    return { direction: 'LONG', entry: entry, sl: sl, tp1: tp1, tp2: tp2, tp3: tp3, rr: rr };
  }

  function buildShort(candles, range, fvg, crt, reclaim, pos) {
    var last = candles[candles.length - 1];
    var entry = last.close;

    var slBase = range.high;
    if (crt && crt.type === 'bearish') slBase = Math.max(slBase, candles[candles.length - 1].high);
    if (fvg && fvg.type === 'bearish') slBase = Math.max(slBase, fvg.top);
    var sl = slBase * (1 + CONFIG.slBufferPct);

    var eq = range.low + range.size * CONFIG.equilibrium;
    var tp1 = eq;
    var tp2 = range.low;
    var tp3 = range.low - range.size * 0.5;

    var risk = sl - entry;
    var rr = risk > 0 ? (entry - tp2) / risk : 0;
    return { direction: 'SHORT', entry: entry, sl: sl, tp1: tp1, tp2: tp2, tp3: tp3, rr: rr };
  }

  // --- Analyse complète d'un actif -------------------------------------------
  function analyze(symbol, timeframe, candles) {
    var base = { symbol: symbol, timeframe: timeframe, hasSignal: false };
    if (!candles || candles.length < 20) return Object.assign(base, { reason: 'Données insuffisantes' });

    var range = dealingRange(candles);
    if (!range) return Object.assign(base, { reason: 'Aucun dealing range clair' });

    var last = candles[candles.length - 1];
    var pos = fibPosition(range, last.close);
    var zone = zoneOf(pos);
    var fvgs = findFVGs(candles);
    var crt = detectCRT(candles);

    var confluences = [];
    var direction = null;
    var fvg = null;
    var reclaim = false;

    // --- Scénario LONG : zone discount ---
    if (zone === 'discount') {
      fvg = latestUnfilledFVG(candles, fvgs, 'bullish');
      var fvgInDiscount = fvg && fibPosition(range, fvg.mid) < CONFIG.equilibrium;
      reclaim = closeReclaim(candles, fvg);
      var crtBull = crt && crt.type === 'bullish';
      var inOTE = pos >= (1 - CONFIG.oteHigh) && pos <= (1 - CONFIG.oteLow); // OTE côté discount

      if (fvgInDiscount) confluences.push('PD Array (FVG) en discount');
      if (inOTE) confluences.push('Prix dans la zone OTE (0.62–0.79)');
      if (crtBull) confluences.push('CRT haussier (sweep + retour)');
      if (reclaim) confluences.push('Clôture au-dessus du PD Array');
      confluences.push('Prix en discount (sous l’equilibrium)');

      // Déclencheur requis : un PD array en discount + (CRT haussier OU clôture au-dessus du PD array)
      if (fvgInDiscount && (crtBull || reclaim)) direction = 'LONG';
    }

    // --- Scénario SHORT : zone premium ---
    if (zone === 'premium') {
      fvg = latestUnfilledFVG(candles, fvgs, 'bearish');
      var fvgInPremium = fvg && fibPosition(range, fvg.mid) > CONFIG.equilibrium;
      reclaim = closeReclaim(candles, fvg);
      var crtBear = crt && crt.type === 'bearish';
      var inOTEs = pos >= CONFIG.oteLow && pos <= CONFIG.oteHigh;

      if (fvgInPremium) confluences.push('PD Array (FVG) en premium');
      if (inOTEs) confluences.push('Prix dans la zone OTE (0.62–0.79)');
      if (crtBear) confluences.push('CRT baissier (sweep + retour)');
      if (reclaim) confluences.push('Clôture en-dessous du PD Array');
      confluences.push('Prix en premium (au-dessus de l’equilibrium)');

      if (fvgInPremium && (crtBear || reclaim)) direction = 'SHORT';
    }

    var result = Object.assign(base, {
      price: last.close,
      zone: zone,
      fibPos: pos,
      range: range,
      confluences: confluences,
      precision: precisionFor(last.close)
    });

    if (!direction) {
      result.reason = zone === 'equilibrium'
        ? 'Prix à l’equilibrium — pas d’edge'
        : 'Confluences incomplètes (PD Array + déclencheur requis)';
      return result;
    }

    var trade = direction === 'LONG'
      ? buildLong(candles, range, fvg, crt, reclaim, pos)
      : buildShort(candles, range, fvg, crt, reclaim, pos);

    if (!(trade.rr >= CONFIG.minRR)) {
      result.reason = 'R:R insuffisant (' + round(trade.rr, 2) + ')';
      return result;
    }

    // Score de confiance : proportion de confluences fortes réunies (hors la base de zone)
    var strong = confluences.filter(function (c) { return c.indexOf('en discount') === -1 && c.indexOf('en premium') === -1; }).length;
    result.hasSignal = true;
    result.trade = trade;
    result.confidence = Math.min(100, 40 + strong * 15);
    return result;
  }

  var api = {
    CONFIG: CONFIG,
    findSwings: findSwings,
    dealingRange: dealingRange,
    fibPosition: fibPosition,
    zoneOf: zoneOf,
    findFVGs: findFVGs,
    detectCRT: detectCRT,
    analyze: analyze,
    precisionFor: precisionFor,
    round: round
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICT = api;
})(typeof window !== 'undefined' ? window : this);
