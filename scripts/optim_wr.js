#!/usr/bin/env node
'use strict';
/**
 * Recherche des réglages qui MAXIMISENT LE TAUX DE RÉUSSITE.
 *
 * C'est une demande explicite, assumée comme telle. Le script rapporte
 * toujours l'espérance et le profit factor à côté du taux de réussite, pour
 * que le prix payé soit visible sur la même ligne.
 *
 *   MECH_CACHE=... node scripts/optim_wr.js --n 800 --min 20
 */
const { execFile } = require('child_process');
const { metriques } = require('./lib/metriques.js');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });
const N    = +(args.n || 800);
const MIN  = +(args.min || 20);
const PAR  = +(args.par || 8);

// Fenêtres horaires candidates, toutes dans la séance de New York.
const FENETRES = [
  ['09:30', '11:00'], ['09:30', '10:30'], ['09:30', '10:00'], ['09:45', '10:30'],
  ['09:45', '11:00'], ['10:00', '10:30'], ['10:00', '11:00'], ['10:00', '10:15'],
  ['09:30', '12:00'], ['09:30', '16:00'], ['10:15', '11:00']
];
const GRILLE = {
  tp1:     ['0.3', '0.5', '0.75', '1.0', '1.25'],
  tp2:     ['1.0', '1.5', '2.0', '2.5', 'dol'],
  part:    ['0.3', '0.5', '0.7', '0.9'],
  disp:    ['off', 'fvg', 'atr', 'taille'],
  dispx:   ['0.5', '1.0', '1.5'],
  sl:      ['ifvg', 'jambe', 'sweep'],
  sweep:   ['0', '1'],
  sweeptf: ['clock', '15m', '30m', '1h'],
  seuil:   ['1', '2', '3'],
  fvgn:    ['1', '2', '3'],
  touche2: ['0', '1'],
  maxjour: ['1', '2', '3'],
  atrmin:  ['0.3', '0.5', '0.8'],
  react:   ['8', '12', '20']
};
const pick = a => a[Math.floor(Math.random() * a.length)];

function tirage() {
  const c = {};
  Object.keys(GRILLE).forEach(k => c[k] = pick(GRILLE[k]));
  const f = pick(FENETRES); c.ghdeb = f[0]; c.ghfin = f[1];
  return c;
}
const cle = c => Object.keys(c).sort().map(k => k + '=' + c[k]).join(' ');

function lance(c) {
  const a = ['scripts/mech.js', '--dump', '1'];
  Object.keys(c).forEach(k => a.push('--' + k, c[k]));
  return new Promise(res => execFile('node', a, { maxBuffer: 1 << 26 }, (e, out) => {
    if (e) return res(null);
    try { res(JSON.parse(out).trades); } catch (_) { res(null); }
  }));
}

(async () => {
  const vus = new Set(), configs = [];
  while (configs.length < N) { const c = tirage(), k = cle(c); if (!vus.has(k)) { vus.add(k); configs.push(c); } }

  const res = [];
  for (let i = 0; i < configs.length; i += PAR) {
    const lot = configs.slice(i, i + PAR);
    const out = await Promise.all(lot.map(lance));
    out.forEach((tr, k) => {
      if (!tr || !tr.length) return;
      const m = metriques(tr);
      if (!m || m.n < MIN) return;
      res.push({ c: lot[k], m });
    });
    if (!((i / PAR) % 10)) process.stderr.write(`\r  ${Math.min(i + PAR, N)}/${N} · ${res.length} retenus`);
  }
  process.stderr.write('\n');

  const fmt = r => `${r.m.wr.toFixed(1).padStart(5)} %  ${String(r.m.n).padStart(3)} tr  ` +
    `esp ${(r.m.esperance >= 0 ? '+' : '') + r.m.esperance.toFixed(3)} R  PF ${r.m.pf === Infinity ? ' ∞' : r.m.pf.toFixed(2)}  ` +
    `DD ${r.m.maxDD.toFixed(1)} R  IC [${r.m.ic[0].toFixed(2)};${r.m.ic[1].toFixed(2)}]`;
  const court = c => `${c.ghdeb}-${c.ghfin} tp1=${c.tp1} tp2=${c.tp2} part=${c.part} disp=${c.disp} sl=${c.sl} ` +
    `sweep=${c.sweep}/${c.sweeptf} seuil=${c.seuil} fvgn=${c.fvgn} t2=${c.touche2} max=${c.maxjour} atr=${c.atrmin} react=${c.react}`;

  console.log(`\n${res.length} configurations retenues sur ${N} tirées (minimum ${MIN} trades)\n`);
  console.log('═══ LES 10 MEILLEURS TAUX DE RÉUSSITE ═══════════════════════════════════');
  res.slice().sort((a, b) => b.m.wr - a.m.wr).slice(0, 10)
     .forEach((r, i) => { console.log(`\n ${String(i + 1).padStart(2)}. ${fmt(r)}`); console.log(`     ${court(r.c)}`); });

  console.log('\n\n═══ POUR COMPARER · LES 5 MEILLEURES ESPÉRANCES ═════════════════════════');
  res.slice().sort((a, b) => b.m.esperance - a.m.esperance).slice(0, 5)
     .forEach((r, i) => { console.log(`\n ${String(i + 1).padStart(2)}. ${fmt(r)}`); console.log(`     ${court(r.c)}`); });

  // Le nuage complet : y a-t-il un lien entre taux de réussite et rentabilité ?
  const n = res.length;
  const mx = res.reduce((a, r) => a + r.m.wr, 0) / n, my = res.reduce((a, r) => a + r.m.esperance, 0) / n;
  const cov = res.reduce((a, r) => a + (r.m.wr - mx) * (r.m.esperance - my), 0);
  const sx = Math.sqrt(res.reduce((a, r) => a + (r.m.wr - mx) ** 2, 0));
  const sy = Math.sqrt(res.reduce((a, r) => a + (r.m.esperance - my) ** 2, 0));
  console.log(`\n\n  Corrélation entre taux de réussite et espérance, sur les ${n} configurations : ${(cov / (sx * sy)).toFixed(3)}`);
})();
