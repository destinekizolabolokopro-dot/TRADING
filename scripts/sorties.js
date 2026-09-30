#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LA FORME DU GAIN — le seul réglage qu'on ait le droit de discuter.   ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS UN BALAYAGE.
 *
 * Le backtest a montré que le modèle gagne +104 € quand il gagne et perd
 * 227 € quand il perd. Son seuil d'équilibre est donc à 68,6 % : en dessous,
 * il perd de l'argent. Ce seuil n'est PAS une propriété du marché. C'est une
 * conséquence arithmétique de la sortie choisie :
 *
 *     90 % de la position vendue à 0,4 fois le risque
 *     10 % qui courent jusqu'à 2,5
 *     → gain maximum 0,61 fois le risque, perte maximum 1,00
 *     → il faut gagner 62 % du temps RIEN QUE POUR RENTRER DANS SES FRAIS,
 *       même en touchant l'objectif complet à chaque trade.
 *
 * On compare donc quelques FORMES DE SORTIE. Les entrées ne bougent pas d'un
 * millimètre : ce sont les mêmes trente signaux, aux mêmes prix, aux mêmes
 * instants. On ne cherche pas quelle combinaison a le mieux marché — on
 * regarde ce que chaque forme impose AVANT de connaître le résultat.
 *
 * ── LA RÈGLE DE SÉLECTION, POSÉE AVANT DE REGARDER ────────────────────────
 * Un candidat n'est retenu que si SES DEUX MOITIÉS sont positives. Le total
 * sur soixante jours ne compte pas : c'est lui qui a fait croire que la
 * version actuelle marchait. Une forme qui gagne gros sur la première moitié
 * et perd sur la seconde est écartée, quel que soit son total.
 *
 *   node scripts/sorties.js
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Modele, Position } = ctx;
const lire = (s, i, r) => {
  const f = path.join(CACHE, `${s}_${i}_${r}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
};
const D = {}, E = {};
for (const x of Modele.SERIES) D[x.cle] = lire('NQF', x.interval, x.range);
for (const x of Modele.SERIES2) E[x.cle] = lire('ESF', x.interval, x.range);
if (!D.m5) { console.error('Cache absent.'); process.exit(1); }

const RISQUE = +(process.env.RISQUE_EUR || 250);
const LUCID_DD = -2000 * 0.92;
const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => v == null ? '—' : v.toFixed(1).replace('.', ',') + ' %';

// LES ENTRÉES NE BOUGENT PAS. Un seul appel, une seule fois.
const SIG = Modele.evaluer(D, E.m5 ? E : null).tousSignaux;

function rejouer(cfg) {
  const T = [];
  for (const s of SIG) {
    // les niveaux de sortie sont RECALCULÉS pour cette forme-là, à partir de
    // l'entrée et du risque du signal — qui, eux, ne changent pas.
    const L = s.sens === 'LONG';
    const pos = { sens: s.sens, t: s.t, entree: s.entree, sl: s.sl, risq: s.risq,
      tp1: L ? s.entree + s.risq * cfg.tp1 : s.entree - s.risq * cfg.tp1,
      tp:  L ? s.entree + s.risq * cfg.tp2 : s.entree - s.risq * cfg.tp2 };
    const fin1m = D.m1 && D.m1.length && D.m1[0].t <= s.t;
    const cs = fin1m ? D.m1 : D.m5;
    let fin;
    try {
      fin = Position.suivre(pos, cs, cfg, { prudent: true, maxBarres: fin1m ? 1000 : 200,
        depuis: s.t, heure: Modele.heure, jourSignal: Modele.heure(s.t).jour });
    } catch (e) { continue; }
    if (fin.ouverte) continue;
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

// ── LES FORMES ÉPROUVÉES, DÉCLARÉES D'AVANCE ──────────────────────────────
// Six, pas soixante. Chacune répond à une idée qu'on peut défendre sans
// regarder les données ; aucune n'est le produit d'une recherche du maximum.
const FORMES = [
  { nom: 'actuelle',            part: 0.9, tp1: 0.4, tp2: 2.5,
    idee: '90 % encaissés très tôt : beaucoup de petits gains, seuil très haut' },
  { nom: 'partiel à mi-chemin', part: 0.5, tp1: 1.0, tp2: 2.5,
    idee: 'la moitié au niveau du risque pris, le reste court' },
  { nom: 'partiel tardif',      part: 0.5, tp1: 1.5, tp2: 3.0,
    idee: 'on ne sécurise qu\'une fois le risque dépassé de moitié' },
  { nom: 'un tiers sécurisé',   part: 0.3, tp1: 1.0, tp2: 3.0,
    idee: 'juste de quoi passer au seuil, l\'essentiel court' },
  { nom: 'rien vendu · 2,0',    part: 0,   tp1: 1.0, tp2: 2.0,
    idee: 'aucune vente partielle ; le stop passe au seuil à 1 fois le risque' },
  { nom: 'rien vendu · 1,5',    part: 0,   tp1: 0.8, tp2: 1.5,
    idee: 'objectif modeste, atteint souvent' }
];

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  LA FORME DU GAIN · mêmes entrées, mêmes ' + String(SIG.length).padStart(2) + ' signaux, sorties variées   ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log('\nCE QUE CHAQUE FORME IMPOSE, avant même de connaître le marché :\n');
console.log('  forme                      gain max   seuil PLANCHER   (réussite minimale');
console.log('                             possible   arithmétique      pour ne rien perdre)');
for (const f of FORMES) {
  const gmax = f.part * f.tp1 + (1 - f.part) * f.tp2;
  console.log(`  ${f.nom.padEnd(24)} ${gmax.toFixed(2).padStart(6)}      ${pc(1 / (1 + gmax) * 100).padStart(7)}`);
}

console.log('\n\nCE QUE ÇA DONNE SUR LES SOIXANTE JOURS :\n');
console.log('  forme                     trades  réussite    seuil   par trade     total     pire creux');
const res = [];
for (const f of FORMES) {
  const T = rejouer(f);
  const b = bilan(T);
  if (!b) { console.log(`  ${f.nom.padEnd(24)} aucun trade`); continue; }
  const m = Math.floor(T.length / 2);
  const a1 = bilan(T.slice(0, m)), a2 = bilan(T.slice(m));
  res.push({ f, b, a1, a2 });
  console.log(`  ${f.nom.padEnd(24)} ${String(b.n).padStart(4)}   ${pc(b.reussite).padStart(7)}  ${pc(b.seuil).padStart(7)}  ` +
    `${eu(b.som / b.n * RISQUE).padStart(8)}  ${eu(b.som * RISQUE).padStart(9)}  ${eu(b.dd * RISQUE).padStart(9)}`);
}

console.log('\n\nLES DEUX MOITIÉS — c\'est ici que ça se joue :\n');
console.log('  forme                     1re moitié      2e moitié     les deux positives ?');
for (const x of res) {
  const ok = x.a1 && x.a2 && x.a1.som > 0 && x.a2.som > 0;
  console.log(`  ${x.f.nom.padEnd(24)} ${eu(x.a1.som * RISQUE).padStart(9)}    ${eu(x.a2.som * RISQUE).padStart(9)}` +
    `        ${ok ? '✅ oui' : '❌ non'}`);
}

const retenus = res.filter(x => x.a1 && x.a2 && x.a1.som > 0 && x.a2.som > 0);
console.log('\n' + '─'.repeat(72));
if (!retenus.length) {
  console.log(`AUCUNE des ${res.length} formes ne tient sur les deux moitiés.

Ce n'est pas un problème de sortie : c'est que les ENTRÉES ne sont pas assez
bonnes pour qu'une forme de sortie les sauve. Changer la sortie déplace le
résultat, il ne le crée pas.`);
} else {
  console.log(`${retenus.length} forme(s) sur ${res.length} tiennent sur les deux moitiés :\n`);
  retenus.sort((a, b) => (b.b.reussite - b.b.seuil) - (a.b.reussite - a.b.seuil));
  for (const x of retenus)
    console.log(`  ${x.f.nom.padEnd(24)} marge ${pc(x.b.reussite - x.b.seuil).padStart(7)} au-dessus du seuil · ` +
      `${eu(x.b.som * RISQUE)} · creux ${eu(x.b.dd * RISQUE)}` +
      (x.b.mort ? `  ⚠️ compte Lucid fermé au trade n° ${x.b.mort}` : ''));
  console.log(`
⚠️  ATTENTION À CE QUE CE CLASSEMENT N'EST PAS. Six formes essayées, une
retenue : la probabilité qu'une forme quelconque passe le test des deux
moitiés par hasard n'est pas nulle. Ce tableau dit « celle-ci n'est pas
disqualifiée », pas « celle-ci marche ».`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LA MÊME QUESTION SUR QUATRE MARCHÉS — 113 trades au lieu de 30.
// Trente trades ne départagent rien. Les mêmes règles appliquées au S&P, au
// Dow et au Russell donnent presque quatre fois plus de matière, sans qu'un
// seul réglage ait été ajusté sur eux.
{
  const AUTRES = [['ES=F', 'S&P 500', 'NQ=F'], ['YM=F', 'Dow', 'ES=F'], ['RTY=F', 'Russell', 'ES=F']];
  const sers = sym => {
    const S = {};
    for (const x of Modele.SERIES) {
      const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_${x.interval}_${x.range}.json`);
      S[x.cle] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
    }
    return S.m5 && S.m5.length > 80 ? S : null;
  };
  const SIGA = [];
  for (const [sym, nom, conf] of AUTRES) {
    const Dx = sers(sym), Ex = sers(conf);
    if (!Dx) continue;
    SIGA.push({ nom, D: Dx, sigs: Modele.evaluer(Dx, Ex).tousSignaux });
  }
  if (SIGA.length) {
    const rejouerSur = (D, sigs, cfg) => {
      const T = [];
      for (const s of sigs) {
        const L = s.sens === 'LONG';
        const pos = { sens: s.sens, t: s.t, entree: s.entree, sl: s.sl, risq: s.risq,
          tp1: L ? s.entree + s.risq * cfg.tp1 : s.entree - s.risq * cfg.tp1,
          tp:  L ? s.entree + s.risq * cfg.tp2 : s.entree - s.risq * cfg.tp2 };
        const f1 = D.m1 && D.m1.length && D.m1[0].t <= s.t;
        let fin;
        try {
          fin = Position.suivre(pos, f1 ? D.m1 : D.m5, cfg, { prudent: true,
            maxBarres: f1 ? 1000 : 200, depuis: s.t, heure: Modele.heure,
            jourSignal: Modele.heure(s.t).jour });
        } catch (e) { continue; }
        if (!fin.ouverte) T.push({ t: s.t, r: fin.r - Position.cout(s.risq) });
      }
      return T;
    };
    console.log('\n\n══ LES MÊMES FORMES SUR QUATRE MARCHÉS ══════════════════════════════\n');
    console.log('  forme                    trades  réussite   seuil    marge   par trade      total   moitiés');
    console.log('  ' + '─'.repeat(88));
    for (const f of FORMES) {
      let TOUT = rejouer(f).slice();
      for (const a of SIGA) TOUT = TOUT.concat(rejouerSur(a.D, a.sigs, f));
      TOUT.sort((a, b) => a.t - b.t);
      const b = bilan(TOUT); if (!b) continue;
      const m = Math.floor(TOUT.length / 2);
      const a1 = bilan(TOUT.slice(0, m)), a2 = bilan(TOUT.slice(m));
      const ok = a1 && a2 && a1.som > 0 && a2.som > 0;
      console.log(`  ${f.nom.padEnd(24)} ${String(b.n).padStart(4)}   ${pc(b.reussite).padStart(7)} ${pc(b.seuil).padStart(7)} ` +
        `${pc(b.reussite - b.seuil).padStart(7)}  ${eu(b.som / b.n * RISQUE).padStart(8)}  ${eu(b.som * RISQUE).padStart(9)}    ${ok ? '✅' : '\u274c'}`);
    }
    console.log(`
  ⚠️  QUATRE MARCHÉS NE FONT PAS QUATRE FOIS PLUS DE PREUVE. Les indices
      américains montent et descendent ensemble : une mauvaise semaine l'est
      souvent pour les quatre. Et additionner leurs résultats suppose qu'on
      les trade tous les quatre en même temps, ce qui multiplie le creux.`);

    // ── ET LA TAILLE QUE LE COMPTE PEUT PORTER ────────────────────────────
    // Le creux mesuré s'exprime en MULTIPLES DU RISQUE : il ne dépend pas de
    // la taille choisie. C'est donc la taille qui décide si ce creux tient
    // dans les 2 000 $ du compte — jamais l'inverse.
    console.log('\n\n══ LA TAILLE QUE LE COMPTE PEUT PORTER, SUR LE NASDAQ SEUL ══════════\n');
    console.log('  forme                    creux    risque max   risque max   gain par trade');
    console.log('                           mesuré     strict       prudent     à ce risque');
    console.log('  ' + '─'.repeat(78));
    const LIM = 2000 * 0.92;
    for (const f of FORMES) {
      const b = bilan(rejouer(f)); if (!b) continue;
      const ddR = Math.abs(b.dd);
      if (!(ddR > 0)) continue;
      const prudent = LIM / (ddR * 2);
      console.log(`  ${f.nom.padEnd(24)} ${ddR.toFixed(1).padStart(6)}×  ${(Math.floor(LIM / ddR) + ' \u20ac').padStart(10)}   ` +
        `${(Math.floor(prudent) + ' \u20ac').padStart(10)}   ${eu(b.som / b.n * prudent).padStart(9)}`);
    }
    console.log(`
  « strict »  : le pire creux DÉJÀ VU remplit exactement la limite. Le
                prochain creux un peu pire ferme le compte.
  « prudent » : la moitié de la limite reste libre pour le creux qu'on n'a pas
                encore vu. Le minimum raisonnable sur trente trades.

  C'EST ICI QUE L'AMÉLIORATION SE JOUE VRAIMENT. Une forme qui gagne plus par
  trade mais gagne moins souvent creuse davantage — il faut donc la trader
  plus petit, et le gain par trade retombe. Comparer les totaux SANS ramener
  chacun à la taille que le compte supporte ne compare rien.`);
  }
}

console.log(`
CE QUI NE CHANGE PAS, quelle que soit la forme retenue :
  · les ${SIG.length} entrées sont les mêmes — on n'a pas touché à ce qui déclenche ;
  · l'échantillon reste de soixante jours, plafond dur de Yahoo ;
  · une forme qui améliore le passé n'améliore pas forcément la suite.
`);
