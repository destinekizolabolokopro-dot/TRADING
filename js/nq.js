/*
 * nq.js — MECH MODEL sur le NASDAQ (NQ) avec SMT contre le S&P 500 (ES)
 * -----------------------------------------------------------------------------
 * Le MECH Model de PB Blake se trade sur le Nasdaq futures (NQ/MNQ). Ce module
 * fournit au site TOUT ce que le modèle exige :
 *   - les bougies NQ (contexte D1 + exécution M15/M5)
 *   - les bougies ES (S&P 500) UNIQUEMENT pour la divergence SMT
 *   - le PDH/PDL (plus-haut / plus-bas de la veille)
 *   - les GAPS NON COMBLÉS (le cœur du modèle) avec leur EQ (équilibre = cible)
 *   - la divergence SMT NQ vs ES (filtre éliminatoire du MECH)
 *
 * Données : Yahoo Finance, via un proxy CORS (même technique que le calendrier
 * éco) pour que ça marche depuis un fichier local dans le navigateur.
 * Pédagogique — pas un conseil financier.
 */
(function (root) {
  'use strict';

  var PROXY = 'https://api.allorigins.win/raw?url=';
  var YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  var SYM = { nq: 'NQ=F', es: 'ES=F' };   // Nasdaq 100 futures / S&P 500 futures

  function url(sym, interval, range) {
    return PROXY + encodeURIComponent(YF + encodeURIComponent(sym) + '?interval=' + interval + '&range=' + range);
  }

  // Récupère les bougies OHLC d'un symbole.
  function candles(sym, interval, range) {
    if (typeof fetch === 'undefined') return Promise.resolve(null);
    return fetch(url(sym, interval, range))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var res = j && j.chart && j.chart.result && j.chart.result[0];
        if (!res || !res.timestamp) return null;
        var q = res.indicators.quote[0], out = [];
        for (var i = 0; i < res.timestamp.length; i++) {
          if (q.open[i] == null || q.close[i] == null) continue;
          out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
        }
        return { sym: res.meta.symbol, price: res.meta.regularMarketPrice,
          chg: res.meta.regularMarketChangePercent, tz: res.meta.exchangeTimezoneName, candles: out };
      })
      .catch(function () { return null; });
  }

  // --- GAPS NON COMBLÉS (le cœur du MECH Model) -------------------------------
  // Deux familles :
  //  1) gap "vrai" de session : le bas d'une bougie est au-dessus du haut de la
  //     précédente (ou l'inverse) — typique des futures qui ferment la nuit.
  //  2) FVG (imbalance 3 bougies) : trou laissé par un mouvement rapide.
  // Un gap est NON COMBLÉ tant que le prix n'est pas revenu dedans après coup.
  function findGaps(cs) {
    var gaps = [], i;
    function unfilled(lo, hi, from) {        // le prix est-il revenu dans la zone ?
      for (var k = from; k < cs.length; k++) { if (cs[k].l <= hi && cs[k].h >= lo) return false; }
      return true;
    }
    for (i = 1; i < cs.length; i++) {
      if (cs[i].l > cs[i - 1].h) {           // gap haussier
        var lo1 = cs[i - 1].h, hi1 = cs[i].l;
        if (unfilled(lo1, hi1, i + 1)) gaps.push({ type: 'gap', dir: 'haussier', lo: lo1, hi: hi1, eq: (lo1 + hi1) / 2, t: cs[i].t });
      } else if (cs[i].h < cs[i - 1].l) {    // gap baissier
        var lo2 = cs[i].h, hi2 = cs[i - 1].l;
        if (unfilled(lo2, hi2, i + 1)) gaps.push({ type: 'gap', dir: 'baissier', lo: lo2, hi: hi2, eq: (lo2 + hi2) / 2, t: cs[i].t });
      }
    }
    for (i = 2; i < cs.length; i++) {        // FVG (3 bougies)
      if (cs[i].l > cs[i - 2].h) {
        var a = cs[i - 2].h, b = cs[i].l;
        if (unfilled(a, b, i + 1)) gaps.push({ type: 'fvg', dir: 'haussier', lo: a, hi: b, eq: (a + b) / 2, t: cs[i].t });
      } else if (cs[i].h < cs[i - 2].l) {
        var c = cs[i].h, d = cs[i - 2].l;
        if (unfilled(c, d, i + 1)) gaps.push({ type: 'fvg', dir: 'baissier', lo: c, hi: d, eq: (c + d) / 2, t: cs[i].t });
      }
    }
    return gaps.sort(function (x, y) { return y.t - x.t; }).slice(0, 8); // les plus récents
  }

  // --- DIVERGENCE SMT : NQ vs ES (filtre éliminatoire du MECH) ---------------
  // Principe : deux actifs corrélés doivent faire le même extrême. Si l'un fait
  // un nouveau plus-haut et PAS l'autre, le mouvement manque de conviction.
  function smt(nq, es, n) {
    n = n || 20;
    if (!nq || !es || nq.length < 2 * n || es.length < 2 * n) return null;
    function mx(a, s, e) { return Math.max.apply(null, a.slice(s, e).map(function (x) { return x.h; })); }
    function mn(a, s, e) { return Math.min.apply(null, a.slice(s, e).map(function (x) { return x.l; })); }
    var nHiR = mx(nq, nq.length - n), nHiP = mx(nq, nq.length - 2 * n, nq.length - n);
    var eHiR = mx(es, es.length - n), eHiP = mx(es, es.length - 2 * n, es.length - n);
    var nLoR = mn(nq, nq.length - n), nLoP = mn(nq, nq.length - 2 * n, nq.length - n);
    var eLoR = mn(es, es.length - n), eLoP = mn(es, es.length - 2 * n, es.length - n);
    var nqHH = nHiR > nHiP, esHH = eHiR > eHiP;
    var nqLL = nLoR < nLoP, esLL = eLoR < eLoP;
    if (nqHH !== esHH) {
      return { type: 'baissière', detail: nqHH ? 'NQ fait un nouveau plus-haut mais le S&P (ES) NON'
        : 'ES fait un nouveau plus-haut mais le NQ NON',
        consigne: 'Divergence SMT BAISSIÈRE — n’achète PAS (le MECH interdit de trader contre la SMT).' };
    }
    if (nqLL !== esLL) {
      return { type: 'haussière', detail: nqLL ? 'NQ fait un nouveau plus-bas mais le S&P (ES) NON'
        : 'ES fait un nouveau plus-bas mais le NQ NON',
        consigne: 'Divergence SMT HAUSSIÈRE — ne vends PAS (le MECH interdit de trader contre la SMT).' };
    }
    return { type: 'aucune', detail: 'NQ et ES font les mêmes extrêmes (pas de divergence).',
      consigne: 'Pas de divergence SMT — ce filtre ne bloque aucun sens.' };
  }

  // PDH / PDL : plus-haut et plus-bas de la veille (bougie D1 précédente).
  function pdhl(daily) {
    if (!daily || daily.length < 2) return null;
    var y = daily[daily.length - 2];
    return { pdh: y.h, pdl: y.l, date: y.t };
  }

  // Charge tout ce dont le MECH a besoin.
  function load() {
    return Promise.all([
      candles(SYM.nq, '1d', '3mo'),    // contexte + PDH/PDL
      candles(SYM.nq, '15m', '5d'),    // exécution / gaps (M15)
      candles(SYM.es, '15m', '5d')     // S&P 500, uniquement pour la SMT
    ]).then(function (r) {
      var nqD = r[0], nq15 = r[1], es15 = r[2];
      if (!nqD || !nq15) return null;
      var gaps = findGaps(nq15.candles);
      var div = es15 ? smt(nq15.candles, es15.candles, 20) : null;
      var lv = pdhl(nqD.candles);
      return {
        nq: { prix: nqD.price, variation_pct: nqD.chg != null ? +nqD.chg.toFixed(2) : null, bougies_m15: nq15.candles.length },
        es: es15 ? { prix: es15.price } : null,
        pdh: lv ? +lv.pdh.toFixed(2) : null,
        pdl: lv ? +lv.pdl.toFixed(2) : null,
        gaps_non_comblés: gaps.map(function (g) {
          return { type: g.type === 'fvg' ? 'FVG' : 'gap de session', sens: g.dir,
            zone: [+g.lo.toFixed(2), +g.hi.toFixed(2)], eq_cible: +g.eq.toFixed(2) };
        }),
        smt: div,
        maj: Date.now()
      };
    }).catch(function () { return null; });
  }

  // Bloc texte injecté dans le prompt du Bot IA.
  function promptBlock(d) {
    if (!d) return "DONNÉES NQ indisponibles pour le moment (flux non joignable).";
    var t = "=== DONNÉES NASDAQ (NQ) POUR LE MECH MODEL ===\n";
    t += "NQ : " + d.nq.prix + (d.nq.variation_pct != null ? ' (' + (d.nq.variation_pct >= 0 ? '+' : '') + d.nq.variation_pct + '%)' : '') + "\n";
    t += "PDH (plus-haut veille) : " + d.pdh + " · PDL (plus-bas veille) : " + d.pdl + "\n";
    if (d.gaps_non_comblés.length) {
      t += "GAPS NON COMBLÉS sur NQ (M15) — ce sont TES CIBLES (vise l'EQ) :\n";
      d.gaps_non_comblés.forEach(function (g) {
        t += "  • " + g.type + " " + g.sens + " : zone " + g.zone[0] + "–" + g.zone[1] + " · EQ (cible) = " + g.eq_cible + "\n";
      });
    } else { t += "Aucun gap non comblé détecté en M15 — sans cible de gap, le MECH ne donne pas de trade.\n"; }
    if (d.smt) {
      t += "SMT (NQ vs S&P 500 / ES) : " + d.smt.type + " — " + d.smt.detail + "\n";
      t += "  ⚠️ " + d.smt.consigne + "\n";
    }
    t += "RAPPEL : tu ne trades QUE le NQ avec le MECH Model, et la SMT se lit contre le S&P 500 (ES).\n";
    return t;
  }

  root.NQ = { load: load, promptBlock: promptBlock, candles: candles, findGaps: findGaps, smt: smt };
})(typeof window !== 'undefined' ? window : this);
