'use strict';
/**
 * BACKTEST DU MODÈLE AMD — scripts/amd_test.js
 *
 * Le modèle est dans js/amd.js ; ce fichier ne fait que le rejouer et compter
 * de l'argent. Mêmes garde-fous que les autres mesures de ce dépôt :
 *
 *   — période commune à tous les marchés (scripts/lib/jeu.js) ;
 *   — un signal dont le stop coûte plus qu'un micro-contrat est écarté ;
 *   — comptage prudent : quand une bougie touche l'objectif ET le stop, le
 *     stop compte ;
 *   — les frais et le dérapage sont retirés de chaque trade.
 *
 *   --marches=NQ,ES     restreint l'étude
 *   --fenetre=9,10      la fenêtre de manipulation, heure de New York
 *   --cible=loin        viser la liquidité interne la plus lointaine
 *   --detail            la liste des trades
 */
const fs = require('fs'), path = require('path');
const J = require('./lib/jeu.js');
const RACINE = path.resolve(__dirname, '..');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/amd.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Modele, Position, AMD } = ctx;
const RISQUE = +(process.env.RISQUE_EUR || 250);

let m;
for (const a of process.argv.slice(2)) {
  if ((m = a.match(/^--fenetre=(\d+),(\d+)$/))) { AMD.CFG.manipDeb = +m[1] * 60; AMD.CFG.manipFin = +m[2] * 60; }
  if ((m = a.match(/^--cible=(proche|loin)$/))) AMD.CFG.cible = m[1];
  if ((m = a.match(/^--delai=(\d+)$/))) AMD.CFG.delai = +m[1];
  if ((m = a.match(/^--portee=([\d.]+)$/))) AMD.CFG.fvgPortee = +m[1];
  // La description ne parle pas de partiel : elle dit de viser la liquidité
  // interne. --partiel=0 tient la position entière jusqu'à l'objectif.
  if ((m = a.match(/^--partiel=([\d.]+)$/))) AMD.CFG.part = +m[1];
  if ((m = a.match(/^--tp1=([\d.]+)$/))) AMD.CFG.tp1 = +m[1];
  if ((m = a.match(/^--tp2=([\d.]+)$/))) AMD.CFG.tp2 = +m[1];
}
const DEM = (process.argv.find(a => a.startsWith('--marches=')) || '').slice(10);
const SYMS = DEM ? DEM.split(',').map(x => x.trim().toUpperCase() + '=F')
                 : ['NQ=F', 'ES=F', 'YM=F', 'RTY=F'];

const PS = {};
for (const s of SYMS) { const S = J.lireMarche(s, Modele.SERIES); if (S.m5 && S.m5.length > 200) PS[s] = S; }
if (!Object.keys(PS).length) { console.error('Cache absent.'); process.exit(1); }
const AL = J.aligner(Object.keys(PS).map(sym => ({ sym, S: PS[sym] })));

const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => v == null ? '—' : v.toFixed(1).replace('.', ',') + ' %';

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  MODÈLE AMD · manipulation puis distribution                         ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
for (const l of J.banniere(AL, Object.keys(PS).map(sym => ({ sym, S: PS[sym] })))) console.log('   ' + l);
console.log(`\n   manipulation ${Math.floor(AMD.CFG.manipDeb/60)}h-${Math.floor(AMD.CFG.manipFin/60)}h NY · ` +
  `cible ${AMD.CFG.cible} · délai ${AMD.CFG.delai} bougies · portée ${AMD.CFG.fvgPortee} ATR · ` +
  `${AMD.CFG.part ? Math.round(AMD.CFG.part * 100) + ' % à ' + AMD.CFG.tp1 : 'rien vendu'} · plafond ${AMD.CFG.tp2} R`);

const T = [];
let ecartes = 0;
for (const sym of Object.keys(PS)) {
  const S = PS[sym];
  const sigs = AMD.evaluer(S).tousSignaux;
  for (const s of sigs) {
    if (!J.jouable(sym, Math.abs(s.risq), RISQUE)) { ecartes++; continue; }
    const m1 = S.m1, f1 = m1 && m1.length && m1[0].t <= s.t, cs = f1 ? m1 : S.m5;
    let fin;
    try {
      fin = Position.suivre(s, cs, AMD.CFG, { prudent: true, maxBarres: f1 ? 1000 : 200,
        depuis: s.t, heure: AMD.heure, jourSignal: s.jour });
    } catch (e) { continue; }
    if (!fin || fin.ouverte) continue;
    T.push({ sym, jour: s.jour, min: s.min, sens: s.sens, manip: s.manip, risq: s.risq,
             r: fin.r - Position.cout(s.risq), sortie: fin.sortie });
  }
}
if (ecartes) console.log(`   ${ecartes} signal(aux) écarté(s) : stop trop large pour ${RISQUE} € de budget.`);
if (!T.length) { console.log('\n   AUCUN TRADE. Le modèle ne déclenche pas sur cette période.\n'); process.exit(0); }

function bilan(g) {
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
const B = bilan(T);
console.log(`\n   ${B.n} trades · ${pc(B.wr)} de réussite · ${eu(B.som / B.n * RISQUE)} par trade · ${eu(B.som * RISQUE)}`);
console.log(`   un gagnant ${eu(B.mg * RISQUE)} · un perdant ${eu(-B.mp * RISQUE)} · ` +
  `seuil d'équilibre ${pc(B.seuil)} · marge ${B.marge >= 0 ? '+' : ''}${pc(B.marge)}`);
console.log(`   pire creux ${eu(B.dd * RISQUE)}`);

const moitie = Math.floor(T.length / 2);
const s1 = bilan(T.slice(0, moitie)), s2 = bilan(T.slice(moitie));
console.log(`\n   deux moitiés : ${eu(s1.som * RISQUE)} puis ${eu(s2.som * RISQUE)}` +
  (s1.som > 0 && s2.som > 0 ? '  ✅' : '  ❌'));

function tableau(titre, cle) {
  const par = {};
  for (const x of T) { const k = cle(x); if (k == null) continue; (par[k] = par[k] || []).push(x); }
  const cles = Object.keys(par).sort();
  if (cles.length < 2) return;
  console.log(`\n   ── ${titre}`);
  for (const k of cles) {
    const b = bilan(par[k]);
    console.log(`      ${String(k).padEnd(16)} ${String(b.n).padStart(3)} · ${pc(b.wr).padStart(6)} · ` +
      `${eu(b.som / b.n * RISQUE).padStart(7)}/trade · ${eu(b.som * RISQUE).padStart(8)}`);
  }
}
tableau('PAR MARCHÉ', x => x.sym);
tableau('PAR SENS', x => x.sens);
tableau('PAR GRANDE LIQUIDITÉ BALAYÉE', x => x.manip);
tableau('PAR PORTE DE SORTIE', x => x.sortie);
tableau('PAR HEURE D\'ENTRÉE (NY)', x => String(Math.floor(x.min / 60)).padStart(2, '0') + 'h');

// ── L'ÉPREUVE DES FRAIS ───────────────────────────────────────────────────
// Tout l'avantage de ce modèle vient des sorties au point mort, qui supposent
// un stop servi au prix exact. Jusqu'où cette hypothèse tient-elle ?
console.log('\n   ── LE POINT DE RUPTURE DES FRAIS');
console.log('      dérapage par côté   par trade        total');
let rupture = null;
for (const slip of [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3]) {
  const som = T.reduce((a, x) => a + x.r, 0) - T.length * (slip * 2 + 4 / 20) / 100;
  // Le coût réel dépend du risque de chaque trade ; on le recalcule trade
  // par trade plutôt que d'appliquer une moyenne.
  let s2 = 0;
  for (const x of T) s2 += x.r + Position.cout(x.risq) - Position.cout(x.risq, { slip });
  const moy = s2 / T.length;
  if (rupture === null && moy < 0) rupture = slip;
  console.log(`      ${String(slip).padStart(5)} point(s)      ${eu(moy * RISQUE).padStart(7)}   ${eu(s2 * RISQUE).padStart(9)}` +
    (moy < 0 ? '   ❌ négative' : ''));
}
if (rupture === null) console.log('      ✅ tient jusqu\'à 3 points de dérapage par côté');
else console.log(`      ${rupture / 0.25 >= 4 ? '✅' : '⚠️ '} devient perdante à partir de ${rupture} point(s) ` +
  `(le marché en coûte souvent un quart de point, soit ${(rupture / 0.25).toFixed(1).replace('.', ',')} fois moins)`);

if (process.argv.includes('--detail')) {
  console.log('\n   ── LES TRADES');
  for (const x of T) console.log(`      ${x.jour} ${String(Math.floor(x.min/60)).padStart(2,'0')}h${String(x.min%60).padStart(2,'0')} ` +
    `${x.sym.padEnd(6)} ${x.sens.padEnd(5)} manip ${String(x.manip).padEnd(9)} ${x.sortie.padEnd(9)} ${eu(x.r * RISQUE).padStart(8)}`);
}
console.log('');
