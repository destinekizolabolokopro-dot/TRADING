/*
 * Couche DONNÉES EN DIRECT du dashboard (navigateur, sans clé)
 * -----------------------------------------------------------------------------
 * - Crypto (BTC/ETH/SOL) : Binance (klines D1 + H4), CORS ouvert.
 * - DXY + Forex (GBP/USD, USD/JPY, EUR/JPY) : calculés depuis les taux BCE
 *   (Frankfurter, CORS ouvert, gratuit). Le DXY suit la formule ICE officielle.
 * Renvoie des cartes prêtes à afficher, même forme que les données mock.
 * En cas d'échec d'une source, la carte concernée retombe sur le mock.
 */
(function (root) {
  'use strict';

  var BINANCE = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com'];
  var clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };

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
    return { hi: hi.p, lo: lo.p, eq: (hi.p + lo.p) / 2 };
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
  function cyclePhase(c) {
    var n = c.length, look = Math.min(12, n - 2), w = c.slice(n - look);
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
  function buildCard(name, sym, cls, htf, dtf, dxyBias, note) {
    var ds = swings(dtf), st = structure(dtf, ds), r = rng(ds);
    var price = htf[htf.length - 1].c;
    var prev = dtf.length >= 2 ? dtf[dtf.length - 2].c : price;
    var chg = prev ? (price - prev) / prev * 100 : 0;
    var cyc = cyclePhase(htf);
    var dir = st.bias === 'haussier' ? 'LONG' : st.bias === 'baissier' ? 'SHORT' : 'WAIT';
    var f = lastFVG(htf), ob = lastOB(htf), ot = ote(htf, swings(htf));
    var chart = { candles: htf.slice(-48), fvg: f, ob: ob, ote: ot, range: r, entry: null, sl: null, tp: null, dir: dir };
    var base = { sym: sym, name: name, cls: cls, price: price, chg: chg, dir: 'WAIT', conf: 40, cycle: cyc,
      entry: null, sl: null, tp: null, rr: null, win: null, prog: 38, note: note || 'Pas de biais net — on attend.', chart: chart };
    if (dir === 'WAIT' || !r) return base;

    var zoneName = price < r.eq ? 'discount' : 'premium';
    var entry, sl, tp;
    if (f && ((dir === 'LONG' && f.type === 'haussier') || (dir === 'SHORT' && f.type === 'baissier'))) entry = (f.bottom + f.top) / 2;
    else entry = r.eq;
    if (dir === 'LONG') { sl = r.lo * 0.997; tp = r.hi; } else { sl = r.hi * 1.003; tp = r.lo; }
    var ok = dir === 'LONG' ? (sl < entry && tp > entry) : (sl > entry && tp < entry);
    var risk = Math.abs(entry - sl), rew = Math.abs(tp - entry);
    if (!ok || risk <= 0) return base;
    var rr = +(rew / risk).toFixed(1);
    // Ratio minimum demandé : 1 RR. En dessous, pas de trade → on attend.
    if (rr < 1) { base.prog = 45; base.note = 'Biais ' + st.bias + ', mais point d\'entrée sous 1R — on attend un retour en ' + (dir === 'LONG' ? 'discount' : 'premium') + '.'; return base; }

    var conf = 45;
    if ((dir === 'LONG' && zoneName === 'discount') || (dir === 'SHORT' && zoneName === 'premium')) conf += 15;
    if (f && f.type === st.bias) conf += 12;
    if (st.label.indexOf('BOS') >= 0) conf += 10;
    var fav = (dir === 'LONG' && dxyBias === 'baissier') || (dir === 'SHORT' && dxyBias === 'haussier');
    if (fav && cls === 'crypto') conf += 10;
    conf = clamp(conf, 0, 96);
    var inZone = price >= Math.min(f ? f.bottom : entry, f ? f.top : entry) && price <= Math.max(f ? f.bottom : entry, f ? f.top : entry);
    var prog = clamp(conf + (inZone ? 8 : -4), 20, 100);
    var win = clamp(Math.round(conf * 0.8), 35, 82);
    var reason = [st.label, 'zone ' + zoneName + (fav && cls === 'crypto' ? ' · DXY favorable' : '')].join(' · ');
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
        cards.push(buildCard('Indice dollar', 'DXY', 'forex', r.fx.dxy, r.fx.dxy, null, null));
      }
      if (r.btcD && r.btcH) cards.push(buildCard('Bitcoin', 'BTC/USD', 'crypto', r.btcH, r.btcD, dxyBias));
      if (r.ethD && r.ethH) cards.push(buildCard('Ethereum', 'ETH/USD', 'crypto', r.ethH, r.ethD, dxyBias));
      if (r.solD && r.solH) cards.push(buildCard('Solana', 'SOL/USD', 'crypto', r.solH, r.solD, dxyBias));
      if (r.fx) {
        cards.push(buildCard('Livre / Dollar', 'GBP/USD', 'forex', r.fx.gbp, r.fx.gbp, dxyBias));
        cards.push(buildCard('Dollar / Yen', 'USD/JPY', 'forex', r.fx.jpy, r.fx.jpy, dxyBias));
        cards.push(buildCard('Euro / Yen', 'EUR/JPY', 'forex', r.fx.eurjpy, r.fx.eurjpy, dxyBias));
      }
      return cards.length ? cards : null;
    });
  }

  // Contexte multi-unités (H1 / H4 / D1) pour le Bot IA — alignement top-down.
  function mtf() {
    var pairs = [{ sym: 'BTC/USD', src: 'BTCUSDT' }, { sym: 'ETH/USD', src: 'ETHUSDT' }, { sym: 'SOL/USD', src: 'SOLUSDT' }];
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
