/*
 * Couche DONNÉES EN DIRECT du dashboard (navigateur, sans clé)
 * -----------------------------------------------------------------------------
 * - Crypto (BTC/ETH/SOL/XRP/BNB) : Binance (klines D1 + H4), CORS ouvert -> VRAIS trades.
 * - Forex EUR/USD + Or (XAU/USD) : Binance (EUR/USDT, PAXG/USDT), bougies réelles -> VRAIS trades.
 * - DXY : reconstruit depuis les taux BCE (Frankfurter, formule ICE) -> boussole/contexte
 *   qui pilote le biais de tous les actifs cotés en USD (il n'est pas traçable en direct sans clé).
 * Garde-fou anti-données périmées : une paire figée (dernière bougie > 3 j) est ignorée.
 * Renvoie des cartes prêtes à afficher, même forme que les données mock.
 * En cas d'échec d'une source, la carte concernée retombe sur le mock.
 */
(function (root) {
  'use strict';

  var BINANCE = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com'];
  var clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };
  // Anti-données périmées : une paire dont la dernière bougie a plus de 3 jours est ignorée
  // (ex. certaines paires forex sont "mortes" sur Binance et resteraient figées).
  var fresh = function (c) { return c && c.length && (Date.now() - c[c.length - 1].t) < 3 * 864e5; };

  // ---- Détections ICT compactes --------------------------------------------
  function swings(c) {
    var hi = [], lo = [];
    for (var i = 2; i < c.length - 2; i++) {
      if (c[i].h > c[i - 1].h && c[i].h > c[i - 2].h && c[i].h > c[i + 1].h && c[i].h > c[i + 2].h) hi.push({ i: i, p: c[i].h });
      if (c[i].l < c[i - 1].l && c[i].l < c[i - 2].l && c[i].l < c[i + 1].l && c[i].l < c[i + 2].l) lo.push({ i: i, p: c[i].l });
    }
    return { hi: hi, lo: lo };
  }
  function structure(c, s) {
    var last = c[c.length - 1], h = s.hi, l = s.lo;
    if (!h.length || !l.length) return { bias: 'neutre', label: 'indéterminée' };
    var up = h.length >= 2 && h[h.length - 1].p > h[h.length - 2].p && l.length >= 2 && l[l.length - 1].p > l[l.length - 2].p;
    var dn = h.length >= 2 && h[h.length - 1].p < h[h.length - 2].p && l.length >= 2 && l[l.length - 1].p < l[l.length - 2].p;
    if (last.c > h[h.length - 1].p) return { bias: 'haussier', label: 'BOS haussier' };
    if (last.c < l[l.length - 1].p) return { bias: 'baissier', label: 'BOS baissier' };
    if (up) return { bias: 'haussier', label: 'structure haussière' };
    if (dn) return { bias: 'baissier', label: 'structure baissière' };
    return { bias: 'neutre', label: 'range' };
  }
  function lastFVG(c) {
    for (var i = c.length - 2; i >= 1; i--) {
      var p = c[i - 1], n = c[i + 1], last = c[c.length - 1];
      if (p.h < n.l) { if (last.c > p.h) return { type: 'haussier', bottom: p.h, top: n.l }; }
      else if (p.l > n.h) { if (last.c < p.l) return { type: 'baissier', bottom: n.h, top: p.l }; }
    }
    return null;
  }
  function rng(s) {
    var hi = s.hi[s.hi.length - 1], lo = s.lo[s.lo.length - 1];
    if (!hi || !lo) return null;
    // Sécurité : le dernier swing haut peut se trouver SOUS le dernier swing bas
    // (détections indépendantes) -> on normalise pour ne jamais avoir un range inversé.
    var top = Math.max(hi.p, lo.p), bot = Math.min(hi.p, lo.p);
    if (top <= bot) return null;
    return { hi: top, lo: bot, eq: (top + bot) / 2 };
  }
  function lastOB(c) {
    for (var i = c.length - 3; i >= 1; i--) {
      var b = c[i], down = b.c < b.o, up = b.c > b.o;
      if (down && c[i + 1].c > b.h && c[i + 2].c >= c[i + 1].c) return { type: 'haussier', bottom: b.l, top: Math.max(b.o, b.c) };
      if (up && c[i + 1].c < b.l && c[i + 2].c <= c[i + 1].c) return { type: 'baissier', bottom: Math.min(b.o, b.c), top: b.h };
    }
    return null;
  }
  function ote(c, s) {
    var hi = s.hi[s.hi.length - 1], lo = s.lo[s.lo.length - 1];
    if (!hi || !lo) return null;
    var H = hi.p, L = lo.p, span = H - L;
    if (hi.i > lo.i) return { type: 'achat', bottom: H - 0.79 * span, top: H - 0.62 * span };
    return { type: 'vente', bottom: L + 0.62 * span, top: L + 0.79 * span };
  }
  // Poches de liquidité : "equal highs" (liquidité acheteuse au-dessus) et "equal lows"
  // (liquidité vendeuse en-dessous) = niveaux où reposent des stops que le prix vient chercher.
  function liquidity(c, s) {
    var price = c[c.length - 1].c, tol = price * 0.0018;
    function cluster(pts) { // renvoie le niveau moyen d'une paire de swings quasi-égaux (récents), sinon null
      var last = pts.slice(-6), best = null;
      for (var i = 0; i < last.length; i++)
        for (var j = i + 1; j < last.length; j++)
          if (Math.abs(last[i].p - last[j].p) <= tol) best = (last[i].p + last[j].p) / 2;
      return best;
    }
    return { buy: cluster(s.hi), sell: cluster(s.lo) };
  }
  // MSS (Market Structure Shift) : cassure de la dernière structure opposée = bascule de momentum.
  function mss(c, s) {
    var h = s.hi, l = s.lo, last = c[c.length - 1].c;
    if (h.length >= 2 && l.length >= 2) {
      if (h[h.length - 1].p < h[h.length - 2].p && last > h[h.length - 1].p) return 'haussier'; // cassure haussière après plus-hauts descendants
      if (l[l.length - 1].p > l[l.length - 2].p && last < l[l.length - 1].p) return 'baissier';  // cassure baissière après plus-bas montants
    }
    return null;
  }
  function cyclePhase(c) {
    var n = c.length;
    if (n < 3) return 'Transition';
    var look = Math.min(12, n - 2), w = c.slice(n - look);
    var hi = Math.max.apply(0, w.map(function (x) { return x.h; })), lo = Math.min.apply(0, w.map(function (x) { return x.l; }));
    var price = c[n - 1].c, rangePct = (hi - lo) / price, last = c[n - 1];
    var lastBody = Math.abs(last.c - last.o), avg = w.map(function (x) { return Math.abs(x.c - x.o); }).reduce(function (a, b) { return a + b; }, 0) / w.length;
    var lastHi = null, lastLo = null, s = swings(c);
    lastHi = s.hi[s.hi.length - 1]; lastLo = s.lo[s.lo.length - 1];
    if (lastLo && last.l < lastLo.p && last.c > lastLo.p) return 'Manipulation';
    if (lastHi && last.h > lastHi.p && last.c < lastHi.p) return 'Manipulation';
    if (lastBody > 1.6 * avg) return 'Expansion';
    if (rangePct < 0.035) return 'Accumulation';
    var pos = (price - lo) / (hi - lo || 1);
    if (pos > 0.8 || pos < 0.2) return 'Distribution';
    return 'Transition';
  }

  // ---- Construction d'une carte de trade -----------------------------------
  function buildCard(name, sym, cls, htf, dtf, dxyBias, note, synthetic) {
    var ds = swings(dtf), st = structure(dtf, ds), r = rng(ds);
    var price = htf[htf.length - 1].c;
    // Variation = clôture-à-clôture des 2 dernières bougies de l'unité "daily" (dtf).
    var dl = dtf.length;
    var chg = (dl >= 2 && dtf[dl - 2].c) ? (dtf[dl - 1].c - dtf[dl - 2].c) / dtf[dl - 2].c * 100 : 0;
    var cyc = cyclePhase(htf);
    var dir = st.bias === 'haussier' ? 'LONG' : st.bias === 'baissier' ? 'SHORT' : 'WAIT';
    var f = lastFVG(htf), ob = lastOB(htf), ot = ote(htf, swings(htf));
    var chart = { candles: htf.slice(-48), fvg: f, ob: ob, ote: ot, range: r, entry: null, sl: null, tp: null, dir: dir };
    var base = { sym: sym, name: name, cls: cls, price: price, chg: chg, dir: 'WAIT', conf: 40, cycle: cyc,
      entry: null, sl: null, tp: null, rr: null, win: null, prog: 38, note: note || 'Pas de biais net — on attend.', chart: chart };

    // Données SYNTHÉTIQUES (DXY/forex reconstruits depuis les clôtures quotidiennes BCE) :
    // pas de vraies mèches -> les FVG/OB seraient du bruit. On n'affiche QUE le contexte
    // (tendance + zone), jamais un trade précis (entrée/SL/TP), pour rester honnête.
    if (synthetic) {
      base.note = r
        ? 'Contexte ' + st.bias + ' · zone ' + (price < r.eq ? 'discount' : 'premium') + ' — clôtures quotidiennes (BCE), pas d\'entrée précise.'
        : 'Contexte indéterminé — clôtures quotidiennes (BCE).';
      base.prog = 42;
      return base;
    }

    if (dir === 'WAIT' || !r) return base;

    var zoneName = price < r.eq ? 'discount' : 'premium';

    // GARDE-FOU ICT 1 : on n'achète pas en premium, on ne vend pas en discount.
    var zoneOk = (dir === 'LONG' && zoneName === 'discount') || (dir === 'SHORT' && zoneName === 'premium');
    if (!zoneOk) {
      base.prog = 46;
      base.note = 'Biais ' + st.bias + ' mais prix en ' + zoneName + ' — mauvaise zone pour ' + dir + ', on attend un retour en ' + (dir === 'LONG' ? 'discount' : 'premium') + '.';
      return base;
    }

    // GARDE-FOU ICT 2 : il faut un POI aligné (FVG puis OB) dans le sens du biais.
    var poi = null, poiType = null;
    if (f && f.type === st.bias) { poi = [f.bottom, f.top]; poiType = 'FVG'; }
    else if (ob && ob.type === st.bias) { poi = [ob.bottom, ob.top]; poiType = 'Order Block'; }
    if (!poi) {
      base.prog = 50;
      base.note = 'Biais ' + st.bias + ' en ' + zoneName + ', mais pas de FVG/OB aligné — on attend la formation d\'une zone.';
      return base;
    }

    // Entrée au milieu du POI. STOP au-delà du POI mais avec un PLANCHER réaliste,
    // sinon un FVG très fin donne un risque minuscule et un RR délirant (30, 40…).
    var entry = (poi[0] + poi[1]) / 2;
    var span = Math.abs(poi[1] - poi[0]) || price * 0.0015;
    var rangeSpan = Math.abs(r.hi - r.lo) || price * 0.01;
    // Un stop institutionnel se loge derrière le swing : au minimum ~12 % du dealing range.
    var minRisk = Math.max(span * 1.1, rangeSpan * 0.12, price * 0.002);
    var slRaw = dir === 'LONG' ? poi[0] - span * 0.6 : poi[1] + span * 0.6;
    var slFloor = dir === 'LONG' ? entry - minRisk : entry + minRisk;
    var sl = dir === 'LONG' ? Math.min(slRaw, slFloor) : Math.max(slRaw, slFloor);
    var risk = Math.abs(entry - sl);
    // CIBLE : la liquidité (extrême de range), mais RR PLAFONNÉ à un niveau atteignable.
    var MAXRR = 6;
    var tpLiq = dir === 'LONG' ? r.hi : r.lo;
    var rew = Math.min(Math.abs(tpLiq - entry), risk * MAXRR);
    var tp = dir === 'LONG' ? entry + rew : entry - rew;
    var ok = dir === 'LONG' ? (sl < entry && tp > entry) : (sl > entry && tp < entry);
    if (!ok || risk <= 0) { base.prog = 48; base.note = 'Géométrie invalide — on attend.'; return base; }
    var rr = +(rew / risk).toFixed(1);
    if (rr < 1) { base.prog = 48; base.note = 'Setup aligné mais RR < 1 (cible trop proche) — on attend un meilleur point.'; return base; }

    // Confluence renforcée — chaque brique validée est un point de confluence, listé dans le motif.
    var hsw = swings(htf);
    var why = [st.label, 'zone ' + zoneName, poiType + ' aligné'];
    var conf = 48 + 12;                            // base + zone correcte (déjà validée)
    if (poiType === 'FVG') conf += 12; else conf += 8;
    if (st.label.indexOf('BOS') >= 0) conf += 12;  // cassure de structure confirmée

    // ALIGNEMENT TOP-DOWN : biais D1 (dtf) confirmé (ou non) par le H4 (htf).
    var hBias = structure(htf, hsw).bias, aligned = hBias === st.bias;
    if (aligned) { conf += 8; why.push('H4 aligné D1'); }
    else if (hBias !== 'neutre') { conf -= 6; why.push('H4 divergent'); }

    // MSS (Market Structure Shift) dans le sens du biais.
    var ms = mss(htf, hsw);
    if (ms === st.bias) { conf += 8; why.push('MSS ' + ms); }

    // Liquidité : poche (equal highs/lows) visée dans le bon sens + balayage récent de la poche opposée.
    var liq = liquidity(htf, hsw);
    var liqTarget = dir === 'LONG' ? liq.buy : liq.sell;
    if (liqTarget != null) { conf += 6; why.push('liquidité ciblée'); }
    var oppPool = dir === 'LONG' ? liq.sell : liq.buy, sweep = false;
    if (oppPool != null) htf.slice(-3).forEach(function (k) {
      if (dir === 'LONG' && k.l < oppPool && k.c > oppPool) sweep = true;
      if (dir === 'SHORT' && k.h > oppPool && k.c < oppPool) sweep = true;
    });
    if (sweep) { conf += 8; why.push('balayage liquidité'); }

    var oteIn = ot && price >= Math.min(ot.bottom, ot.top) && price <= Math.max(ot.bottom, ot.top);
    if (oteIn) { conf += 6; why.push('OTE'); }     // prix dans l'OTE (62-79 %)
    if (cyc === 'Expansion' || cyc === 'Accumulation') conf += 4;

    // DXY inversé pour crypto/or ET forex …/USD : DXY baissier = dollar faible = favorable au long.
    var fav = (dir === 'LONG' && dxyBias === 'baissier') || (dir === 'SHORT' && dxyBias === 'haussier');
    if (fav) conf += 10;
    else if (dxyBias && dxyBias !== 'neutre') conf -= 8; // DXY à contre-courant
    conf = clamp(conf, 0, 97);

    var inZone = price >= Math.min(poi[0], poi[1]) && price <= Math.max(poi[0], poi[1]);
    var prog = clamp(conf + (inZone ? 10 : -3) + (rr >= 2 ? 4 : 0), 20, 100);
    var win = clamp(Math.round(conf * 0.82), 40, 85);
    why.push('cible ' + rr + 'R');
    if (fav) why.push('DXY favorable');
    var reason = why.join(' · ');
    chart.entry = entry; chart.sl = sl; chart.tp = tp;
    return { sym: sym, name: name, cls: cls, price: price, chg: chg, dir: dir, conf: conf, cycle: cyc,
      entry: entry, sl: sl, tp: tp, rr: rr, win: win, prog: prog, note: reason, chart: chart };
  }

  // ---- Sources --------------------------------------------------------------
  function fetchJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function binance(src, interval, limit) {
    var path = '/api/v3/klines?symbol=' + src + '&interval=' + interval + '&limit=' + (limit || 150);
    function tryHost(i) {
      if (i >= BINANCE.length) return Promise.reject(new Error('Binance injoignable'));
      return fetchJSON(BINANCE[i] + path).then(function (d) {
        return d.map(function (k) { return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }; }).slice(0, -1);
      }).catch(function () { return tryHost(i + 1); });
    }
    return tryHost(0);
  }
  // Séries FX quotidiennes depuis Frankfurter (base USD) → DXY + paires.
  function frankfurter() {
    var d = new Date(Date.now() - 100 * 86400000);
    var start = d.toISOString().slice(0, 10);
    var url = 'https://api.frankfurter.dev/v1/' + start + '..?base=USD&symbols=EUR,JPY,GBP,CAD,CHF,SEK';
    return fetchJSON(url).then(function (j) {
      var dates = Object.keys(j.rates).sort();
      var dxy = [], gbp = [], jpy = [], eurjpy = [];
      dates.forEach(function (dt) {
        var r = j.rates[dt];
        var EURUSD = 1 / r.EUR, GBPUSD = 1 / r.GBP, USDJPY = r.JPY;
        var v = 50.14348112 * Math.pow(EURUSD, -0.576) * Math.pow(USDJPY, 0.136) * Math.pow(GBPUSD, -0.119) *
          Math.pow(r.CAD, 0.091) * Math.pow(r.SEK, 0.042) * Math.pow(r.CHF, 0.036);
        var mk = function (x) { return { t: dt, o: x, h: x, l: x, c: x }; };
        dxy.push(mk(v)); gbp.push(mk(GBPUSD)); jpy.push(mk(USDJPY)); eurjpy.push(mk(r.JPY / r.EUR));
      });
      return { dxy: dxy, gbp: gbp, jpy: jpy, eurjpy: eurjpy };
    });
  }

  // ---- Chargement global ----------------------------------------------------
  function load() {
    var jobs = {
      btcD: binance('BTCUSDT', '1d', 120), btcH: binance('BTCUSDT', '4h', 150),
      ethD: binance('ETHUSDT', '1d', 120), ethH: binance('ETHUSDT', '4h', 150),
      solD: binance('SOLUSDT', '1d', 120), solH: binance('SOLUSDT', '4h', 150),
      xrpD: binance('XRPUSDT', '1d', 120), xrpH: binance('XRPUSDT', '4h', 150),
      bnbD: binance('BNBUSDT', '1d', 120), bnbH: binance('BNBUSDT', '4h', 150),
      // Forex & or en VRAIES bougies via Binance (EUR/USDT, PAXG/USDT — paires liquides et à jour).
      // USDT ≈ USD ; la structure/les zones/les niveaux sont fidèles (écart ~0,1 % sur le prix absolu).
      eurD: binance('EURUSDT', '1d', 120), eurH: binance('EURUSDT', '4h', 150),
      xauD: binance('PAXGUSDT', '1d', 120), xauH: binance('PAXGUSDT', '4h', 150),
      fx: frankfurter()
    };
    function safe(p) { return p.then(function (v) { return v; }, function () { return null; }); }
    var keys = Object.keys(jobs);
    return Promise.all(keys.map(function (k) { return safe(jobs[k]); })).then(function (res) {
      var r = {}; keys.forEach(function (k, i) { r[k] = res[i]; });
      var cards = [];
      // DXY d'abord (contexte pour les cryptos)
      var dxyBias = 'neutre';
      if (r.fx) {
        var dS = swings(r.fx.dxy), dSt = structure(r.fx.dxy, dS); dxyBias = dSt.bias;
        cards.push(buildCard('Indice dollar', 'DXY', 'forex', r.fx.dxy, r.fx.dxy, null, null, true));
      }
      // Chaque paire n'est ajoutée que si ses données sont FRAÎCHES (garde-fou anti-prix figé).
      function add(name, sym, cls, H, D) { if (H && D && fresh(H)) cards.push(buildCard(name, sym, cls, H, D, dxyBias)); }
      add('Bitcoin', 'BTC/USD', 'crypto', r.btcH, r.btcD);
      add('Ethereum', 'ETH/USD', 'crypto', r.ethH, r.ethD);
      add('Solana', 'SOL/USD', 'crypto', r.solH, r.solD);
      add('XRP', 'XRP/USD', 'crypto', r.xrpH, r.xrpD);
      add('BNB', 'BNB/USD', 'crypto', r.bnbH, r.bnbD);
      // Forex + or : VRAIS trades (bougies réelles). USD au dénominateur -> même logique DXY que la crypto.
      add('Euro / Dollar', 'EUR/USD', 'forex', r.eurH, r.eurD);
      add('Or', 'XAU/USD', 'forex', r.xauH, r.xauD);
      return cards.length ? cards : null;
    });
  }

  // Contexte multi-unités (H1 / H4 / D1) pour le Bot IA — alignement top-down.
  function mtf() {
    var pairs = [{ sym: 'BTC/USD', src: 'BTCUSDT' }, { sym: 'ETH/USD', src: 'ETHUSDT' }, { sym: 'SOL/USD', src: 'SOLUSDT' },
      { sym: 'XRP/USD', src: 'XRPUSDT' }, { sym: 'BNB/USD', src: 'BNBUSDT' },
      { sym: 'EUR/USD', src: 'EURUSDT' }, { sym: 'XAU/USD', src: 'PAXGUSDT' }];
    var tfs = [{ n: 'D1', i: '1d' }, { n: 'H4', i: '4h' }, { n: 'H1', i: '1h' }];
    var jobs = [];
    pairs.forEach(function (p) {
      tfs.forEach(function (tf) {
        jobs.push(binance(p.src, tf.i, 150).then(function (c) { return { p: p, tf: tf, c: c }; }, function () { return { p: p, tf: tf, c: null }; }));
      });
    });
    return Promise.all(jobs).then(function (res) {
      var byPair = {};
      res.forEach(function (r) {
        if (!byPair[r.p.sym]) byPair[r.p.sym] = { paire: r.p.sym, unites: {} };
        if (!r.c || r.c.length < 30) return;
        var c = r.c, s = swings(c), st = structure(c, s), rr = rng(s), price = c[c.length - 1].c, f = lastFVG(c), ot = ote(c, s), ob = lastOB(c);
        var round = function (x) { return x == null ? null : +(x.toFixed(x >= 100 ? 2 : 4)); };
        byPair[r.p.sym].unites[r.tf.n] = {
          prix: round(price), structure: st.label, biais: st.bias, cycle: cyclePhase(c),
          zone: rr ? (price < rr.eq ? 'discount' : 'premium') : '—',
          fvg: f ? { type: f.type, bas: round(f.bottom), haut: round(f.top) } : null,
          ote: ot ? { type: ot.type, bas: round(ot.bottom), haut: round(ot.top) } : null,
          ob: ob ? { type: ob.type, bas: round(ob.bottom), haut: round(ob.top) } : null,
          range: rr ? { haut: round(rr.hi), bas: round(rr.lo) } : null
        };
      });
      return pairs.map(function (p) { return byPair[p.sym]; }).filter(Boolean);
    });
  }

  root.LIVE = { load: load, mtf: mtf };
})(typeof window !== 'undefined' ? window : this);
