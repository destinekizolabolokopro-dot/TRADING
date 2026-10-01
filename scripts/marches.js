#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LA MÊME STRATÉGIE SUR D'AUTRES MARCHÉS.                             ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * POURQUOI C'EST LA SEULE VRAIE AMÉLIORATION DISPONIBLE.
 *
 * Le modèle a trente trades. À ce nombre-là, on ne distingue rien : ni le
 * total positif, ni la seconde moitié négative ne sont concluants. Et on ne
 * peut pas allonger la période, Yahoo refuse les bougies de 5 minutes au-delà
 * de soixante jours.
 *
 * Mais on peut changer de MARCHÉ. Le S&P 500, le Dow et le Russell ont les
 * mêmes séances, les mêmes heures, et leurs mouvements ne sont pas les mêmes
 * que ceux du Nasdaq. Appliquer la stratégie telle quelle, SANS TOUCHER À UN
 * SEUL RÉGLAGE, donne un échantillon que personne n'a regardé en la
 * construisant. C'est ce qui se rapproche le plus d'un hors échantillon.
 *
 * ⚠️ CE N'EST PAS INDÉPENDANT POUR AUTANT. Les indices américains montent et
 * descendent ensemble : une mauvaise semaine l'est souvent pour les quatre.
 * Quatre marchés ne valent donc pas quatre fois plus de preuve. Mais si la
 * stratégie ne tient QUE sur le Nasdaq, on l'apprend ici.
 *
 *   node scripts/marches.js
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
const { Modele, Position } = charger();
const lire = (sym, i, r) => {
  const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_${i}_${r}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
};
function series(sym) {
  const D = {};
  for (const x of Modele.SERIES) D[x.cle] = lire(sym, x.interval, x.range);
  return D.m5 && D.m5.length > 80 ? D : null;
}

const RISQUE = +(process.env.RISQUE_EUR || 250);
const LUCID_DD = -2000 * 0.92;
const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => v == null ? '—' : v.toFixed(1).replace('.', ',') + ' %';

const MARCHES = [
  { sym: 'NQ=F', nom: 'Nasdaq 100', conf: 'ES=F' },
  { sym: 'ES=F', nom: 'S&P 500',    conf: 'NQ=F' },
  { sym: 'YM=F', nom: 'Dow Jones',  conf: 'ES=F' },
  { sym: 'RTY=F', nom: 'Russell 2000', conf: 'ES=F' }
];

function mesurer(D, E) {
  const d = Modele.evaluer(D, E);
  const sigs = (d && d.tousSignaux) || [];
  const T = [];
  for (const s of sigs) {
    const fin1m = D.m1 && D.m1.length && D.m1[0].t <= s.t;
    const cs = fin1m ? D.m1 : D.m5;
    let fin;
    try {
      fin = Position.suivre(s, cs, Modele.CFG, { prudent: true, maxBarres: fin1m ? 1000 : 200,
        depuis: s.t, heure: Modele.heure, jourSignal: Modele.heure(s.t).jour });
    } catch (e) { continue; }
    if (fin.ouverte) continue;
    // Le coût est en POINTS ; il ne vaut pas la même chose d'un marché à
    // l'autre. On le rapporte au risque du signal, comme partout ailleurs.
    T.push({ t: s.t, r: fin.r - Position.cout(s.risq), sortie: fin.sortie });
  }
  return T.sort((a, b) => a.t - b.t);
}

function bilan(T) {
  if (!T.length) return null;
  const n = T.length, som = T.reduce((a, x) => a + x.r, 0);
  const g = T.filter(x => x.r > 0), p = T.filter(x => x.r < 0);
  const gM = g.length ? g.reduce((a, x) => a + x.r, 0) / g.length : 0;
  const pM = p.length ? Math.abs(p.reduce((a, x) => a + x.r, 0)) / p.length : 0;
  let pic = 0, cum = 0, dd = 0, mort = null;
  T.forEach((x, i) => {
    cum += x.r; if (cum > pic) pic = cum;
    if (cum - pic < dd) dd = cum - pic;
    if (mort === null && (cum - pic) * RISQUE <= LUCID_DD) mort = i + 1;
  });
  return { n, som, reussite: g.length / n * 100, gM, pM,
    seuil: (gM + pM) > 0 ? pM / (gM + pM) * 100 : null, dd, mort };
}

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  LA MÊME STRATÉGIE, AUCUN RÉGLAGE CHANGÉ, QUATRE MARCHÉS            ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
console.log('  marché            trades  réussite    seuil    marge   par trade      total');
console.log('  ' + '─'.repeat(74));
const TOUT = [];
const res = [];
for (const m of MARCHES) {
  const D = series(m.sym), E = series(m.conf);
  if (!D) { console.log(`  ${m.nom.padEnd(16)} données absentes`); continue; }
  const T = mesurer(D, E);
  const b = bilan(T);
  if (!b) { console.log(`  ${m.nom.padEnd(16)} aucun trade clos`); continue; }
  res.push({ m, T, b });
  TOUT.push(...T);
  console.log(`  ${m.nom.padEnd(16)} ${String(b.n).padStart(4)}   ${pc(b.reussite).padStart(7)}  ${pc(b.seuil).padStart(7)}  ` +
    `${pc(b.reussite - b.seuil).padStart(7)}  ${eu(b.som / b.n * RISQUE).padStart(8)}  ${eu(b.som * RISQUE).padStart(9)}` +
    (b.mort ? '  ⚠️ compte fermé' : ''));
}

console.log('\n\n  LES DEUX MOITIÉS, MARCHÉ PAR MARCHÉ :\n');
console.log('  marché            1re moitié     2e moitié     les deux positives ?');
console.log('  ' + '─'.repeat(66));
let tiennent = 0;
for (const x of res) {
  const m2 = Math.floor(x.T.length / 2);
  const a = bilan(x.T.slice(0, m2)), b = bilan(x.T.slice(m2));
  const ok = a && b && a.som > 0 && b.som > 0;
  if (ok) tiennent++;
  console.log(`  ${x.m.nom.padEnd(16)} ${eu((a ? a.som : 0) * RISQUE).padStart(9)}   ${eu((b ? b.som : 0) * RISQUE).padStart(9)}` +
    `       ${ok ? '✅ oui' : '❌ non'}`);
}

const B = bilan(TOUT.sort((a, b) => a.t - b.t));
if (B) {
  console.log('\n\n  LES QUATRE MARCHÉS ENSEMBLE :\n');
  console.log(`     ${B.n} trades · ${pc(B.reussite)} gagnés · seuil ${pc(B.seuil)} · ` +
    `marge ${pc(B.reussite - B.seuil)}`);
  console.log(`     ${eu(B.som / B.n * RISQUE)} par trade · ${eu(B.som * RISQUE)} au total · ` +
    `pire creux ${eu(B.dd * RISQUE)}`);
  const m2 = Math.floor(TOUT.length / 2);
  const a = bilan(TOUT.slice(0, m2)), b = bilan(TOUT.slice(m2));
  console.log(`     première moitié ${eu(a.som * RISQUE)} · seconde moitié ${eu(b.som * RISQUE)}` +
    `  ${a.som > 0 && b.som > 0 ? '✅' : '❌'}`);
  console.log(`
  ⚠️  Additionner les quatre marchés SUPPOSE qu'on les trade tous les quatre
      en même temps, avec 250 € de risque sur chacun. Le creux de ${eu(B.dd * RISQUE)}
      est alors bien réel, et il faut le comparer aux 2 000 $ du compte.`);
}

console.log('\n' + '─'.repeat(74));
console.log(`VERDICT : ${tiennent} marché(s) sur ${res.length} tiennent sur leurs deux moitiés.
`);
if (tiennent === 0) console.log(`Aucun. La stratégie ne se reproduit nulle part, y compris là où elle n'a
jamais été ajustée. C'est l'information la plus utile de tout ce travail.
`);
else if (tiennent < res.length) console.log(`Le résultat n'est pas régulier d'un marché à l'autre. Il reste possible
que ce soit le hasard — à ces nombres de trades, un marché sur quatre qui
tient ne prouve rien.
`);
else console.log(`Tous. C'est le meilleur signe obtenu jusqu'ici. Il ne suffit pas : les
indices américains bougent ensemble, donc quatre marchés ne valent pas
quatre échantillons indépendants.
`);
console.log(`⚠️  À NE PAS FAIRE À PARTIR DE CE TABLEAU : choisir le marché qui a le
    mieux marché. Le choisir APRÈS avoir vu le résultat, c'est exactement
    l'ajustement aux données contre lequel tout le reste est construit.
`);
