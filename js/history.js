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

  function reset() { save([]); }

  root.History = { load: load, record: record, evaluate: evaluate, bilan: bilan, reset: reset };
})(typeof window !== 'undefined' ? window : this);
