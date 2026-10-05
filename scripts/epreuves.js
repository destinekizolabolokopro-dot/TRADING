#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LES ÉPREUVES — des backtests faits pour CASSER la stratégie.         ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Un backtest ordinaire répond à « combien ça rapporte ». Il ne répond pas à
 * la seule question qui compte : « est-ce que ça rapporte POUR UNE RAISON ».
 *
 * Chaque épreuve ci-dessous retire quelque chose à la stratégie et regarde si
 * le résultat survit. Si une stratégie fait aussi bien SANS sa règle, alors
 * la règle ne sert à rien — et le résultat venait d'ailleurs.
 *
 *   node scripts/epreuves.js            le Nasdaq
 *   node scripts/epreuves.js --tous     les quatre marchés ensemble
 *   node scripts/epreuves.js --rapide   saute les épreuves à 200 tirages
 *
 * Les épreuves 1 à 3 rejouent deux cents fois tout l'échantillon sur des
 * bougies de 1 minute : comptez une dizaine de minutes sur quatre marchés.
 * Les épreuves 4 à 6 sont immédiates.
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Modele, Position } = ctx;
const lire = (sym, i, r) => {
  const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_${i}_${r}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
};
const ser = sym => {
  const S = {};
  for (const x of Modele.SERIES) S[x.cle] = lire(sym, x.interval, x.range);
  return S.m5 && S.m5.length > 80 ? S : null;
};
const RISQUE = +(process.env.RISQUE_EUR || 250);
const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => v == null ? '—' : v.toFixed(1).replace('.', ',') + ' %';

const MARCHES = process.argv.includes('--tous')
  ? [['NQ=F', 'ES=F'], ['ES=F', 'NQ=F'], ['YM=F', 'ES=F'], ['RTY=F', 'ES=F']]
  : [['NQ=F', 'ES=F']];

// Chaque symbole est chargé UNE fois, puis tous sont ramenés à la période que
// tous couvrent (voir scripts/lib/jeu.js). Sans cela, un cache rafraîchi à
// moitié fait comparer des périodes différentes sous le même total.
const JEUX = require('./lib/jeu.js');
const SYMBOLES = [...new Set(MARCHES.flat())];
const PAR_SYM = {};
for (const sym of SYMBOLES) { const S = ser(sym); if (S && S.m5 && S.m5.length > 80) PAR_SYM[sym] = S; }
const ALIGNE = JEUX.aligner(Object.keys(PAR_SYM).map(sym => ({ sym, S: PAR_SYM[sym] })));
const JEU = MARCHES.map(([s, c]) => ({ sym: s, D: PAR_SYM[s], E: PAR_SYM[c] })).filter(x => x.D);
if (!JEU.length) { console.error('Cache absent.'); process.exit(1); }

// Un générateur reproductible : une épreuve qui change de réponse à chaque
// lancement ne prouve rien et ne se vérifie pas.
function alea(graine) {
  let s = graine >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function suivre(D, pos) {
  const f1 = D.m1 && D.m1.length && D.m1[0].t <= pos.t;
  try {
    const fin = Position.suivre(pos, f1 ? D.m1 : D.m5, Modele.CFG,
      { prudent: true, maxBarres: f1 ? 1000 : 200, depuis: pos.t,
        heure: Modele.heure, jourSignal: Modele.heure(pos.t).jour });
    return fin.ouverte ? null : fin;
  } catch (e) { return null; }
}
const niveaux = (D, sens, entree, risq, t) => {
  const L = sens === 'LONG';
  return { sens, t, entree, risq, sl: L ? entree - risq : entree + risq,
    tp1: L ? entree + risq * Modele.CFG.tp1 : entree - risq * Modele.CFG.tp1,
    tp:  L ? entree + risq * Modele.CFG.tp2 : entree - risq * Modele.CFG.tp2 };
};

function bilan(T) {
  if (!T.length) return null;
  const n = T.length, som = T.reduce((a, x) => a + x, 0);
  const g = T.filter(x => x > 0);
  return { n, som, moy: som / n, wr: g.length / n * 100 };
}
if (process.argv.includes('--sansplafond')) Modele.CFG.maxJour = 100;
// Réglages passés en ligne de commande, pour soumettre une candidate issue de
// scripts/recherche.js aux mêmes épreuves que le modèle en place.
//   --slx=6 --fenetre=8,10 --part=0.9 --tp1=0.4 --tp2=2.5 --sortie=aucune
for (const a of process.argv) {
  let m;
  if ((m = a.match(/^--slx=(\d+(?:\.\d+)?)$/))) Modele.CFG.slx = +m[1];
  if ((m = a.match(/^--fenetre=(\d+),(\d+)$/))) { Modele.CFG.ghDeb = +m[1] * 60; Modele.CFG.ghFin = +m[2] * 60; }
  if ((m = a.match(/^--part=(\d*(?:\.\d+)?)$/))) Modele.CFG.part = +m[1];
  if ((m = a.match(/^--tp1=(\d*(?:\.\d+)?)$/))) Modele.CFG.tp1 = +m[1];
  if ((m = a.match(/^--tp2=(\d*(?:\.\d+)?)$/))) Modele.CFG.tp2 = +m[1];
  if (a === '--sortie=aucune') Modele.CFG.sortieMin = null;
  if ((m = a.match(/^--sortie=(\d+)$/))) Modele.CFG.sortieMin = +m[1] * 60;
}
const FORME = (process.argv.find(a => a.startsWith('--sorties=')) || '').split('=')[1];
if (FORME === 'rien2') Object.assign(Modele.CFG, { part: 0, tp1: 1.0, tp2: 2.0 });
const VARIANTE = [process.argv.includes('--sansplafond') ? 'sans plafond journalier' : null,
                  FORME ? 'sortie ' + FORME : null,
                  process.argv.some(a => /^--(slx|fenetre|part|tp1|tp2|sortie)=/.test(a))
                    ? `stop ×${Modele.CFG.slx} · ${Math.floor(Modele.CFG.ghDeb / 60)}h-${Math.floor(Modele.CFG.ghFin / 60)}h · ` +
                      `${Math.round(Modele.CFG.part * 100)} % à ${Modele.CFG.tp1} · reste ${Modele.CFG.tp2} · ` +
                      `sortie ${Modele.CFG.sortieMin == null ? 'aucune' : Math.floor(Modele.CFG.sortieMin / 60) + ' h'}`
                    : null].filter(Boolean).join(' + ');
// Un signal dont le stop coûte plus que le budget pour UN micro-contrat n'est
// pas prenable : il est écarté, comme le site l'écarte déjà (js/compte.js).
const BUDGET = RISQUE;
let ECARTES = 0;
const SIG = JEU.map(j => {
  const tous = Modele.evaluer(j.D, j.E).tousSignaux;
  const sigs = tous.filter(s => JEUX.jouable(j.sym, Math.abs(s.risq), BUDGET));
  ECARTES += tous.length - sigs.length;
  return { j, sigs };
});
if (ECARTES) console.log(`   ${ECARTES} signal(aux) écarté(s) : stop trop large pour ${BUDGET} € de budget ` +
  `(un micro-contrat coûterait davantage).`);

function reel() {
  const T = [];
  for (const { j, sigs } of SIG)
    for (const s of sigs) { const f = suivre(j.D, s); if (f) T.push(f.r - Position.cout(s.risq)); }
  return T;
}
const REEL = bilan(reel());

console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
console.log(`║  LES ÉPREUVES · ${String(MARCHES.length)} marché(s) · ${String(REEL.n).padStart(3)} trades réels                       ║`);
console.log('╚══════════════════════════════════════════════════════════════════════╝');
for (const l of JEUX.banniere(ALIGNE, JEU.map(j => ({ sym: '', S: j.D })))) console.log('   ' + l);
if (VARIANTE) console.log(`\n⚙️  VARIANTE ÉPROUVÉE : ${VARIANTE}`);
console.log(`\nLA STRATÉGIE ${VARIANTE ? 'AINSI MODIFIÉE' : 'TELLE QU\'ELLE EST'} : ${REEL.n} trades · ${pc(REEL.wr)} · ${eu(REEL.moy * RISQUE)} par trade · ${eu(REEL.som * RISQUE)}\n`);

const RAPIDE = process.argv.includes('--rapide');

// ── UNE VARIANTE PEUT ÊTRE SOUMISE AUX MÊMES ÉPREUVES ─────────────────────
// L'ablation désigne des candidats à la simplification. Un candidat ne vaut
// rien tant qu'il n'a pas passé CES épreuves-là : améliorer le total est
// facile, battre le hasard ne l'est pas.
//   --sansplafond   retire le plafond de deux trades par jour
//   --sorties=X     remplace la forme de sortie (ex. --sorties=rien2)

// La fenêtre horaire peut être changée en ligne de commande : le texte des
// épreuves doit dire la vraie fenêtre, jamais une valeur écrite en dur.
function fenetreTexte() {
  const h = m => String(Math.floor(m / 60)) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
  return 'entre ' + h(Modele.CFG.ghDeb) + ' et ' + h(Modele.CFG.ghFin);
}

function epreuve(titre, question, echantillons) {
  const b = echantillons.map(bilan).filter(Boolean);
  if (!b.length) { console.log(`\n── ${titre}\n   (aucun trade produit)`); return; }
  const moys = b.map(x => x.moy * RISQUE).sort((a, b2) => a - b2);
  const med = moys[Math.floor(moys.length / 2)];
  const mieux = moys.filter(m => m >= REEL.moy * RISQUE).length;
  console.log(`\n── ${titre}`);
  console.log(`   ${question}`);
  if (b.length > 1) {
    console.log(`   ${b.length} tirages · médiane ${eu(med)} par trade · ` +
      `de ${eu(moys[0])} à ${eu(moys[moys.length - 1])}`);
    console.log(`   tirages au moins aussi bons que la vraie stratégie : ${mieux}/${b.length}` +
      `  (${(mieux / b.length * 100).toFixed(0)} %)`);
    if (mieux / b.length > 0.2)
      console.log(`   ❌ LA RÈGLE N'APPORTE RIEN DE DÉMONTRABLE : le hasard fait aussi bien`);
    else if (mieux / b.length > 0.05)
      console.log(`   ⚠️  marginal : le hasard fait aussi bien une fois sur ${Math.round(b.length / Math.max(1, mieux))}`);
    else console.log(`   ✅ la vraie stratégie bat le hasard dans ce test`);
  } else {
    console.log(`   ${b[0].n} trades · ${pc(b[0].wr)} · ${eu(b[0].moy * RISQUE)} par trade · ${eu(b[0].som * RISQUE)}`);
    const ecart = (b[0].moy - REEL.moy) * RISQUE;
    console.log(`   écart avec la vraie stratégie : ${eu(ecart)} par trade`);
  }
}

// ── 1. LE SENS EST-IL MIEUX QU'UNE PIÈCE ? ────────────────────────────────
// On garde TOUT : les mêmes instants, les mêmes stops, la même gestion. On ne
// tire au sort que le SENS. Si le résultat ne baisse pas, le biais haussier /
// baissier — la moitié de la machinerie — ne sert à rien.
if (!RAPIDE) {
  const ech = [];
  for (let g = 1; g <= 200; g++) {
    const r = alea(g * 7919), T = [];
    for (const { j, sigs } of SIG) for (const s of sigs) {
      const sens = r() < 0.5 ? 'LONG' : 'SHORT';
      const f = suivre(j.D, niveaux(j.D, sens, s.entree, s.risq, s.t));
      if (f) T.push(f.r - Position.cout(s.risq));
    }
    ech.push(T);
  }
  epreuve('ÉPREUVE 1 · LE SENS TIRÉ À PILE OU FACE',
    'Mêmes instants, mêmes stops, mais le sens au hasard. Le biais sert-il ?', ech);
}

// ── 2. L'INSTANT EST-IL MIEUX QU'AU HASARD DANS LA FENÊTRE ? ──────────────
// Autant d'entrées, aux mêmes jours, dans la même fenêtre 09h-10h, avec le
// même risque en points — mais à une bougie tirée au sort. Si ça fait aussi
// bien, toute la détection (biais, DOL, niveau clé, touche, inversion) ne
// sert qu'à choisir une heure qui n'a pas d'importance.
if (!RAPIDE) {
  const ech = [];
  for (let g = 1; g <= 200; g++) {
    const r = alea(g * 104729), T = [];
    for (const { j, sigs } of SIG) {
      // les bougies éligibles, par jour
      const parJour = {};
      for (const b of j.D.m5) {
        const e = Modele.heure(b.t);
        if (e.dow < 1 || e.dow > 5) continue;
        if (e.min < Modele.CFG.ghDeb || e.min >= Modele.CFG.ghFin) continue;
        (parJour[e.jour] = parJour[e.jour] || []).push(b);
      }
      for (const s of sigs) {
        const jour = Modele.heure(s.t).jour, dispo = parJour[jour];
        if (!dispo || !dispo.length) continue;
        const b = dispo[Math.floor(r() * dispo.length)];
        const f = suivre(j.D, niveaux(j.D, s.sens, b.c, s.risq, b.t));
        if (f) T.push(f.r - Position.cout(s.risq));
      }
    }
    ech.push(T);
  }
  epreuve('ÉPREUVE 2 · L\'INSTANT TIRÉ AU SORT DANS LA FENÊTRE',
    'Mêmes jours, même sens, même risque — mais une bougie au hasard ' + fenetreTexte() + '.', ech);
}

// ── 3. TOUT AU HASARD ─────────────────────────────────────────────────────
if (!RAPIDE) {
  const ech = [];
  for (let g = 1; g <= 200; g++) {
    const r = alea(g * 15485863), T = [];
    for (const { j, sigs } of SIG) {
      const parJour = {};
      for (const b of j.D.m5) {
        const e = Modele.heure(b.t);
        if (e.dow < 1 || e.dow > 5) continue;
        if (e.min < Modele.CFG.ghDeb || e.min >= Modele.CFG.ghFin) continue;
        (parJour[e.jour] = parJour[e.jour] || []).push(b);
      }
      for (const s of sigs) {
        const dispo = parJour[Modele.heure(s.t).jour];
        if (!dispo || !dispo.length) continue;
        const b = dispo[Math.floor(r() * dispo.length)];
        const sens = r() < 0.5 ? 'LONG' : 'SHORT';
        const f = suivre(j.D, niveaux(j.D, sens, b.c, s.risq, b.t));
        if (f) T.push(f.r - Position.cout(s.risq));
      }
    }
    ech.push(T);
  }
  epreuve('ÉPREUVE 3 · TOUT AU HASARD (instant ET sens)',
    'Il ne reste que la fenêtre horaire, la taille du stop et la gestion de sortie.', ech);
}

// ── 4. COMBIEN DE FRAIS LA STRATÉGIE SUPPORTE-T-ELLE ? ────────────────────
// Le dérapage retenu est une hypothèse. À partir de combien meurt-elle ?
{
  console.log('\n── ÉPREUVE 4 · LE POINT DE RUPTURE DES FRAIS');
  console.log('   Le dérapage retenu (0,25 point par côté) est une hypothèse. Jusqu\'où tient-elle ?');
  const brut = [];
  for (const { j, sigs } of SIG) for (const s of sigs) {
    const f = suivre(j.D, s); if (f) brut.push({ r: f.r, risq: s.risq });
  }
  console.log('      dérapage par côté   par trade');
  let rupture = null;
  for (const slip of [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3]) {
    const T = brut.map(x => x.r - Position.cout(x.risq, { slip }));
    const b = bilan(T);
    if (rupture === null && b.moy <= 0) rupture = slip;
    console.log(`      ${String(slip).padStart(5)} point(s)      ${eu(b.moy * RISQUE).padStart(8)}` +
      (b.moy <= 0 ? '   ❌ négative' : ''));
  }
  if (rupture === null) console.log('   ✅ tient jusqu\'à 3 points de dérapage par côté');
  else if (rupture === 0) console.log('   ❌ perdante MÊME SANS AUCUN FRAIS. Le dérapage n\'y est pour rien :\n' +
    '      c\'est la stratégie elle-même qui ne gagne pas sur cet échantillon.');
  else {
    // Ce qui compte n'est pas le seuil brut mais sa distance au coût réel,
    // de l'ordre d'un quart de point par côté sur ces contrats.
    const marge = rupture / 0.25;
    console.log(`   ${marge >= 4 ? '✅' : '⚠️ '} devient perdante à partir de ${rupture} point(s) de dérapage par côté.`);
    console.log(`      Le marché réel en coûte souvent un quart de point, soit ${marge < 2 ? 'à peine' : marge >= 4 ? 'environ' : 'seulement'} ` +
      `${marge % 1 ? marge.toFixed(1).replace('.', ',') : marge} fois moins : ` +
      (marge >= 4 ? 'la marge encaisse une exécution nettement pire que prévu.'
       : marge >= 2 ? 'la marge existe mais ne pardonne pas une mauvaise exécution.'
       : 'la marge est quasi nulle.'));
  }
}

// ── 5. L'HYPOTHÈSE INTRABOUGIE PÈSE COMBIEN ? ─────────────────────────────
// Quand une bougie touche l'objectif ET le stop, on compte le stop. L'inverse
// serait tout aussi défendable sans les bougies de 1 minute. L'écart entre
// les deux mesure ce que vaut cette convention.
{
  console.log('\n── ÉPREUVE 5 · LE POIDS DE L\'HYPOTHÈSE INTRABOUGIE');
  console.log('   Quand une bougie touche l\'objectif ET le stop, qui gagne ?');
  let ambigus = 0, trades = 0;
  for (const [nom, prudent] of [['prudent (le stop compte)', true], ['optimiste (l\'objectif compte)', false]]) {
    const T = [];
    for (const { j, sigs } of SIG) for (const s of sigs) {
      const f1 = j.D.m1 && j.D.m1.length && j.D.m1[0].t <= s.t;
      try {
        const fin = Position.suivre(s, f1 ? j.D.m1 : j.D.m5, Modele.CFG,
          { prudent, maxBarres: f1 ? 1000 : 200, depuis: s.t,
            heure: Modele.heure, jourSignal: Modele.heure(s.t).jour });
        if (!fin.ouverte) {
          T.push(fin.r - Position.cout(s.risq));
          if (prudent) { trades++; if (fin.ambigu > 0) ambigus++; }
        }
      } catch (e) { /* ignoré */ }
    }
    const b = bilan(T);
    console.log(`      ${nom.padEnd(32)} ${pc(b.wr).padStart(7)} · ${eu(b.moy * RISQUE).padStart(8)} par trade · ${eu(b.som * RISQUE).padStart(9)}`);
  }
  // Le compte des trades concernés : sans lui, deux totaux identiques ne
  // disent pas si la convention ne change rien ou si l'épreuve est muette.
  console.log(`      trades où une bougie touche les deux : ${ambigus} sur ${trades}` +
    (trades ? ` (${(ambigus / trades * 100).toFixed(1).replace('.', ',')} %)` : ''));
  if (!ambigus) console.log('   ✅ aucune bougie ambiguë : le résultat ne doit rien à cette convention.');
  else console.log('   Plus l\'écart est grand, plus le résultat dépend d\'une convention et non du marché.');
}

// ── 6. UN SEUL JOUR PÈSE COMBIEN ? ────────────────────────────────────────
// CONSTATÉ EN VRAI, et c'est ce qui a motivé cette épreuve : entre le
// 30 septembre et le 1er octobre, la fenêtre de Yahoo a glissé d'un jour —
// un jour perdu au début, un jour gagné à la fin. Le total du modèle est
// passé de +798 € à +440 €. QUARANTE-CINQ POUR CENT de différence pour
// vingt-quatre heures de données.
//
// On mesure donc directement : on retire une journée de bourse, une seule,
// et on regarde de combien le total bouge. Si retirer un jour quelconque
// change le signe, le résultat n'est pas un résultat.
{
  console.log('\n── ÉPREUVE 6 · LE POIDS D\'UNE SEULE JOURNÉE');
  console.log('   On retire une journée de bourse, une seule, et on regarde le total.');
  const parJour = {};
  for (const { j, sigs } of SIG) for (const s of sigs) {
    const f = suivre(j.D, s); if (!f) continue;
    const jr = Modele.heure(s.t).jour;
    (parJour[jr] = parJour[jr] || []).push(f.r - Position.cout(s.risq));
  }
  const jours = Object.keys(parJour).sort();
  const total = REEL.som;
  const sans = jours.map(jr => ({
    jour: jr, n: parJour[jr].length,
    reste: total - parJour[jr].reduce((a, x) => a + x, 0)
  })).sort((a, b) => a.reste - b.reste);
  // ⚠️ LA QUESTION EST « LE SIGNE CHANGE-T-IL », pas « le reste est-il
  // négatif ». Une première version comptait les journées dont le retrait
  // laissait un total négatif — ce qui, quand le total est DÉJÀ négatif,
  // compte presque toutes les journées et ne veut rien dire.
  const positif = total > 0;
  const bascule = sans.filter(x => (x.reste > 0) !== positif).length;
  console.log(`      total avec tout            ${eu(total * RISQUE).padStart(9)}`);
  for (const x of sans.slice(0, 3))
    console.log(`      sans le ${x.jour} (${String(x.n)} trade${x.n > 1 ? 's' : ''})  ${eu(x.reste * RISQUE).padStart(9)}` +
      ((x.reste > 0) !== positif ? '   ❌ le signe bascule' : ''));
  console.log(`      ...`);
  for (const x of sans.slice(-2))
    console.log(`      sans le ${x.jour} (${String(x.n)} trade${x.n > 1 ? 's' : ''})  ${eu(x.reste * RISQUE).padStart(9)}`);
  console.log(`   ${jours.length} journées. Retirer la pire en fait ${eu(sans[sans.length - 1].reste * RISQUE)},` +
    ` retirer la meilleure ${eu(sans[0].reste * RISQUE)}.`);
  if (bascule) console.log(`   ❌ ${bascule} journée(s) sur ${jours.length} renversent le signe du total à elles seules\n` +
    `      (${positif ? 'de positif à négatif' : 'de négatif à positif'}). Le résultat tient à une\n` +
    `      poignée de séances, pas à une régularité.`);
  else console.log(`   ✅ aucune journée seule ne renverse le signe du total.`);
}

console.log('\n' + '─'.repeat(72));
console.log(`COMMENT LIRE CES ÉPREUVES

  Elles ne disent pas si la stratégie gagne. Elles disent si elle gagne POUR
  UNE RAISON. Une stratégie que le hasard égale une fois sur cinq n'a pas
  d'avantage démontrable — même si son total est positif.

  Deux cents tirages ne font pas une preuve non plus : avec ${REEL.n} trades, la
  dispersion du hasard est large, et il est DIFFICILE de battre ce test.
  Le réussir est donc un bon signe ; l'échouer est une mauvaise nouvelle
  beaucoup plus sûre.
`);
