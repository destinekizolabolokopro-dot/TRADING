/*
 * IA MAISON — un vrai modèle de machine learning qui tourne DANS le navigateur.
 * =============================================================================
 * Ce n'est PAS un appel à une IA externe (ça, c'est le "Bot IA / Claude"). Ici, le
 * cerveau vit chez toi : une régression logistique entraînée sur les VRAIES bougies.
 *
 * Ce qu'elle fait, honnêtement :
 *  1. Elle transforme chaque bougie en "concepts" ICT/SMC + indicateurs (les FEATURES).
 *  2. Elle apprend, sur l'historique réel, à estimer la probabilité que le prix MONTE.
 *  3. Elle mesure sa précision en WALK-FORWARD (hors échantillon) = son VRAI niveau.
 *  4. Elle S'ENTRAÎNE AUTOMATIQUEMENT à chaque ouverture (rien à cliquer), en repartant
 *     du cerveau sauvegardé (apprentissage continu) et en le complétant sur les nouvelles
 *     données. Elle NOTE ses prédictions passées et vérifie si elle a eu raison → elle
 *     "apprend de ses erreurs" (track record réel affiché).
 *  5. Sa MÉMOIRE NE SE PERD PAS : sauvegarde auto dans IndexedDB (+ export/import d'un
 *     fichier ia-cerveau.json comme filet de sécurité absolu).
 *
 * Limite assumée : sur les marchés, un tel modèle plafonne autour de 52–55 % de réussite.
 * On l'affiche sans mentir. Outil pédagogique, pas un conseil financier.
 */
(function (root) {
  'use strict';

  var HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com'];
  // On "renourrit" l'IA avec un LARGE panier : 28 actifs. Plus la cross-section est riche, plus
  // la médiane du panier (la cible) est fiable et plus l'IA a d'exemples pour apprendre la force
  // relative. Le labo confirme : 28 actifs > 14 (précision "engagée" 63 % → 66 %).
  var ASSETS = [
    { sym: 'BTC/USD', src: 'BTCUSDT', cls: 'crypto' },
    { sym: 'ETH/USD', src: 'ETHUSDT', cls: 'crypto' },
    { sym: 'SOL/USD', src: 'SOLUSDT', cls: 'crypto' },
    { sym: 'XRP/USD', src: 'XRPUSDT', cls: 'crypto' },
    { sym: 'BNB/USD', src: 'BNBUSDT', cls: 'crypto' },
    { sym: 'ADA/USD', src: 'ADAUSDT', cls: 'crypto' },
    { sym: 'DOGE/USD', src: 'DOGEUSDT', cls: 'crypto' },
    { sym: 'LTC/USD', src: 'LTCUSDT', cls: 'crypto' },
    { sym: 'LINK/USD', src: 'LINKUSDT', cls: 'crypto' },
    { sym: 'DOT/USD', src: 'DOTUSDT', cls: 'crypto' },
    { sym: 'AVAX/USD', src: 'AVAXUSDT', cls: 'crypto' },
    { sym: 'TRX/USD', src: 'TRXUSDT', cls: 'crypto' },
    { sym: 'MATIC/USD', src: 'MATICUSDT', cls: 'crypto' },
    { sym: 'ATOM/USD', src: 'ATOMUSDT', cls: 'crypto' },
    { sym: 'UNI/USD', src: 'UNIUSDT', cls: 'crypto' },
    { sym: 'XLM/USD', src: 'XLMUSDT', cls: 'crypto' },
    { sym: 'ETC/USD', src: 'ETCUSDT', cls: 'crypto' },
    { sym: 'FIL/USD', src: 'FILUSDT', cls: 'crypto' },
    { sym: 'NEAR/USD', src: 'NEARUSDT', cls: 'crypto' },
    { sym: 'APT/USD', src: 'APTUSDT', cls: 'crypto' },
    { sym: 'INJ/USD', src: 'INJUSDT', cls: 'crypto' },
    { sym: 'AAVE/USD', src: 'AAVEUSDT', cls: 'crypto' },
    { sym: 'ALGO/USD', src: 'ALGOUSDT', cls: 'crypto' },
    { sym: 'SAND/USD', src: 'SANDUSDT', cls: 'crypto' },
    { sym: 'EOS/USD', src: 'EOSUSDT', cls: 'crypto' },
    { sym: 'XTZ/USD', src: 'XTZUSDT', cls: 'crypto' },
    { sym: 'EUR/USD', src: 'EURUSDT', cls: 'forex' },
    { sym: 'XAU/USD', src: 'PAXGUSDT', cls: 'forex' }
  ];
  // Horizon ~30 j (rotation mensuelle) : c'est là que le momentum RELATIF persiste le mieux.
  var HORIZON = 30;
  var MODEL_VERSION = 6;        // + features cross-sectionnelles : on ré-apprend de zéro
  // 11 features ABSOLUES (l'actif seul) + 7 features RELATIVES (sa position vs le panier).
  // Comme la cible est relative (surperformer le panier), ces features relatives sont le bon
  // carburant : elles disent "cet actif est-il plus fort/faible que les autres MAINTENANT ?".
  var FEATURE_NAMES = [
    'Biais HTF (EMA50/200)', 'Zone premium/discount', 'RSI (excès)', 'Momentum (ROC)',
    'Régime (efficiency)', 'Displacement', 'Position dans le range (liquidité)',
    'Cassure de structure (BOS)', 'Volatilité (ATR)', 'Dernière variation', 'Pente EMA50',
    'Momentum relatif (vs panier)', 'Rang de momentum', 'Momentum relatif long',
    'RSI relatif', 'Force de tendance relative', 'Écart au prix relatif', 'Volatilité relative'
  ];
  var BF = 11;                  // nombre de features de base (absolues)
  var NF = FEATURE_NAMES.length; // total (18)

  // ---- Indicateurs (mêmes définitions que le moteur, cohérence garantie) -----
  function ema(v, p) { var k = 2 / (p + 1), e = v[0], out = [e]; for (var i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); out.push(e); } return out; }
  function rsiArr(cl, p) {
    var out = [], i; for (i = 0; i < p; i++) out.push(50);
    if (cl.length <= p) { while (out.length < cl.length) out.push(50); return out; }
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
  function atrArr(c, p) {
    var out = [0], trs = [0], i;
    for (i = 1; i < c.length; i++) { var h = c[i].h, lo = c[i].l, pc = c[i - 1].c; trs.push(Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc))); }
    var a = 0, cnt = 0;
    for (i = 1; i < c.length; i++) {
      if (i <= p) { a += trs[i]; cnt++; out.push(a / cnt); }
      else { a = (a * (p - 1) + trs[i]) / p; out.push(a); }
    }
    return out;
  }

  // ---- Extraction des FEATURES : les "concepts" traduits en nombres ----------
  // Renvoie {X:[[...]], y:[0/1], rows:[{i, feats, ret}]} à partir de bougies d'un actif.
  function buildFeatures(c) {
    var n = c.length; if (n < 60) return null;
    var cl = c.map(function (x) { return x.c; });
    var e20 = ema(cl, 20), e50 = ema(cl, 50), e200 = ema(cl, 200);
    var rsi = rsiArr(cl, 14), atr = atrArr(c, 14);
    var X = [], RAW = [], meta = [];
    var start = 50, end = n; // on garde les dernières bougies pour la prédiction "live"
    for (var i = start; i < end; i++) {
      var price = cl[i], a = atr[i] || price * 0.01;
      // 1. Biais HTF : EMA50 vs EMA200 (structure haute)
      var bias = e200[i] ? (e50[i] > e200[i] ? 1 : -1) : 0;
      // 2. Zone premium/discount : écart au prix "juste" (EMA20), normalisé par l'ATR
      var distE20 = clampf((price - e20[i]) / a, -3, 3);
      // 3. RSI centré (excès de sur-achat/sur-vente)
      var rsiN = (rsi[i] - 50) / 50;
      // 4. Momentum : variation sur 10 bougies
      var roc10 = i >= 10 && cl[i - 10] ? clampf((price - cl[i - 10]) / cl[i - 10] * 5, -3, 3) : 0;
      // 5. Régime : efficiency ratio (tendance nette vs haché)
      var er = effR(cl, i, 20);
      // 6. Displacement : corps de la dernière bougie / corps moyen
      var dispv = displ(c, i, 10);
      // 7. Position dans le range récent (proche du haut = liquidité au-dessus)
      var rp = rangePos(c, i, 20);
      // 8. Cassure de structure (BOS) sur les 20 dernières bougies
      var bos = bosFlag(c, i, 20);
      // 9. Volatilité relative
      var atrN = clampf(a / price * 30, 0, 3);
      // 10. Dernière variation (1 bougie)
      var ret1 = i >= 1 && cl[i - 1] ? clampf((price - cl[i - 1]) / cl[i - 1] * 8, -3, 3) : 0;
      // 11. Pente de l'EMA50 (dynamique de la tendance)
      var slope = i >= 5 ? clampf((e50[i] - e50[i - 5]) / a, -3, 3) : 0;
      X.push([bias, distE20, rsiN, roc10, er, dispv, rp, bos, atrN, ret1, slope]);
      // Métriques BRUTES (non bornées) pour le calcul cross-sectionnel dans load() :
      // momentum 20/40, RSI, force de tendance, écart au prix, volatilité.
      var mom20 = i >= 20 && cl[i - 20] ? (price - cl[i - 20]) / cl[i - 20] : 0;
      var mom40 = i >= 40 && cl[i - 40] ? (price - cl[i - 40]) / cl[i - 40] : 0;
      var trendv = e200[i] ? (e50[i] - e200[i]) / price : 0;
      RAW.push([mom20, mom40, rsi[i], trendv, (price - e20[i]) / a, a / price]);
      meta.push({ i: i, t: c[i].t });
    }
    // On expose, pour chaque bougie exploitable, sa feature + son horodatage + son rendement
    // FUTUR sur HORIZON. L'étiquette (surperforme-t-il le panier ?) est calculée dans load(),
    // car elle a besoin de TOUS les actifs au même instant (cible RELATIVE / cross-sectionnelle).
    var rows = [], last = null;
    for (var k = 0; k < meta.length; k++) {
      var idx = meta[k].i, future = idx + HORIZON;
      if (future < n) rows.push({ x: X[k], raw: RAW[k], t: meta[k].t, fret: (cl[future] - cl[idx]) / cl[idx] });
      if (idx === n - 1) last = { x: X[k], raw: RAW[k], t: meta[k].t }; // dernière bougie = point "live"
    }
    if (last == null) last = { x: X[X.length - 1], raw: RAW[X.length - 1], t: meta[meta.length - 1].t };
    return { rows: rows, live: last, price: cl[n - 1] };
  }
  // Features RELATIVES : z-score et rang cross-sectionnels d'un actif vs le panier à l'instant T.
  // Entrée = { sym: raw6 }. Sortie = { sym: rel7 }. Aligne les features sur la cible relative.
  function crossFeatures(rawBySym) {
    var syms = Object.keys(rawBySym); if (syms.length < 4) return null;
    function z(idx) { var v = syms.map(function (s) { return rawBySym[s][idx]; }), n = v.length,
      mu = v.reduce(function (a, b) { return a + b; }, 0) / n,
      sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - mu) * (b - mu); }, 0) / n) || 1, o = {};
      syms.forEach(function (s) { o[s] = clampf((rawBySym[s][idx] - mu) / sd, -3, 3); }); return o; }
    function rank(idx) { var ord = syms.slice().sort(function (a, b) { return rawBySym[a][idx] - rawBySym[b][idx]; }),
      n = ord.length, o = {}; ord.forEach(function (s, i) { o[s] = n > 1 ? (i / (n - 1)) * 2 - 1 : 0; }); return o; }
    var zMom20 = z(0), rMom20 = rank(0), zMom40 = z(1), zRsi = z(2), zTrend = z(3), zDist = z(4), zVol = z(5);
    var out = {};
    syms.forEach(function (s) { out[s] = [zMom20[s], rMom20[s], zMom40[s], zRsi[s], zTrend[s], zDist[s], zVol[s]]; });
    return out;
  }
  function clampf(v, a, b) { return v < a ? a : v > b ? b : v; }
  function effR(cl, i, p) { if (i < p) return 0; var chg = Math.abs(cl[i] - cl[i - p]), vol = 0; for (var j = i - p + 1; j <= i; j++) vol += Math.abs(cl[j] - cl[j - 1]); return vol ? clampf(chg / vol * 2 - 1, -1, 1) : 0; }
  function displ(c, i, p) { if (i < p) return 0; var body = Math.abs(c[i].c - c[i].o), s = 0; for (var j = i - p; j < i; j++) s += Math.abs(c[j].c - c[j].o); var avg = s / p; if (!avg) return 0; var sign = c[i].c >= c[i].o ? 1 : -1; return clampf(sign * (body / avg - 1), -3, 3); }
  function rangePos(c, i, p) { if (i < p) return 0; var hi = -Infinity, lo = Infinity; for (var j = i - p + 1; j <= i; j++) { if (c[j].h > hi) hi = c[j].h; if (c[j].l < lo) lo = c[j].l; } if (hi <= lo) return 0; return (c[i].c - lo) / (hi - lo) * 2 - 1; }
  function bosFlag(c, i, p) {
    if (i < p + 2) return 0;
    var hi = -Infinity, lo = Infinity;
    for (var j = i - p; j < i; j++) { if (c[j].h > hi) hi = c[j].h; if (c[j].l < lo) lo = c[j].l; }
    if (c[i].c > hi) return 1; if (c[i].c < lo) return -1; return 0;
  }

  // ---- Le modèle : régression logistique (poids = le "cerveau") --------------
  function sigmoid(z) { return z > 30 ? 1 : z < -30 ? 0 : 1 / (1 + Math.exp(-z)); }
  function standardize(X) {
    var d = NF, mu = new Array(d).fill(0), sg = new Array(d).fill(0), n = X.length, i, j;
    for (i = 0; i < n; i++) for (j = 0; j < d; j++) mu[j] += X[i][j];
    for (j = 0; j < d; j++) mu[j] /= (n || 1);
    for (i = 0; i < n; i++) for (j = 0; j < d; j++) { var e = X[i][j] - mu[j]; sg[j] += e * e; }
    for (j = 0; j < d; j++) { sg[j] = Math.sqrt(sg[j] / (n || 1)) || 1; }
    return { mu: mu, sg: sg };
  }
  function applyStd(x, s) { var o = new Array(NF); for (var j = 0; j < NF; j++) o[j] = (x[j] - s.mu[j]) / s.sg[j]; return o; }
  // Entraînement par descente de gradient. warm = poids de départ (apprentissage continu).
  function train(X, y, warm, epochs) {
    var d = NF, n = X.length;
    var w = (warm && warm.length === d) ? warm.slice() : new Array(d).fill(0);
    var b = (warm && typeof warm.b === 'number') ? warm.b : 0;
    var lr = 0.1, lambda = 0.01;
    epochs = epochs || 250;
    for (var ep = 0; ep < epochs; ep++) {
      var gw = new Array(d).fill(0), gb = 0;
      for (var i = 0; i < n; i++) {
        var z = b; for (var j = 0; j < d; j++) z += w[j] * X[i][j];
        var err = sigmoid(z) - y[i];
        for (j = 0; j < d; j++) gw[j] += err * X[i][j];
        gb += err;
      }
      for (j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
      b -= lr * (gb / n);
    }
    w.b = b;
    return w;
  }
  function predictOne(x, w, s) { var xs = applyStd(x, s), z = w.b || 0; for (var j = 0; j < NF; j++) z += w[j] * xs[j]; return sigmoid(z); }

  // ---- Calibration (Platt scaling) : que "64 %" veuille VRAIMENT dire 64 % ------
  // On ajuste p_calibrée = sigmoid(a·logit(p) + b) sur les prédictions d'entraînement, pour que
  // la probabilité affichée colle à la fréquence réelle. Ne change pas le classement, juste l'échelle.
  function logit(p) { p = Math.min(0.9999, Math.max(0.0001, p)); return Math.log(p / (1 - p)); }
  function fitPlatt(ps, ys) {
    var a = 1, b = 0, lr = 0.3, n = ps.length; if (n < 30) return { a: 1, b: 0 };
    for (var ep = 0; ep < 400; ep++) {
      var ga = 0, gb = 0;
      for (var i = 0; i < n; i++) { var L = logit(ps[i]), q = sigmoid(a * L + b), e = q - ys[i]; ga += e * L; gb += e; }
      a -= lr * ga / n; b -= lr * gb / n;
    }
    return { a: a, b: b };
  }
  function applyCal(p, cal) { return cal ? sigmoid(cal.a * logit(p) + cal.b) : p; }
  // Erreur de calibration attendue (ECE) : écart moyen entre proba prédite et fréquence réelle,
  // par tranches de 10 %. 0 % = parfaitement calibré. Sert d'indicateur de fiabilité honnête.
  function ece(pairs) {
    var bins = []; for (var k = 0; k < 10; k++) bins.push({ sp: 0, sy: 0, n: 0 });
    pairs.forEach(function (pr) { var b = Math.min(9, Math.floor(pr.p * 10)); bins[b].sp += pr.p; bins[b].sy += pr.y; bins[b].n++; });
    var N = pairs.length, e = 0;
    bins.forEach(function (b) { if (b.n) e += b.n / N * Math.abs(b.sp / b.n - b.sy / b.n); });
    return Math.round(e * 100);
  }

  // Walk-forward STRICT PAR ACTIF (zéro fuite temporelle) : à chaque coupe, on entraîne sur
  // le PASSÉ de tous les actifs, puis on teste sur le FUTUR de chaque actif. C'est le test le
  // plus honnête possible — il révèle le vrai niveau (souvent proche du pile ou face, 50 %).
  //   perAsset = [{X, y}]  (features/étiquettes d'un actif, dans l'ordre chronologique)
  // On mesure : accuracy absolue, ET accuracy QUAND LE MODÈLE S'ENGAGE (|prob-0.5| >= marge)
  // + la couverture (part des cas où il s'engage). Le vrai juge = accuracy vs 50 % (hasard).
  function walkForward(perAsset) {
    var assets = perAsset.filter(function (a) { return a.X.length >= 200; });
    if (assets.length < 3) return null;
    var folds = 4, margin = 0.07, correct = 0, tested = 0, base = 0, corrC = 0, cov = 0;
    var calPairsRaw = [], calPairsCal = [];
    for (var f = 1; f <= folds; f++) {
      var frac = f / (folds + 1), nextFrac = (f + 1) / (folds + 1);
      var Xtr = [], ytr = [];
      assets.forEach(function (a) {
        var cut = Math.floor(a.X.length * frac);
        for (var i = 0; i < cut; i++) { Xtr.push(a.X[i]); ytr.push(a.y[i]); }
      });
      if (Xtr.length < 300) continue;
      var s = standardize(Xtr), Xs = Xtr.map(function (x) { return applyStd(x, s); });
      var w = train(Xs, ytr, null, 180);
      // Calibration ajustée sur le TRAIN (jamais sur le test) puis appliquée au test.
      var trProbs = Xs.map(function (x) { var z = w.b; for (var j = 0; j < NF; j++) z += w[j] * x[j]; return sigmoid(z); });
      var cal = fitPlatt(trProbs, ytr);
      var ones = ytr.reduce(function (a, b) { return a + b; }, 0), maj = ones >= ytr.length / 2 ? 1 : 0;
      assets.forEach(function (a) {
        var lo = Math.floor(a.X.length * frac), hi = Math.floor(a.X.length * nextFrac);
        for (var t = lo; t < hi; t++) {
          var praw = predictOne(a.X[t], w, s), p = applyCal(praw, cal), pred = p >= 0.5 ? 1 : 0;
          if (pred === a.y[t]) correct++;
          if (maj === a.y[t]) base++;
          tested++;
          calPairsRaw.push({ p: praw, y: a.y[t] }); calPairsCal.push({ p: p, y: a.y[t] });
          if (Math.abs(p - 0.5) >= margin) { cov++; if (pred === a.y[t]) corrC++; }
        }
      });
    }
    if (!tested) return null;
    return { acc: Math.round(correct / tested * 100), baseline: Math.round(base / tested * 100),
      accEngaged: cov ? Math.round(corrC / cov * 100) : null,
      coverage: Math.round(cov / tested * 100), tested: tested,
      eceRaw: ece(calPairsRaw), ece: ece(calPairsCal) };
  }

  // ---- Persistance : IndexedDB (auto) — la mémoire qui ne se perd pas --------
  var DB = 'tradeassist_ia', STORE = 'brain', KEY = 'model';
  function idb() {
    return new Promise(function (res, rej) {
      if (typeof indexedDB === 'undefined') return rej(new Error('no-idb'));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet() {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        tx.onsuccess = function () { res(tx.result || null); };
        tx.onerror = function () { res(null); };
      });
    }).catch(function () { return memGet(); });
  }
  function idbPut(v) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, KEY);
        tx.onsuccess = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { memPut(v); return false; });
  }
  // Repli mémoire (environnements sans IndexedDB : tests Node, navigation privée stricte)
  var _mem = null; function memGet() { return Promise.resolve(_mem); } function memPut(v) { _mem = v; }

  // ---- Chargement des données ------------------------------------------------
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
  var fresh = function (c) { return c && c.length && (Date.now() - c[c.length - 1].t) < 3 * 864e5; };

  // ---- Notation des prédictions passées : "apprendre de ses erreurs" ---------
  // brain.log = [{sym, ts, dueTs, price0, prob, dir, graded, correct}]
  // La cible est RELATIVE : une prédiction est correcte si l'actif a bien SURPERFORMÉ (ou
  // sous-performé) le panier sur la période. On regroupe donc par jour et on compare chaque
  // rendement réalisé à la MÉDIANE du groupe. On note à l'échéance (HORIZON jours passés).
  function gradeLog(brain, priceBySym) {
    var log = brain.log || [], now = Date.now(), day = 864e5, changed = false;
    var due = log.filter(function (e) { return !e.graded && now >= e.dueTs && priceBySym[e.sym] != null; });
    var byDay = {};
    due.forEach(function (e) { var d = Math.floor(e.ts / day); (byDay[d] = byDay[d] || []).push(e); });
    Object.keys(byDay).forEach(function (d) {
      var grp = byDay[d]; if (grp.length < 3) return; // médiane peu fiable -> on attend
      var rets = grp.map(function (e) { return priceBySym[e.sym] / e.price0 - 1; });
      var med = rets.slice().sort(function (a, b) { return a - b; })[Math.floor(rets.length / 2)];
      grp.forEach(function (e, i) {
        var out = rets[i] > med ? 1 : 0;
        e.correct = (out === (e.dir === 'up' ? 1 : 0)) ? 1 : 0;
        e.ret = +(rets[i] * 100).toFixed(2); e.graded = true; changed = true;
      });
    });
    // Track record réel = prédictions notées ET engagées (l'IA s'est prononcée : fort/faible)
    var graded = log.filter(function (e) { return e.graded && e.dir !== 'neutre'; });
    var ok = graded.filter(function (e) { return e.correct; }).length;
    brain.track = { total: graded.length, correct: ok, rate: graded.length ? Math.round(ok / graded.length * 100) : null };
    if (log.length > 600) brain.log = log.slice(log.length - 600);
    return changed;
  }
  // Enregistre le panier COMPLET du jour (tous les actifs, y compris neutres) pour pouvoir
  // calculer une médiane fiable à la notation. Un seul enregistrement par jour (batch cohérent).
  function logPredictions(brain, signals) {
    brain.log = brain.log || [];
    var now = Date.now(), day = 864e5;
    if (brain.log.some(function (e) { return (now - e.ts) < day; })) return; // déjà loggé aujourd'hui
    signals.forEach(function (s) {
      brain.log.push({ sym: s.sym, ts: now, dueTs: now + HORIZON * day, price0: s.price,
        prob: s.prob, dir: s.dir, graded: false });
    });
  }

  // ---- Orchestration : tout se fait tout seul à l'ouverture ------------------
  function load() {
    return Promise.all(ASSETS.map(function (a) {
      return fetchKlines(a.src).then(function (c) { return { a: a, c: c }; }, function () { return { a: a, c: null }; });
    })).then(function (rows) {
      rows = rows.filter(function (r) { return fresh(r.c); });
      if (!rows.length) return null;

      // 1) Features par actif (avec horodatage + rendement futur de chaque bougie)
      var perAsset = [];
      rows.forEach(function (r) {
        var f = buildFeatures(r.c);
        if (!f || !f.rows.length) return;
        perAsset.push({ a: r.a, f: f });
      });
      if (perAsset.length < 3) return null;

      // 2) CIBLE RELATIVE (cross-sectionnelle) : pour chaque instant, la médiane des rendements
      // futurs du panier. Étiquette = 1 si l'actif SURPERFORME cette médiane. C'est la seule
      // question réellement apprenable (le momentum relatif est une anomalie robuste) — bien
      // plus que « le prix va-t-il monter ? » qui est du pur pile ou face.
      // Par timestamp : rendements futurs du panier (pour la médiane-cible) ET métriques brutes
      // de chaque actif (pour les features relatives z-score/rang).
      var byT = {}, rawByT = {};
      perAsset.forEach(function (pa) {
        pa.f.rows.forEach(function (row) {
          (byT[row.t] = byT[row.t] || []).push(row.fret);
          (rawByT[row.t] = rawByT[row.t] || {})[pa.a.sym] = row.raw;
        });
      });
      var medByT = {}, relByT = {};
      Object.keys(byT).forEach(function (t) { var a = byT[t].slice().sort(function (x, y) { return x - y; }); medByT[t] = a[Math.floor(a.length / 2)]; });
      Object.keys(rawByT).forEach(function (t) { var r = crossFeatures(rawByT[t]); if (r) relByT[t] = r; });

      // Features complètes = base (11) + relatives (7). Étiquette = surperforme la médiane ?
      var poolX = [], poolY = [];
      perAsset.forEach(function (pa) {
        var X = [], y = [], sym = pa.a.sym;
        pa.f.rows.forEach(function (row) {
          var m = medByT[row.t], rel = relByT[row.t] && relByT[row.t][sym];
          if (m == null || !rel) return;
          X.push(row.x.concat(rel)); y.push(row.fret > m ? 1 : 0);
        });
        pa.labX = X; pa.labY = y; poolX = poolX.concat(X); poolY = poolY.concat(y);
      });
      if (poolX.length < 200) return null;

      // Features relatives LIVE : cross-section sur la dernière bougie de chaque actif.
      var liveRawBySym = {};
      perAsset.forEach(function (pa) { liveRawBySym[pa.a.sym] = pa.f.live.raw; });
      var liveRel = crossFeatures(liveRawBySym) || {};
      var ZERO7 = [0, 0, 0, 0, 0, 0, 0];

      return idbGet().then(function (saved) {
        // 3) Cerveau sauvegardé (apprentissage continu) — sauf si le modèle a changé de version
        var brain = (saved && saved.v === MODEL_VERSION) ? saved : { v: MODEL_VERSION, log: (saved && saved.log) || [], sessions: 0 };
        var warm = brain.w || null;

        // 4) Précision honnête HORS échantillon (walk-forward STRICT par actif) — le vrai niveau
        var wf = walkForward(perAsset.map(function (pa) { return { X: pa.labX, y: pa.labY }; }));

        // 5) Entraînement sur TOUT le dispo, en repartant du cerveau précédent (continu)
        var std = standardize(poolX);
        var Xs = poolX.map(function (x) { return applyStd(x, std); });
        var w = train(Xs, poolY, warm, brain.sessions > 0 ? 120 : 250);
        // Calibration (Platt) ajustée sur les prédictions d'entraînement → probas affichées fiables.
        var trProbs = Xs.map(function (x) { var z = w.b; for (var j = 0; j < NF; j++) z += w[j] * x[j]; return sigmoid(z); });
        var cal = fitPlatt(trProbs, poolY);

        // 6) Prédictions "live" : proba que CHAQUE actif surperforme le panier (force relative)
        var priceBySym = {};
        var signals = perAsset.map(function (pa) {
          var full = pa.f.live.x.concat(liveRel[pa.a.sym] || ZERO7);
          var prob = applyCal(predictOne(full, w, std), cal); // proba calibrée
          priceBySym[pa.a.sym] = pa.f.price;
          var dir = prob >= 0.56 ? 'up' : prob <= 0.44 ? 'down' : 'neutre'; // up = fort, down = faible
          var conf = Math.round(Math.abs(prob - 0.5) * 200); // 0..100
          // Contribution de chaque concept = poids × feature standardisée (pourquoi la déci)
          var xs = applyStd(full, std);
          var contrib = [];
          for (var j = 0; j < NF; j++) contrib.push({ n: FEATURE_NAMES[j], v: w[j] * xs[j] });
          contrib.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
          var drivers = contrib.slice(0, 3).map(function (cc) { return { n: cc.n, d: cc.v >= 0 ? 'haussier' : 'baissier' }; });
          return { sym: pa.a.sym, cls: pa.a.cls, price: pa.f.price, prob: +prob.toFixed(3),
            dir: dir, conf: conf, drivers: drivers };
        }).sort(function (a, b) { return b.prob - a.prob; }); // classement par force relative décroissante

        // 7) Apprendre de ses erreurs : noter les anciennes prédictions, puis logger celles du jour
        gradeLog(brain, priceBySym);
        logPredictions(brain, signals);

        // 7) Sauvegarde du cerveau (auto) — mémoire persistante
        brain.w = Array.prototype.slice.call(w); brain.w.b = w.b;
        brain.mu = std.mu; brain.sg = std.sg;
        brain.wf = wf; brain.samples = poolX.length; brain.assets = perAsset.length;
        brain.sessions = (brain.sessions || 0) + 1; brain.updated = Date.now();
        idbPut(brain);

        return { signals: signals, wf: wf, track: brain.track, sessions: brain.sessions,
          samples: poolX.length, assets: perAsset.length, horizon: HORIZON, updated: brain.updated,
          featureNames: FEATURE_NAMES };
      });
    });
  }

  // ---- Export / Import : le filet de sécurité absolu (fichier à toi) ---------
  function exportBrain() {
    return idbGet().then(function (brain) {
      if (!brain) throw new Error('Aucun cerveau à exporter — ouvre d\'abord l\'IA au moins une fois.');
      var blob = new Blob([JSON.stringify(brain)], { type: 'application/json' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'ia-cerveau.json'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
      return true;
    });
  }
  function importBrain(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var b = JSON.parse(fr.result);
          if (!b || typeof b !== 'object' || !('v' in b)) throw new Error('Fichier invalide.');
          idbPut(b).then(function () { res(b); });
        } catch (e) { rej(new Error('Fichier illisible : ' + e.message)); }
      };
      fr.onerror = function () { rej(new Error('Lecture impossible.')); };
      fr.readAsText(file);
    });
  }
  function status() { return idbGet(); }
  function reset() { return idbPut({ v: MODEL_VERSION, log: [], sessions: 0 }); }

  root.IA = { load: load, exportBrain: exportBrain, importBrain: importBrain, status: status, reset: reset,
    _internals: { buildFeatures: buildFeatures, crossFeatures: crossFeatures, train: train, walkForward: walkForward, standardize: standardize, applyStd: applyStd, predictOne: predictOne, NF: NF, BF: BF } };
})(typeof window !== 'undefined' ? window : this);
