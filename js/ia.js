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
  var ASSETS = [
    { sym: 'BTC/USD', src: 'BTCUSDT', cls: 'crypto' },
    { sym: 'ETH/USD', src: 'ETHUSDT', cls: 'crypto' },
    { sym: 'SOL/USD', src: 'SOLUSDT', cls: 'crypto' },
    { sym: 'XRP/USD', src: 'XRPUSDT', cls: 'crypto' },
    { sym: 'BNB/USD', src: 'BNBUSDT', cls: 'crypto' },
    { sym: 'EUR/USD', src: 'EURUSDT', cls: 'forex' },
    { sym: 'XAU/USD', src: 'PAXGUSDT', cls: 'forex' }
  ];
  var HORIZON = 4;              // on prédit le sens du mouvement ~4 bougies (jours) plus tard
  var MODEL_VERSION = 3;        // version des features : si elle change, on ré-apprend de zéro
  var FEATURE_NAMES = [
    'Biais HTF (EMA50/200)', 'Zone premium/discount', 'RSI (excès)', 'Momentum (ROC)',
    'Régime (efficiency)', 'Displacement', 'Position dans le range (liquidité)',
    'Cassure de structure (BOS)', 'Volatilité (ATR)', 'Dernière variation', 'Pente EMA50'
  ];
  var NF = FEATURE_NAMES.length;

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
    var X = [], meta = [];
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
      meta.push({ i: i, price: price });
    }
    // Étiquette : le prix a-t-il MONTÉ dans HORIZON bougies ? (uniquement là où le futur est connu)
    var y = [], Xt = [], last = null;
    for (var k = 0; k < meta.length; k++) {
      var idx = meta[k].i, future = idx + HORIZON;
      if (future < n) { y.push(cl[future] > cl[idx] ? 1 : 0); Xt.push(X[k]); }
      else if (idx === n - 1) { last = X[k]; } // dernière bougie = point de prédiction "live"
    }
    if (last == null) last = X[X.length - 1];
    return { X: Xt, y: y, live: last, price: cl[n - 1] };
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

  // Walk-forward HONNÊTE : on entraîne sur le passé, on teste sur du JAMAIS-VU, on cumule.
  function walkForward(X, y) {
    var n = X.length; if (n < 120) return null;
    var folds = 4, block = Math.floor(n / (folds + 1)), correct = 0, tested = 0, base = 0;
    for (var f = 1; f <= folds; f++) {
      var cut = block * f, testEnd = Math.min(n, cut + block);
      var Xtr = X.slice(0, cut), ytr = y.slice(0, cut);
      if (Xtr.length < 40) continue;
      var s = standardize(Xtr), Xs = Xtr.map(function (x) { return applyStd(x, s); });
      var w = train(Xs, ytr, null, 200);
      // classe majoritaire du train = référence "bête" à battre
      var ones = ytr.reduce(function (a, b) { return a + b; }, 0), maj = ones >= ytr.length / 2 ? 1 : 0;
      for (var t = cut; t < testEnd; t++) {
        var p = predictOne(X[t], w, s), pred = p >= 0.5 ? 1 : 0;
        if (pred === y[t]) correct++;
        if (maj === y[t]) base++;
        tested++;
      }
    }
    if (!tested) return null;
    return { acc: Math.round(correct / tested * 100), baseline: Math.round(base / tested * 100), tested: tested };
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
    var path = '/api/v3/klines?symbol=' + src + '&interval=1d&limit=400';
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
  // brain.log = [{sym, ts, dueTs, price, prob, dir, price0, graded, correct}]
  // À chaque ouverture, on note celles dont l'échéance (HORIZON jours) est passée.
  function gradeLog(brain, priceBySym, dataBySym) {
    var log = brain.log || [], now = Date.now(), changed = false;
    log.forEach(function (e) {
      if (e.graded) return;
      // On cherche la bougie de clôture à l'échéance dans les données fraîches, sinon on
      // attend simplement (le prix actuel sert de repli une fois l'échéance dépassée).
      var priceNow = priceBySym[e.sym];
      if (now < e.dueTs || priceNow == null) return;
      var went = priceNow > e.price0 ? 1 : 0;         // le prix a-t-il monté depuis l'entrée ?
      e.correct = (went === (e.dir === 'up' ? 1 : 0)) ? 1 : 0;
      e.graded = true; e.priceEnd = priceNow; changed = true;
    });
    // Bilan du track record réel (prédictions live notées)
    var graded = log.filter(function (e) { return e.graded; });
    var ok = graded.filter(function (e) { return e.correct; }).length;
    brain.track = { total: graded.length, correct: ok, rate: graded.length ? Math.round(ok / graded.length * 100) : null };
    // On borne le journal (garde les 400 plus récents)
    if (log.length > 400) brain.log = log.slice(log.length - 400);
    return changed;
  }
  // Enregistre les prédictions "live" du jour (une par actif, pas de doublon < 1 j).
  function logPredictions(brain, signals) {
    brain.log = brain.log || [];
    var now = Date.now(), day = 864e5;
    signals.forEach(function (s) {
      if (s.dir === 'neutre') return;
      var dup = brain.log.some(function (e) { return e.sym === s.sym && !e.graded && (now - e.ts) < day; });
      if (dup) return;
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

      // 1) On assemble le grand jeu de données (toutes paires poolées = plus d'exemples)
      var poolX = [], poolY = [], perAsset = [];
      rows.forEach(function (r) {
        var f = buildFeatures(r.c);
        if (!f) return;
        poolX = poolX.concat(f.X); poolY = poolY.concat(f.y);
        perAsset.push({ a: r.a, f: f });
      });
      if (poolX.length < 120) return null;

      return idbGet().then(function (saved) {
        // 2) Cerveau sauvegardé (apprentissage continu) — sauf si les features ont changé
        var brain = (saved && saved.v === MODEL_VERSION) ? saved : { v: MODEL_VERSION, log: (saved && saved.log) || [], sessions: 0 };
        var warm = brain.w || null;

        // 3) Précision honnête HORS échantillon (walk-forward) — le vrai niveau
        var wf = walkForward(poolX, poolY);

        // 4) Entraînement sur TOUT le dispo, en repartant du cerveau précédent (continu)
        var std = standardize(poolX);
        var Xs = poolX.map(function (x) { return applyStd(x, std); });
        var w = train(Xs, poolY, warm, brain.sessions > 0 ? 120 : 250);

        // 5) Prédictions "live" par actif + concepts qui poussent la décision
        var priceBySym = {}, dataBySym = {};
        var signals = perAsset.map(function (pa) {
          var prob = predictOne(pa.f.live, w, std);
          priceBySym[pa.a.sym] = pa.f.price; dataBySym[pa.a.sym] = pa.f;
          var dir = prob >= 0.56 ? 'up' : prob <= 0.44 ? 'down' : 'neutre';
          var conf = Math.round(Math.abs(prob - 0.5) * 200); // 0..100
          // Contribution de chaque concept = poids × feature standardisée (pourquoi la déci)
          var xs = applyStd(pa.f.live, std);
          var contrib = [];
          for (var j = 0; j < NF; j++) contrib.push({ n: FEATURE_NAMES[j], v: w[j] * xs[j] });
          contrib.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
          var drivers = contrib.slice(0, 3).map(function (cc) { return { n: cc.n, d: cc.v >= 0 ? 'haussier' : 'baissier' }; });
          return { sym: pa.a.sym, cls: pa.a.cls, price: pa.f.price, prob: +prob.toFixed(3),
            dir: dir, conf: conf, drivers: drivers };
        }).sort(function (a, b) { return b.conf - a.conf; });

        // 6) Apprendre de ses erreurs : noter les anciennes prédictions, puis logger celles du jour
        gradeLog(brain, priceBySym, dataBySym);
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
    _internals: { buildFeatures: buildFeatures, train: train, walkForward: walkForward, standardize: standardize, applyStd: applyStd, predictOne: predictOne, NF: NF } };
})(typeof window !== 'undefined' ? window : this);
