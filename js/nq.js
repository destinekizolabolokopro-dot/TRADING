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

  // Plusieurs relais : un proxy public gratuit tombe régulièrement (j'ai eu des
  // erreurs 520/522 en le testant). On essaie les suivants avant d'abandonner.
  var PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?url=',
    'https://api.codetabs.com/v1/proxy/?quest='
  ];
  var YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  var SYM = { nq: 'NQ=F', es: 'ES=F' };   // Nasdaq 100 futures / S&P 500 futures

  function url(proxy, sym, interval, range) {
    return proxy + encodeURIComponent(YF + encodeURIComponent(sym) + '?interval=' + interval + '&range=' + range);
  }

  // Récupère les bougies OHLC d'un symbole, en essayant chaque relais à son tour.
  function candles(sym, interval, range) {
    if (typeof fetch === 'undefined') return Promise.resolve(null);

    function tryProxy(i) {
      if (i >= PROXIES.length) return Promise.resolve(null);
      return fetchOne(url(PROXIES[i], sym, interval, range))
        .then(function (r) { return r || tryProxy(i + 1); })
        .catch(function () { return tryProxy(i + 1); });
    }
    return tryProxy(0);
  }

  function fetchOne(u) {
    return fetch(u)
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
  function findGaps(cs, fenetre) {
    // On ne remonte que les `fenetre` dernières bougies : au-delà, un gap
    // n'est plus une cible réaliste, et la recherche coûte cher (O(n²)).
    if (fenetre && cs.length > fenetre) cs = cs.slice(cs.length - fenetre);
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

  // ===========================================================================
  // STRUCTURE DU MECH : SWEEP → SÉQUENCE → INVERSION
  // ---------------------------------------------------------------------------
  // C'est le DÉCLENCHEUR du modèle. Avant, le site ne le calculait pas : il
  // donnait les cibles (gaps) et les filtres (SMT) mais laissait le bot DEVINER
  // la structure. Maintenant elle est calculée sur les vraies bougies, comme
  // dans le script Pine — donc vérifiable, et non-repeinte.
  //
  // ⚠️ HONNÊTETÉ : « inversion » n'a pas de définition universelle. Celle codée
  // ici est le CISD (clôture au-delà des opens opposés) + displacement. C'est UN
  // choix, indiqué tel quel dans les sorties — pas « la » définition officielle.
  // ===========================================================================

  // Heure de New York d'un timestamp (les sessions du MECH sont définies en ET).
  var _etFmt = null;
  function etParts(ts) {
    if (!_etFmt) _etFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    var o = {};
    _etFmt.formatToParts(new Date(ts)).forEach(function (p) { o[p.type] = p.value; });
    var h = parseInt(o.hour, 10); if (h === 24) h = 0;
    return { jour: o.year + '-' + o.month + '-' + o.day, min: h * 60 + parseInt(o.minute, 10) };
  }

  // Extrêmes des sessions ASIE et LONDRES sur les dernières 48 h : ce sont des
  // POOLS DE LIQUIDITÉ, donc des niveaux susceptibles d'être balayés.
  function sessionPools(cs) {
    var cut = cs.length ? cs[cs.length - 1].t - 48 * 3600 * 1000 : 0;
    var asia = { h: null, l: null }, lon = { h: null, l: null };
    cs.forEach(function (c) {
      if (c.t < cut) return;
      var e = etParts(c.t);
      // Asie : 20 h 00 → minuit (ET). Londres : 03 h 00 → 06 h 00 (ET).
      var inAsia = e.min >= 20 * 60;
      var inLon = e.min >= 3 * 60 && e.min < 6 * 60;
      if (inAsia) {
        asia.h = asia.h == null ? c.h : Math.max(asia.h, c.h);
        asia.l = asia.l == null ? c.l : Math.min(asia.l, c.l);
      }
      if (inLon) {
        lon.h = lon.h == null ? c.h : Math.max(lon.h, c.h);
        lon.l = lon.l == null ? c.l : Math.min(lon.l, c.l);
      }
    });
    return { asia: asia, londres: lon };
  }

  // Swings CONFIRMÉS : un pivot n'existe qu'après `len` bougies de chaque côté.
  // Il ne peut donc jamais apparaître puis disparaître (anti-repeint).
  function swings(cs, len) {
    len = len || 5;
    var hi = [], lo = [], i, k, ok;
    for (i = len; i < cs.length - len; i++) {
      ok = true;
      for (k = i - len; k <= i + len; k++) { if (k !== i && cs[k].h >= cs[i].h) { ok = false; break; } }
      if (ok) hi.push({ prix: cs[i].h, i: i, t: cs[i].t });
      ok = true;
      for (k = i - len; k <= i + len; k++) { if (k !== i && cs[k].l <= cs[i].l) { ok = false; break; } }
      if (ok) lo.push({ prix: cs[i].l, i: i, t: cs[i].t });
    }
    return { hauts: hi, bas: lo };
  }

  function atr(cs, n) {
    n = n || 14;
    if (cs.length < n + 1) return null;
    var sum = 0;
    for (var i = cs.length - n; i < cs.length; i++) {
      var pc = cs[i - 1].c;
      sum += Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - pc), Math.abs(cs[i].l - pc));
    }
    return sum / n;
  }

  // INVERSION (définition CISD + displacement) cherchée APRÈS la bougie du sweep.
  function inversion(cs, from, haussiere, look, a) {
    look = look || 5;
    for (var i = Math.max(from + 1, look); i < cs.length; i++) {
      var corps = Math.abs(cs[i].c - cs[i].o);
      var disp = a ? corps > a : true;          // mouvement franc, pas une bougie molle
      var ext = cs[i - 1].o;
      for (var k = i - look; k < i; k++) {
        if (k < 0) continue;
        ext = haussiere ? Math.max(ext, cs[k].o) : Math.min(ext, cs[k].o);
      }
      var ok = haussiere ? (cs[i].c > ext && cs[i].c > cs[i].o)
                         : (cs[i].c < ext && cs[i].c < cs[i].o);
      if (ok && disp) return { i: i, t: cs[i].t, prix: cs[i].c, definition: 'CISD + displacement' };
    }
    return null;
  }

  // La séquence complète du MECH.
  //   LONG  : swing low → swing high → LOWER LOW qui balaye une liquidité → inversion haussière
  //   SHORT : swing high → swing low → HIGHER HIGH qui balaye une liquidité → inversion baissière
  function structure(cs, niveaux, opts) {
    opts = opts || {};
    var len = opts.pivots || 5;
    var expire = opts.expire || 30;      // le setup meurt s'il n'y a pas d'inversion
    var sw = swings(cs, len);
    var a = atr(cs, 14);
    var out = {
      sens: null, valide: false, sweep: null, inversion: null,
      definition_inversion: 'CISD (clôture au-delà des opens opposés) + corps > ATR(14)',
      detail: ''
    };
    if (sw.bas.length < 2 || sw.hauts.length < 2) {
      out.detail = 'Pas assez de swings confirmés sur les bougies disponibles.';
      return out;
    }

    // Quels niveaux comptent comme liquidité ?
    function pools(bas) {
      var p = [];
      function add(v, nom) { if (v != null) p.push({ prix: v, quoi: nom }); }
      if (bas) {
        add(niveaux.pdl, 'PDL (plus-bas de la veille)');
        add(niveaux.asiaL, "plus-bas de la session ASIE");
        add(niveaux.lonL, 'plus-bas de la session LONDRES');
        add(sw.bas.length >= 2 ? sw.bas[sw.bas.length - 2].prix : null, 'swing low précédent');
      } else {
        add(niveaux.pdh, 'PDH (plus-haut de la veille)');
        add(niveaux.asiaH, "plus-haut de la session ASIE");
        add(niveaux.lonH, 'plus-haut de la session LONDRES');
        add(sw.hauts.length >= 2 ? sw.hauts[sw.hauts.length - 2].prix : null, 'swing high précédent');
      }
      return p;
    }

    var fin = cs.length - 1;

    // On ne regarde pas QUE le dernier swing : un setup armé il y a 20 bougies
    // est encore vivant tant qu'il n'a pas expiré. On remonte donc les swings
    // récents et on garde le plus récent qui coche la séquence complète.
    function chercher(bas) {
      var liste = bas ? sw.bas : sw.hauts;
      var autre = bas ? sw.hauts : sw.bas;
      var p = pools(bas);
      for (var n = liste.length - 1; n >= 1; n--) {
        var cur = liste[n], prec = liste[n - 1];
        if (fin - cur.i > expire) break;                       // trop vieux : setup mort
        var casse = bas ? (cur.prix < prec.prix) : (cur.prix > prec.prix);
        if (!casse) continue;                                   // pas un lower low / higher high
        var entre = autre.filter(function (x) { return x.i > prec.i && x.i < cur.i; }).length > 0;
        if (!entre) continue;                                   // séquence incomplète
        var pris = null;
        p.forEach(function (x) {
          var touche = bas ? (cur.prix <= x.prix) : (cur.prix >= x.prix);
          if (!touche) return;
          if (!pris) { pris = x; return; }
          // le pool le plus "proche" du prix balayé est le plus significatif
          if (bas ? x.prix > pris.prix : x.prix < pris.prix) pris = x;
        });
        if (pris) return { swing: cur, pool: pris };
      }
      return null;
    }

    var L = chercher(true), S = chercher(false);
    var choix = null, sens = null;
    if (L && S) { choix = L.swing.i >= S.swing.i ? L : S; sens = (choix === L) ? 'LONG' : 'SHORT'; }
    else if (L) { choix = L; sens = 'LONG'; }
    else if (S) { choix = S; sens = 'SHORT'; }

    if (choix) {
      var haussier = sens === 'LONG';
      out.sens = sens;
      out.sweep = { niveau: +choix.pool.prix.toFixed(2), quoi: choix.pool.quoi,
                    prix_atteint: +choix.swing.prix.toFixed(2), t: choix.swing.t,
                    bougies_depuis: fin - choix.swing.i };
      var inv = inversion(cs, choix.swing.i, haussier, 5, a);
      if (inv && inv.i - choix.swing.i <= expire) {
        out.inversion = inv;
        out.valide = true;
        out.detail = 'Séquence ' + sens + ' complète : balayage du ' + choix.pool.quoi + ' à ' +
          choix.pool.prix.toFixed(2) + ' (prix descendu/monté à ' + choix.swing.prix.toFixed(2) +
          '), puis inversion ' + (haussier ? 'haussière' : 'baissière') + ' confirmée à ' + inv.prix.toFixed(2) + '.';
      } else {
        out.detail = 'Balayage du ' + choix.pool.quoi + ' à ' + choix.pool.prix.toFixed(2) +
          ' constaté il y a ' + (fin - choix.swing.i) + ' bougies, mais AUCUNE inversion ' +
          (haussier ? 'haussière' : 'baissière') + ' confirmée depuis. On attend — on n\'entre jamais sur le balayage lui-même.';
      }
      return out;
    }

    out.detail = 'Aucun balayage de liquidité suivi d\'une structure valide sur les bougies récentes.';
    return out;
  }

  // PDH / PDL : plus-haut et plus-bas de la veille (bougie D1 précédente).
  function pdhl(daily) {
    if (!daily || daily.length < 2) return null;
    var y = daily[daily.length - 2];
    return { pdh: y.h, pdl: y.l, date: y.t };
  }

  // ===========================================================================
  // LE TRADE : entrée, stop, objectif, RR — déduits des règles du MECH.
  // ---------------------------------------------------------------------------
  //   ENTRÉE   : le prix de l'inversion (le modèle n'entre PAS sur le balayage).
  //   STOP     : au-delà de l'extrême balayé, plus un petit tampon.
  //   OBJECTIF : l'EQ du gap non comblé le plus proche dans le sens du trade.
  //   RR       : rapport des deux. Sous 1, on ne prend pas.
  // ===========================================================================
  var BUFFER_PCT = 0.02;      // tampon du stop, en % du prix
  var RR_MIN = 1.0;

  function trade(d) {
    if (!d || !d.structure || !d.structure.valide) return null;
    var st = d.structure;
    var long = st.sens === 'LONG';
    var entree = st.inversion ? st.inversion.prix : d.nq.prix;
    if (entree == null) return null;

    var buf = entree * BUFFER_PCT / 100;
    var sl = long ? st.sweep.prix_atteint - buf : st.sweep.prix_atteint + buf;

    // Objectif : l'EQ non comblé le plus proche AU-DELÀ de l'entrée.
    var tp = null, cible = null;
    (d.gaps_non_comblés || []).forEach(function (g) {
      var eq = g.eq_cible;
      if (long ? eq <= entree : eq >= entree) return;
      if (tp == null || (long ? eq < tp : eq > tp)) { tp = eq; cible = g; }
    });
    if (tp == null) {
      return { possible: false, sens: st.sens, entree: +entree.toFixed(2), sl: +sl.toFixed(2),
        raison: "Aucun gap non comblé au-delà de l'entrée : le modèle n'a pas d'objectif, donc pas de trade." };
    }

    var risque = Math.abs(entree - sl);
    if (!(risque > 0)) return { possible: false, sens: st.sens, raison: 'Stop confondu avec l\'entrée.' };
    var rr = Math.abs(tp - entree) / risque;

    // Un stop plus serré que la moitié de l'ATR de l'unité n'est pas un stop :
    // il sera touché par le bruit normal, et il gonfle artificiellement le RR.
    if (d.atr && risque < d.atr * 0.5) {
      return { possible: false, sens: st.sens, entree: +entree.toFixed(2), sl: +sl.toFixed(2),
        tp: +tp.toFixed(2), rr: +rr.toFixed(2),
        raison: 'Stop trop serré (' + risque.toFixed(2) + ' pts pour un ATR de ' + d.atr.toFixed(2) +
          ') : il serait balayé par le bruit, et le RR de ' + rr.toFixed(2) + ' est un mirage.' };
    }

    return {
      possible: rr >= RR_MIN,
      sens: st.sens,
      entree: +entree.toFixed(2),
      sl: +sl.toFixed(2),
      tp: +tp.toFixed(2),
      rr: +rr.toFixed(2),
      risque_points: +risque.toFixed(2),
      gain_points: +Math.abs(tp - entree).toFixed(2),
      cible: cible ? (cible.type + ' ' + cible.sens + ' — zone ' + cible.zone[0] + '–' + cible.zone[1]) : null,
      raison: rr >= RR_MIN
        ? ('Entrée sur l\'inversion à ' + entree.toFixed(2) + ', stop au-delà du balayage (' +
           st.sweep.prix_atteint.toFixed(2) + '), objectif l\'EQ du gap non comblé le plus proche (' + tp.toFixed(2) + ').')
        : ('RR de ' + rr.toFixed(2) + ' : sous le minimum de ' + RR_MIN + ', le modèle passe son tour.'),
      motif: 'MECH — balayage ' + st.sweep.quoi + ' à ' + st.sweep.niveau +
             ', inversion ' + (st.inversion ? st.inversion.definition : '—') +
             ' à ' + (st.inversion ? st.inversion.prix : '—') + ', cible EQ ' + tp.toFixed(2) + '.'
    };
  }

  // ===========================================================================
  // BALAYAGE DE TOUTES LES TIMEFRAMES
  // ---------------------------------------------------------------------------
  // Le MECH ne vit pas sur une seule unité : la cible se lit en M5/M15, mais
  // l'inversion peut se confirmer en M1. On analyse donc CHAQUE unité de la
  // même façon, et on remonte celle qui donne le meilleur trade.
  //
  // M1 est plafonné à 2 jours : Yahoo n'autorise que 8 jours de M1 par requête,
  // et au-delà de quelques centaines de bougies un gap n'est plus une cible.
  // ===========================================================================
  var TFS = [
    { id: 'M1',  iv: '1m',  range: '2d', fenetre: 400, pivots: 5, expire: 60 },
    { id: 'M5',  iv: '5m',  range: '5d', fenetre: 400, pivots: 5, expire: 40 },
    { id: 'M15', iv: '15m', range: '5d', fenetre: 400, pivots: 5, expire: 30 },
    { id: 'M30', iv: '30m', range: '1mo', fenetre: 300, pivots: 5, expire: 24 },
    { id: 'H1',  iv: '60m', range: '3mo', fenetre: 300, pivots: 5, expire: 20 }
  ];

  function analyseTF(tf, nqC, esC, niveaux, prix) {
    if (!nqC || nqC.length < 60) return { tf: tf.id, dispo: false, detail: 'Pas assez de bougies.' };
    var gaps = findGaps(nqC, tf.fenetre);
    var pools = sessionPools(nqC);
    var lv = {
      pdh: niveaux.pdh, pdl: niveaux.pdl,
      asiaH: pools.asia.h, asiaL: pools.asia.l,
      lonH: pools.londres.h, lonL: pools.londres.l
    };
    var struct = structure(nqC, lv, { pivots: tf.pivots, expire: tf.expire });
    var div = esC ? smt(nqC, esC, 20) : null;
    var vue = {
      tf: tf.id, dispo: true, bougies: nqC.length,
      sessions: pools,
      gaps_non_comblés: gaps.map(function (g) {
        return { type: g.type === 'fvg' ? 'FVG' : 'gap de session', sens: g.dir,
          zone: [+g.lo.toFixed(2), +g.hi.toFixed(2)], eq_cible: +g.eq.toFixed(2) };
      }),
      smt: div, structure: struct, nq: { prix: prix }, atr: atr(nqC, 14)
    };
    vue.trade = trade(vue);
    // La SMT est un filtre ÉLIMINATOIRE : un trade contre elle n'existe pas.
    if (vue.trade && vue.trade.possible && div && div.type !== 'aucune') {
      var contre = (div.type === 'baissière' && vue.trade.sens === 'LONG') ||
                   (div.type === 'haussière' && vue.trade.sens === 'SHORT');
      if (contre) {
        vue.trade.possible = false;
        vue.trade.raison = 'Refusé par la SMT ' + div.type + ' : ' + div.consigne;
      }
    }
    return vue;
  }

  // Parmi toutes les unités, laquelle retenir ?
  // PAS celle qui affiche le plus gros RR : un RR énorme vient presque toujours
  // d'un stop trop serré, donc d'un trade qui saute. Le MECH vise 1:1 à 1:1,5
  // avec un TAUX DE RÉUSSITE élevé. On prend donc l'unité la PLUS BASSE qui
  // valide — c'est là que l'entrée est la plus précise, et la spec dit que
  // l'inversion M1 suffit.
  function meilleur(vues) {
    var ordre = TFS.map(function (t) { return t.id; });
    var ok = vues.filter(function (v) { return v.dispo && v.trade && v.trade.possible; });
    if (!ok.length) return null;
    ok.sort(function (a, b) { return ordre.indexOf(a.tf) - ordre.indexOf(b.tf); });
    return ok[0];
  }

  // Dernier instantané chargé : le prompt du Bot IA peut le relire sans
  // refaire d'appel réseau (même principe que le calendrier économique).
  var CACHE = null, CACHE_T = 0;
  var TTL = 5 * 60 * 1000;   // 5 minutes : le MECH travaille en M5/M15

  function data() { return CACHE; }

  // Charge tout ce dont le MECH a besoin.
  function load(force) {
    if (!force && CACHE && (Date.now() - CACHE_T) < TTL) return Promise.resolve(CACHE);
    return loadFresh();
  }

  function loadFresh() {
    var req = [candles(SYM.nq, '1d', '3mo')];          // contexte + PDH/PDL
    TFS.forEach(function (tf) { req.push(candles(SYM.nq, tf.iv, tf.range)); });
    TFS.forEach(function (tf) { req.push(candles(SYM.es, tf.iv, tf.range)); });

    return Promise.all(req).then(function (r) {
      var nqD = r[0];
      if (!nqD) return null;
      var lv = pdhl(nqD.candles);
      var niveaux = { pdh: lv ? lv.pdh : null, pdl: lv ? lv.pdl : null };
      var prix = nqD.price;

      var vues = TFS.map(function (tf, i) {
        var nqC = r[1 + i], esC = r[1 + TFS.length + i];
        return analyseTF(tf, nqC && nqC.candles, esC && esC.candles, niveaux, prix);
      });
      if (!vues.some(function (v) { return v.dispo; })) return null;

      var best = meilleur(vues);
      // La vue par défaut (affichage principal) : celle qui donne un trade, sinon M15.
      var base = best || vues.filter(function (v) { return v.dispo && v.tf === 'M15'; })[0]
                      || vues.filter(function (v) { return v.dispo; })[0];
      var esPrix = null;
      for (var k = 0; k < TFS.length; k++) { if (r[1 + TFS.length + k]) { esPrix = r[1 + TFS.length + k].price; break; } }

      var out = {
        nq: { prix: prix, variation_pct: nqD.chg != null ? +nqD.chg.toFixed(2) : null },
        es: esPrix != null ? { prix: esPrix } : null,
        pdh: lv ? +lv.pdh.toFixed(2) : null,
        pdl: lv ? +lv.pdl.toFixed(2) : null,
        timeframes: vues,
        tf_retenue: base ? base.tf : null,
        // Raccourcis vers la vue retenue, pour tout le code existant.
        gaps_non_comblés: base ? base.gaps_non_comblés : [],
        smt: base ? base.smt : null,
        sessions: base ? base.sessions : null,
        structure: base ? base.structure : null,
        trade: base ? base.trade : null,
        maj: Date.now()
      };
      CACHE = out;
      CACHE_T = Date.now();
      return out;
    }).catch(function () { return null; });
  }

  // Bloc texte injecté dans le prompt du Bot IA.
  function promptBlock(d) {
    if (d === undefined) d = CACHE;
    if (!d) return "=== DONNÉES NASDAQ (NQ) ===\nFlux NQ/ES injoignable pour le moment : tu n'as NI les gaps non comblés, NI le PDH/PDL, NI la SMT. "
      + "Sans ces données le MECH Model ne peut PAS être validé — renvoie \"idees\": [] et explique-le dans \"marche\".";
    var t = "=== DONNÉES NASDAQ (NQ) POUR LE MECH MODEL ===\n";
    t += "NQ : " + d.nq.prix + (d.nq.variation_pct != null ? ' (' + (d.nq.variation_pct >= 0 ? '+' : '') + d.nq.variation_pct + '%)' : '') + "\n";
    t += "PDH (plus-haut veille) : " + d.pdh + " · PDL (plus-bas veille) : " + d.pdl + "\n";
    if (d.timeframes && d.timeframes.length) {
      t += "BALAYAGE DE TOUTES LES UNITÉS DE TEMPS (chaque ligne est calculée, pas estimée) :\n";
      d.timeframes.forEach(function (v) {
        if (!v.dispo) { t += "  " + v.tf + " : indisponible\n"; return; }
        var st = v.structure.valide ? ('structure VALIDE ' + v.structure.sens) : 'structure non valide';
        var tr = v.trade ? (v.trade.possible
              ? ('TRADE ' + v.trade.sens + ' · entrée ' + v.trade.entree + ' · stop ' + v.trade.sl +
                 ' · objectif ' + v.trade.tp + ' · RR ' + v.trade.rr)
              : ('pas de trade — ' + v.trade.raison)) : 'pas de trade';
        t += "  " + v.tf + " : " + st + " · " + v.gaps_non_comblés.length + " gap(s) non comblé(s) · SMT " +
             (v.smt ? v.smt.type : '—') + " · " + tr + "\n";
      });
      t += "UNITÉ RETENUE : " + (d.tf_retenue || '—') +
           " — on garde la plus BASSE qui valide (entrée la plus précise), pas celle qui affiche le plus gros RR : " +
           "un RR énorme vient presque toujours d'un stop trop serré.\n";
    }
    if (d.sessions) {
      var p = d.sessions;
      t += "Pools de liquidité récents — ASIE : haut " + (p.asia.h != null ? p.asia.h.toFixed(2) : '—') +
        " / bas " + (p.asia.l != null ? p.asia.l.toFixed(2) : '—') +
        " · LONDRES : haut " + (p.londres.h != null ? p.londres.h.toFixed(2) : '—') +
        " / bas " + (p.londres.l != null ? p.londres.l.toFixed(2) : '—') + "\n";
    }
    if (d.structure) {
      var st = d.structure;
      t += "STRUCTURE (calculée sur les bougies M15, pas estimée) :\n";
      t += "  Séquence : " + (st.valide ? "✅ VALIDE — sens " + st.sens : "❌ NON valide") + "\n";
      if (st.sweep) {
        t += "  Balayage : " + st.sweep.quoi + " à " + st.sweep.niveau +
          " (le prix est allé jusqu'à " + st.sweep.prix_atteint + ")\n";
      } else { t += "  Balayage : aucun balayage de liquidité identifié.\n"; }
      t += "  Inversion : " + (st.inversion ? "confirmée à " + st.inversion.prix + " (" + st.inversion.definition + ")"
                                            : "PAS encore confirmée") + "\n";
      t += "  Lecture : " + st.detail + "\n";
      t += "  ⚠️ La définition d'inversion utilisée ici est : " + st.definition_inversion +
        ". Il n'existe pas de définition universelle — ne présente pas celle-ci comme officielle.\n";
      if (!st.valide) {
        t += "  ⛔ Sans séquence valide (balayage + structure + inversion), le MECH INTERDIT le trade : renvoie \"idees\": [].\n";
      }
    }
    if (d.gaps_non_comblés.length) {
      t += "GAPS NON COMBLÉS sur NQ (M15) — ce sont TES CIBLES (vise l'EQ) :\n";
      d.gaps_non_comblés.forEach(function (g) {
        t += "  • " + g.type + " " + g.sens + " : zone " + g.zone[0] + "–" + g.zone[1] + " · EQ (cible) = " + g.eq_cible + "\n";
      });
    } else { t += "Aucun gap non comblé détecté en M15 — sans cible de gap, le MECH ne donne pas de trade.\n"; }
    if (d.trade) {
      var tr = d.trade;
      if (tr.possible) {
        t += "TRADE CALCULÉ PAR LES RÈGLES (entrée/stop/objectif déjà déduits — reprends CES chiffres) :\n";
        t += "  " + tr.sens + " · entrée " + tr.entree + " · stop " + tr.sl + " · objectif " + tr.tp + " · RR " + tr.rr + "\n";
        t += "  " + tr.raison + "\n";
      } else {
        t += "TRADE : impossible — " + tr.raison + "\n";
      }
    }
    if (d.smt) {
      t += "SMT (NQ vs S&P 500 / ES) : " + d.smt.type + " — " + d.smt.detail + "\n";
      t += "  ⚠️ " + d.smt.consigne + "\n";
    }
    t += "RAPPEL : tu ne trades QUE le NQ avec le MECH Model, et la SMT se lit contre le S&P 500 (ES).\n";
    return t;
  }

  root.NQ = { load: load, data: data, promptBlock: promptBlock, candles: candles,
    findGaps: findGaps, smt: smt, swings: swings, structure: structure,
    sessionPools: sessionPools, trade: trade, TFS: TFS, analyseTF: analyseTF };
})(typeof window !== 'undefined' ? window : this);
