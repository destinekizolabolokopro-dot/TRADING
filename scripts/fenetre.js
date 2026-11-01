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

/**
 * LA FENÊTRE DE TOUTE L'ANNÉE, en minutes UTC depuis minuit.
 *
 * POURQUOI ELLE EXISTE. `utcDe` donne la bonne fenêtre POUR AUJOURD'HUI, et
 * c'est ce qu'il faut au robot qui tourne. Mais les créneaux de la tâche
 * planifiée sont écrits en UTC FIXE dans le YAML, alors que la fenêtre suit
 * New York : ils se décalent d'une heure deux fois par an et personne ne le
 * voit venir. C'est arrivé le 1er novembre 2026 — les États-Unis ont quitté
 * l'heure d'été, la fenêtre est passée de 11 h 45 → 16 h 45 à 12 h 45 →
 * 17 h 45 UTC, et les trois premiers créneaux mouraient avant l'ouverture.
 *
 * Les créneaux doivent donc couvrir l'UNION des deux saisons. On mesure les
 * deux décalages au lieu de les supposer : −4 h et −5 h aujourd'hui, mais
 * c'est une règle politique qui a déjà changé et rechangera.
 */
function decalageLe(iso) {
  const sonde = new Date(iso + 'T12:00:00Z');
  const ny = new Date(sonde.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const utc = new Date(sonde.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((utc - ny) / 60000);
}
function union() {
  const an = new Date().getUTCFullYear();
  const decs = [decalageLe(an + '-01-15'), decalageLe(an + '-07-15')];
  const dMin = Math.min(...decs), dMax = Math.max(...decs);
  return { deb: (deb - AVANT) + dMin, fin: (fin + APRES) + dMax, dMin: dMin, dMax: dMax };
}

const d = utcDe(deb - AVANT), f = utcDe(fin + APRES);
if (process.argv.includes('--union')) {
  const u = union();
  const hn = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  if (process.argv.includes('--clair')) {
    console.log(`décalages New York mesurés : −${u.dMin / 60} h (été) et −${u.dMax / 60} h (hiver)`);
    console.log(`fenêtre de TOUTE L'ANNÉE : ${hn(u.deb)} → ${hn(u.fin)} UTC`);
    console.log(`  c'est elle que les créneaux du YAML doivent couvrir, pas celle du jour.`);
  } else {
    console.log(u.deb + ' ' + u.fin);
  }
} else if (process.argv.includes('--clair')) {
  const h = s => new Date(s * 1000).toISOString().slice(11, 16);
  const hn = m => String(Math.floor(m / 60)).padStart(2, '0') + ' h ' + String(m % 60).padStart(2, '0');
  console.log(`stratégies : ${hn(deb)} → ${hn(fin)} New York`);
  console.log(`surveillance : ${h(d)} → ${h(f)} UTC (marge ${AVANT} min avant, ${APRES} min après)`);
} else {
  console.log(d + ' ' + f);
}
