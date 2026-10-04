'use strict';
/**
 * LES ÉPREUVES DU MODÈLE AMD — scripts/amd_epreuves.js
 *
 * Elles ne disent pas si le modèle gagne : le backtest le dit déjà. Elles
 * disent s'il gagne POUR UNE RAISON. Un modèle à 37 % de réussite et gros
 * rapport est précisément celui dont le total peut tenir à quelques trades.
 *
 * Six épreuves, toutes déclarées avant lancement :
 *   1. le SENS tiré à pile ou face, mêmes instants, mêmes stops
 *   2. l'INSTANT tiré au sort dans la fenêtre, même sens, même risque
 *   3. tout au hasard
 *   4. le point de rupture des frais
 *   5. le poids de la convention intrabougie
 *   6. le poids d'un seul MOIS, et celui du plus gros trade
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
const TIRAGES = +(process.env.TIRAGES || 200);

let m;
for (const a of process.argv.slice(2))
  if ((m = a.match(/^--fenetre=(\d+),(\d+)$/))) { AMD.CFG.manipDeb = +m[1] * 60; AMD.CFG.manipFin = +m[2] * 60; }
AMD.CFG.unitesFVG = ['h1', 'h4'];
AMD.CFG.unitesInt = ['h1', 'h4'];
const SYMS = (process.argv.find(a => a.startsWith('--marches=')) || '--marches=NQ,ES')
  .slice(10).split(',').map(x => x.trim().toUpperCase() + '=F');

const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => v == null ? '—' : v.toFixed(1).replace('.', ',') + ' %';

// Générateur reproductible : une épreuve qui change de réponse à chaque
// lancement ne prouve rien et ne se vérifie pas.
function alea(graine) {
  let s = graine >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function bilan(T) {
  if (!T.length) return null;
  const n = T.length, som = T.reduce((a, x) => a + x, 0);
  return { n, som, moy: som / n, wr: T.filter(x => x > 0).length / n * 100 };
}
function epreuve(titre, question, echantillons, vrai) {
  const b = echantillons.map(bilan).filter(Boolean);
  if (!b.length) { console.log(`\n── ${titre}\n   (aucun trade produit)`); return; }
  const moys = b.map(x => x.moy * RISQUE).sort((a, c) => a - c);
  const med = moys[Math.floor(moys.length / 2)];
  const bat = moys.filter(x => x >= vrai).length;
  console.log(`\n── ${titre}`);
  console.log(`   ${question}`);
  console.log(`   ${b.length} tirages · médiane ${eu(med)} par trade · de ${eu(moys[0])} à ${eu(moys[moys.length - 1])}`);
  console.log(`   tirages au moins aussi bons que le modèle : ${bat}/${b.length}  (${Math.round(bat / b.length * 100)} %)`);
  const p = bat / b.length;
  console.log(p <= 0.05 ? '   ✅ le modèle bat le hasard dans ce test'
    : p <= 0.15 ? `   ⚠️  marginal : le hasard fait aussi bien une fois sur ${Math.round(1 / p)}`
    : '   ❌ LA RÈGLE N\'APPORTE RIEN DE DÉMONTRABLE : le hasard fait aussi bien');
}

L.jeu(SYMS).then(PS => {
  if (!Object.keys(PS).length) { console.error('Aucune série.'); process.exit(1); }
  const debut = Math.max(...Object.values(PS).map(S => S.h1[0].t));
  const fin = Math.min(...Object.values(PS).map(S => S.h1[S.h1.length - 1].t));
  for (const S of Object.values(PS)) {
    S.h1 = S.h1.filter(b => b.t >= debut && b.t <= fin);
    S.d1 = S.d1.filter(b => b.t <= fin);
  }

  // ── les signaux réels ──────────────────────────────────────────────────
  const JEU = [];
  for (const sym of Object.keys(PS)) {
    const sigs = AMD.evaluer(PS[sym], { execution: 'h1' }).tousSignaux
      .filter(s => Math.abs(s.risq) * (POINT[sym] || 2) / TAUX <= RISQUE);
    JEU.push({ sym, S: PS[sym], sigs });
  }
  const suivre = (S, pos, jour, prudent) => {
    try {
      const f = Position.suivre(pos, S.h1, AMD.CFG,
        { prudent: prudent !== false, maxBarres: 60, depuis: pos.t,
          heure: AMD.heure, jourSignal: jour });
      return f && !f.ouverte ? f : null;
    } catch (e) { return null; }
  };
  const niveaux = (sens, entree, risq, t) => {
    const L2 = sens === 'LONG';
    return { sens, t, entree, risq,
      sl: L2 ? entree - risq : entree + risq,
      tp1: L2 ? entree + risq * AMD.CFG.tp1 : entree - risq * AMD.CFG.tp1,
      tp: L2 ? entree + risq * AMD.CFG.tp2 : entree - risq * AMD.CFG.tp2 };
  };

  const REEL = [];
  for (const j of JEU) for (const s of j.sigs) {
    const f = suivre(j.S, s, s.jour);
    if (f) REEL.push({ r: f.r - Position.cout(s.risq), t: s.t, sym: j.sym, ambigu: f.ambigu, risq: s.risq });
  }
  const B = bilan(REEL.map(x => x.r));
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log(`║  LES ÉPREUVES DU MODÈLE AMD · 2 ans · ${String(B.n).padStart(3)} trades                    ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`   ${new Date(debut).toISOString().slice(0,10)} → ${new Date(fin).toISOString().slice(0,10)} · exécution 1 heure`);
  console.log(`\nLE MODÈLE : ${B.n} trades · ${pc(B.wr)} · ${eu(B.moy * RISQUE)} par trade · ${eu(B.som * RISQUE)}`);
  const VRAI = B.moy * RISQUE;

  // ── 1. LE SENS AU HASARD ───────────────────────────────────────────────
  const e1 = [];
  for (let g = 1; g <= TIRAGES; g++) {
    const r = alea(g * 2654435761), T = [];
    for (const j of JEU) for (const s of j.sigs) {
      const sens = r() < 0.5 ? 'LONG' : 'SHORT';
      const f = suivre(j.S, niveaux(sens, s.entree, Math.abs(s.risq), s.t), s.jour);
      if (f) T.push(f.r - Position.cout(s.risq));
    }
    e1.push(T);
  }
  epreuve('ÉPREUVE 1 · LE SENS TIRÉ À PILE OU FACE',
    'Mêmes instants, mêmes stops, mais le sens au hasard. Le scénario sert-il ?', e1, VRAI);

  // ── 2. L'INSTANT AU HASARD DANS LA FENÊTRE ─────────────────────────────
  const h = m2 => Math.floor(m2 / 60);
  const e2 = [];
  for (let g = 1; g <= TIRAGES; g++) {
    const r = alea(g * 104729), T = [];
    for (const j of JEU) {
      const parJour = {};
      for (const b of j.S.h1) {
        const e = AMD.heure(b.t);
        if (e.dow < 1 || e.dow > 5) continue;
        if (e.min < AMD.CFG.distDeb || e.min >= AMD.CFG.distFin) continue;
        (parJour[e.jour] = parJour[e.jour] || []).push(b);
      }
      for (const s of j.sigs) {
        const dispo = parJour[s.jour];
        if (!dispo || !dispo.length) continue;
        const b = dispo[Math.floor(r() * dispo.length)];
        const f = suivre(j.S, niveaux(s.sens, b.c, Math.abs(s.risq), b.t), s.jour);
        if (f) T.push(f.r - Position.cout(s.risq));
      }
    }
    e2.push(T);
  }
  epreuve('ÉPREUVE 2 · L\'INSTANT TIRÉ AU SORT DANS LA FENÊTRE',
    `Mêmes jours, même sens, même risque — mais une bougie au hasard entre ${h(AMD.CFG.distDeb)}h et ${h(AMD.CFG.distFin)}h NY.`,
    e2, VRAI);

  // ── 3. TOUT AU HASARD ──────────────────────────────────────────────────
  const e3 = [];
  for (let g = 1; g <= TIRAGES; g++) {
    const r = alea(g * 15485863), T = [];
    for (const j of JEU) {
      const parJour = {};
      for (const b of j.S.h1) {
        const e = AMD.heure(b.t);
        if (e.dow < 1 || e.dow > 5) continue;
        if (e.min < AMD.CFG.distDeb || e.min >= AMD.CFG.distFin) continue;
        (parJour[e.jour] = parJour[e.jour] || []).push(b);
      }
      for (const s of j.sigs) {
        const dispo = parJour[s.jour];
        if (!dispo || !dispo.length) continue;
        const b = dispo[Math.floor(r() * dispo.length)];
        const sens = r() < 0.5 ? 'LONG' : 'SHORT';
        const f = suivre(j.S, niveaux(sens, b.c, Math.abs(s.risq), b.t), s.jour);
        if (f) T.push(f.r - Position.cout(s.risq));
      }
    }
    e3.push(T);
  }
  epreuve('ÉPREUVE 3 · TOUT AU HASARD (instant ET sens)',
    'Il ne reste que la fenêtre horaire, la taille du stop et la gestion de sortie.', e3, VRAI);

  // ── 4. LES FRAIS ───────────────────────────────────────────────────────
  console.log('\n── ÉPREUVE 4 · LE POINT DE RUPTURE DES FRAIS');
  let rupture = null;
  for (const slip of [0, 0.25, 0.5, 1, 2, 3, 5]) {
    let s2 = 0;
    for (const x of REEL) s2 += x.r + Position.cout(x.risq) - Position.cout(x.risq, { slip });
    const moy = s2 / REEL.length;
    if (rupture === null && moy < 0) rupture = slip;
    console.log(`      ${String(slip).padStart(5)} point(s)   ${eu(moy * RISQUE).padStart(7)}/trade   ${eu(s2 * RISQUE).padStart(10)}` + (moy < 0 ? '   ❌' : ''));
  }
  console.log(rupture === null ? '   ✅ tient jusqu\'à 5 points de dérapage par côté'
    : `   ${rupture >= 1 ? '✅' : '⚠️ '} négative à partir de ${rupture} point(s) par côté`);

  // ── 5. LA CONVENTION INTRABOUGIE ───────────────────────────────────────
  console.log('\n── ÉPREUVE 5 · LE POIDS DE L\'HYPOTHÈSE INTRABOUGIE');
  let ambigus = 0;
  for (const [nom, prudent] of [['prudent (le stop compte)', true], ['optimiste (l\'objectif compte)', false]]) {
    const T = [];
    for (const j of JEU) for (const s of j.sigs) {
      const f = suivre(j.S, s, s.jour, prudent);
      if (f) { T.push(f.r - Position.cout(s.risq)); if (prudent && f.ambigu > 0) ambigus++; }
    }
    const b = bilan(T);
    console.log(`      ${nom.padEnd(32)} ${pc(b.wr).padStart(7)} · ${eu(b.moy * RISQUE).padStart(8)} par trade · ${eu(b.som * RISQUE).padStart(9)}`);
  }
  console.log(`      trades où une bougie touche les deux : ${ambigus} sur ${REEL.length}` +
    ` (${(ambigus / REEL.length * 100).toFixed(1).replace('.', ',')} %)`);

  // ── 6. LE POIDS D'UN MOIS, ET DU PLUS GROS TRADE ───────────────────────
  console.log('\n── ÉPREUVE 6 · LE POIDS D\'UN SEUL MOIS, ET D\'UN SEUL TRADE');
  const tot = REEL.reduce((a, x) => a + x.r, 0);
  const parMois = {};
  for (const x of REEL) { const k = new Date(x.t).toISOString().slice(0, 7); (parMois[k] = parMois[k] || []).push(x.r); }
  const mois = Object.keys(parMois).map(k => ({ k, som: parMois[k].reduce((a, v) => a + v, 0), n: parMois[k].length }));
  mois.sort((a, b2) => b2.som - a.som);
  let bascule = 0;
  for (const mm of mois) if (tot - mm.som <= 0) bascule++;
  console.log(`      total sur tout              ${eu(tot * RISQUE).padStart(9)}`);
  for (const mm of mois.slice(0, 3))
    console.log(`      sans ${mm.k} (${String(mm.n).padStart(2)} trades)      ${eu((tot - mm.som) * RISQUE).padStart(9)}`);
  console.log(`      ...`);
  for (const mm of mois.slice(-2))
    console.log(`      sans ${mm.k} (${String(mm.n).padStart(2)} trades)      ${eu((tot - mm.som) * RISQUE).padStart(9)}`);
  console.log(`      ${mois.length} mois · retirer le meilleur laisse ${eu((tot - mois[0].som) * RISQUE)}`);
  console.log(bascule ? `      ❌ ${bascule} mois suffisent à rendre le total négatif.`
    : '      ✅ aucun mois seul ne renverse le signe du total.');
  const tri = REEL.map(x => x.r).sort((a, b2) => b2 - a);
  const top5 = tri.slice(0, 5).reduce((a, v) => a + v, 0);
  console.log(`      les 5 plus gros gains pèsent ${eu(top5 * RISQUE)} sur ${eu(tot * RISQUE)}` +
    ` (${Math.round(top5 / tot * 100)} % du total)` + (top5 / tot > 0.6 ? '   ⚠️' : '   ✅'));
  console.log(`      sans eux : ${eu((tot - top5) * RISQUE)}` + (tot - top5 > 0 ? '  ✅ encore positif' : '  ❌ négatif'));
  console.log('');
});
