#!/usr/bin/env node
'use strict';
/**
 * Rapport complet d'une version du modèle.
 *
 * Lit le journal produit par n'importe quel moteur (--dump 1) et imprime
 * toutes les métriques exigées. Externe aux moteurs, donc utilisable sur une
 * version gelée sans la rouvrir.
 *
 *   node scripts/rapport.js --moteur scripts/baseline_v0.js --sym NQ=F --range 60d
 *   node scripts/rapport.js --json journal.json --nom V0
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const { metriques, parGroupe, DEFAUTS } = require('./lib/metriques.js');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });

const MOTEUR = args.moteur || 'scripts/baseline_v0.js';
const NOM    = args.nom || MOTEUR.split('/').pop().replace('.js', '');
const SYM    = args.sym || 'NQ=F';
const RANGE  = args.range || '60d';
const opts   = { pointval: +(args.pointval || DEFAUTS.pointval), slip: +(args.slip || DEFAUTS.slip),
                 comm: +(args.comm || DEFAUTS.comm), risque: +(args.risque || DEFAUTS.risque) };

// paramètres à transmettre au moteur (tout ce qui n'est pas à nous)
const MIENS = new Set(['moteur', 'nom', 'json', 'pointval', 'slip', 'comm', 'risque', 'csvout']);
const passe = [];
Object.keys(args).forEach(k => { if (!MIENS.has(k)) { passe.push('--' + k, args[k]); } });

let brut;
if (args.json) brut = JSON.parse(fs.readFileSync(args.json, 'utf-8'));
else brut = JSON.parse(execFileSync('node', [MOTEUR, '--dump', '1', ...passe],
  { encoding: 'utf-8', maxBuffer: 1 << 26 }));
// Un moteur peut renvoyer soit un tableau de trades, soit { entonnoir, trades }.
const trades = Array.isArray(brut) ? brut : brut.trades;
const entonnoir = Array.isArray(brut) ? null : brut.entonnoir;

const m = metriques(trades, opts);
const b = metriques(trades, Object.assign({ brut: true }, opts));

const l = (k, v) => console.log(`  ${k.padEnd(26, '.')} ${v}`);
const sgn = x => (x >= 0 ? '+' : '') + x.toFixed(3);

console.log('\n' + '═'.repeat(74));
console.log(`  ${NOM}   ·   ${SYM}   ·   ${RANGE}   ·   horloge ${args.horloge || '2m'}`);
console.log('═'.repeat(74));

console.log('\n  CONDITIONS');
l('Marché', SYM + '   (aucun autre marché mélangé)');
l('Période', RANGE);
l('Commission', `${opts.comm.toFixed(2)} $ aller-retour`);
l('Slippage', `${opts.slip} point par côté  (${opts.slip * 2} pt au total)`);
l('Valeur du point', opts.pointval + ' $');
l('Risque par trade', opts.risque + ' $');
l('Paramètres du moteur', passe.length ? passe.join(' ') : '(défauts)');

if (!m) { console.log('\n  Aucun trade.\n'); process.exit(0); }

console.log('\n  RÉSULTATS   (nets de frais)');
l('Trades', m.n);
l('Gagnants / perdants', `${m.gagnants} / ${m.perdants}`);
l('Win rate', m.wr.toFixed(1) + ' %');
l('Win rate hors BE', `${m.wrHorsBE.toFixed(1)} %   (${m.detail.g}G / ${m.detail.p}P / ${m.detail.be}BE)`);
l('RR moyen visé', m.avgR.toFixed(2));
l('Espérance', sgn(m.esperance) + ' R');
l('Profit factor', m.pf === Infinity ? '∞' : m.pf.toFixed(2));
l('Max drawdown', m.maxDD.toFixed(2) + ' R   (' + Math.round(m.maxDDdollars) + ' $)');
l('Cumulé', sgn(m.cumulR) + ' R');
l('P&L', (m.pnl >= 0 ? '+' : '') + Math.round(m.pnl) + ' $');
l('Coût moyen par trade', m.coutMoyen.toFixed(3) + ' R   (brut : ' + sgn(b.esperance) + ' R)');

console.log('\n  CE QUE L\'ÉCHANTILLON PERMET DE DIRE');
l('Écart-type', m.sd.toFixed(2) + ' R');
l('IC 95 % de l\'espérance', `[${m.ic[0].toFixed(3)} ; ${m.ic[1].toFixed(3)}]`);
l('Largeur de l\'IC', m.largeurIC.toFixed(3) + ' R');
l('t', m.t.toFixed(2) + (m.ic[0] > 0 ? '   ✅ espérance > 0' : '   ⚠️  zéro dans l\'intervalle'));

const bloc = (titre, groupes) => {
  const k = Object.keys(groupes); if (k.length < 2) return;
  console.log('\n  ' + titre);
  k.forEach(x => { const s = groupes[x]; if (!s) return;
    console.log(`    ${String(x).padEnd(12)} ${String(s.n).padStart(3)} tr · ${s.wr.toFixed(1).padStart(5)} % · ` +
      `esp ${sgn(s.esperance)} R · PF ${s.pf === Infinity ? '  ∞' : s.pf.toFixed(2)} · DD ${s.maxDD.toFixed(1)} R`); });
};
bloc('LONG vs SHORT', parGroupe(trades, t => t.sens || '?', opts));
bloc('PAR HEURE (New York)', parGroupe(trades, t => t.h == null ? '?' :
  String(Math.floor(t.h / 60)).padStart(2, '0') + 'h', opts));
bloc('PAR UNITÉ D\'IFVG', parGroupe(trades, t => t.tf || '?', opts));
bloc('PAR SORTIE', parGroupe(trades, t => t.o || '?', opts));

if (entonnoir) {
  console.log('\n  ENTONNOIR — où disparaissent les setups');
  const lib = { barres: 'bougies examinées', biais: 'biais tranché',
    neutre: 'rejetés : biais NEUTRE', dolAtteint: 'rejetés : DOL déjà atteint',
    niveauTrouve: 'niveau clé retenu', touche: 'niveau touché',
    ifvgTrouve: 'IFVG confirmé', entrees: 'entrées' };
  let prec = null;
  Object.entries(entonnoir).forEach(([k, v]) => {
    const perte = prec != null && v <= prec ? `   (−${prec - v})` : '';
    console.log(`    ${(lib[k] || k).padEnd(30)} ${String(v).padStart(7)}${perte}`);
    if (['biais', 'niveauTrouve', 'touche', 'ifvgTrouve'].includes(k)) prec = v;
  });
}
console.log('');
