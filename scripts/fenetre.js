'use strict';
/**
 * LA FENÊTRE À SURVEILLER — scripts/fenetre.js
 *
 * Rend, en secondes depuis l'époque UTC, le début et la fin de la période où
 * le robot doit relever. Elle est DÉDUITE des stratégies, jamais écrite en dur.
 *
 * POURQUOI. La tâche planifiée portait « 13 h 15 → 15 h 45 UTC » en dur, ce qui
 * correspondait à la fenêtre 09 h → 10 h New York. Le modèle AMD ouvre à 08 h :
 * le robot aurait commencé à surveiller SOIXANTE-QUINZE MINUTES après
 * l'ouverture, en ratant précisément l'heure où tombent 64 % des balayages de
 * grande liquidité. Un réglage changé à un endroit et pas à l'autre ne se voit
 * pas : il faut qu'il n'y ait qu'un endroit.
 *
 * La fenêtre retenue est l'UNION des trois stratégies, élargie de la marge de
 * retard de Yahoo en amont et d'une queue en aval pour les sorties.
 *
 *   node scripts/fenetre.js          « <début> <fin> » en secondes
 *   node scripts/fenetre.js --clair  la même chose, lisible
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/kintt.js', 'js/amd.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);

// Marge amont : Yahoo sert ses bougies avec dix à quinze minutes de retard, et
// un relevé qui commence pile à l'ouverture ne voit encore rien.
const AVANT = 15, APRES = 45;

const deb = Math.min(ctx.Modele.CFG.ghDeb, ctx.Kintt ? ctx.Kintt.CFG.obs : Infinity,
                     ctx.AMD.CFG.manipDeb);
const fin = Math.max(ctx.Modele.CFG.ghFin, ctx.Kintt ? ctx.Kintt.CFG.fin : 0,
                     ctx.AMD.CFG.distFin);

/** Les secondes UTC d'aujourd'hui à `min` minutes, heure de New York. */
function utcDe(min) {
  const m = new Date();
  const jour = m.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // On cherche l'instant UTC dont l'heure new-yorkaise vaut `min` ce jour-là.
  // Le décalage change deux fois l'an : on le mesure plutôt que de le supposer.
  const sonde = new Date(jour + 'T12:00:00Z');
  const ny = new Date(sonde.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const utc = new Date(sonde.toLocaleString('en-US', { timeZone: 'UTC' }));
  const decalage = Math.round((utc - ny) / 60000);          // minutes, positif
  return Math.floor(Date.parse(jour + 'T00:00:00Z') / 1000) + (min + decalage) * 60;
}

const d = utcDe(deb - AVANT), f = utcDe(fin + APRES);
if (process.argv.includes('--clair')) {
  const h = s => new Date(s * 1000).toISOString().slice(11, 16);
  const hn = m => String(Math.floor(m / 60)).padStart(2, '0') + ' h ' + String(m % 60).padStart(2, '0');
  console.log(`stratégies : ${hn(deb)} → ${hn(fin)} New York`);
  console.log(`surveillance : ${h(d)} → ${h(f)} UTC (marge ${AVANT} min avant, ${APRES} min après)`);
} else {
  console.log(d + ' ' + f);
}
