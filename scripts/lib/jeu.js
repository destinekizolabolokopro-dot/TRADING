/**
 * LE JEU DE DONNÉES COMMUN — scripts/lib/jeu.js
 *
 * POURQUOI CE FICHIER EXISTE.
 * Le 4 octobre 2026, la même stratégie inchangée est passée de 113 trades /
 * −492 € à 142 trades / −2 966 €. Aucune ligne de code n'avait bougé. La
 * cause : le cache avait été rafraîchi À MOITIÉ. NQ et ES allaient jusqu'au
 * 2 octobre, YM et RTY s'arrêtaient au 30 septembre. Deux jours de bourse de
 * plus pour deux marchés sur quatre.
 *
 * Toutes les comparaisons entre marchés que j'avais publiées — « positive sur
 * 4 marchés sur 4 » — comparaient donc des périodes différentes. Ce n'était
 * pas quatre regards indépendants sur le même mois : c'était quatre regards
 * sur quatre mois légèrement décalés. Un marché qui tombe bien sur ses deux
 * jours supplémentaires suffit à faire basculer le verdict.
 *
 * CE QUE FAIT CE MODULE. Il ramène tous les marchés à la période que TOUS
 * couvrent, et il dit à voix haute ce qu'il a coupé. Une comparaison entre
 * marchés redevient alors une comparaison.
 */
'use strict';
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..', '..');

// Les trois modules du site, chargés comme le navigateur les charge : ce sont
// EXACTEMENT les mêmes fichiers qui décident en direct. Un backtest qui
// réimplémente la stratégie ne mesure pas la stratégie.
function contexte() {
  const ctx = {};
  for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
    new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
  return ctx;
}

const dossier = () => process.env.MECH_CACHE || path.join(RACINE, '.cache');

function lireSerie(sym, interval, range, cache) {
  const f = path.join(cache || dossier(), `${sym.replace(/\W/g, '')}_${interval}_${range}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
}

// Un marché : toutes ses unités de temps, telles que le cache les contient.
function lireMarche(sym, SERIES, cache) {
  const S = {};
  for (const x of SERIES) S[x.cle] = lireSerie(sym, x.interval, x.range, cache);
  return S;
}

const jour = t => new Date(t).toISOString().slice(0, 10);

/**
 * Ramène plusieurs marchés à leur période commune.
 *
 * La période est calculée sur m5, l'unité qui décide : le début retenu est le
 * plus tardif des débuts, la fin la plus précoce des fins. Chaque série est
 * ensuite rognée à cette période. Les unités fines (m1) n'ont de toute façon
 * que quelques jours : les rogner ne leur retire rien, mais leur couverture
 * reste inégale et `couvertureM1` la mesure.
 *
 * @param marches  [{ sym, S }]  modifiés sur place
 * @returns { debut, fin, coupes: [{sym, avant, apres, perdus}], aligne }
 */
function aligner(marches) {
  const avec = marches.filter(m => m.S && m.S.m5 && m.S.m5.length);
  if (avec.length < 2) return { aligne: false, coupes: [] };

  const debut = Math.max(...avec.map(m => m.S.m5[0].t));
  const fin = Math.min(...avec.map(m => m.S.m5[m.S.m5.length - 1].t));
  const coupes = [];

  for (const m of avec) {
    const avant = { n: m.S.m5.length, d: m.S.m5[0].t, f: m.S.m5[m.S.m5.length - 1].t };
    for (const cle of Object.keys(m.S)) {
      const s = m.S[cle];
      if (!s || !s.length) continue;
      // Le journalier et l'horaire servent à lire le biais et des niveaux
      // vieux de plusieurs centaines de bougies : les rogner par le début
      // amputerait la structure. Seule la FIN compte pour eux — c'est elle
      // qui fait voir à un marché des jours que les autres n'ont pas.
      const parDebut = cle === 'm1' || cle === 'm2' || cle === 'm5' || cle === 'm15';
      m.S[cle] = s.filter(b => b.t <= fin && (!parDebut || b.t >= debut));
    }
    const ap = m.S.m5;
    coupes.push({ sym: m.sym, avant: avant.n, apres: ap.length, perdus: avant.n - ap.length,
                  avantFin: avant.f, avantDebut: avant.d });
  }
  return { aligne: true, debut, fin, coupes };
}

// Combien de jours de bourse distincts sont réellement mesurés, et quelle
// part des bougies est arbitrée à la minute plutôt qu'à 5 minutes.
function couvertureM1(marches) {
  let avec = 0, sans = 0;
  for (const m of marches) {
    if (!m.S || !m.S.m5) continue;
    const d1 = m.S.m1 && m.S.m1.length ? m.S.m1[0].t : Infinity;
    for (const b of m.S.m5) { if (b.t >= d1) avec++; else sans++; }
  }
  return { avec, sans, part: avec + sans ? avec / (avec + sans) : 0 };
}

/**
 * La bannière à afficher AVANT tout chiffre. Elle dit la période mesurée et
 * ce que l'alignement a coûté. Sans elle, un total agrège des périodes
 * différentes sans le dire, et c'est précisément le défaut qui a motivé ce
 * fichier.
 */
function banniere(al, marches) {
  const L = [];
  if (!al.aligne) return L;
  const touches = al.coupes.filter(c => c.perdus > 0);
  L.push(`Période commune aux ${al.coupes.length} marchés : ${jour(al.debut)} → ${jour(al.fin)}`);
  if (touches.length) {
    L.push(`⚠️  cache inégal : ${touches.length} marché(s) rognés pour que la comparaison en soit une.`);
    for (const c of touches)
      L.push(`      ${c.sym.padEnd(6)} ${String(c.perdus).padStart(5)} bougies m5 retirées` +
        (c.avantFin > al.fin ? ` (allait jusqu'au ${jour(c.avantFin)})` : '') +
        (c.avantDebut < al.debut ? ` (commençait le ${jour(c.avantDebut)})` : ''));
  }
  if (marches) {
    const c = couvertureM1(marches);
    L.push(`Arbitrage intrabougie : ${(c.part * 100).toFixed(0)} % des bougies couvertes par la minute, ` +
      `le reste tranché sur 5 minutes.`);
  }
  return L;
}

module.exports = { RACINE, contexte, dossier, lireSerie, lireMarche, aligner, couvertureM1, banniere, jour };
