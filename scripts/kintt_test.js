#!/usr/bin/env node
'use strict';
/** Mesure la stratégie kintt, et la compare à js/modele.js sur les mêmes jours. */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/kintt.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Modele, Kintt, Position } = ctx;
const lire = (s, i, r) => {
  const f = path.join(CACHE, `${s}_${i}_${r}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
};
const D = {}, E = {};
for (const x of Modele.SERIES) D[x.cle] = lire('NQF', x.interval, x.range);
for (const x of Modele.SERIES2) E[x.cle] = lire('ESF', x.interval, x.range);
if (!D.m5) { console.error('Cache absent.'); process.exit(1); }

const RISQUE = 250, COUT = 0.7;
function mesurer(sigs, cfg, nom, parSignal) {
  const T = [];
  for (const s of sigs) {
    // kintt vise un PRIX, pas un multiple du risque. Le suivi partagé
    // raisonne en multiples : on lui donne donc, pour ce signal-là, le
    // multiple équivalent. Sans ça le plafond vaut NaN et tout s'effondre.
    //
    // ⚠️ CETTE LIGNE S'APPLIQUAIT AUSSI AU MODÈLE, et c'était faux. Le champ
    // `rr` du modèle valait 0,61 — le gain si tout est touché, pas le rapport
    // à l'objectif — et il écrasait donc tp2 : le modèle était mesuré avec un
    // objectif final à 0,61 fois le risque au lieu de 2,50. Résultat annoncé
    // 2 116 € au lieu de 2 622 €, pendant des jours. Le plafond par signal ne
    // concerne QUE les stratégies qui visent une zone.
    const c2 = parSignal && s.rr != null ? Object.assign({}, cfg, { tp2: s.rr }) : cfg;
    const fin = Position.suivre(s, D.m5, c2, {
      prudent: true, maxBarres: 200, depuis: s.t,
      heure: Modele.heure, jourSignal: Modele.heure(s.t).jour });
    if (fin.ouverte) continue;
    T.push({ r: fin.r - COUT / s.risq, o: fin.sortie, t: s.t, rr: s.rr,
             jour: Modele.heure(s.t).jour });
  }
  const n = T.length; if (!n) { console.log(`  ${nom} : aucun trade clos`); return null; }
  const R = T.reduce((a, x) => a + x.r, 0), moy = R / n;
  const pos = T.filter(x => x.r > 0), neg = T.filter(x => x.r < 0);
  const gM = pos.length ? pos.reduce((a, x) => a + x.r, 0) / pos.length : 0;
  const pM = neg.length ? Math.abs(neg.reduce((a, x) => a + x.r, 0)) / neg.length : 0;
  let pic = 0, cum = 0, dd = 0;
  for (const x of T.slice().sort((a, b) => a.t - b.t)) { cum += x.r; if (cum > pic) pic = cum; if (pic - cum > dd) dd = pic - cum; }
  const seuil = (gM + pM) > 0 ? pM / (gM + pM) * 100 : 0;
  const eu = v => (v >= 0 ? '+' : '') + Math.round(v) + ' €';
  console.log(`  ${nom.padEnd(22)} ${String(n).padStart(3)} trades · ${(pos.length / n * 100).toFixed(1).padStart(5)} % gagnés · ` +
    `${eu(moy * RISQUE).padStart(7)} par trade · ${eu(R * RISQUE).padStart(8)} au total`);
  console.log(`  ${''.padEnd(22)} gain ${eu(gM * RISQUE)} · perte ${eu(-pM * RISQUE)} · seuil ${seuil.toFixed(1)} % · ` +
    `creux ${eu(-dd * RISQUE)} · objectif visé ${(T.reduce((a, x) => a + (x.rr || 0), 0) / n).toFixed(2)}× le risque`);
  const par = {}; T.forEach(x => par[x.o] = (par[x.o] || 0) + 1);
  console.log(`  ${''.padEnd(22)} issues : ` + Object.keys(par).sort().map(k => k + ' ' + par[k]).join(' · '));
  return { n, wr: pos.length / n * 100, euros: R * RISQUE, jours: [...new Set(T.map(x => x.jour))] };
}

console.log('\nLES DEUX STRATÉGIES SUR LES MÊMES 60 JOURS\n');
const dm = Modele.evaluer(D, E);
mesurer(dm.tousSignaux, Modele.CFG, 'modele (09h-10h)');
console.log('');
const dk = Kintt.evaluer(D, E);
mesurer(dk.tousSignaux, Kintt.CFG, 'kintt (10h-12h)', true);
console.log('\n  où passent les bougies :');
const E1 = dk.entonnoir;
for (const k of Object.keys(E1)) console.log('    ' + k.padEnd(20) + String(E1[k]).padStart(6));

console.log('\nVARIANTES DE kintt\n');
const base = JSON.parse(JSON.stringify(Kintt.CFG));
const CAS = [
  ['sans la variante M15', { accepteM15: false }],
  ['IFVG seul, sans CISD', { exigeCISD: false }],
  ['CISD seul, sans IFVG', { exigeIFVG: false }],
  ['objectif à distance fixe', { objectif: 'R' }],
  ['avec partiel 90 % à 0,4', { part: 0.9, tp1: 0.4 }],
  ['fenêtre primaire seule', { fin: 11 * 60 }],
  ['sans confirmation ES', { confirmeES: false }],
  ['zones M5 comprises', { unites: 'M5,M15,M30,H1,H4' }]
];
for (const [nom, opt] of CAS) {
  Object.assign(Kintt.CFG, base, opt);
  mesurer(Kintt.evaluer(D, E).tousSignaux, Kintt.CFG, nom, true);
}
Object.assign(Kintt.CFG, base);
