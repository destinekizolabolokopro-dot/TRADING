'use strict';
/**
 * Apprentissage statistique : chaque bot mémorise ses trades dans un fichier JSON,
 * évalue les trades en cours (gagné au TP / perdu au SL), calcule son taux de
 * réussite par TYPE de setup, et devient plus sélectif sur ce qui perd.
 * (Ce n'est pas une IA magique : c'est un vrai suivi de performance qui filtre.)
 */
const fs = require('fs');
const path = require('path');

const MIN_SAMPLE = 5; // nb de trades clôturés avant de juger un setup

function file(name) { return path.join(__dirname, '..', 'data', name + '.json'); }
function load(name) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) { return []; }
}
function save(name, hist) {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(hist, null, 2));
}

// Clôture les trades en cours selon le prix courant (gagné au TP, perdu au SL).
function evaluate(hist, priceBySym) {
  for (const h of hist) {
    if (h.status !== 'open') continue;
    const p = priceBySym[h.symbol];
    if (p == null) continue;
    let hit = null;
    if (h.direction === 'LONG') { if (p <= h.sl) hit = 'loss'; else if (p >= h.tp) hit = 'win'; }
    else { if (p >= h.sl) hit = 'loss'; else if (p <= h.tp) hit = 'win'; }
    if (hit) {
      h.status = 'closed'; h.result = hit; h.closedTs = Date.now();
      const risk = Math.abs(h.entry - h.sl), rew = Math.abs(h.tp - h.entry);
      h.r = hit === 'win' ? +(risk > 0 ? rew / risk : 0).toFixed(2) : -1;
    }
  }
  return hist;
}

// Taux de réussite par setup {setup: {n, wins, rate, rsum}}
function stats(hist) {
  const m = {};
  for (const h of hist) {
    if (h.status !== 'closed') continue;
    const k = h.setup || h.strategy || 'default';
    if (!m[k]) m[k] = { n: 0, wins: 0, rsum: 0 };
    m[k].n++; if (h.result === 'win') m[k].wins++; m[k].rsum += h.r || 0;
  }
  for (const k in m) m[k].rate = Math.round((m[k].wins / m[k].n) * 100);
  return m;
}

// Facteur de confiance appris pour un setup : <1 il évite, >1 il renforce.
function factor(st, setup) {
  const s = st[setup];
  if (!s || s.n < MIN_SAMPLE) return { f: 1, phase: 'test', rate: s ? s.rate : null, n: s ? s.n : 0 };
  const f = Math.max(0.3, Math.min(1.6, (s.wins / s.n) / 0.5));
  return { f, phase: s.rate >= 50 ? 'confiance' : 'évite', rate: s.rate, n: s.n };
}

// Bilan global {total, wins, loss, open, rate, rsum}
function bilan(hist) {
  const closed = hist.filter((h) => h.status === 'closed');
  const wins = closed.filter((h) => h.result === 'win').length;
  return {
    total: closed.length, wins, loss: closed.length - wins,
    open: hist.filter((h) => h.status === 'open').length,
    rate: closed.length ? Math.round((wins / closed.length) * 100) : null,
    rsum: +closed.reduce((a, h) => a + (h.r || 0), 0).toFixed(2),
  };
}

// Empêche de rouvrir le même trade (symbole+setup+sens) tant qu'un est ouvert.
function alreadyOpen(hist, symbol, setup, direction) {
  return hist.some((h) => h.status === 'open' && h.symbol === symbol && h.setup === setup && h.direction === direction);
}

module.exports = { load, save, evaluate, stats, factor, bilan, alreadyOpen, MIN_SAMPLE };
