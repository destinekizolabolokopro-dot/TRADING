/*
 * Stratégies "Trader Pro" — méthodes SYSTÉMATIQUES réellement utilisées par les fonds,
 * calculées sur les vraies bougies journalières (Binance, sans clé). Contrairement à
 * l'ICT/SMC (lecture de structure), ce sont des règles quantitatives simples et éprouvées :
 *   1. Suivi de tendance (CTA / trend following)      — EMA 50/200 + repli
 *   2. Cassure Donchian (Turtle Traders)              — plus haut/bas des 20 bougies
 *   3. Retour à la moyenne (mean reversion / RSI)     — extrême + retour vers la moyenne
 *   4. Momentum relatif (factor momentum, cross-asset)— on privilégie ce qui va le plus fort
 * Chaque signal a entrée / SL / TP / RR (RR plafonné à 6, jamais sous 1).
 */
(function (root) {
  'use strict';

  var HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com'];
  var ASSETS = [
    { sym: 'BTC/USD', src: 'BTCUSDT', cls: 'crypto' },
    { sym: 'ETH/USD', src: 'ETHUSDT', cls: 'crypto' },
    { sym: 'SOL/USD', src: 'SOLUSDT', cls: 'crypto' },
    { sym: 'XRP/USD', src: 'XRPUSDT', cls: 'crypto' },
    { sym: 'BNB/USD', src: 'BNBUSDT', cls: 'crypto' },
    { sym: 'EUR/USD', src: 'EURUSDT', cls: 'forex' },
    { sym: 'XAU/USD', src: 'PAXGUSDT', cls: 'forex' }
  ];

  // ---- Indicateurs -----------------------------------------------------------
  function ema(v, p) { var k = 2 / (p + 1), e = v[0], out = [e]; for (var i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); out.push(e); } return out; }
  function sma(v, p) { var out = [], s = 0; for (var i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; out.push(i >= p - 1 ? s / p : null); } return out; }
  function stdev(cl, p) { var n = cl.length, r = [], i; for (i = Math.max(1, n - p); i < n; i++) r.push((cl[i] - cl[i - 1]) / cl[i - 1]); if (!r.length) return 0; var m = r.reduce(function (a, b) { return a + b; }, 0) / r.length; return Math.sqrt(r.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / r.length); }
  function rsi(cl, p) {
    var out = []; var i; for (i = 0; i < p; i++) out.push(null);
    if (cl.length <= p) return out;
    var g = 0, l = 0;
    for (i = 1; i <= p; i++) { var d = cl[i] - cl[i - 1]; if (d >= 0) g += d; else l -= d; }
    var ag = g / p, al = l / p;
    out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (i = p + 1; i < cl.length; i++) {
      var dd = cl[i] - cl[i - 1], gg = dd > 0 ? dd : 0, ll = dd < 0 ? -dd : 0;
      ag = (ag * (p - 1) + gg) / p; al = (al * (p - 1) + ll) / p;
      out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return out;
  }
  function atr(c, p) { // renvoie la dernière valeur (Wilder)
    if (c.length <= p) return null;
    var trs = [], i;
    for (i = 1; i < c.length; i++) { var h = c[i].h, lo = c[i].l, pc = c[i - 1].c; trs.push(Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc))); }
    var a = 0; for (i = 0; i < p; i++) a += trs[i]; a /= p;
    for (i = p; i < trs.length; i++) a = (a * (p - 1) + trs[i]) / p;
    return a;
  }
  function roc(cl, p) { var n = cl.length; if (n <= p || !cl[n - 1 - p]) return 0; return (cl[n - 1] - cl[n - 1 - p]) / cl[n - 1 - p] * 100; }
  function donchian(c, p) { var s = c.slice(c.length - 1 - p, c.length - 1); var hi = -Infinity, lo = Infinity; s.forEach(function (x) { if (x.h > hi) hi = x.h; if (x.l < lo) lo = x.l; }); return { hi: hi, lo: lo }; }

  // Construit un signal cohérent (RR ≥ 1, plafonné à 6) ou null.
  function mk(dir, entry, sl, tp) {
    var risk = Math.abs(entry - sl), rew = Math.abs(tp - entry);
    if (risk <= 0) return null;
    var ok = dir === 'LONG' ? (sl < entry && tp > entry) : (sl > entry && tp < entry);
    if (!ok) return null;
    var rr = rew / risk;
    if (rr < 1) return null;
    if (rr > 6) { rew = risk * 6; tp = dir === 'LONG' ? entry + rew : entry - rew; rr = 6; }
    return { dir: dir, entry: +entry, sl: +sl, tp: +tp, rr: +rr.toFixed(1) };
  }

  // ---- Stratégies (sur bougies D1) ------------------------------------------
  // 1. Suivi de tendance : EMA50 vs EMA200 = sens ; on entre sur un repli vers l'EMA50.
  function trendFollow(c) {
    var cl = c.map(function (x) { return x.c; }), n = cl.length;
    if (n < 210) return { dir: 'WAIT', note: 'Pas assez d\'historique.' };
    var e50 = ema(cl, 50), e200 = ema(cl, 200), a = atr(c, 14), price = cl[n - 1];
    var up = e50[n - 1] > e200[n - 1], dir = up ? 'LONG' : 'SHORT';
    if (Math.abs(price - e50[n - 1]) > 1.6 * a)
      return { dir: 'WAIT', note: 'Tendance ' + (up ? 'haussière' : 'baissière') + ' (EMA50 ' + (up ? '>' : '<') + ' EMA200), mais pas de repli — on attend un retour vers l\'EMA50.' };
    var s = mk(dir, price, up ? price - 1.5 * a : price + 1.5 * a, up ? price + 3 * a : price - 3 * a);
    if (!s) return { dir: 'WAIT', note: 'Géométrie invalide.' };
    s.note = 'Tendance ' + (up ? 'haussière' : 'baissière') + ' confirmée (EMA50/EMA200) + repli sur l\'EMA50 → on suit la tendance.';
    return s;
  }
  // 2. Cassure Donchian (Turtle Traders) : cassure du plus haut/bas des 20 bougies.
  function breakout(c) {
    var n = c.length; if (n < 25) return { dir: 'WAIT', note: 'Pas assez d\'historique.' };
    var d = donchian(c, 20), a = atr(c, 14), price = c[n - 1].c;
    if (price >= d.hi) { var L = mk('LONG', price, price - 2 * a, price + 4 * a); if (L) { L.note = 'Cassure du plus haut des 20 bougies → percée haussière (méthode des Tortues).'; return L; } }
    if (price <= d.lo) { var S = mk('SHORT', price, price + 2 * a, price - 4 * a); if (S) { S.note = 'Cassure du plus bas des 20 bougies → percée baissière (méthode des Tortues).'; return S; } }
    return { dir: 'WAIT', note: 'Prix dans le canal des 20 bougies — pas de cassure.' };
  }
  // 3. Retour à la moyenne : RSI extrême + prix éloigné de sa moyenne (EMA20) → retour visé.
  function meanRevert(c) {
    var cl = c.map(function (x) { return x.c; }), n = cl.length;
    if (n < 30) return { dir: 'WAIT', note: 'Pas assez d\'historique.' };
    var r = rsi(cl, 14), e20 = ema(cl, 20), a = atr(c, 14), price = cl[n - 1], rv = r[n - 1], mean = e20[n - 1];
    if (rv == null) return { dir: 'WAIT', note: 'RSI indisponible.' };
    if (rv < 30 && price < mean) { var L = mk('LONG', price, price - 1.5 * a, mean); if (L) { L.note = 'Survendu (RSI ' + Math.round(rv) + ') et sous la moyenne → pari sur le retour vers la moyenne.'; return L; } }
    if (rv > 70 && price > mean) { var S = mk('SHORT', price, price + 1.5 * a, mean); if (S) { S.note = 'Suracheté (RSI ' + Math.round(rv) + ') et au-dessus de la moyenne → pari sur le retour vers la moyenne.'; return S; } }
    return { dir: 'WAIT', note: 'RSI ' + Math.round(rv) + ' — pas d\'excès (ni survendu < 30, ni suracheté > 70).' };
  }

  // 4. Règle des 200 jours de Paul Tudor Jones : jamais acheteur sous la MA200, ni vendeur au-dessus. Vise ~5:1.
  function ptj(c) {
    var cl = c.map(function (x) { return x.c; }), n = cl.length;
    if (n < 210) return { dir: 'WAIT', note: 'Historique insuffisant (< 200 jours).' };
    var ma = sma(cl, 200), a = atr(c, 14), price = cl[n - 1], m = ma[n - 1], above = price > m, risk = 1.2 * a;
    var s = mk(above ? 'LONG' : 'SHORT', price, above ? price - risk : price + risk, above ? price + 5 * risk : price - 5 * risk);
    if (!s) return { dir: 'WAIT', note: 'Géométrie invalide.' };
    s.note = 'Prix ' + (above ? 'au-dessus' : 'en-dessous') + ' de la moyenne 200 jours → biais ' + (above ? 'acheteur' : 'vendeur') + ' (règle PTJ), objectif ambitieux ~5:1.';
    return s;
  }
  // Allocation "risk parity" (Ray Dalio) : plus de poids aux actifs les MOINS volatils (risque équilibré).
  function riskParity(rows) {
    var vols = rows.map(function (r) { return { sym: r.a.sym, vol: stdev(r.c.map(function (x) { return x.c; }), 30) || 1e-6 }; });
    var inv = vols.map(function (v) { return 1 / v.vol; }), tot = inv.reduce(function (a, b) { return a + b; }, 0) || 1;
    return vols.map(function (v, i) { return { sym: v.sym, w: +(inv[i] / tot * 100).toFixed(1) }; }).sort(function (a, b) { return b.w - a.w; });
  }

  // ---- Chargement + assemblage ----------------------------------------------
  function fetchKlines(src) {
    var path = '/api/v3/klines?symbol=' + src + '&interval=1d&limit=300';
    function tryHost(i) {
      if (i >= HOSTS.length) return Promise.reject(new Error('Binance injoignable'));
      return fetch(HOSTS[i] + path).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { return d.map(function (k) { return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }; }).slice(0, -1); })
        .catch(function () { return tryHost(i + 1); });
    }
    return tryHost(0);
  }
  var fresh = function (c) { return c && c.length && (Date.now() - c[c.length - 1].t) < 3 * 864e5; };

  function load() {
    return Promise.all(ASSETS.map(function (a) {
      return fetchKlines(a.src).then(function (c) { return { a: a, c: c }; }, function () { return { a: a, c: null }; });
    })).then(function (rows) {
      rows = rows.filter(function (r) { return fresh(r.c); });
      if (!rows.length) return null;

      // Momentum relatif (cross-asset) : classement par performance sur 30 jours.
      var mom = rows.map(function (r) { return { sym: r.a.sym, cls: r.a.cls, roc: +roc(r.c.map(function (x) { return x.c; }), 30).toFixed(1) }; })
        .sort(function (x, y) { return y.roc - x.roc; });

      function pack(fn) {
        return rows.map(function (r) {
          var s = fn(r.c) || { dir: 'WAIT', note: '—' };
          s.sym = r.a.sym; s.cls = r.a.cls; s.price = r.c[r.c.length - 1].c;
          return s;
        }).sort(function (x, y) { var a = x.dir !== 'WAIT' ? 1 : 0, b = y.dir !== 'WAIT' ? 1 : 0; return b - a; });
      }

      return {
        updated: Date.now(),
        strategies: [
          { key: 'trend', name: 'Suivi de tendance (CTA)', tag: 'trend-following',
            how: 'Ce que font les fonds CTA (Winton, Man AHL) : ils ne prédisent rien, ils SUIVENT la tendance. Tant que la moyenne 50 est au-dessus de la 200, on reste acheteur ; on entre sur un repli vers la moyenne 50. Peu de trades, gardés longtemps, on laisse courir les gains.',
            signals: pack(trendFollow) },
          { key: 'breakout', name: 'Cassure Donchian (Turtle Traders)', tag: 'breakout',
            how: 'La stratégie légendaire des « Tortues » : on achète quand le prix casse le plus haut des 20 dernières bougies (et on vend sous le plus bas). L\'idée : une vraie tendance démarre souvent par une cassure. Stop et objectif calés sur la volatilité (ATR).',
            signals: pack(breakout) },
          { key: 'revert', name: 'Retour à la moyenne (mean reversion)', tag: 'mean-reversion',
            how: 'Approche « statistical arbitrage » simplifiée : quand le prix s\'éloigne trop de sa moyenne (RSI sous 30 = survendu, ou au-dessus de 70 = suracheté), on parie sur le RETOUR vers la moyenne. Marche mieux en marché sans tendance (range).',
            signals: pack(meanRevert) },
          { key: 'momentum', name: 'Momentum relatif (factor momentum)', tag: 'quant',
            how: 'Ce que font les quants (style AQR) : classer les actifs par performance récente et privilégier les plus FORTS (le momentum a tendance à persister). En haut du classement = biais acheteur ; en bas = biais vendeur.',
            ranking: mom }
        ],
        legends: [
          { name: 'Paul Tudor Jones', who: 'Macro + technique · a anticipé le krach de 1987',
            principle: '« Personne ne devrait être acheteur sous la moyenne 200 jours, ni vendeur au-dessus. » Il coupe vite ses pertes et vise un gain/risque d\'au moins 5:1. Sa règle des 200 jours, appliquée à tes actifs :',
            signals: pack(ptj) },
          { name: 'Ray Dalio', who: 'Bridgewater · plus gros hedge fund du monde',
            principle: '« All Weather / risk parity » : la diversification est le seul repas gratuit. On équilibre le RISQUE entre actifs (plus de poids aux moins volatils) au lieu de répartir le capital à l\'aveugle. Allocation risk-parity indicative sur tes actifs :',
            alloc: riskParity(rows) },
          { name: 'Jim Simons', who: 'Renaissance / Medallion · meilleur track record de l\'histoire',
            principle: 'Pur quantitatif : des milliers de petits signaux statistiques tenus très court terme, exécutés par des maths et des machines. Le RETOUR À LA MOYENNE (stratégie plus haut) en est une brique accessible. Son fonds Medallion a fait ~66 %/an brut pendant 30 ans — mais fermé au public.' },
          { name: 'Jesse Livermore', who: '« Boy Plunger » · légende du début XXᵉ siècle',
            principle: 'Suivre la tendance, acheter sur les cassures de sommets (« points pivots »), renforcer les positions gagnantes (pyramiding) et couper vite les perdantes. C\'est l\'esprit de la CASSURE DONCHIAN plus haut. « Ce n\'est pas la réflexion qui rapporte, c\'est la patience de rester dans le trade gagnant. »' },
          { name: 'George Soros', who: '« A fait sauter la Banque d\'Angleterre » en 1992',
            principle: 'Théorie de la réflexivité : les marchés s\'auto-alimentent (les croyances des gens changent la réalité). Gros paris macro quand la conviction est forte, taille énorme, sortie immédiate si on a tort. « L\'important n\'est pas d\'avoir raison ou tort, mais combien tu gagnes quand tu as raison et combien tu perds quand tu as tort. »' },
          { name: 'Warren Buffett', who: 'Le plus grand investisseur long terme',
            principle: 'Value investing : acheter des entreprises de qualité sous leur vraie valeur, avec une marge de sécurité, et les garder des décennies. « Sois craintif quand les autres sont avides, avide quand ils sont craintifs. » ⚠️ C\'est pour les ACTIONS et le LONG terme — ça ne s\'applique pas au trading crypto/forex court terme.' }
        ]
      };
    });
  }

  root.PRO = { load: load };
})(typeof window !== 'undefined' ? window : this);
