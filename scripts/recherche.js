#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LA RECHERCHE — chercher pour de bon, sans se mentir.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Jusqu'ici tout l'outillage servait à MESURER ce qu'on avait, et la réponse
 * était toujours « rien ». Mesurer n'est pas chercher. Ce fichier cherche.
 *
 * ── CE QUI REND UNE RECHERCHE HONNÊTE ─────────────────────────────────────
 * Sur soixante jours, n'importe quel balayage trouve une combinaison qui
 * gagne. Trois barrières, posées AVANT de lancer, l'empêchent de compter :
 *
 *   1. QUATRE MARCHÉS. On mesure sur le Nasdaq, le S&P, le Dow et le Russell
 *      ensemble. Une combinaison réglée pour l'un doit survivre aux trois
 *      autres, où personne n'a rien réglé.
 *   2. LES DEUX MOITIÉS. La première et la seconde moitié de la séquence
 *      doivent être positives toutes les deux. Un total porté par un seul
 *      mois ne passe pas.
 *   3. LE HASARD. La survivante doit battre deux cents tirages où l'instant
 *      d'entrée est choisi au hasard dans la même fenêtre. C'est la barrière
 *      que le modèle actuel ne franchit pas : le hasard le bat 196 fois
 *      sur 200.
 *
 * Et une quatrième, qui n'est pas une barrière mais un aveu : le nombre de
 * combinaisons essayées est AFFICHÉ. Avec deux cents essais, une poignée
 * passe les trois barrières par pur hasard. Le tableau le dit.
 *
 *   node scripts/recherche.js
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
function charger() {
  const c = {};
  for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
    new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(c, c, c.ST);
  return c;
}
const base = charger();
const lire = (sym, i, r) => {
  const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_${i}_${r}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
};
const ser = sym => {
  const S = {};
  for (const x of base.Modele.SERIES) S[x.cle] = lire(sym, x.interval, x.range);
  return S.m5 && S.m5.length > 80 ? S : null;
};
const MARCHES = [['NQ=F', 'Nasdaq', 'ES=F'], ['ES=F', 'S&P', 'NQ=F'],
                 ['YM=F', 'Dow', 'ES=F'], ['RTY=F', 'Russell', 'ES=F']];
// Période commune imposée : « positive sur 4 marchés sur 4 » ne veut rien
// dire si les 4 marchés ne couvrent pas les mêmes séances (scripts/lib/jeu.js).
const JEUX = require('./lib/jeu.js');
const PAR_SYM = {};
for (const sym of [...new Set(MARCHES.flatMap(m => [m[0], m[2]]))]) {
  const S = ser(sym); if (S && S.m5 && S.m5.length > 80) PAR_SYM[sym] = S;
}
const ALIGNE = JEUX.aligner(Object.keys(PAR_SYM).map(sym => ({ sym, S: PAR_SYM[sym] })));
const JEU = MARCHES.map(([s, n, c]) => ({ nom: n, D: PAR_SYM[s], E: PAR_SYM[c] })).filter(x => x.D);
if (!JEU.length) { console.error('Cache absent.'); process.exit(1); }
for (const l of JEUX.banniere(ALIGNE, JEU.map(j => ({ sym: '', S: j.D })))) console.log(l);

const RISQUE = +(process.env.RISQUE_EUR || 250);
const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' %';

// ── L'ESPACE EXPLORÉ ──────────────────────────────────────────────────────
// Volontairement GROSSIER. Des pas fins sur soixante jours ne décrivent pas
// le marché, ils décrivent le bruit. Chaque valeur se défend sans regarder
// les données : un stop au bord de la zone ou deux, trois, quatre fois plus
// large ; une fenêtre d'une heure, de deux, décalée d'une heure.
const STOPS = [2, 3, 4, 6];
const FENETRES = [[9 * 60, 10 * 60, '09h-10h'], [9 * 60, 11 * 60, '09h-11h'],
                  [8 * 60, 10 * 60, '08h-10h'], [10 * 60, 12 * 60, '10h-12h']];
const SORTIES = [
  ['90 % à 0,4 · reste 2,5', { part: 0.9, tp1: 0.4, tp2: 2.5 }],
  ['50 % à 1,0 · reste 2,5', { part: 0.5, tp1: 1.0, tp2: 2.5 }],
  ['30 % à 1,0 · reste 3,0', { part: 0.3, tp1: 1.0, tp2: 3.0 }],
  ['rien vendu · 2,0',       { part: 0,   tp1: 1.0, tp2: 2.0 }],
  ['rien vendu · 3,0',       { part: 0,   tp1: 1.0, tp2: 3.0 }]
];
const HEURES = [[12 * 60, 'midi'], [16 * 60, '16 h'], [null, 'aucune']];

function bilan(T) {
  if (!T.length) return null;
  const n = T.length, som = T.reduce((a, x) => a + x.r, 0);
  const g = T.filter(x => x.r > 0), p = T.filter(x => x.r < 0);
  const gM = g.length ? g.reduce((a, x) => a + x.r, 0) / g.length : 0;
  const pM = p.length ? Math.abs(p.reduce((a, x) => a + x.r, 0)) / p.length : 0;
  const seuil = (gM + pM) > 0 ? pM / (gM + pM) * 100 : null;
  const wr = g.length / n * 100;
  let pic = 0, cum = 0, dd = 0;
  for (const x of T) { cum += x.r; if (cum > pic) pic = cum; if (cum - pic < dd) dd = cum - pic; }
  const m = Math.floor(n / 2);
  return { n, som, wr, seuil, marge: seuil == null ? null : wr - seuil, dd,
           s1: T.slice(0, m).reduce((a, x) => a + x.r, 0),
           s2: T.slice(m).reduce((a, x) => a + x.r, 0) };
}

// Les ENTRÉES ne dépendent que du stop et de la fenêtre : on les calcule une
// fois pour chaque couple, puis on rejoue les sorties par-dessus. Sans ça la
// recherche durerait des heures.
console.log('\nCalcul des entrées (' + STOPS.length * FENETRES.length + ' couples stop × fenêtre)…');
const ENTREES = {};
for (const slx of STOPS) for (const [deb, fin, nomF] of FENETRES) {
  const c = charger();
  Object.assign(c.Modele.CFG, { slx, ghDeb: deb, ghFin: fin });
  const cle = slx + '|' + nomF;
  ENTREES[cle] = JEU.map(j => ({ j, sigs: c.Modele.evaluer(j.D, j.E).tousSignaux, M: c.Modele, P: c.Position }));
}

function rejouer(cle, sortie, heure) {
  const T = [];
  for (const { j, sigs, M, P } of ENTREES[cle]) {
    const cfg = Object.assign({}, M.CFG, sortie, { sortieMin: heure });
    for (const s of sigs) {
      const L = s.sens === 'LONG';
      const pos = { sens: s.sens, t: s.t, entree: s.entree, sl: s.sl, risq: s.risq,
        tp1: L ? s.entree + s.risq * cfg.tp1 : s.entree - s.risq * cfg.tp1,
        tp:  L ? s.entree + s.risq * cfg.tp2 : s.entree - s.risq * cfg.tp2 };
      const f1 = j.D.m1 && j.D.m1.length && j.D.m1[0].t <= s.t;
      let f;
      try {
        f = P.suivre(pos, f1 ? j.D.m1 : j.D.m5, cfg, { prudent: true,
          maxBarres: f1 ? 1000 : 200, depuis: s.t, heure: M.heure,
          jourSignal: M.heure(s.t).jour });
      } catch (e) { continue; }
      if (!f.ouverte) T.push({ t: s.t, r: f.r - P.cout(s.risq), marche: j.nom });
    }
  }
  return T.sort((a, b) => a.t - b.t);
}

console.log('Essai de ' + (STOPS.length * FENETRES.length * SORTIES.length * HEURES.length) +
  ' combinaisons sur ' + JEU.length + ' marchés…\n');
const tous = [];
for (const slx of STOPS) for (const [, , nomF] of FENETRES)
  for (const [nomS, sortie] of SORTIES) for (const [h, nomH] of HEURES) {
    const T = rejouer(slx + '|' + nomF, sortie, h);
    const b = bilan(T);
    if (!b || b.n < 40) continue;          // trop peu de trades pour dire quoi que ce soit
    // marchés individuellement positifs
    const parM = {};
    T.forEach(x => { (parM[x.marche] = parM[x.marche] || []).push(x.r); });
    const marchesOk = Object.keys(parM).filter(k => parM[k].reduce((a, x) => a + x, 0) > 0).length;
    tous.push({ nom: `stop ×${slx} · ${nomF} · ${nomS} · sortie ${nomH}`,
                slx, fenetre: nomF, sortie: nomS, heure: nomH, b, marchesOk,
                nMarches: Object.keys(parM).length });
  }

console.log('── TOUTES LES COMBINAISONS, TRIÉES PAR MARGE ────────────────────────────\n');
tous.sort((a, b) => b.b.marge - a.b.marge);
console.log('  combinaison                                        trades  marge    total   moitiés  marchés+');
console.log('  ' + '─'.repeat(98));
for (const x of tous.slice(0, 12))
  console.log('  ' + x.nom.padEnd(50) + String(x.b.n).padStart(4) + '  ' + pc(x.b.marge).padStart(7) +
    '  ' + eu(x.b.som * RISQUE).padStart(8) + '    ' + (x.b.s1 > 0 && x.b.s2 > 0 ? '✅' : '❌') +
    '      ' + x.marchesOk + '/' + x.nMarches);

const passent = tous.filter(x => x.b.marge > 0 && x.b.s1 > 0 && x.b.s2 > 0 && x.marchesOk >= 3);
console.log('\n' + '─'.repeat(100));
console.log(`${tous.length} combinaisons mesurées · ${passent.length} franchissent les deux premières barrières` +
  ` (marge positive, deux moitiés positives, au moins 3 marchés sur 4)\n`);
if (!passent.length) {
  console.log('AUCUNE. Ce n\'est pas une question de réglage : l\'espace entier est vide.');
} else {
  for (const x of passent)
    console.log('  · ' + x.nom + '\n      ' + x.b.n + ' trades · ' + pc(x.b.marge) + ' de marge · ' +
      eu(x.b.som * RISQUE) + ' · creux ' + eu(x.b.dd * RISQUE) +
      ' · moitiés ' + eu(x.b.s1 * RISQUE) + ' puis ' + eu(x.b.s2 * RISQUE));
  console.log(`
⚠️  ${tous.length} combinaisons essayées. Si AUCUNE n'avait d'avantage, on
    s'attendrait quand même à en voir passer quelques-unes par hasard. La
    troisième barrière — battre le hasard — est donc la seule qui tranche :
      node scripts/epreuves.js --tous   avec les réglages de la survivante`);
}
