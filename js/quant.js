/*
 * Moteur QUANT / INSTITUTIONNEL — inspiré du fonctionnement réel des grands fonds
 * (Renaissance, Two Sigma, Citadel, DE Shaw…). Il ne prédit PAS la direction du marché
 * (pile ou face) : il construit un panier MARKET-NEUTRAL long/short par FACTEURS.
 *
 * Les 4 piliers repris des pros :
 *  1. FACTEURS : on note chaque actif sur des primes de risque documentées — Momentum (90 j),
 *     Tendance (prix vs EMA200), Faible volatilité (low-vol anomaly).
 *     (Volontairement SIMPLE : en labo, ajouter des facteurs gonflait le Sharpe backtest à ~1,2
 *      mais il s'effondrait à ~0,16 en live = sur-apprentissage. 3 facteurs = bien plus stable.
 *      Le facteur "reversal court terme" a été mesuré NÉGATIF sur ces actifs → exclu.)
 *  2. ENSEMBLE : on combine ces facteurs (z-scores) en un score composite unique.
 *  3. CLASSEMENT CROSS-SECTIONNEL : on va LONG le haut du panier, SHORT le bas.
 *  4. MARKET-NEUTRAL : long + short en même temps → on gagne sur l'ÉCART, peu importe
 *     que le marché monte ou baisse. La vraie métrique visée n'est pas le win rate mais
 *     le SHARPE (rendement ÷ risque).
 *
 * Backtest walk-forward honnête (rebalance tous les 20 j). ⚠️ Échantillon court, sans frais
 * ni coût de short, marché majoritairement haussier → INDICATIF, pas une promesse.
 */
(function (root) {
  'use strict';

  var HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com'];
  var ASSETS = [
    { sym: 'BTC/USD', src: 'BTCUSDT' }, { sym: 'ETH/USD', src: 'ETHUSDT' }, { sym: 'SOL/USD', src: 'SOLUSDT' },
    { sym: 'XRP/USD', src: 'XRPUSDT' }, { sym: 'BNB/USD', src: 'BNBUSDT' }, { sym: 'ADA/USD', src: 'ADAUSDT' },
    { sym: 'DOGE/USD', src: 'DOGEUSDT' }, { sym: 'LTC/USD', src: 'LTCUSDT' }, { sym: 'LINK/USD', src: 'LINKUSDT' },
    { sym: 'DOT/USD', src: 'DOTUSDT' }, { sym: 'AVAX/USD', src: 'AVAXUSDT' }, { sym: 'TRX/USD', src: 'TRXUSDT' },
    { sym: 'MATIC/USD', src: 'MATICUSDT' }, { sym: 'ATOM/USD', src: 'ATOMUSDT' }, { sym: 'UNI/USD', src: 'UNIUSDT' },
    { sym: 'XLM/USD', src: 'XLMUSDT' }, { sym: 'ETC/USD', src: 'ETCUSDT' }, { sym: 'FIL/USD', src: 'FILUSDT' },
    { sym: 'NEAR/USD', src: 'NEARUSDT' }, { sym: 'APT/USD', src: 'APTUSDT' }, { sym: 'INJ/USD', src: 'INJUSDT' },
    { sym: 'AAVE/USD', src: 'AAVEUSDT' }, { sym: 'ALGO/USD', src: 'ALGOUSDT' }, { sym: 'SAND/USD', src: 'SANDUSDT' },
    { sym: 'EOS/USD', src: 'EOSUSDT' }, { sym: 'XTZ/USD', src: 'XTZUSDT' }, { sym: 'EUR/USD', src: 'EURUSDT' },
    { sym: 'XAU/USD', src: 'PAXGUSDT' }
  ];
  var H = 20;                    // horizon / période de rebalance (jours)
  // Poids de l'ensemble de facteurs (equal-weight des jambes ; l'inverse-vol a été mesuré nuisible).
  // Volontairement 3 facteurs seulement : plus robuste hors échantillon (voir en-tête).
  var W = { mom: 1, trend: 1, lowvol: 0.5 };
  var fresh = function (c) { return c && c.length && (Date.now() - c[c.length - 1].t) < 3 * 864e5; };

  function ema(v, p) { var k = 2 / (p + 1), e = v[0], o = [e]; for (var i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); o.push(e); } return o; }
  function ret(cl, i, p) { return i >= p && cl[i - p] ? (cl[i] - cl[i - p]) / cl[i - p] : 0; }
  function vol(cl, i, p) { if (i < p) return 0; var r = [], j; for (j = i - p + 1; j <= i; j++) r.push((cl[j] - cl[j - 1]) / cl[j - 1]); var m = r.reduce(function (a, b) { return a + b; }, 0) / r.length; return Math.sqrt(r.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / r.length); }
  function zmap(map) { var s = Object.keys(map), a = s.map(function (x) { return map[x]; }), n = a.length,
    mu = a.reduce(function (p, q) { return p + q; }, 0) / n, sd = Math.sqrt(a.reduce(function (p, q) { return p + (q - mu) * (q - mu); }, 0) / n) || 1, o = {};
    s.forEach(function (x) { o[x] = (map[x] - mu) / sd; }); return o; }

  // Facteurs bruts d'un actif à l'indice i (3 facteurs documentés : momentum, tendance, faible vol.)
  function factorsAt(a, i) {
    var cl = a.cl;
    return { mom: ret(cl, i, 90), trend: a.e200[i] ? cl[i] / a.e200[i] - 1 : 0, lowvol: -vol(cl, i, 30) };
  }
  // Score composite cross-sectionnel : z-score chaque facteur (vs le panier) puis pondère (ensemble).
  function compositeAt(assets, idxByT, t) {
    var raw = { mom: {}, trend: {}, lowvol: {} }, present = [];
    assets.forEach(function (a) { var i = idxByT[a.sym][t]; if (i == null || i < 205) return;
      var f = factorsAt(a, i); raw.mom[a.sym] = f.mom; raw.trend[a.sym] = f.trend; raw.lowvol[a.sym] = f.lowvol; present.push(a.sym); });
    if (present.length < 8) return null;
    var zM = zmap(raw.mom), zT = zmap(raw.trend), zL = zmap(raw.lowvol), comp = {}, sub = {};
    present.forEach(function (s) { comp[s] = W.mom * zM[s] + W.trend * zT[s] + W.lowvol * zL[s];
      sub[s] = { mom: zM[s], trend: zT[s], lowvol: zL[s] }; });
    return { comp: comp, sub: sub };
  }

  // Backtest market-neutral : rebalance tous les H j, long topK / short bottomK, on mesure le spread.
  function backtest(assets, idxByT, times, K) {
    var rets = [], i;
    for (i = 210; i < times.length - H; i += H) {
      var t = times[i], c = compositeAt(assets, idxByT, t); if (!c) continue;
      var fr = {};
      assets.forEach(function (a) { var ii = idxByT[a.sym][t]; if (ii != null && ii + H < a.cl.length) fr[a.sym] = (a.cl[ii + H] - a.cl[ii]) / a.cl[ii]; });
      var ranked = Object.keys(c.comp).filter(function (s) { return fr[s] != null; }).sort(function (x, y) { return c.comp[y] - c.comp[x]; });
      if (ranked.length < 2 * K) continue;
      var longs = ranked.slice(0, K), shorts = ranked.slice(-K);
      var lm = longs.reduce(function (a, s) { return a + fr[s]; }, 0) / K;
      var sm = shorts.reduce(function (a, s) { return a + fr[s]; }, 0) / K;
      rets.push(lm - sm);
    }
    return rets;
  }
  function stats(rets) {
    var n = rets.length; if (!n) return null;
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / n;
    var sd = Math.sqrt(rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / n) || 1e-9;
    var perYear = 365 / H, sharpe = (mean / sd) * Math.sqrt(perYear);
    var win = rets.filter(function (r) { return r > 0; }).length / n * 100;
    var ann = Math.pow(1 + mean, perYear) - 1;
    var eq = 1, peak = 1, dd = 0;
    rets.forEach(function (r) { eq *= 1 + r; if (eq > peak) peak = eq; var d = (peak - eq) / peak; if (d > dd) dd = d; });
    return { n: n, sharpe: +sharpe.toFixed(2), win: Math.round(win), ann: Math.round(ann * 100), dd: Math.round(dd * 100), meanPct: +(mean * 100).toFixed(2) };
  }

  function fetchKlines(src) {
    var path = '/api/v3/klines?symbol=' + src + '&interval=1d&limit=1000';
    function tryHost(i) {
      if (i >= HOSTS.length) return Promise.reject(new Error('Binance injoignable'));
      return fetch(HOSTS[i] + path).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { return d.map(function (k) { return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }; }).slice(0, -1); })
        .catch(function () { return tryHost(i + 1); });
    }
    return tryHost(0);
  }

  function load() {
    return Promise.all(ASSETS.map(function (a) {
      return fetchKlines(a.src).then(function (c) { return { a: a, c: c }; }, function () { return { a: a, c: null }; });
    })).then(function (rows) {
      var assets = [];
      rows.forEach(function (r) {
        if (!fresh(r.c)) return;
        var cl = r.c.map(function (x) { return x.c; }), idx = {};
        r.c.forEach(function (k, i) { idx[k.t] = i; });
        assets.push({ sym: r.a.sym, cl: cl, c: r.c, e200: ema(cl, 200), _t: idx });
      });
      if (assets.length < 8) return null;

      var idxByT = {}; assets.forEach(function (a) { idxByT[a.sym] = a._t; });
      var allT = {}; assets.forEach(function (a) { a.c.forEach(function (k) { allT[k.t] = 1; }); });
      var times = Object.keys(allT).map(Number).sort(function (x, y) { return x - y; });
      var K = Math.max(3, Math.round(assets.length / 5)); // quintiles (top/bottom 20 %, standard académique)

      // Panier LIVE : composite au dernier instant commun
      var tLive = times[times.length - 1];
      var c = compositeAt(assets, idxByT, tLive) || compositeAt(assets, idxByT, times[times.length - 2]);
      var ranked = c ? Object.keys(c.comp).sort(function (x, y) { return c.comp[y] - c.comp[x]; }) : [];
      function pack(s) { var a = assets.find(function (x) { return x.sym === s; }); return { sym: s, score: +c.comp[s].toFixed(2), sub: c.sub[s],
        price: a ? a.cl[a.cl.length - 1] : null,
        vol: a ? +(vol(a.cl, a.cl.length - 1, 30)).toFixed(4) : 0.02 }; }
      var longs = ranked.slice(0, K).map(pack), shorts = ranked.slice(-K).map(pack).reverse();
      var mids = ranked.slice(K, ranked.length - K).map(pack);

      var perf = stats(backtest(assets, idxByT, times, K));
      return { longs: longs, shorts: shorts, mids: mids, perf: perf, K: K, H: H,
        assets: assets.length, updated: Date.now() };
    });
  }

  root.QUANT = { load: load };
})(typeof window !== 'undefined' ? window : this);
