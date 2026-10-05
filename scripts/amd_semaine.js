'use strict';
/**
 * LE MODÈLE AMD, SEMAINE PAR SEMAINE — scripts/amd_semaine.js
 *
 * « Ça fait quoi en une semaine ? » — la question se pose comme ça et se
 * répond comme ça. Un total de deux ans ne dit rien de ce qu'on vit : ce qui
 * compte est la semaine médiane, la part de semaines perdantes, et la pire.
 *
 * Les deux mesures sont données côte à côte, parce qu'elles ne disent pas la
 * même chose :
 *   — 5 MINUTES sur 60 jours : la vraie exécution, mais peu de semaines ;
 *   — 1 HEURE sur 2 ans : beaucoup de semaines, mais une exécution plus
 *     grossière qui rate des entrées.
 * L'écart entre les deux est lui-même une information.
 */
const fs = require('fs'), path = require('path');
const J = require('./lib/jeu.js');
const L = require('./longue.js');
const RACINE = path.resolve(__dirname, '..');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/amd.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Modele, Position, AMD } = ctx;
const RISQUE = +(process.env.RISQUE_EUR || 250);
const POINT = { 'NQ=F': 2, 'ES=F': 5, 'YM=F': 0.5, 'RTY=F': 5 }, TAUX = 1.08;
AMD.CFG.manipDeb = 8 * 60; AMD.CFG.manipFin = 10 * 60;
const SYMS = ['NQ=F', 'ES=F'];

const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const sem = t => {
  const d = new Date(t), l = new Date(d);
  l.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return l.toISOString().slice(0, 10);
};

function rejouer(PS, exe, series) {
  const T = [];
  for (const sym of Object.keys(PS)) {
    const S = PS[sym];
    for (const s of AMD.evaluer(S, { execution: exe }).tousSignaux) {
      if (Math.abs(s.risq) * (POINT[sym] || 2) / TAUX > RISQUE) continue;
      const cs = S[exe];
      let f;
      try {
        f = Position.suivre(s, cs, AMD.CFG, { prudent: true, maxBarres: exe === 'h1' ? 60 : 200,
          depuis: s.t, heure: AMD.heure, jourSignal: s.jour });
      } catch (e) { continue; }
      if (!f || f.ouverte) continue;
      T.push({ t: s.t, r: f.r - Position.cout(s.risq) });
    }
  }
  return T.sort((a, b) => a.t - b.t);
}

function parSemaine(titre, T, nSemAttendu) {
  const par = {};
  for (const x of T) (par[sem(x.t)] = par[sem(x.t)] || []).push(x.r);
  const cles = Object.keys(par).sort();
  const soms = cles.map(k => par[k].reduce((a, v) => a + v, 0) * RISQUE).sort((a, b) => a - b);
  const nb = cles.map(k => par[k].length);
  const med = soms[Math.floor(soms.length / 2)];
  const medN = nb.slice().sort((a, b) => a - b)[Math.floor(nb.length / 2)];
  const pos = soms.filter(x => x > 0).length, nul = soms.filter(x => x === 0).length;
  console.log(`\n── ${titre}`);
  console.log(`   ${T.length} trades sur ${cles.length} semaines tradées` +
    (nSemAttendu ? ` (${nSemAttendu} semaines de calendrier : ${nSemAttendu - cles.length} sans aucun trade)` : ''));
  console.log(`   trades par semaine : ${medN} en médiane · de ${Math.min(...nb)} à ${Math.max(...nb)}`);
  console.log(`\n   LA SEMAINE MÉDIANE : ${eu(med)}`);
  console.log(`   semaines gagnantes : ${pos}/${cles.length} (${Math.round(pos / cles.length * 100)} %)` +
    (nul ? ` · ${nul} à zéro` : ''));
  console.log(`   la pire : ${eu(soms[0])} · la meilleure : ${eu(soms[soms.length - 1])}`);
  const q1 = soms[Math.floor(soms.length * 0.25)], q3 = soms[Math.floor(soms.length * 0.75)];
  console.log(`   une semaine sur deux tombe entre ${eu(q1)} et ${eu(q3)}`);
  // la moyenne, qui est ce qu'on projette, et l'écart avec la médiane
  const moy = soms.reduce((a, v) => a + v, 0) / cles.length;
  console.log(`   moyenne ${eu(moy)} par semaine tradée` +
    (nSemAttendu ? ` · ${eu(soms.reduce((a, v) => a + v, 0) / nSemAttendu)} par semaine de calendrier` : ''));
  if (moy > med * 1.5 && med > 0) console.log(`   ⚠️  la moyenne dépasse largement la médiane : quelques semaines portent le total.`);
  // la distribution, en clair
  const tranches = [[-1e9, -500, 'perte > 500 €'], [-500, -1, 'perte 1-500 €'], [-1, 1, 'nulle'],
                    [1, 500, 'gain 1-500 €'], [500, 1500, 'gain 500-1500 €'], [1500, 1e9, 'gain > 1500 €']];
  console.log('\n   RÉPARTITION DES SEMAINES');
  for (const [lo, hi, nom] of tranches) {
    const n = soms.filter(x => x > lo && x <= hi).length;
    if (!n) continue;
    console.log(`      ${nom.padEnd(18)} ${String(n).padStart(3)} · ${String(Math.round(n / cles.length * 100)).padStart(3)} %  ` +
      '█'.repeat(Math.round(n / cles.length * 40)));
  }
}

// ── 5 minutes, 60 jours ───────────────────────────────────────────────────
const P5 = {};
for (const s of SYMS) { const S = J.lireMarche(s, Modele.SERIES); if (S.m5 && S.m5.length > 200) P5[s] = S; }
J.aligner(Object.keys(P5).map(sym => ({ sym, S: P5[sym] })));
AMD.CFG.unitesFVG = ['m30', 'h1']; AMD.CFG.unitesInt = ['m30', 'h1', 'h4'];
const T5 = rejouer(P5, 'm5');

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  MODÈLE AMD · CE QUE ÇA DONNE EN UNE SEMAINE                         ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
const j5 = new Set(T5.map(x => new Date(x.t).toISOString().slice(0, 10)));
parSemaine('EXÉCUTION 5 MINUTES · 60 jours (la vraie exécution)', T5, 10);

// ── 1 heure, 2 ans ────────────────────────────────────────────────────────
L.jeu(SYMS).then(PS => {
  const debut = Math.max(...Object.values(PS).map(S => S.h1[0].t));
  const fin = Math.min(...Object.values(PS).map(S => S.h1[S.h1.length - 1].t));
  for (const S of Object.values(PS)) {
    S.h1 = S.h1.filter(b => b.t >= debut && b.t <= fin);
    S.d1 = S.d1.filter(b => b.t <= fin);
  }
  AMD.CFG.unitesFVG = ['h1', 'h4']; AMD.CFG.unitesInt = ['h1', 'h4'];
  const TH = rejouer(PS, 'h1');
  const semaines = Math.round((fin - debut) / (7 * 86400e3));
  parSemaine('EXÉCUTION 1 HEURE · 2 ans (plus de semaines, exécution plus grossière)', TH, semaines);
  console.log('\n   ⚠️  Les deux mesures ne sont pas comparables trade pour trade : en');
  console.log('      1 heure le modèle voit moins d\'entrées et les prend plus tard.');
  console.log('      La première dit ce qui se passerait vraiment, sur peu de semaines ;');
  console.log('      la seconde dit si la régularité tient, sur beaucoup de semaines.\n');
});
