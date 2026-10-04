'use strict';
/**
 * LE MODÈLE AMD SUR DEUX ANS — scripts/amd_longue.js
 *
 * Même modèle (js/amd.js), même comptage, mais l'unité d'exécution est le
 * 1 HEURE au lieu du 5 minutes, parce que c'est la seule qui remonte à deux
 * ans. Lire scripts/longue.js pour ce que cela coûte en précision.
 *
 * CE QUE CE TEST PEUT DIRE : l'idée — balayage de la grande liquidité puis
 * retour vers les liquidités internes — tient-elle sur deux ans ?
 * CE QU'IL NE PEUT PAS DIRE : combien la stratégie rapporte réellement. Les
 * entrées en 1 heure ne sont pas les entrées en 5 minutes.
 */
const fs = require('fs'), path = require('path');
const L = require('./longue.js');
const RACINE = path.resolve(__dirname, '..');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/amd.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Position, AMD } = ctx;
const RISQUE = +(process.env.RISQUE_EUR || 250);
const POINT = { 'NQ=F': 2, 'ES=F': 5, 'YM=F': 0.5, 'RTY=F': 5 }, TAUX = 1.08;

let m;
for (const a of process.argv.slice(2)) {
  if ((m = a.match(/^--fenetre=(\d+),(\d+)$/))) { AMD.CFG.manipDeb = +m[1] * 60; AMD.CFG.manipFin = +m[2] * 60; }
  if ((m = a.match(/^--cible=(proche|loin)$/))) AMD.CFG.cible = m[1];
  if ((m = a.match(/^--partiel=([\d.]+)$/))) AMD.CFG.part = +m[1];
  if ((m = a.match(/^--tp1=([\d.]+)$/))) AMD.CFG.tp1 = +m[1];
  if ((m = a.match(/^--tp2=([\d.]+)$/))) AMD.CFG.tp2 = +m[1];
  if ((m = a.match(/^--delai=(\d+)$/))) AMD.CFG.delaiMin = +m[1];
  if ((m = a.match(/^--portee=([\d.]+)$/))) AMD.CFG.fvgPortee = +m[1];
  if ((m = a.match(/^--smt=(ignore|exige|confirme)$/))) AMD.CFG.smt = m[1];
}
// En longue période le M30 n'existe pas : le modèle se rabat sur H1 et H4.
AMD.CFG.unitesFVG = ['h1', 'h4'];
AMD.CFG.unitesInt = ['h1', 'h4'];

const SYMS = (process.argv.find(a => a.startsWith('--marches=')) || '--marches=NQ,ES')
  .slice(10).split(',').map(x => x.trim().toUpperCase() + '=F');

const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => v == null ? '—' : v.toFixed(1).replace('.', ',') + ' %';
const an = t => new Date(t).toISOString().slice(0, 7);

function bilan(g) {
  if (!g.length) return null;
  const n = g.length, som = g.reduce((a, x) => a + x.r, 0);
  const G = g.filter(x => x.r > 0), P = g.filter(x => x.r <= 0);
  const mg = G.length ? G.reduce((a, x) => a + x.r, 0) / G.length : 0;
  const mp = P.length ? Math.abs(P.reduce((a, x) => a + x.r, 0) / P.length) : 0;
  const seuil = (mg + mp) ? mp / (mg + mp) * 100 : null;
  let cum = 0, pic = 0, dd = 0;
  for (const x of g) { cum += x.r; pic = Math.max(pic, cum); dd = Math.min(dd, cum - pic); }
  return { n, som, wr: G.length / n * 100, mg, mp, seuil, dd,
           marge: seuil == null ? null : G.length / n * 100 - seuil };
}

L.jeu(SYMS).then(PS => {
  if (!Object.keys(PS).length) { console.error('Aucune série longue période.'); process.exit(1); }
  // période commune
  const debut = Math.max(...Object.values(PS).map(S => S.h1[0].t));
  const fin = Math.min(...Object.values(PS).map(S => S.h1[S.h1.length - 1].t));
  for (const S of Object.values(PS)) {
    S.h1 = S.h1.filter(b => b.t >= debut && b.t <= fin);
    S.d1 = S.d1.filter(b => b.t <= fin);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  MODÈLE AMD SUR DEUX ANS · exécution 1 heure                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`   période commune : ${new Date(debut).toISOString().slice(0,10)} → ${new Date(fin).toISOString().slice(0,10)}`);
  console.log(`   ⚠️  unité d'exécution 1 heure, douze fois plus grossière que le 5 minutes.`);
  console.log(`      Une bougie d'une heure contient bien plus souvent le stop ET l'objectif ;`);
  console.log(`      le comptage prudent fait compter le stop. Le résultat est pessimiste,`);
  console.log(`      mais l'incertitude est grande. Ce test juge l'IDÉE, pas le rendement.`);
  console.log(`\n   manipulation ${Math.floor(AMD.CFG.manipDeb/60)}h-${Math.floor(AMD.CFG.manipFin/60)}h NY · cible ${AMD.CFG.cible} · ` +
    `${AMD.CFG.part ? Math.round(AMD.CFG.part*100) + ' % à ' + AMD.CFG.tp1 : 'rien vendu, point mort à ' + AMD.CFG.tp1} · plafond ${AMD.CFG.tp2} R · SMT ${AMD.CFG.smt}`);

  const T = [];
  let ecartes = 0, ambigus = 0;
  for (const sym of Object.keys(PS)) {
    const S = PS[sym];
    const CORREL = { 'NQ=F': 'ES=F', 'ES=F': 'NQ=F', 'YM=F': 'ES=F', 'RTY=F': 'ES=F' };
    for (const s of AMD.evaluer(S, { execution: 'h1', E: PS[CORREL[sym]] }).tousSignaux) {
      const coutUn = Math.abs(s.risq) * (POINT[sym] || 2) / TAUX;
      if (coutUn > RISQUE) { ecartes++; continue; }
      let fin2;
      try {
        fin2 = Position.suivre(s, S.h1, AMD.CFG, { prudent: true, maxBarres: 60,
          depuis: s.t, heure: AMD.heure, jourSignal: s.jour });
      } catch (e) { continue; }
      if (!fin2 || fin2.ouverte) continue;
      ambigus += fin2.ambigu > 0 ? 1 : 0;
      T.push({ sym, jour: s.jour, min: s.min, sens: s.sens, manip: s.manip, risq: s.risq,
               smt: s.smt, t: s.t, r: fin2.r - Position.cout(s.risq), sortie: fin2.sortie });
    }
  }
  T.sort((a, b) => a.t - b.t);
  if (ecartes) console.log(`   ${ecartes} signal(aux) écarté(s) : stop trop large pour ${RISQUE} € de budget.`);
  if (!T.length) { console.log('\n   AUCUN TRADE.\n'); return; }

  const B = bilan(T);
  console.log(`\n   ${B.n} trades · ${pc(B.wr)} de réussite · ${eu(B.som / B.n * RISQUE)} par trade · ${eu(B.som * RISQUE)}`);
  console.log(`   un gagnant ${eu(B.mg * RISQUE)} · un perdant ${eu(-B.mp * RISQUE)} · ` +
    `seuil d'équilibre ${pc(B.seuil)} · marge ${B.marge >= 0 ? '+' : ''}${pc(B.marge)}`);
  console.log(`   pire creux ${eu(B.dd * RISQUE)}`);
  console.log(`   ${ambigus} trade(s) sur ${T.length} (${(ambigus/T.length*100).toFixed(0)} %) tranchés par la convention intrabougie` +
    (ambigus / T.length > 0.15 ? '   ⚠️  beaucoup' : ''));

  // ── LE TEST QUI COMPTE SUR DEUX ANS : LA RÉGULARITÉ ────────────────────
  console.log('\n   ── TRIMESTRE PAR TRIMESTRE (c\'est ça qu\'on vient chercher ici)');
  const parT = {};
  for (const x of T) {
    const d = new Date(x.t), k = d.getUTCFullYear() + ' T' + (Math.floor(d.getUTCMonth() / 3) + 1);
    (parT[k] = parT[k] || []).push(x);
  }
  let positifs = 0, total = 0;
  for (const k of Object.keys(parT).sort()) {
    const b = bilan(parT[k]); total++;
    if (b.som > 0) positifs++;
    console.log(`      ${k}  ${String(b.n).padStart(3)} trades · ${pc(b.wr).padStart(6)} · ` +
      `${eu(b.som * RISQUE).padStart(9)}  ${b.som > 0 ? '✅' : '❌'}`);
  }
  console.log(`      → ${positifs} trimestre(s) positif(s) sur ${total}`);

  console.log('\n   ── SEMESTRE PAR SEMESTRE');
  const parS = {};
  for (const x of T) {
    const d = new Date(x.t), k = d.getUTCFullYear() + (d.getUTCMonth() < 6 ? ' S1' : ' S2');
    (parS[k] = parS[k] || []).push(x);
  }
  for (const k of Object.keys(parS).sort()) {
    const b = bilan(parS[k]);
    console.log(`      ${k}  ${String(b.n).padStart(3)} trades · ${pc(b.wr).padStart(6)} · ` +
      `marge ${(b.marge >= 0 ? '+' : '') + pc(b.marge)} · ${eu(b.som * RISQUE).padStart(9)}  ${b.som > 0 ? '✅' : '❌'}`);
  }

  function tab(titre, cle) {
    const par = {};
    for (const x of T) { const k = cle(x); if (k == null) continue; (par[k] = par[k] || []).push(x); }
    const cles = Object.keys(par).sort();
    if (cles.length < 2) return;
    console.log(`\n   ── ${titre}`);
    for (const k of cles) {
      const b = bilan(par[k]);
      console.log(`      ${String(k).padEnd(12)} ${String(b.n).padStart(3)} · ${pc(b.wr).padStart(6)} · ` +
        `${eu(b.som / b.n * RISQUE).padStart(7)}/trade · ${eu(b.som * RISQUE).padStart(9)}`);
    }
  }
  tab('PAR MARCHÉ', x => x.sym);
  tab('PAR SENS', x => x.sens);
  tab('PAR GRANDE LIQUIDITÉ BALAYÉE', x => x.manip);
  tab('PAR PORTE DE SORTIE', x => x.sortie);
  tab('PAR DIVERGENCE SMT', x => x.smt === true ? 'divergence' : x.smt === false ? 'les deux suivent' : 'non jugeable');

  // frais
  console.log('\n   ── LE POINT DE RUPTURE DES FRAIS');
  let rupture = null;
  for (const slip of [0, 0.25, 0.5, 1, 2, 3]) {
    let s2 = 0;
    for (const x of T) s2 += x.r + Position.cout(x.risq) - Position.cout(x.risq, { slip });
    const moy = s2 / T.length;
    if (rupture === null && moy < 0) rupture = slip;
    console.log(`      ${String(slip).padStart(5)} point(s)   ${eu(moy * RISQUE).padStart(7)}/trade   ${eu(s2 * RISQUE).padStart(10)}` +
      (moy < 0 ? '   ❌' : ''));
  }
  console.log(rupture === null ? '      ✅ tient jusqu\'à 3 points par côté'
    : `      ${rupture >= 1 ? '✅' : '⚠️ '} négative à partir de ${rupture} point(s) par côté`);
  console.log('');
});
