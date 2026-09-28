#!/usr/bin/env node
'use strict';
/**
 * LA RÉFÉRENCE — l'empreinte exacte de ce que le modèle produit aujourd'hui.
 *
 * Les 44 vérifications existantes attrapent les incohérences INTERNES : un
 * stop du mauvais côté, un bilan qui ne colle pas à sa liste. Elles
 * n'attrapent PAS le pire cas : une modification du modèle qui change
 * silencieusement les résultats sans rien casser. Passer de 42 à 30 signaux
 * est parfaitement cohérent — et catastrophique si ce n'était pas voulu.
 *
 * Ce fichier fige l'empreinte. scripts/test.js la compare, et tout écart
 * FAIT ÉCHOUER les tests. Pour l'accepter, il faut la régénérer à la main :
 *
 *   node scripts/reference.js          vérifie
 *   node scripts/reference.js --ecrire accepte le changement et le fige
 *
 * Écrire la référence est donc un ACTE DÉLIBÉRÉ, visible dans un commit.
 * C'est exactement ce qui manquait : rien ne distinguait « j'ai amélioré le
 * modèle » de « j'ai cassé le modèle sans m'en rendre compte ».
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const REF = path.join(RACINE, 'data', 'reference.json');

function charger() {
  const ctx = {};
  for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
    new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
  return ctx;
}

function empreinte() {
  const lire = (s, i, r) => {
    const f = path.join(CACHE, `${s}_${i}_${r}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
  };
  const D = { m1: lire('NQF','1m','8d'), m2: lire('NQF','2m','60d'), m5: lire('NQF','5m','60d'),
              m15: lire('NQF','15m','60d'), h1: lire('NQF','1h','6mo'), d1: lire('NQF','1d','1y') };
  if (!D.m5) return null;                        // pas de cache : rien à comparer
  const E = lire('ESF','5m','60d') ? { m5: lire('ESF','5m','60d'), m15: lire('ESF','15m','60d'),
                                       h1: lire('ESF','1h','6mo'), d1: lire('ESF','1d','1y') } : null;
  const { Modele, Position } = charger();
  const C = Modele.CFG;
  const d = Modele.evaluer(D, E);
  const sigs = (d && d.tousSignaux) || [];

  // L'empreinte porte sur ce qui compte : les niveaux de chaque signal. Elle
  // ne porte PAS sur les bougies — elles glissent chez Yahoo, et ce n'est pas
  // le modèle qui change.
  const lignes = sigs.map(s => [s.t, s.sens, +s.entree.toFixed(2), +s.sl.toFixed(2),
                                +s.tp1.toFixed(2), +s.tp.toFixed(2), s.niveau].join('|'));
  const hash = crypto.createHash('sha256').update(lignes.join('\n')).digest('hex').slice(0, 16);

  // et le résultat, rejoué
  let gagnants = 0, total = 0, somme = 0;
  for (const s of sigs) {
    const fin = Position.suivre(s, D.m5, C, { prudent: true, maxBarres: 200, depuis: s.t,
      heure: Modele.heure, jourSignal: Modele.heure(s.t).jour });
    if (fin.ouverte) continue;
    total++; if (fin.r > 0) gagnants++;
    somme += fin.r - Position.cout(s.risq);
  }
  return {
    cfg: C, signaux: sigs.length, hash: hash,
    clos: total, gagnants: gagnants,
    reussite: total ? +(gagnants / total * 100).toFixed(1) : null,
    euros: Math.round(somme * 250)
  };
}

const e = empreinte();
if (!e) { console.log('Cache absent — impossible de calculer la référence.'); process.exit(0); }

if (process.argv.includes('--ecrire')) {
  fs.writeFileSync(REF, JSON.stringify(Object.assign({
    ecritLe: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    note: 'Régénéré à la main. Tout écart fait échouer scripts/test.js.'
  }, e), null, 1) + '\n');
  console.log(`Référence figée : ${e.signaux} signaux · ${e.reussite} % · ${e.euros >= 0 ? '+' : ''}${e.euros} € · empreinte ${e.hash}`);
} else {
  if (!fs.existsSync(REF)) { console.log('Aucune référence. Lancer : node scripts/reference.js --ecrire'); process.exit(1); }
  const r = JSON.parse(fs.readFileSync(REF, 'utf-8'));
  const ecarts = [];
  if (r.hash !== e.hash) ecarts.push(`empreinte des signaux : ${r.hash} → ${e.hash}`);
  if (r.signaux !== e.signaux) ecarts.push(`nombre de signaux : ${r.signaux} → ${e.signaux}`);
  if (r.reussite !== e.reussite) ecarts.push(`réussite : ${r.reussite} % → ${e.reussite} %`);
  if (r.euros !== e.euros) ecarts.push(`résultat : ${r.euros} € → ${e.euros} €`);
  for (const k of Object.keys(r.cfg)) if (JSON.stringify(r.cfg[k]) !== JSON.stringify(e.cfg[k]))
    ecarts.push(`réglage ${k} : ${JSON.stringify(r.cfg[k])} → ${JSON.stringify(e.cfg[k])}`);
  if (!ecarts.length) { console.log(`Conforme à la référence du ${r.ecritLe} · ${e.signaux} signaux · ${e.reussite} %`); process.exit(0); }
  console.error('\n⚠️  LE MODÈLE NE PRODUIT PLUS LA MÊME CHOSE\n');
  ecarts.forEach(x => console.error('   ' + x));
  console.error('\nSi le changement est voulu : node scripts/reference.js --ecrire\n');
  process.exit(1);
}
