/*
 * Historique des trades — journal local (localStorage).
 * Enregistre chaque trade proposé par les bots (avec la SOURCE : quel bot),
 * clôture au TP (gagné) ou au SL (perdu) selon le prix courant, et calcule le bilan.
 */
(function (root) {
  'use strict';
  var STORE = 'tradeassist.history.v2'; // v2 : ignore l'ancien historique gonflé/faux
  var COOLDOWN = 6 * 3600 * 1000; // 6 h avant de rouvrir le même trade après clôture
  // Nettoyage des anciens journaux pourris (bug des faux gains empilés).
  try { localStorage.removeItem('tradeassist.history'); localStorage.removeItem('ictsmc.history'); } catch (e) {}

  function load() { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { return []; } }
  function save(h) { try { localStorage.setItem(STORE, JSON.stringify(h)); } catch (e) {} }

  // Ajoute les nouveaux trades (t = {sym,dir,entry,sl,tp,rr}) pour une source donnée.
  function record(list, source) {
    var h = load(), added = 0;
    (list || []).forEach(function (t) {
      if (!t || t.dir === 'WAIT' || t.rr == null || t.entry == null || t.sl == null || t.tp == null) return;
      // Si le prix courant a DÉJÀ dépassé le TP ou le SL, l'entrée est manquée/invalide -> on n'enregistre pas
      // (évite les faux "gagné/perdu" instantanés dès la création du trade).
      if (t.price != null) {
        var pr = +t.price, lg = t.dir === 'LONG';
        if (lg && (pr >= +t.tp || pr <= +t.sl)) return;
        if (!lg && (pr <= +t.tp || pr >= +t.sl)) return;
      }
      var open = h.some(function (x) { return x.status === 'open' && x.symbol === t.sym && x.source === source && x.direction === t.dir; });
      var cd = h.some(function (x) { return x.status === 'closed' && x.symbol === t.sym && x.source === source && x.direction === t.dir && x.closedTs && (Date.now() - x.closedTs) < COOLDOWN; });
      if (open || cd) return;
      h.push({ id: Date.now() + '-' + t.sym + '-' + source + '-' + Math.random().toString(36).slice(2, 6),
        ts: Date.now(), source: source, symbol: t.sym, direction: t.dir,
        entry: +t.entry, sl: +t.sl, tp: +t.tp, rr: +t.rr, motif: t.note || '',
        tf: t.tf || null, style: t.style || null,
        status: 'open', result: null, r: null });
      added++;
    });
    if (added) save(h);
    return added;
  }

  // Clôture les trades ouverts selon le prix courant {symbole: prix}.
  function evaluate(priceBySym) {
    var h = load(), changed = false;
    h.forEach(function (x) {
      if (x.status !== 'open') return;
      var p = priceBySym[x.symbol]; if (p == null) return;
      var hit = null;
      if (x.direction === 'LONG') { if (p <= x.sl) hit = 'loss'; else if (p >= x.tp) hit = 'win'; }
      else { if (p >= x.sl) hit = 'loss'; else if (p <= x.tp) hit = 'win'; }
      if (hit) { x.status = 'closed'; x.result = hit; x.closedTs = Date.now(); x.r = hit === 'win' ? x.rr : -1; changed = true; }
    });
    if (changed) save(h);
  }

  function bilan(source) {
    var all = load();
    if (source) all = all.filter(function (x) { return x.source === source; });
    var closed = all.filter(function (x) { return x.status === 'closed'; });
    var wins = closed.filter(function (x) { return x.result === 'win'; }).length;
    var rsum = closed.reduce(function (a, x) { return a + (x.r || 0); }, 0);
    return { total: closed.length, wins: wins, loss: closed.length - wins,
      open: all.filter(function (x) { return x.status === 'open'; }).length,
      rate: closed.length ? Math.round(wins / closed.length * 100) : null, rsum: +rsum.toFixed(1) };
  }

  // Liste des sources (bots) présentes dans le journal.
  function sources() {
    var seen = {}, out = [];
    load().forEach(function (x) { if (x.source && !seen[x.source]) { seen[x.source] = 1; out.push(x.source); } });
    return out;
  }

  // Statistiques avancées, globales ou filtrées par source.
  // R = multiple de risque (1 R = le risque du trade). 1 R ≈ 1 % du capital => 100 € sur 10 000 €.
  function stats(source) {
    var all = load();
    if (source) all = all.filter(function (x) { return x.source === source; });
    var openCount = all.filter(function (x) { return x.status === 'open'; }).length;
    var closed = all.filter(function (x) { return x.status === 'closed'; })
      .sort(function (a, b) { return (a.closedTs || a.ts) - (b.closedTs || b.ts); });
    var wins = closed.filter(function (x) { return x.result === 'win'; });
    var losses = closed.filter(function (x) { return x.result === 'loss'; });
    var grossWin = wins.reduce(function (a, x) { return a + (x.r || 0); }, 0);
    var grossLoss = Math.abs(losses.reduce(function (a, x) { return a + (x.r || 0); }, 0));
    var rsum = grossWin - grossLoss;
    var pf = grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? null : 0); // null = pas encore de perte (∞)
    // Courbe d'équité cumulée (en R) + drawdown max.
    var eq = [], run = 0, peak = 0, maxdd = 0;
    closed.forEach(function (x) {
      run += (x.r || 0); eq.push(+run.toFixed(2));
      if (run > peak) peak = run;
      if (peak - run > maxdd) maxdd = peak - run;
    });
    // Meilleur / pire trade (en R).
    var best = null, worst = null;
    closed.forEach(function (x) {
      if (best == null || (x.r || 0) > (best.r || 0)) best = x;
      if (worst == null || (x.r || 0) < (worst.r || 0)) worst = x;
    });
    // Série en cours (gains/pertes consécutifs, depuis la fin).
    var streak = 0, streakType = null;
    for (var i = closed.length - 1; i >= 0; i--) {
      if (streakType == null) { streakType = closed[i].result; streak = 1; }
      else if (closed[i].result === streakType) streak++;
      else break;
    }
    return {
      total: closed.length, wins: wins.length, loss: losses.length, open: openCount,
      rate: closed.length ? Math.round(wins.length / closed.length * 100) : null,
      rsum: +rsum.toFixed(1), eur: Math.round(rsum * 100),
      pf: pf, maxdd: +maxdd.toFixed(1),
      avgWin: wins.length ? +(grossWin / wins.length).toFixed(2) : null,
      avgLoss: losses.length ? +(grossLoss / losses.length).toFixed(2) : null,
      rrPlanned: closed.length ? +(closed.reduce(function (a, x) { return a + (x.rr || 0); }, 0) / closed.length).toFixed(2) : null,
      best: best ? { sym: best.symbol, r: best.r } : null,
      worst: worst ? { sym: worst.symbol, r: worst.r } : null,
      streak: streak, streakType: streakType, equity: eq,
      avgR: closed.length ? +(rsum / closed.length).toFixed(2) : null, // gain moyen par trade (R)
      avgDurMs: closed.length ? Math.round(closed.reduce(function (a, x) { return a + ((x.closedTs || x.ts) - x.ts); }, 0) / closed.length) : null
    };
  }

  function reset() { save([]); }

  root.History = { load: load, record: record, evaluate: evaluate, bilan: bilan, stats: stats, sources: sources, reset: reset };
})(typeof window !== 'undefined' ? window : this);
