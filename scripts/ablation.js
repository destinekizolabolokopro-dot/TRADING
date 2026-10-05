#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  L'ABLATION — chaque règle mérite-t-elle sa place ?                   ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * POURQUOI RETIRER, ET JAMAIS AJOUTER.
 *
 * Les épreuves ont montré que les règles d'entrée ne battent pas le hasard :
 * choisir une bougie au mot dans la fenêtre fait mieux 196 fois sur 200. La
 * tentation est alors de chercher les réglages qui rattrapent le résultat.
 * C'est exactement ce qu'il ne faut pas faire : sur soixante jours, on trouve
 * toujours une combinaison qui marche, et elle ne marche que là.
 *
 * On fait donc l'inverse. On RETIRE une règle à la fois et on regarde. Une
 * règle dont le retrait AMÉLIORE le résultat ne gagne pas sa place : elle
 * coûte des trades, de la complexité, et elle n'apporte rien. L'enlever
 * SIMPLIFIE le modèle — c'est le contraire d'un ajustement aux données.
 *
 * ── LA RÈGLE DE DÉCISION, POSÉE AVANT DE REGARDER ─────────────────────────
 * Une règle est déclarée inutile si, SUR LES QUATRE MARCHÉS :
 *   · son retrait améliore la marge au-dessus du seuil d'équilibre, ET
 *   · son retrait ne dégrade pas l'accord entre les deux moitiés.
 * Le total en euros ne décide de rien : c'est lui qui a fait croire que la
 * stratégie marchait.
 *
 *   node scripts/ablation.js
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
const MARCHES = [['NQ=F', 'ES=F'], ['ES=F', 'NQ=F'], ['YM=F', 'ES=F'], ['RTY=F', 'ES=F']];

// Période commune imposée : retirer une règle et comparer n'a de sens que si
// les quatre marchés couvrent les mêmes séances (voir scripts/lib/jeu.js).
const JEUX = require('./lib/jeu.js');
const PAR_SYM = {};
for (const sym of [...new Set(MARCHES.flat())]) { const S = ser(sym); if (S && S.m5 && S.m5.length > 80) PAR_SYM[sym] = S; }
const ALIGNE = JEUX.aligner(Object.keys(PAR_SYM).map(sym => ({ sym, S: PAR_SYM[sym] })));
const JEU = MARCHES.map(([s, c]) => ({ D: PAR_SYM[s], E: PAR_SYM[c] })).filter(x => x.D);
if (!JEU.length) { console.error('Cache absent.'); process.exit(1); }
for (const l of JEUX.banniere(ALIGNE, JEU.map(j => ({ sym: '', S: j.D })))) console.log(l);

const RISQUE = +(process.env.RISQUE_EUR || 250);
const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' %';

function mesurer(modif) {
  const c = charger();
  Object.assign(c.Modele.CFG, modif || {});
  const T = [];
  for (const { D, E } of JEU) {
    const d = c.Modele.evaluer(D, E);
    for (const s of (d && d.tousSignaux) || []) {
      const f1 = D.m1 && D.m1.length && D.m1[0].t <= s.t;
      let fin;
      try {
        fin = c.Position.suivre(s, f1 ? D.m1 : D.m5, c.Modele.CFG,
          { prudent: true, maxBarres: f1 ? 1000 : 200, depuis: s.t,
            heure: c.Modele.heure, jourSignal: c.Modele.heure(s.t).jour });
      } catch (e) { continue; }
      if (!fin.ouverte) T.push({ t: s.t, r: fin.r - c.Position.cout(s.risq) });
    }
  }
  return T.sort((a, b) => a.t - b.t);
}

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
  const s1 = T.slice(0, m).reduce((a, x) => a + x.r, 0);
  const s2 = T.slice(m).reduce((a, x) => a + x.r, 0);
  return { n, som, wr, seuil, marge: seuil == null ? null : wr - seuil, dd,
           moitiesOk: s1 > 0 && s2 > 0, s1, s2 };
}

const REF = bilan(mesurer(null));
console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  L\'ABLATION · on RETIRE une règle à la fois, sur quatre marchés     ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
console.log(`  LE MODÈLE COMPLET : ${REF.n} trades · ${REF.wr.toFixed(1)} % gagnés · ` +
  `seuil ${REF.seuil.toFixed(1)} % · marge ${pc(REF.marge)} · ${eu(REF.som * RISQUE)}\n`);

// Chaque entrée retire UNE règle. Rien n'est ajouté, rien n'est optimisé :
// les valeurs de remplacement neutralisent la règle, elles ne la règlent pas.
const ABLATIONS = [
  ['le biais haute unité',        { seuil: 0 },
   'on entre quel que soit le score des FVG en 1 jour / 4 h / 1 h / 15 min'],
  ['la confirmation sur l\'ES',   { confirme2: false },
   'on ne demande plus au second marché de dire la même chose'],
  ['l\'âge maximum d\'un niveau', { keyAge: 100000 },
   'un niveau clé reste valable indéfiniment'],
  ['le délai de réaction',        { react: 100000 },
   'plus de limite entre la touche du niveau et l\'inversion'],
  ['le stop minimum (ATR)',       { atrMin: 0 },
   'on accepte les stops les plus serrés, sans plancher'],
  ['le plafond de 2 trades/jour', { maxJour: 100 },
   'autant de signaux par jour que le marché en produit'],
  ['la sortie horaire',           { sortieMin: null },
   'on ne solde plus à midi ; la position court jusqu\'au stop ou à l\'objectif'],
  ['les niveaux M5',              { unites: 'M15,M30,H1,H4' },
   'on ne regarde plus les niveaux de la plus petite unité'],
  ['les niveaux H4',              { unites: 'M5,M15,M30,H1' },
   'on ne regarde plus la plus grande unité'],
  ['l\'élargissement du stop',    { slx: 1 },
   'le stop revient au bord de l\'IFVG, sans multiplicateur']
];

console.log('  règle retirée                 trades  réussite   seuil    marge     Δ marge   moitiés');
console.log('  ' + '─'.repeat(88));
const res = [];
for (const [nom, modif, quoi] of ABLATIONS) {
  const b = bilan(mesurer(modif));
  if (!b) { console.log(`  ${nom.padEnd(28)} aucun trade`); continue; }
  const d = b.marge - REF.marge;
  res.push({ nom, quoi, b, d });
  console.log(`  ${nom.padEnd(28)} ${String(b.n).padStart(4)}   ${b.wr.toFixed(1).padStart(6)} % ` +
    `${b.seuil.toFixed(1).padStart(6)} % ${pc(b.marge).padStart(8)}  ${pc(d).padStart(8)}` +
    `     ${b.moitiesOk ? '✅' : '❌'}`);
}

const inutiles = res.filter(x => x.d > 0.5 && (x.b.moitiesOk || !REF.moitiesOk));
console.log('\n' + '─'.repeat(90));
if (!inutiles.length) {
  console.log(`AUCUNE règle ne gagne à être retirée. Ça ne veut pas dire qu'elles servent :
les épreuves ont montré que l'ensemble ne bat pas le hasard. Ça veut dire
qu'aucune ne porte seule la responsabilité du problème.`);
} else {
  inutiles.sort((a, b) => b.d - a.d);
  console.log(`${inutiles.length} règle(s) dont le RETRAIT améliore la marge :\n`);
  for (const x of inutiles)
    console.log(`  · ${x.nom}\n      ${x.quoi}\n      marge ${pc(REF.marge)} → ${pc(x.b.marge)}  (${pc(x.d)})` +
      ` · ${eu(REF.som * RISQUE)} → ${eu(x.b.som * RISQUE)} · ${x.b.n} trades`);
  console.log(`
⚠️  DIX ABLATIONS ESSAYÉES. Même si aucune ne servait, une ou deux
    paraîtraient utiles par hasard. Ce tableau désigne des CANDIDATS à la
    simplification, pas des conclusions. Une règle ne doit être retirée que
    si son retrait tient AUSSI sur les épreuves — c'est-à-dire si le modèle
    simplifié bat le hasard, ce que le modèle complet ne fait pas.`);
}
console.log(`
CE QUE CETTE ABLATION NE FAIT PAS :
  · elle ne cherche pas les meilleurs réglages — elle ne fait que RETIRER ;
  · elle ne teste qu'un retrait à la fois, jamais une combinaison, parce que
    les combinaisons sont le début de l'ajustement aux données ;
  · elle reste sur les mêmes 60 jours, plafond dur de Yahoo.
`);
