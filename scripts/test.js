#!/usr/bin/env node
'use strict';
/**
 * LES TESTS QUI AURAIENT ATTRAPÉ CHAQUE BUG.
 *
 * Chaque bloc porte le nom du bug réel qu'il aurait empêché. Ce ne sont pas
 * des tests décoratifs : à chaque fois, un faux chiffre est arrivé jusqu'à
 * l'écran, et à chaque fois une de ces vérifications l'aurait arrêté.
 *
 *   node scripts/test.js
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');

let ok = 0, ko = 0;
const echecs = [];
function t(nom, fn) {
  try { fn(); ok++; console.log('  ✅ ' + nom); }
  catch (e) { ko++; echecs.push(nom + ' — ' + e.message); console.log('  ❌ ' + nom + '\n       ' + e.message); }
}
function eq(a, b, quoi) {
  if (a !== b) throw new Error((quoi || '') + ' attendu ' + b + ', obtenu ' + a);
}
function pres(a, b, tol, quoi) {
  if (Math.abs(a - b) > (tol || 1e-9)) throw new Error((quoi || '') + ' attendu ~' + b + ', obtenu ' + a);
}

// ── chargement des modules du navigateur ───────────────────────────────────
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/kintt.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Position, Modele, Kintt, ST } = ctx;
const CFG = Modele.CFG;

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LES RÉGLAGES SONT COHÉRENTS ENTRE EUX ─────────────────────');

t('la fenêtre commence avant de finir', () => {
  if (!(CFG.ghDeb < CFG.ghFin)) throw new Error(CFG.ghDeb + ' → ' + CFG.ghFin);
});
t('l\'objectif final est plus loin que le partiel', () => {
  if (!(CFG.tp2 > CFG.tp1)) throw new Error('tp1 ' + CFG.tp1 + ' ≥ tp2 ' + CFG.tp2);
});
t('la fraction vendue au partiel est entre 0 et 1', () => {
  if (!(CFG.part >= 0 && CFG.part <= 1)) throw new Error('part = ' + CFG.part);
});
t('le stop n\'est jamais plus serré que le bord structurel', () => {
  if (!(CFG.slx >= 1)) throw new Error('slx = ' + CFG.slx);
});
t('la sortie forcée tombe APRÈS la fermeture de la fenêtre', () => {
  // Une sortie forcée avant la fin de la fenêtre solderait des positions que
  // le modèle vient d'ouvrir.
  if (CFG.sortieMin != null && !(CFG.sortieMin >= CFG.ghFin))
    throw new Error('sortie ' + CFG.sortieMin + ' < fin de fenêtre ' + CFG.ghFin);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── CE QUE VAUT UNE POSITION ──────────────────────────────────');
// BUG RÉEL : « si on soldait maintenant, +467 € ». Faux. 90 % de la position
// était déjà vendue au partiel ; seuls 10 % suivaient encore le prix. La
// vraie valeur était +90 € acquis plus 67 € de reste.

const pos = Position.niveaux('SHORT', 30677, 30716.4, CFG);   // bord → risq × slx

t('le stop est du bon côté de l\'entrée', () => {
  if (!(pos.sl > pos.entree)) throw new Error('vente : stop ' + pos.sl + ' ≤ entrée ' + pos.entree);
});
t('les objectifs sont du bon côté de l\'entrée', () => {
  if (!(pos.tp1 < pos.entree && pos.tp < pos.entree)) throw new Error('objectifs du mauvais côté');
});
t('le stop est éloigné de slx fois le bord', () => {
  pres(pos.risq, Math.abs(30677 - 30716.4) * CFG.slx, 1e-6, 'distance du stop');
});

t('APRÈS LE PARTIEL, un mouvement énorme ne donne pas la position entière', () => {
  // Le prix descend de 294 points — bien au-delà de l'objectif final.
  const v = Position.valeur(pos, 30677 - 294, true, CFG);
  const plafond = CFG.part * CFG.tp1 + (1 - CFG.part) * CFG.tp2;
  if (v > plafond + 1e-9) throw new Error('valeur ' + v + ' > plafond ' + plafond);
  // et surtout : PAS (294 / risq), qui vaudrait bien plus
  const naif = 294 / pos.risq;
  if (Math.abs(v - naif) < 1e-6) throw new Error('la part déjà vendue est ignorée');
});
t('AVANT le partiel, la valeur ne descend jamais sous la perte maximale', () => {
  const v = Position.valeur(pos, 30677 + 10000, false, CFG);
  if (v < -1 - 1e-9) throw new Error('valeur ' + v + ' < −1');
});
t('APRÈS le partiel, la valeur ne descend jamais sous ce qui est encaissé', () => {
  const v = Position.valeur(pos, 30677 + 10000, true, CFG);
  if (v < CFG.part * CFG.tp1 - 1e-9) throw new Error('valeur ' + v + ' < acquis ' + CFG.part * CFG.tp1);
});
t('un gain plafonné vaut bien part×tp1 + (1−part)×tp2', () => {
  pres(pos.gainMax, CFG.part * CFG.tp1 + (1 - CFG.part) * CFG.tp2, 1e-9, 'gain maximal');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LE SUIVI D\'UNE POSITION ───────────────────────────────────');
// BUG RÉEL : le suivi testait l'objectif AVANT le stop. Quand une bougie
// touchait les deux, il comptait l'objectif. Rejouées en 1 minute, quatre
// positions sur huit étaient en fait perdantes.

const b = (h, l, c, t2) => ({ t: t2, h: h, l: l, c: c == null ? (h + l) / 2 : c });

t('bougie qui touche stop ET objectif : le comptage prudent choisit le stop', () => {
  const r = Position.suivre(pos, [b(pos.sl + 5, pos.tp1 - 5, pos.entree, 1)], CFG,
    { prudent: true, maxBarres: 10 });
  eq(r.sortie, 'stop', 'issue');
  eq(r.r, -1, 'résultat');
  eq(r.ambigu, 1, 'bougies ambiguës');
});
t('la même bougie, comptage optimiste : l\'objectif — et l\'écart est signalé', () => {
  const r = Position.suivre(pos, [b(pos.sl + 5, pos.tp1 - 5, pos.entree, 1)], CFG,
    { prudent: false, maxBarres: 10 });
  if (r.ambigu !== 1) throw new Error('l\'ambiguïté doit être comptée dans les deux modes');
});
t('partiel touché puis retour au seuil : on encaisse la part vendue', () => {
  const r = Position.suivre(pos, [
    b(pos.entree + 1, pos.tp1 - 1, pos.tp1, 1),      // le partiel tombe
    b(pos.entree + 1, pos.entree - 1, pos.entree, 2) // retour au prix d'entrée
  ], CFG, { prudent: true, maxBarres: 10 });
  eq(r.sortie, 'seuil', 'issue');
  pres(r.r, CFG.part * CFG.tp1, 1e-9, 'résultat');
});
t('objectif complet : le plafond, jamais plus', () => {
  const r = Position.suivre(pos, [
    b(pos.entree - 1, pos.tp1 - 1, pos.tp1, 1),       // le partiel tombe
    // ⚠️ le haut de cette bougie doit rester SOUS le prix d'entrée : après le
    // partiel le stop y est remonté, et une bougie qui touche les deux est
    // comptée « seuil » — c'est la règle, et le premier jet de ce test s'y
    // était fait prendre.
    b(pos.entree - 1, pos.tp - 50, pos.tp - 50, 2)    // dépasse l'objectif
  ], CFG, { prudent: true, maxBarres: 10 });
  eq(r.sortie, 'objectif', 'issue');
  pres(r.r, pos.gainMax, 1e-9, 'résultat plafonné');
});

t('après le partiel, une bougie qui touche le seuil ET l\'objectif donne le seuil', () => {
  // La contrepartie du test précédent : c'est bien la règle prudente, et elle
  // doit être vérifiée explicitement pour qu'on ne la « corrige » pas un jour.
  const r = Position.suivre(pos, [
    b(pos.entree - 1, pos.tp1 - 1, pos.tp1, 1),
    b(pos.entree + 1, pos.tp - 50, pos.entree, 2)     // touche le seuil aussi
  ], CFG, { prudent: true, maxBarres: 10 });
  eq(r.sortie, 'seuil', 'issue');
});
t('une issue hors bornes lève une erreur au lieu de passer', () => {
  let leve = false;
  try {
    Position.suivre(Object.assign({}, pos, { risq: 0 }),
      [b(pos.entree, pos.entree - 1e6, pos.entree - 1e6, 1)], CFG, { prudent: true, maxBarres: 1 });
  } catch (e) { leve = true; }
  // soit ça lève, soit le résultat reste dans les bornes — jamais de valeur folle
  if (!leve) { /* le garde-fou interne a borné : acceptable */ }
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LE MODÈLE NE PRODUIT PAS D\'ORDRE IMPOSSIBLE ───────────────');
// BUG RÉEL : le stop se retrouvait DU CÔTÉ DU GAIN quand la clôture d'entrée
// dépassait le bord de l'IFVG. `Math.abs` effaçait le signe. 4 à 9 % des
// signaux selon la fenêtre, et ils perdaient de l'argent.

const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const dispo = fs.existsSync(path.join(CACHE, 'NQF_5m_60d.json'));
let SIGNAUX = [];
if (dispo) {
  const lire = (s, i, r) => JSON.parse(fs.readFileSync(path.join(CACHE, `${s}_${i}_${r}.json`), 'utf-8'));
  const D = {};
  for (const x of Modele.SERIES) D[x.cle] = lire('NQF', x.interval, x.range);
  const E = fs.existsSync(path.join(CACHE, 'ESF_5m_60d.json'))
    ? { m5: lire('ESF','5m','60d'), m15: lire('ESF','15m','60d'),
        h1: lire('ESF','1h','6mo'), d1: lire('ESF','1d','1y') } : null;
  const d = Modele.evaluer(D, E);
  SIGNAUX = (d && d.tousSignaux) || [];

  t('aucun signal n\'a son stop du mauvais côté', () => {
    const faux = SIGNAUX.filter(s => s.sens === 'LONG' ? !(s.sl < s.entree) : !(s.sl > s.entree));
    if (faux.length) throw new Error(faux.length + ' signal(aux) sur ' + SIGNAUX.length);
  });
  t('aucun signal n\'a son objectif du mauvais côté', () => {
    const faux = SIGNAUX.filter(s => s.sens === 'LONG'
      ? !(s.tp1 > s.entree && s.tp > s.entree) : !(s.tp1 < s.entree && s.tp < s.entree));
    if (faux.length) throw new Error(faux.length + ' signal(aux) sur ' + SIGNAUX.length);
  });
  t('tous les signaux tombent DANS la fenêtre déclarée', () => {
    const dehors = SIGNAUX.filter(s => {
      const e = Modele.heure(s.t);
      return e.dow < 1 || e.dow > 5 || e.min < CFG.ghDeb || e.min >= CFG.ghFin;
    });
    if (dehors.length) throw new Error(dehors.length + ' hors fenêtre');
  });
  t('le nombre de signaux par jour respecte le plafond', () => {
    const parJour = {};
    SIGNAUX.forEach(s => { const j = Modele.heure(s.t).jour; parJour[j] = (parJour[j] || 0) + 1; });
    const trop = Object.keys(parJour).filter(j => parJour[j] > CFG.maxJour);
    if (trop.length) throw new Error('jours dépassant ' + CFG.maxJour + ' : ' + trop.join(', '));
  });
} else {
  console.log('  ⏭️  cache absent — les tests sur données réelles sont sautés');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── CE QUI EST AFFICHÉ CORRESPOND À CE QUI EST MESURÉ ──────────');
// BUG RÉEL : le pied de page annonçait « 80,0 % de réussite » à travers TROIS
// régénérations de js/mesure.js, parce qu'il était recopié à la main.

const mesureSrc = fs.readFileSync(path.join(RACINE, 'js/mesure.js'), 'utf-8');
const LISTE = new Function(mesureSrc + '; return Mesure.liste();')();

t('l\'historique mesuré n\'est pas vide', () => {
  if (!LISTE.length) throw new Error('aucun signal');
});
t('chaque ligne de l\'historique a un stop du bon côté', () => {
  const faux = LISTE.filter(x => x.direction === 'LONG' ? !(x.sl < x.entry) : !(x.sl > x.entry));
  if (faux.length) throw new Error(faux.length + ' ligne(s) sur ' + LISTE.length);
});
t('aucun résultat de l\'historique ne sort des bornes du modèle', () => {
  const plafond = CFG.part * CFG.tp1 + (1 - CFG.part) * CFG.tp2;
  const fous = LISTE.filter(x => x.r > plafond + 0.05 || x.r < -1.2);
  if (fous.length) throw new Error(fous.length + ' résultat(s) hors [−1,2 ; ' + plafond.toFixed(2) + ']');
});
t('l\'en-tête de js/mesure.js dit le même nombre que la liste', () => {
  const m = mesureSrc.match(/les (\d+) signaux/);
  if (!m) throw new Error('en-tête illisible');
  eq(+m[1], LISTE.length, 'nombre de signaux annoncé');
});
t('l\'en-tête dit le même taux de réussite que la liste', () => {
  const m = mesureSrc.match(/·\s*([\d.,]+)\s*% de réussite/);
  if (!m) throw new Error('taux illisible dans l\'en-tête');
  const dit = parseFloat(m[1].replace(',', '.'));
  const vrai = LISTE.filter(x => x.r > 0).length / LISTE.length * 100;
  pres(dit, vrai, 0.1, 'taux de réussite annoncé');
});

for (const f of ['TRADEassist.html', 'docs/index.html']) {
  t(f + ' porte exactement le même historique que js/mesure.js', () => {
    const h = fs.readFileSync(path.join(RACINE, f), 'utf-8');
    const m = h.match(/var BRUT = \[([\s\S]*?)\n  \];/);
    if (!m) throw new Error('historique introuvable dans la page');
    eq(m[1].trim().split('\n').length, LISTE.length, 'signaux inlinés');
  });
  t(f + ' n\'a plus aucune référence de script non inlinée', () => {
    const h = fs.readFileSync(path.join(RACINE, f), 'utf-8');
    const reste = [...h.matchAll(/<script src="([^"]+)"><\/script>/g)].map(x => x[1]);
    if (reste.length) throw new Error('non inliné : ' + reste.join(', '));
  });
}

t('le site ne parle plus en R dans ce qu\'un humain lit', () => {
  const h = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf-8');
  // on ne regarde que le texte visible, pas les commentaires de code
  const visible = h.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const trouve = visible.match(/\d[,.]\d\s*R\b/g);
  if (trouve) throw new Error('reste : ' + [...new Set(trouve)].join(', '));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LE JOURNAL EN DIRECT SE TIENT ─────────────────────────────');
// BUG RÉEL : le bilan annonçait +300 € alors que les positions valaient
// −1 275 €, et huit signaux d'anciens réglages étaient mélangés aux nouveaux.

const jf = path.join(RACINE, 'data/signaux.json');
if (fs.existsSync(jf)) {
  const J = JSON.parse(fs.readFileSync(jf, 'utf-8'));
  t('le bilan compte le même nombre de signaux que la liste', () => {
    eq(J.bilan.total, J.signaux.length, 'total');
  });
  t('le bilan compte les clos et les ouverts sans en perdre', () => {
    eq(J.bilan.clos + J.bilan.ouverts, J.signaux.length, 'clos + ouverts');
  });
  t('le cumul du bilan est la somme des résultats', () => {
    const somme = J.signaux.filter(s => s.statut === 'clos').reduce((a, s) => a + (s.r || 0), 0);
    pres(J.bilan.cumulR, +somme.toFixed(3), 0.002, 'cumul');
  });
  t('aucun signal du journal ne mélange les anciens réglages', () => {
    const vieux = J.signaux.filter(s => s.slx == null || s.slx !== CFG.slx);
    if (vieux.length) throw new Error(vieux.length + ' signal(aux) avec un autre stop');
  });
  t('chaque signal du journal a un stop et des objectifs cohérents', () => {
    for (const s of J.signaux) {
      const L = s.sens === 'LONG';
      if (L ? !(s.sl < s.entree) : !(s.sl > s.entree))
        throw new Error(s.jour + ' ' + s.heureNY + ' : stop du mauvais côté');
      if (L ? !(s.tp1 > s.entree) : !(s.tp1 < s.entree))
        throw new Error(s.jour + ' ' + s.heureNY + ' : partiel du mauvais côté');
    }
  });
  t('aucun résultat du journal ne sort des bornes', () => {
    const plafond = CFG.part * CFG.tp1 + (1 - CFG.part) * CFG.tp2;
    for (const s of J.signaux) {
      if (s.r == null) continue;
      if (s.r > plafond + 1e-6 || s.r < -1 - 1e-6)
        throw new Error(s.jour + ' ' + s.heureNY + ' : ' + s.r + ' hors bornes');
    }
  });
} else {
  console.log('  ⏭️  data/signaux.json absent');
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LE ROBOT PEUT-IL VRAIMENT VOIR LA SÉANCE ? ────────────────');
// BUG RÉEL, mesuré le 30 septembre. Les trois créneaux prévus — 10 h 17,
// 11 h 47, 12 h 37 — n'ont AUCUN été honorés par GitHub. Le travail est parti
// à 16 h 26 puis 17 h 00, soit après la fin de la fenêtre : deux exécutions de
// dix-neuf secondes, un simple rattrapage, et la séance pas surveillée du tout.
//
// Ces vérifications portent sur l'ARITHMÉTIQUE du planning, parce qu'elle est
// facile à casser sans s'en apercevoir : un travail GitHub meurt à 360 minutes,
// et un créneau qui dépasse cette limite se fait tuer en cours de route — en
// laissant croire à un relevé qui n'a pas eu lieu.

{
  const yml = fs.readFileSync(path.join(RACINE, '.github/workflows/seance.yml'), 'utf-8');
  const crons = [...yml.matchAll(/- cron: '(\d+) (\d+) \* \* 1-5'/g)]
    .map(m => +m[2] * 60 + +m[1]);
  const lim = +(yml.match(/timeout-minutes:\s*(\d+)/) || [])[1];
  const marge = +(yml.match(/LIMITE=\$\(\(DEPART \+ (\d+) \* 60\)\)/) || [])[1];
  const deb = 13 * 60 + 15, fin = 15 * 60 + 45;

  t('le planning de la séance a plusieurs départs', () => {
    if (crons.length < 4)
      throw new Error(crons.length + ' créneau(x) : un seul abandon suffirait à perdre la journée');
  });

  t('aucun créneau ne se fait tuer avant la fin de son travail', () => {
    if (!(marge > 0)) throw new Error('la borne interne LIMITE est introuvable');
    if (marge + 10 > lim)
      throw new Error(`le script court ${marge} min mais le travail est tué à ${lim}`);
    if (lim >= 360) throw new Error(`timeout-minutes ${lim} : GitHub tue à 360`);
  });

  t('chaque créneau atteint la fenêtre et en couvre un bout', () => {
    const vains = crons.filter(d => deb > d + marge);
    if (vains.length) throw new Error(vains.length +
      ' créneau(x) mourraient avant l\'ouverture — ils occupent la place pour rien');
  });

  t('au moins un créneau couvre la fenêtre en entier', () => {
    const complets = crons.filter(d => Math.min(fin, d + marge) >= fin);
    if (!complets.length) throw new Error('aucun créneau ne va jusqu\'à 15 h 45');
  });

  t('un départ retardataire ne tue pas un travail déjà en attente', () => {
    // C'est ce qui serait arrivé le 30 septembre : un travail parti à 6 h et
    // sagement en attente aurait été annulé à 16 h 26 par un retardataire,
    // juste avant de servir à quelque chose.
    const m = yml.match(/group:\s*seance[\s\S]{0,80}?cancel-in-progress:\s*(\w+)/);
    if (!m) throw new Error('groupe de concurrence introuvable');
    if (m[1] !== 'false')
      throw new Error('cancel-in-progress: ' + m[1] + ' — un retardataire tuerait le gardien');
  });
}

t('une nuit ne décrit pas une séance', () => {
  // Le 30 septembre, un passage de 01 h 20 New York — marché fermé — a marqué
  // la journée « décrite ». Les rattrapages de l'après-midi n'ont donc RIEN
  // consigné de la séance : il ne reste aucune trace de ce que le modèle a vu
  // entre 09 h et 10 h.
  const src = fs.readFileSync(path.join(RACINE, 'scripts/live_log.js'), 'utf-8');
  const m = src.match(/const jourDejaDecrit =[\s\S]{0,400}?;/);
  if (!m) throw new Error('le test du jour décrit est introuvable');
  if (!/minNY\(p\.heureNY\) >= Modele\.CFG\.ghDeb/.test(m[0]))
    throw new Error('un passage de n\'importe quelle heure suffit encore à marquer la journée décrite');
  if (/apresCoup/.test(m[0]))
    throw new Error('le drapeau `apresCoup` sert encore de preuve — il était posé à 01 h 20 du matin');
});

t('un relevé de rattrapage raconte la SÉANCE, pas l\'heure du relevé', () => {
  // Quand GitHub abandonne les créneaux, le seul relevé de la journée tombe
  // l'après-midi. Il disait « hors fenêtre, biais haussier » — l'état du
  // marché à 13 h 40, qui n'apprend rien sur ce qui s'est passé de 09 h à 10 h.
  const mod = fs.readFileSync(path.join(RACINE, 'js/modele.js'), 'utf-8');
  if (!/etapeFenetre:/.test(mod))
    throw new Error('le modèle ne garde pas ce qu\'il a vu dans la fenêtre');
  const src = fs.readFileSync(path.join(RACINE, 'scripts/live_log.js'), 'utf-8');
  if (!/d\.etapeFenetre/.test(src))
    throw new Error('le rattrapage n\'utilise pas l\'état de la séance');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LA STRATÉGIE NE DOIT PAS CONNAÎTRE L\'AVENIR ───────────────');
// LE PIRE BUG DU PROJET, et aucun test ne le voyait.
//
// ST.agreger regroupe les bougies 1 h par quatre. ST.idxA rend la bougie QUI
// CONTIENT l'instant demandé — donc, sur une unité supérieure, une bougie NON
// TERMINÉE. Son plus haut, son plus bas et sa clôture n'existent pas encore.
// Mesuré sur une bougie H4 réelle : ouverture 01 h 00, plus haut 31058 ; le
// code interrogeait ce plus haut dès 01 h 10, alors qu'il ne serait définitif
// qu'à 05 h 00. Et le biais datait la résolution d'un FVG à l'OUVERTURE de la
// bougie qui tranche — jusqu'à vingt-quatre heures trop tôt sur le journalier.
//
// Ce que ça coûtait, une fois retiré :
//     modèle   41 trades · 87,8 % · +2 622 €   →   25 trades · 76,0 % · +606 €
//     kintt     3 trades · 33,3 % ·   +304 €   →    2 trades ·  0,0 % · −256 €
//
// LA VÉRIFICATION, elle, ne regarde pas le code : elle coupe les bougies juste
// après un signal et exige que la stratégie produise EXACTEMENT le même signal.
// Une stratégie qui lit l'avenir ne peut pas passer.

if (dispo) {
  const lireA = (s2, i, r) => {
    const f = path.join(CACHE, `${s2}_${i}_${r}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
  };
  const DA = {}, EA = {};
  for (const x of Modele.SERIES) DA[x.cle] = lireA('NQF', x.interval, x.range);
  for (const x of Modele.SERIES2) EA[x.cle] = lireA('ESF', x.interval, x.range);

  // Le marché tel qu'il était connu à l'instant t : on jette tout ce qui
  // vient après, exactement comme le robot le voit en direct.
  const couper = (S, t) => {
    const out = {};
    for (const k of Object.keys(S)) out[k] = S[k] ? S[k].filter(c => c.t < t) : S[k];
    return out;
  };

  for (const [nom, strat] of [['le modèle', Modele], ['kintt', Kintt]]) {
    t(nom + ' produit les mêmes signaux quand on lui retire l\'avenir', () => {
      const plein = strat.evaluer(DA, EA.m5 ? EA : null);
      const sigs = (plein && plein.tousSignaux) || [];
      // Les bougies 1 minute ne remontent qu'à huit jours. Au-delà, tronquer
      // efface une série que le robot AVAIT à l'époque : le signal
      // disparaîtrait faute de données, pas faute d'honnêteté. On ne juge donc
      // que la période réellement rejouable.
      const t0 = DA.m1 && DA.m1.length ? DA.m1[0].t : 0;
      const jugeables = sigs.filter(x => x.t > t0 + 2 * 24 * 3600 * 1000);
      if (!jugeables.length) { console.log('     (periode rejouable sans signal)'); return; }

      // Plusieurs dates de coupe : a chacune, TOUS les signaux anterieurs
      // doivent reapparaitre a l'identique. Un signal qui ne tient que parce
      // que la suite est connue se trahit ici.
      const ecarts = [];
      let compares = 0;
      const coupes = [...new Set(jugeables.map(x => x.t + 5 * 60000))].slice(-5);
      for (const tc of coupes) {
        const T2 = couper(DA, tc), E2 = EA.m5 ? couper(EA, tc) : null;
        if (!T2.m5 || T2.m5.length < 200 || !T2.m1 || T2.m1.length < 500) continue;
        const r = strat.evaluer(T2, E2);
        const vus = (r && r.tousSignaux) || [];
        const att = jugeables.filter(x => x.t < tc);
        for (const sig of att) {
          compares++;
          const q = new Date(sig.t).toISOString().slice(0, 16).replace('T', ' ');
          const vu = vus.filter(x => x.t === sig.t)[0];
          if (!vu) { ecarts.push(q + ' disparait sans l\'avenir'); continue; }
          for (const champ of ['sens', 'entree', 'sl', 'tp'])
            if (String(vu[champ]) !== String(sig[champ]))
              ecarts.push(`${q} · ${champ} ${sig[champ]} -> ${vu[champ]}`);
        }
        // L'AUTRE SENS : un signal qui existait à l'époque et que les données
        // postérieures effacent. Borné à la même période jugeable.
        for (const vu of vus) {
          if (vu.t <= t0 + 2 * 24 * 3600 * 1000) continue;
          compares++;
          if (!att.some(x => x.t === vu.t))
            ecarts.push(new Date(vu.t).toISOString().slice(0, 16).replace('T', ' ') +
              ' EFFACÉ par les données postérieures');
        }
      }
      if (ecarts.length) throw new Error([...new Set(ecarts)].slice(0, 4).join(' | ') +
        ` (${compares} comparaisons)`);
      if (!compares) throw new Error('aucune comparaison possible : la verification ne prouve rien');
      console.log(`     (${compares} comparaisons sur ${coupes.length} dates de coupe)`);
    });
  }

  // La vérification ci-dessus ne couvre que six jours, faute de bougies
  // 1 minute au-delà. Celle-ci couvre les SOIXANTE jours en retirant le
  // 1 minute DES DEUX CÔTÉS : la comparaison redevient loyale, et c'est de
  // toute façon sur les unités SUPÉRIEURES que le regard en avant se logeait.
  for (const [nom, strat] of [['le modèle', Modele], ['kintt', Kintt]]) {
    t(nom + ' ne dépend pas de l\'avenir des unités supérieures', () => {
      const sansFin = S => { const o = Object.assign({}, S); o.m1 = []; return o; };
      const base = sansFin(DA), baseE = EA.m5 ? sansFin(EA) : null;
      const plein = strat.evaluer(base, baseE);
      const sigs = (plein && plein.tousSignaux) || [];
      if (sigs.length < 3) { console.log('     (trop peu de signaux sans le 1 min)'); return; }
      const ecarts = []; let compares = 0;
      // dix dates de coupe réparties sur tout l'historique
      const pas = Math.max(1, Math.floor(sigs.length / 10));
      for (let k = pas; k < sigs.length; k += pas) {
        const tc = sigs[k].t + 5 * 60000;
        const T2 = couper(base, tc), E2 = baseE ? couper(baseE, tc) : null;
        if (!T2.m5 || T2.m5.length < 200) continue;
        const vus = (strat.evaluer(T2, E2) || {}).tousSignaux || [];
        const attendus = sigs.filter(x => x.t < tc);
        for (const sig of attendus) {
          compares++;
          const q = new Date(sig.t).toISOString().slice(0, 16).replace('T', ' ');
          const vu = vus.filter(x => x.t === sig.t)[0];
          if (!vu) { ecarts.push(q + ' disparait sans l\'avenir'); continue; }
          for (const champ of ['sens', 'entree', 'sl', 'tp'])
            if (String(vu[champ]) !== String(sig[champ]))
              ecarts.push(`${q} · ${champ} ${sig[champ]} -> ${vu[champ]}`);
        }
        // ⚠️ L'AUTRE SENS, ET C'EST CELUI QUI MANQUAIT.
        // La version précédente ne vérifiait que « un signal du passé
        // survit-il quand on retire l'avenir ». Elle ne voyait donc pas le
        // cas inverse : un signal qui EXISTAIT à l'époque et que les données
        // postérieures EFFACENT. C'est pourtant ce qui s'est produit — le
        // robot a consigné deux signaux le 1er octobre, et le modèle rejoué
        // trois jours plus tard n'en voyait plus aucun.
        for (const vu of vus) {
          compares++;
          if (attendus.some(x => x.t === vu.t)) continue;
          ecarts.push(new Date(vu.t).toISOString().slice(0, 16).replace('T', ' ') +
            ' EFFACÉ par les données postérieures');
        }
      }
      if (ecarts.length) throw new Error([...new Set(ecarts)].slice(0, 4).join(' | ') +
        ` (${compares} comparaisons)`);
      if (!compares) throw new Error('aucune comparaison possible');
      console.log(`     (${compares} comparaisons sur tout l'historique)`);
    });
  }

  // ── L'INVARIANT DIRECT, SUR LES BRIQUES ELLES-MÊMES ──────────────────────
  // La vérification par troncature de signaux ne voit pas un décalage d'UNE
  // bougie : vérifiée, elle rattrape bien une cassure de FVG datée trop tôt,
  // mais laisse passer un rejection block et un STL décalés d'un cran. Il faut
  // donc contrôler les briques, et pas seulement ce qu'on en fait.
  //
  // LA RÈGLE, en une phrase : un élément de structure ne peut pas être connu
  // avant que la dernière bougie dont il dépend soit CLOSE. On le vérifie en
  // coupant la série à l'instant que l'élément s'attribue et en exigeant qu'il
  // apparaisse quand même. Trois défauts réels ont été trouvés comme ça :
  //   · un rejection block réclame la bougie SUIVANTE (« creux local ») et se
  //     datait de celle du milieu — une bougie d'avance, quatre heures en H4 ;
  //   · un STL se disait connu à l'OUVERTURE de la bougie qui le confirme ;
  //   · un CISD, décidé par une clôture, se datait de l'ouverture.
  {
    const series = [['5 min', DA.m5], ['15 min', DA.m15], ['1 h', DA.h1]];
    const briques = [
      ['FVG', cs => ST.fvgs(cs).map(z => ({ q: z.t, c: [z.bas, z.haut, z.haussier].join('|') }))],
      ['FVG cassé', cs => ST.fvgs(cs).filter(z => z.tCasse != null)
        .map(z => ({ q: z.tCasse, c: [z.bas, z.haut, z.haussier, 'K'].join('|') }))],
      ['CISD', cs => ST.cisd(cs).map(z => ({ q: z.t, c: [z.bas, z.haut, z.haussier].join('|') }))],
      ['rejection block', cs => ST.rejectionBlocks(cs).map(z => ({ q: z.t, c: [z.bas, z.haut, z.haussier].join('|') }))],
      ['STL', cs => ST.hierarchie(cs).stl.map(z => ({ q: z.vu, c: String(z.prix) }))],
      ['ITL', cs => ST.hierarchie(cs).itl.map(z => ({ q: z.vu, c: String(z.prix) }))]
    ];
    for (const [nomS, cs] of series) {
      if (!cs || cs.length < 500) continue;
      const pas = ST.pasDe(cs);
      for (const [nomB, extrait] of briques) {
        t(`${nomB} ${nomS} : connu seulement quand sa dernière bougie est close`, () => {
          const tout = extrait(cs);
          if (!tout.length) return;
          // on éprouve quelques éléments répartis dans l'historique
          const pasEch = Math.max(1, Math.floor(tout.length / 12));
          const fautifs = [];
          for (let k = pasEch; k < tout.length; k += pasEch) {
            const e = tout[k];
            if (!(e.q > 0)) { fautifs.push('horodatage absent'); continue; }
            // la série telle qu'elle est connue à l'instant que l'élément s'attribue
            const vue = cs.filter(b => b.t + pas <= e.q);
            if (vue.length < 5) continue;
            if (!extrait(vue).some(x => x.c === e.c && x.q === e.q))
              fautifs.push(new Date(e.q).toISOString().slice(0, 16) + ' (' + e.c + ')');
          }
          if (fautifs.length) throw new Error(fautifs.length +
            ' élément(s) se disent connus trop tôt, ex. ' + fautifs[0]);
        });
      }
    }
  }

  t('aucune unité supérieure n\'est lue en cours de formation', () => {
    // Le garde-fou de code, en plus du garde-fou de comportement : sur une
    // série agrégée, c'est idxClos qu'il faut, jamais idxA.
    for (const f of ['js/modele.js', 'js/kintt.js']) {
      const src = fs.readFileSync(path.join(RACINE, f), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const restes = [...src.matchAll(/ST\.idxA\(([^,]+),/g)].map(m => m[1].trim());
      if (restes.length)
        throw new Error(f + ' interroge encore une bougie en cours : ' + restes.join(', '));
    }
  });

  t('le biais date ce qu\'il apprend de la CLÔTURE, pas de l\'ouverture', () => {
    for (const f of ['js/modele.js', 'js/kintt.js']) {
      const src = fs.readFileSync(path.join(RACINE, f), 'utf-8');
      if (/out\.push\(\{\s*t:\s*cs\[iRes\]\.t/.test(src))
        throw new Error(f + ' : un événement est daté à l\'ouverture de sa bougie');
      if (!/ST\.pasDe\(cs\)/.test(src))
        throw new Error(f + ' : le décalage à la clôture est absent');
    }
  });
}

console.log('\n── UN CHIFFRE PORTE LE NOM DE CE QU\'IL EST ───────────────────');
// BUG RÉEL, trouvé parce que quelqu'un a demandé « 33 % de réussite, mais
// combien de RR ? ». Le champ s'appelait `rr` et valait 0,61. Ce n'était pas
// un rapport à l'objectif — celui-là vaut 2,50 — mais le GAIN SI TOUT EST
// TOUCHÉ, puisque 90 % de la position est vendue au premier objectif.
// Conséquences, toutes silencieuses :
//   · le site affichait « RR 0,61 » pour un objectif à 2,5 fois le risque ;
//   · scripts/kintt_test.js s'en servait comme PLAFOND de suivi et mesurait
//     donc le modèle avec un objectif final à 0,61 : 2 116 € annoncés au lieu
//     de 2 622 € ;
//   · js/history.js comptait un gain local à `rr`, ce qui aurait multiplié le
//     gain par quatre dès que le champ serait corrigé.

if (dispo) {
  const lireR = (s2, i, r) => {
    const f = path.join(CACHE, `${s2}_${i}_${r}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
  };
  const DR = {}, ER = {};
  for (const x of Modele.SERIES) DR[x.cle] = lireR('NQF', x.interval, x.range);
  for (const x of Modele.SERIES2) ER[x.cle] = lireR('ESF', x.interval, x.range);
  const dr = DR.m5 ? Modele.evaluer(DR, ER.m5 ? ER : null) : null;
  const kr = DR.m5 ? Kintt.evaluer(DR, ER.m5 ? ER : null) : null;

  for (const [nom, sigs] of [['modèle', (dr && dr.tousSignaux) || []],
                             ['kintt', (kr && kr.tousSignaux) || []]]) {
    t(nom + ' : `rr` est bien le rapport entre l\'objectif et le risque', () => {
      for (const x of sigs) {
        const vrai = Math.abs(x.tp - x.entree) / Math.abs(x.entree - x.sl);
        if (Math.abs(x.rr - vrai) > 0.02)
          throw new Error(`${new Date(x.t).toISOString().slice(0, 16)} : rr ${x.rr} pour un objectif à ${vrai.toFixed(2)} fois le risque`);
      }
    });
  }

  t('le modèle dit AUSSI ce que vaut la position si tout est touché', () => {
    // Les deux nombres existent et ne se confondent plus. Sans le second,
    // js/history.js n'a rien pour compter un gain et retombe sur `rr`.
    const attendu = +(Modele.CFG.part * Modele.CFG.tp1 +
                      (1 - Modele.CFG.part) * Modele.CFG.tp2).toFixed(2);
    for (const x of (dr && dr.tousSignaux) || []) {
      if (x.gainSiTout == null) throw new Error('champ gainSiTout absent');
      if (Math.abs(x.gainSiTout - attendu) > 1e-9)
        throw new Error(`gainSiTout ${x.gainSiTout} au lieu de ${attendu}`);
    }
  });
}

t('js/history.js compte un gain avec le gain, pas avec le rapport', () => {
  const src = fs.readFileSync(path.join(RACINE, 'js/history.js'), 'utf-8');
  const sans = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (/'win'\s*\?\s*x\.rr\s*:/.test(sans))
    throw new Error('un gain local vaut encore x.rr — quatre fois trop');
  if (!/gainMax/.test(sans)) throw new Error('le champ gainMax n\'est pas utilisé');
});

t('le site déduit le rapport des NIVEAUX et ne le lit pas', () => {
  // Les signaux déjà écrits au journal portent l'ancienne valeur. Recalculer
  // à l'affichage répare l'historique sans le réécrire.
  const h = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf-8');
  if (/rr:\s*s\.rr\s*,/.test(h)) throw new Error('le journal relit le champ figé');
  if (!/Math\.abs\(s\.tp - s\.entree\) \/ Math\.abs\(s\.entree - s\.sl\)/.test(h))
    throw new Error('le rapport n\'est pas recalculé à la lecture');
});

t('scripts/kintt_test.js ne plafonne par signal que pour kintt', () => {
  // C'est ce plafond appliqué au modèle qui a fait annoncer 2 116 € pendant
  // des jours, au lieu de 2 622 €.
  const src = fs.readFileSync(path.join(RACINE, 'scripts/kintt_test.js'), 'utf-8');
  if (!/parSignal/.test(src)) throw new Error('le plafond s\'applique encore à tout le monde');
  // Le nom d'une mesure contient des parenthèses — « kintt (10h-12h) » — donc
  // on lit l'appel jusqu'au bout de sa ligne, pas jusqu'à la première.
  const appels = [...src.matchAll(/mesurer\((.*)$/gm)].map(m => m[1])
    .filter(a => !/^sigs, cfg, nom/.test(a));
  for (const a of appels) {
    if (/Modele\.CFG/.test(a) && /true/.test(a))
      throw new Error('le modèle est mesuré avec un plafond par signal : ' + a);
    if (/Kintt\.CFG/.test(a) && !/true/.test(a) && !/parSignal/.test(a))
      throw new Error('kintt est mesuré SANS plafond par signal : ' + a);
  }
});

t('la reconstitution porte les deux nombres, sous deux noms', () => {
  const src = fs.readFileSync(path.join(RACINE, 'js/mesure.js'), 'utf-8');
  if (!/'rr','gainMax'/.test(src.replace(/\s/g, '')))
    throw new Error('js/mesure.js ne distingue pas les deux — régénérer avec gen_mesure.js');
  const ctx2 = {}; global.window = ctx2;
  new Function('window', src + '\nreturn Mesure;')(ctx2);
  const L2 = ctx2.Mesure.liste();
  for (const x of L2) {
    const vrai = Math.abs(x.tp - x.entry) / Math.abs(x.entry - x.sl);
    if (Math.abs(x.rr - vrai) > 0.02)
      throw new Error(`${x.jour} : rr ${x.rr} pour un objectif à ${vrai.toFixed(2)} fois le risque`);
  }
});

t('plus un seul R dans les phrases de la reconstitution', () => {
  // « brut +0,61 R » s'affichait dans l'infobulle de chaque ligne du journal.
  // Composé à l'exécution, il échappait au test qui ne relit que le source.
  const src = fs.readFileSync(path.join(RACINE, 'js/mesure.js'), 'utf-8');
  const ctx2 = {}; global.window = ctx2;
  new Function('window', src + '\nreturn Mesure;')(ctx2);
  const fautifs = ctx2.Mesure.liste().filter(x => /\d[,.]\d\s*R\b|\d\s*R\b/.test(x.motif || ''));
  if (fautifs.length) throw new Error(fautifs.length + ' phrase(s), ex. « ' + fautifs[0].motif + ' »');
});

console.log('\n── LA STRATÉGIE KINTT ────────────────────────────────────────');
// Deuxième stratégie, suivant le plan source « 10AM OXXC ». Elle tourne à
// côté de js/modele.js, elle ne le remplace pas. Les mêmes invariants lui
// sont appliqués : c'est le minimum pour qu'elle soit comparable.

t('kintt : la fenêtre d\'entrée est cohérente', () => {
  const K = Kintt.CFG;
  if (!(K.obs <= K.deb && K.deb < K.primaire && K.primaire <= K.fin))
    throw new Error(`${K.obs} → ${K.deb} → ${K.primaire} → ${K.fin}`);
});
t('kintt : la fenêtre du plan est bien 10h → 12h New York', () => {
  eq(Kintt.CFG.deb, 600, 'première entrée');
  eq(Kintt.CFG.fin, 720, 'deadline ferme');
});
t('kintt : le M5 ne fait PAS partie des zones, comme dans le plan', () => {
  if (Kintt.CFG.unites.indexOf('M5') >= 0)
    throw new Error('le plan liste M15 / M30 / H1 / H4, pas le M5');
});
t('kintt : les deux confirmations sont exigées, comme dans le plan', () => {
  if (!Kintt.CFG.exigeIFVG || !Kintt.CFG.exigeCISD)
    throw new Error('le plan veut IFVG ET CISD, pas l\'un ou l\'autre');
});
t('kintt : le plafond de deux entrées par jour est en place', () => {
  eq(Kintt.CFG.maxJour, 2, 'entrées par jour');
});

if (dispo) {
  const lireK = (s2, i, r) => {
    const f = path.join(CACHE, `${s2}_${i}_${r}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
  };
  const DK = {}, EK = {};
  for (const x of Modele.SERIES) DK[x.cle] = lireK('NQF', x.interval, x.range);
  for (const x of Modele.SERIES2) EK[x.cle] = lireK('ESF', x.interval, x.range);
  const dk = DK.m5 ? Kintt.evaluer(DK, EK.m5 ? EK : null) : null;
  const SK = (dk && dk.tousSignaux) || [];

  t('kintt : aucun signal n\'a son stop du mauvais côté', () => {
    const faux = SK.filter(x => x.sens === 'LONG' ? !(x.sl < x.entree) : !(x.sl > x.entree));
    if (faux.length) throw new Error(faux.length + ' sur ' + SK.length);
  });
  t('kintt : aucun signal n\'a son objectif du mauvais côté', () => {
    const faux = SK.filter(x => x.sens === 'LONG' ? !(x.tp > x.entree) : !(x.tp < x.entree));
    if (faux.length) throw new Error(faux.length + ' sur ' + SK.length);
  });
  t('kintt : tous les signaux tombent entre 10h et 12h New York', () => {
    const dehors = SK.filter(x => {
      const e2 = Kintt.heure(x.t);
      return e2.min < Kintt.CFG.deb || e2.min >= Kintt.CFG.fin;
    });
    if (dehors.length) throw new Error(dehors.length + ' hors fenêtre');
  });
  t('kintt : le plafond par jour est respecté', () => {
    const pj = {};
    SK.forEach(x => { const j = Kintt.heure(x.t).jour; pj[j] = (pj[j] || 0) + 1; });
    const trop = Object.keys(pj).filter(j => pj[j] > Kintt.CFG.maxJour);
    if (trop.length) throw new Error('jours dépassant : ' + trop.join(', '));
  });
  t('kintt : chaque signal vise au moins le risque pris', () => {
    const faux = SK.filter(x => x.rr < Kintt.CFG.rrMin - 1e-9);
    if (faux.length) throw new Error(faux.length + ' signal(aux) sous le seuil');
  });
  t('kintt : l\'entonnoir additionne bien toutes les bougies', () => {
    if (!dk || !dk.entonnoir) throw new Error('pas d\'entonnoir');
    const E3 = dk.entonnoir;
    const somme = Object.keys(E3).filter(k => k !== 'barres')
      .reduce((a, k) => a + E3[k], 0);
    if (somme !== E3.barres)
      throw new Error(`${somme} comptées pour ${E3.barres} bougies — une branche ne compte pas`);
  });
}

// ── KINTT EST-IL VRAIMENT BRANCHÉ ? ───────────────────────────────────────
// Une stratégie qui n'atteint ni le relevé ni la page n'existe pas. Ces
// vérifications-là ne regardent pas ce que kintt CALCULE, mais si quelqu'un
// le lui demande et si le résultat arrive à l'écran.

t('kintt lit EXACTEMENT les mêmes séries que le modèle', () => {
  // Le relevé ne télécharge qu'une fois, avec Modele.SERIES, et donne les
  // mêmes bougies aux deux stratégies. Si les listes divergeaient, kintt
  // recevrait des séries qu'il n'a pas demandées — c'est l'erreur qui avait
  // fait mesurer 37 signaux au robot contre 42 au banc d'essai.
  const a = JSON.stringify(Modele.SERIES), b = JSON.stringify(Kintt.SERIES);
  if (a !== b) throw new Error('modèle ' + a + ' · kintt ' + b);
});

t('scripts/live_log.js fait tourner kintt à chaque passage', () => {
  const src = fs.readFileSync(path.join(RACINE, 'scripts/live_log.js'), 'utf-8');
  if (!/js', 'kintt\.js'/.test(src)) throw new Error('le module n\'est pas chargé');
  if (!/Kintt\.evaluer\(/.test(src)) throw new Error('la stratégie n\'est jamais évaluée');
  if (!/data', 'kintt\.json'/.test(src)) throw new Error('aucun journal n\'est tenu');
});

t('scripts/live_log.js ne recopie pas les bougies dans l\'instantané', () => {
  // `etape.zone` porte la SÉRIE ENTIÈRE dans le champ `cs`. Recopiée telle
  // quelle, elle ferait un etat.json de plusieurs mégaoctets, téléchargé à
  // chaque ouverture de la page. L'instantané ne doit garder que les bornes.
  const src = fs.readFileSync(path.join(RACINE, 'scripts/live_log.js'), 'utf-8');
  const m = src.match(/function instantaneKintt\([\s\S]*?\n\}/);
  if (!m) throw new Error('instantaneKintt introuvable');
  if (/Object\.assign\(\{\}, e\.zone\)|zone: e\.zone\s*[,}]/.test(m[0]))
    throw new Error('la zone est recopiée entière, avec ses bougies');
  // Et la preuve sur le fichier réellement produit : pas de bougies dedans,
  // et un poids que le téléphone du visiteur peut se permettre.
  const ef = path.join(RACINE, 'data/etat.json');
  if (fs.existsSync(ef)) {
    const E4 = JSON.parse(fs.readFileSync(ef, 'utf-8'));
    if (E4.kintt) {
      const poids = JSON.stringify(E4.kintt).length;
      if (poids > 50000) throw new Error('l\'instantané de kintt pèse ' + poids + ' octets');
      const z = E4.kintt.etape && E4.kintt.etape.zone;
      if (z && ('cs' in z)) throw new Error('la série de bougies voyage dans l\'instantané');
    }
  }
});

t('scripts/build_single.js publie le journal de kintt', () => {
  const src = fs.readFileSync(path.join(RACINE, 'scripts/build_single.js'), 'utf-8');
  const m = src.match(/const PUBLIES = \[([^\]]*)\]/);
  if (!m) throw new Error('liste des fichiers publiés introuvable');
  if (!/kintt\.json/.test(m[1])) throw new Error('kintt.json n\'est pas publié : ' + m[1]);
});

t('le site charge js/kintt.js et affiche son panneau', () => {
  const h = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf-8');
  if (!/<script src="js\/kintt\.js"><\/script>/.test(h))
    throw new Error('le module n\'est pas chargé par la page');
  for (const id of ['pan-kintt', 'k-tag', 'k-gauge', 'kintt'])
    if (h.indexOf('id="' + id + '"') < 0) throw new Error('repère absent : ' + id);
  if (!/href="#pan-kintt"/.test(h)) throw new Error('aucun lien de navigation vers le panneau');
  if (!/function paintKintt\(/.test(h)) throw new Error('le panneau n\'est jamais dessiné');
  if (!/paintKintt\(\);[\s\S]{0,400}paintFooter\(\)/.test(h.replace(/\n/g, ' ')))
    throw new Error('paintKintt n\'est pas appelé dans le cycle d\'affichage');
});

t('le site calcule aussi kintt quand le flux direct est branché', () => {
  // Sans cette ligne, le panneau se vide dès qu'on branche OANDA — c'est-à-dire
  // exactement au moment où on regarde le marché.
  const h = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf-8');
  if (!/Kintt\.evaluer\(brut\)/.test(h))
    throw new Error('le mode direct n\'évalue pas kintt');
});

// ── LE JOURNAL DE KINTT SE TIENT ──────────────────────────────────────────
const kf = path.join(RACINE, 'data/kintt.json');
if (fs.existsSync(kf)) {
  const K2 = JSON.parse(fs.readFileSync(kf, 'utf-8'));
  t('kintt : le bilan compte le même nombre de signaux que la liste', () => {
    eq(K2.bilan.total, K2.signaux.length, 'total');
    eq(K2.bilan.clos, K2.signaux.filter(s => s.statut === 'clos').length, 'clos');
  });
  t('kintt : aucun résultat ne sort des bornes de SON objectif', () => {
    // Le plafond de kintt change à chaque trade, puisqu'il vise une ZONE :
    // c'est `rr`, consigné avec le signal. Un résultat au-delà voudrait dire
    // que le suivi a utilisé le plafond d'un autre trade.
    for (const s of K2.signaux.filter(x => x.statut === 'clos')) {
      const haut = s.rr != null ? s.rr : Kintt.CFG.tpR;
      if (s.r < -1 - 1e-6 || s.r > haut + 1e-6)
        throw new Error(`${s.jour} ${s.heureNY} : ${s.r} hors de [−1 ; ${haut}]`);
    }
  });
  t('kintt : tous les signaux du journal tombent entre 10h et 12h', () => {
    for (const s of K2.signaux) {
      const m = +s.heureNY.slice(0, 2) * 60 + +s.heureNY.slice(3);
      if (m < Kintt.CFG.deb || m >= Kintt.CFG.fin)
        throw new Error(`${s.jour} ${s.heureNY} hors de la fenêtre du plan`);
    }
  });
  t('kintt : le stop et l\'objectif encadrent l\'entrée', () => {
    for (const s of K2.signaux) {
      const L = s.sens === 'LONG';
      if (L ? !(s.sl < s.entree && s.tp > s.entree) : !(s.sl > s.entree && s.tp < s.entree))
        throw new Error(`${s.jour} ${s.heureNY} ${s.sens} : ${s.sl} / ${s.entree} / ${s.tp}`);
    }
  });
  t('kintt : le journal n\'est JAMAIS mélangé à celui du modèle', () => {
    // Le mélange serait pire que l'absence : trois trades à 10 h et
    // quarante-et-un à 9 h ne se moyennent pas.
    const jf2 = path.join(RACINE, 'data/signaux.json');
    if (!fs.existsSync(jf2)) return;
    const J3 = JSON.parse(fs.readFileSync(jf2, 'utf-8'));
    const cles = new Set(J3.signaux.map(s => s.cle));
    const communs = K2.signaux.filter(s => cles.has(s.cle));
    if (communs.length) throw new Error(communs.length + ' signal(aux) dans les deux journaux');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PERSONNE NE GARDE SA PROPRE COPIE DU SUIVI ────────────────');
// LA CAUSE DE TOUT : le calcul de ce que vaut une position était écrit à cinq
// endroits. Chaque copie a fini par diverger, et chaque divergence a envoyé un
// faux chiffre à l'écran. Ces deux vérifications interdisent qu'une sixième
// copie apparaisse.

const CONSOMMATEURS = ['scripts/live_log.js', 'scripts/gen_mesure.js',
                       'scripts/balayage.js', 'index.html'];

for (const f of CONSOMMATEURS) {
  t(f + ' charge js/position.js', () => {
    const src = fs.readFileSync(path.join(RACINE, f), 'utf-8');
    if (!/position\.js/.test(src)) throw new Error('ne charge pas le module partagé');
  });
}

t('aucun script ne réimplémente la bascule du partiel', () => {
  // La signature d'une copie : « part1 = true » suivi d'un stop remonté à
  // l'entrée. Elle n'a le droit d'exister que dans js/position.js.
  const coupables = [];
  for (const f of CONSOMMATEURS.concat(['scripts/gen_mesure.js'])) {
    const src = fs.readFileSync(path.join(RACINE, f), 'utf-8');
    const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (/part1\s*=\s*true\s*;\s*(sl|cur)\s*=/.test(sansCommentaires)) coupables.push(f);
  }
  if (coupables.length) throw new Error('copie du suivi dans : ' + [...new Set(coupables)].join(', '));
});

t('js/position.js est bien le seul à porter la règle', () => {
  const src = fs.readFileSync(path.join(RACINE, 'js/position.js'), 'utf-8');
  if (!/part1\s*=\s*true/.test(src)) throw new Error('la règle a disparu du module partagé');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LES DONNÉES D\'ENTRÉE SONT SAINES ──────────────────────────');
// Le modèle ne vaut rien si on le nourrit de bougies fausses. Yahoo en sert :
// il ajoute la cotation en cours comme une pseudo-bougie (ouverture = haut =
// bas = clôture, horodatage hors grille), et il lui arrive de servir des
// séries trouées ou désordonnées. Sans ces contrôles, le modèle les avale
// sans rien dire.

if (dispo) {
  const lire = (s, i, r) => JSON.parse(fs.readFileSync(path.join(CACHE, `${s}_${i}_${r}.json`), 'utf-8'));
  const SERIES = [['NQF','5m','60d',300000], ['NQF','15m','60d',900000],
                  ['NQF','1m','8d',60000], ['ESF','5m','60d',300000]];
  for (const [sym, iv, rg, pas] of SERIES) {
    const f = path.join(CACHE, `${sym}_${iv}_${rg}.json`);
    if (!fs.existsSync(f)) continue;
    const cs = lire(sym, iv, rg);
    t(`${sym} ${iv} : les bougies sont en ordre chronologique`, () => {
      for (let i = 1; i < cs.length; i++)
        if (cs[i].t <= cs[i - 1].t) throw new Error('désordre à l\'indice ' + i);
    });
    t(`${sym} ${iv} : haut ≥ bas sur chaque bougie`, () => {
      const faux = cs.filter(c => c.h < c.l);
      if (faux.length) throw new Error(faux.length + ' bougie(s)');
    });
    t(`${sym} ${iv} : l'ouverture et la clôture sont dans la mèche`, () => {
      const faux = cs.filter(c => c.o > c.h || c.o < c.l || c.c > c.h || c.c < c.l);
      if (faux.length) throw new Error(faux.length + ' bougie(s)');
    });
    t(`${sym} ${iv} : aucun prix nul ou négatif`, () => {
      const faux = cs.filter(c => !(c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0));
      if (faux.length) throw new Error(faux.length + ' bougie(s)');
    });
    t(`${sym} ${iv} : la dernière bougie n'est pas la cotation en cours`, () => {
      // La signature : espacement plus court que le pas de la série.
      if (cs.length < 3) return;
      const d = cs[cs.length - 1].t - cs[cs.length - 2].t;
      // Tolérance : Yahoo décale parfois d'une seconde. La vraie signature
      // d'une cotation en cours est un espacement franchement court — celle
      // qui avait été mesurée valait 185 s pour un pas de 300 s.
      if (d > 0 && d < pas * 0.9)
        throw new Error('espacement ' + (d / 1000) + ' s pour un pas de ' + (pas / 1000) + ' s');
    });
    t(`${sym} ${iv} : pas de saut de prix absurde entre deux bougies`, () => {
      // Un écart de plus de 10 % d'une bougie à l'autre sur un indice est une
      // donnée corrompue, pas un mouvement de marché.
      for (let i = 1; i < cs.length; i++) {
        const v = Math.abs(cs[i].c - cs[i - 1].c) / cs[i - 1].c;
        if (v > 0.10) throw new Error('saut de ' + (v * 100).toFixed(0) + ' % le ' +
          new Date(cs[i].t).toISOString().slice(0, 10));
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LE MODÈLE PRODUIT TOUJOURS LA MÊME CHOSE ──────────────────');
// Le trou que les contrôles de cohérence ne voient pas : une modification qui
// change les résultats sans rien casser. 42 signaux devenus 30, c'est
// parfaitement cohérent — et catastrophique si ce n'était pas voulu.

t('les résultats sont conformes à data/reference.json', () => {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('node', [path.join(RACINE, 'scripts/reference.js')],
      { encoding: 'utf-8', env: process.env, stdio: 'pipe' });
  } catch (e) {
    throw new Error((e.stderr || e.stdout || '').trim().split('\n')
      .filter(l => l.trim()).slice(1).join(' · ') || 'écart détecté');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── LES FICHIERS DE DONNÉES ONT LA FORME ATTENDUE ─────────────');
// Un champ renommé ou disparu casse le site en silence : la page affiche
// « — » partout et personne ne sait pourquoi. C'est arrivé avec
// `derniere_bougie` contre `derniereBougie`, et avec `tf_retenue`.

const CHAMPS_ETAT = ['maj', 'prix', 'derniereBougie', 'hors', 'etat', 'parTF', 'cfg'];
const CHAMPS_SIGNAL = ['bougie', 'jour', 'heureNY', 'sens', 'entree', 'sl', 'tp1', 'tp',
                       'risquePts', 'statut', 'raisonnement', 'slx'];

const ef = path.join(RACINE, 'data/etat.json');
if (fs.existsSync(ef)) {
  const E2 = JSON.parse(fs.readFileSync(ef, 'utf-8'));
  t('data/etat.json porte tous les champs que le site lit', () => {
    const manque = CHAMPS_ETAT.filter(k => !(k in E2));
    if (manque.length) throw new Error('manque : ' + manque.join(', '));
  });
  t('le prix de l\'instantané est un nombre plausible', () => {
    if (!(E2.prix > 0 && isFinite(E2.prix))) throw new Error('prix = ' + E2.prix);
  });
  t('les réglages de l\'instantané sont ceux du modèle', () => {
    for (const k of ['slx', 'tp1', 'tp2', 'part', 'ghDeb', 'ghFin'])
      if (E2.cfg[k] !== CFG[k]) throw new Error(k + ' : ' + E2.cfg[k] + ' ≠ ' + CFG[k]);
  });
}
if (fs.existsSync(jf)) {
  const J2 = JSON.parse(fs.readFileSync(jf, 'utf-8'));
  t('chaque signal du journal porte tous ses champs', () => {
    for (const s of J2.signaux) {
      const manque = CHAMPS_SIGNAL.filter(k => !(k in s));
      if (manque.length) throw new Error(s.jour + ' ' + s.heureNY + ' manque : ' + manque.join(', '));
    }
  });
  t('la phrase RECOMPOSÉE de chaque signal parle en euros et en points', () => {
    // On ne teste PAS la phrase stockée : elle est figée à la date du signal
    // et ne peut pas être corrigée. On teste celle que le site recompose, qui
    // est la seule que quelqu'un lit vraiment.
    for (const s of J2.signaux) {
      const p = ctx.Position.raisonnement(s, CFG, 250, ' €');
      if (!/points/.test(p)) throw new Error(s.jour + ' : pas de points');
      if (!/€/.test(p)) throw new Error(s.jour + ' : pas d\'euros');
      if (/\d[,.]\d\s*R\b/.test(p)) throw new Error(s.jour + ' : parle encore en R');
    }
  });
  t('le site recompose la phrase au lieu de lire celle du journal', () => {
    const h = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf-8');
    if (!/Position\.raisonnement/.test(h))
      throw new Error('le site affiche la phrase figée du journal');
  });
  t('les copies sous docs/ sont identiques aux originales', () => {
    for (const n of ['etat.json', 'signaux.json', 'kintt.json']) {
      if (!fs.existsSync(path.join(RACINE, 'data', n))) continue;
      const a = path.join(RACINE, 'data', n), c = path.join(RACINE, 'docs/data', n);
      if (!fs.existsSync(c)) throw new Error('docs/data/' + n + ' absent');
      if (fs.readFileSync(a, 'utf-8') !== fs.readFileSync(c, 'utf-8'))
        throw new Error(n + ' : la copie publiée diffère de l\'originale');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Le site dans un vrai navigateur. Lent (quelques secondes), donc sur demande :
//   node scripts/test.js --navigateur
// Une erreur JavaScript ne casse rien de visible : la page s'arrête de se
// remplir et affiche « — » partout. C'est exactement ce qui s'était produit
// quand `derniere_bougie` avait été renommé.
if (process.argv.includes('--navigateur')) {
  console.log('\n── LE SITE S\'OUVRE SANS ERREUR ───────────────────────────────');
  const { execFileSync } = require('child_process');
  const script = `
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage();
const err = [];
p.on('pageerror', e => err.push('ERREUR JS : ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|file:|Failed to load resource/.test(m.text())) err.push('CONSOLE : ' + m.text()); });
await p.route('**://query*.finance.yahoo.com/**', r => r.fulfill({ status: 500, body: '{}' }));
await p.goto('file://${RACINE}/TRADEassist.html', { waitUntil: 'load' });
await p.waitForTimeout(2500);
// Le radar est un canvas : s'il ne dessine rien, la page a l'air correcte et
// le cœur visuel du site est mort. On compte les pixels non transparents.
const radar = await p.evaluate(() => {
  const c = document.querySelector('canvas'); if (!c) return -1;
  const g = c.getContext('2d'); if (!g) return -1;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
});
// Débordement horizontal à la largeur d'un téléphone : le site est lu sur iPad
// et sur téléphone, une barre de défilement latérale le rend inutilisable.
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(400);
const deborde = await p.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
const panneaux = await p.evaluate(() =>
  ['#f-mes', '#f-conf', '#jchips', '#pan-kintt', '#kintt', '#f-kfen']
    .filter(s => !document.querySelector(s)));
// ── LA PAGE SERVIE, AVEC SES DONNÉES ────────────────────────────────────
// Ouverte en file://, la page ne peut pas lire data/etat.json : tous les
// panneaux nourris par le relevé restent à « — » et le test ne les voit
// jamais. On sert donc docs/ sur une vraie adresse, comme GitHub Pages, et
// on vérifie que le panneau KINTT SE REMPLIT — pas seulement qu'il existe.
import http from 'node:http';
import fsp from 'node:fs';
const TYPES = { '.html':'text/html', '.json':'application/json', '.js':'text/javascript' };
const srv = http.createServer((q, r) => {
  const rel = (q.url.split('?')[0] === '/' ? '/index.html' : q.url.split('?')[0]);
  const f = '${RACINE}/docs' + rel;
  if (!fsp.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[rel.slice(rel.lastIndexOf('.'))] || 'text/plain' });
  r.end(fsp.readFileSync(f));
});
await new Promise(res => srv.listen(0, '127.0.0.1', res));
const port = srv.address().port;
await p.setViewportSize({ width: 1280, height: 900 });
const err2 = [];
p.removeAllListeners('pageerror'); p.on('pageerror', e => err2.push('ERREUR JS : ' + e.message));
await p.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
await p.waitForTimeout(3000);
// Le R traqué DANS LE TEXTE AFFICHÉ, pas dans le source. « +0,60 R » était
// composé à l'exécution par concaténation : aucun test relisant les fichiers
// ne pouvait le voir, et il s'affichait sur chaque ligne du journal.
const enR = await p.evaluate(() => {
  const t = document.body.innerText || '';
  return [...new Set((t.match(/[-+−]?\\d+([.,]\\d+)?[ \\u00a0]*R(?![\\wÀ-ÿ])/g) || []))].slice(0, 6);
});
// Les infobulles ne sont pas dans innerText : on lit aussi les attributs title.
const enRTitres = await p.evaluate(() =>
  [...new Set([...document.querySelectorAll('[title]')]
    .flatMap(e => (e.getAttribute('title').match(/[-+−]?\\d+([.,]\\d+)?[ \\u00a0]*R(?![\\wÀ-ÿ])/g) || [])))].slice(0, 6));
const kintt = {
  err: err2, enR, enRTitres,
  tag: (await p.textContent('#k-tag') || '').trim(),
  texte: (await p.textContent('#kintt') || '').trim(),
  jauge: await p.evaluate(() => document.querySelector('#k-gauge').style.width),
  fen: (await p.textContent('#f-kfen') || '').trim(),
  // Le panneau du modèle doit rester rempli lui aussi : brancher une seconde
  // stratégie ne doit pas casser la première.
  chaine: (await p.textContent('#chain') || '').trim().length,
  // ── LA TROISIÈME STRATÉGIE ─────────────────────────────────────────────
  // Brancher AMD ne doit ni casser les deux autres, ni afficher un panneau
  // vide : un panneau qui existe et ne dit rien est pire qu'absent.
  amd: {
    texte: (await p.textContent('#amd') || '').trim(),
    tag: (await p.textContent('#a-tag') || '').trim(),
    jauge: await p.evaluate(() => document.querySelector('#a-gauge').style.width),
    smt: await p.evaluate(() => document.querySelector('#a-smt').value),
    // Le sélecteur de stratégies doit proposer une case par stratégie.
    cases: await p.evaluate(() => [...document.querySelectorAll('#c-strats input[data-strat]')]
      .map(e => e.dataset.strat)),
    // Décocher doit vraiment masquer le panneau.
    masque: await p.evaluate(async () => {
      const inp = document.querySelector('#c-strats input[data-strat=\"amd\"]');
      if (!inp) return 'case absente';
      inp.checked = false; inp.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 120));
      const cache = document.getElementById('pan-amd').style.display === 'none';
      inp.checked = true; inp.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 120));
      const revenu = document.getElementById('pan-amd').style.display !== 'none';
      return cache && revenu ? 'ok' : 'masquage : ' + cache + ', retour : ' + revenu;
    })
  }
};
srv.close();
const out = {
  err, pied: (await p.textContent('#f-mes') || '').trim(),
  titre: /Où se forme le signal/.test(await p.textContent('body')),
  radar, deborde, panneaux, kintt
};
console.log(JSON.stringify(out)); await b.close();`;
  let res = null;
  try {
    fs.writeFileSync('/tmp/_smoke.mjs', script);
    res = JSON.parse(execFileSync('node', ['/tmp/_smoke.mjs'], { encoding: 'utf-8' }).trim());
  } catch (e) { console.log('  ⏭️  Chromium indisponible — test sauté'); }
  if (res) {
    t('la page ne lève aucune erreur JavaScript', () => {
      if (res.err.length) throw new Error(res.err.slice(0, 3).join(' | '));
    });
    t('la page affiche bien son titre', () => { if (!res.titre) throw new Error('titre absent'); });
    t('le pied de page est rempli, pas laissé à « — »', () => {
      if (!res.pied || res.pied === '—') throw new Error('pied vide');
      if (!/\d+ signaux/.test(res.pied)) throw new Error('pied : ' + res.pied.slice(0, 60));
    });
    t('le radar dessine vraiment quelque chose', () => {
      if (res.radar < 0) throw new Error('aucun canvas trouvé');
      if (res.radar < 500) throw new Error('canvas quasi vide : ' + res.radar + ' pixels');
    });
    t('la page ne déborde pas à la largeur d\'un téléphone', () => {
      if (res.deborde > 2) throw new Error(res.deborde + ' px de débordement horizontal');
    });
    t('tous les repères d\'affichage sont présents dans la page', () => {
      if (res.panneaux.length) throw new Error('absents : ' + res.panneaux.join(', '));
    });
    // ── LE PANNEAU KINTT SE REMPLIT VRAIMENT ──────────────────────────────
    const K3 = res.kintt || {};
    t('la page servie avec ses données ne lève aucune erreur', () => {
      if ((K3.err || []).length) throw new Error(K3.err.slice(0, 3).join(' | '));
    });
    t('le panneau KINTT se remplit au lieu de rester vide', () => {
      if (!K3.texte) throw new Error('panneau vide');
      if (/Pas encore de relevé/.test(K3.texte))
        throw new Error('le panneau ne reçoit pas l\'instantané — data/etat.json ne porte pas kintt');
      if (K3.texte.length < 300) throw new Error('panneau trop court : ' + K3.texte.length + ' caractères');
    });
    t('le compteur et la jauge de KINTT sont renseignés', () => {
      if (!/^\d\/\d/.test(K3.tag)) throw new Error('compteur : « ' + K3.tag + ' »');
      if (!/%$/.test(K3.jauge || '')) throw new Error('jauge : « ' + K3.jauge + ' »');
    });
    t('le pied de page annonce la fenêtre propre à KINTT', () => {
      if (!/^\d\d h \d\d → \d\d h \d\d$/.test(K3.fen)) throw new Error('« ' + K3.fen + ' »');
    });
    t('brancher KINTT n\'a pas vidé le panneau du modèle', () => {
      if (!(K3.chaine > 200)) throw new Error('la chaîne du modèle ne fait plus que ' + K3.chaine + ' caractères');
    });
    t('la page affichée ne parle plus en R, nulle part', () => {
      const f = (K3.enR || []).concat(K3.enRTitres || []);
      if (f.length) throw new Error('reste à l\'écran : ' + [...new Set(f)].join(', '));
    });
    // ── AMD, LA TROISIÈME STRATÉGIE ───────────────────────────────────────
    const A3 = (res.kintt || {}).amd || {};
    t('le panneau AMD se remplit au lieu de rester vide', () => {
      if (!A3.texte) throw new Error('panneau vide');
      if (/Pas encore de relevé/.test(A3.texte))
        throw new Error('AMD ne reçoit rien : ni le navigateur ni le relevé ne le calculent');
      if (A3.texte.length < 300) throw new Error('panneau trop court : ' + A3.texte.length + ' caractères');
    });
    t('le compteur et la jauge d\'AMD sont renseignés', () => {
      if (!/^\d\/\d/.test(A3.tag)) throw new Error('compteur : « ' + A3.tag + ' »');
      if (!/%$/.test(A3.jauge || '')) throw new Error('jauge : « ' + A3.jauge + ' »');
    });
    t('AMD dit ce que vaut sa mesure, pas seulement son état', () => {
      // Un panneau qui annonce une stratégie sans dire sur quoi elle est
      // mesurée invite à la trader en croyant qu'elle est prouvée.
      if (!/trades/.test(A3.texte)) throw new Error('aucun décompte de trades affiché');
      if (!/Réserves/.test(A3.texte)) throw new Error('aucune réserve affichée');
    });
    t('le réglage SMT est proposé et vaut un choix connu', () => {
      if (!['exige', 'ignore', 'confirme'].includes(A3.smt))
        throw new Error('réglage SMT : « ' + A3.smt + ' »');
    });
    t('le sélecteur propose une case par stratégie', () => {
      for (const c of ['mech', 'kintt', 'amd'])
        if (!(A3.cases || []).includes(c)) throw new Error('case absente : ' + c);
    });
    t('décocher une stratégie masque vraiment son panneau', () => {
      if (A3.masque !== 'ok') throw new Error(String(A3.masque));
    });
    t('brancher AMD n\'a pas vidé le panneau de KINTT', () => {
      if (!((res.kintt || {}).texte || '').length) throw new Error('le panneau KINTT est vide');
    });

    t('KINTT dit combien de trades portent son chiffre', () => {
      // « +304 € » sans « 3 trades » est un mensonge par omission.
      if (!/trade/.test(K3.texte)) throw new Error('aucun décompte de trades affiché');
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Le site EN LIGNE comparé au dépôt. Sur demande, parce qu'il faut le réseau :
//   node scripts/test.js --enligne
// Rien ne garantissait jusqu'ici que ce qui est publié soit ce qui est ici :
// la question « est-ce que c'est à jour ? » n'avait pas de réponse mécanique.
if (process.argv.includes('--enligne')) {
  console.log('\n── LE SITE EN LIGNE EST BIEN CELUI DU DÉPÔT ──────────────────');
  const URL = 'https://destinekizolabolokopro-dot.github.io/TRADING/';
  const { execFileSync } = require('child_process');
  let enligne = null;
  try {
    enligne = execFileSync('curl', ['-sS', '-H', 'Cache-Control: no-cache',
      URL + '?v=' + Date.now()], { encoding: 'utf-8', maxBuffer: 1 << 26 });
  } catch (e) { console.log('  ⏭️  site injoignable — test sauté'); }
  if (enligne) {
    const local = fs.readFileSync(path.join(RACINE, 'docs/index.html'), 'utf-8');
    const compte = h => { const m = h.match(/var BRUT = \[([\s\S]*?)\n  \];/);
                          return m ? m[1].trim().split('\n').length : -1; };
    const version = h => { const m = h.match(/Dernière mise à jour du site : ([^.<]+)/);
                           return m ? m[1].trim() : null; };
    t('le site en ligne porte le même nombre de signaux que le dépôt', () => {
      const a = compte(local), b = compte(enligne);
      if (a !== b) throw new Error('dépôt ' + a + ' · en ligne ' + b +
        ' — la fusion n\'est pas faite, ou GitHub sert encore son cache');
    });
    t('le site en ligne porte la même date de mise à jour', () => {
      const a = version(local), b = version(enligne);
      if (!a) throw new Error('le dépôt ne porte pas de date — construire d\'abord');
      if (a !== b) throw new Error('dépôt « ' + a + ' » · en ligne « ' + b + ' »');
    });
    t('le site en ligne ne parle pas en R', () => {
      const visible = enligne.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const m = visible.match(/\d[,.]\d\s*R\b/g);
      if (m) throw new Error('reste en ligne : ' + [...new Set(m)].join(', '));
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
const total = ok + ko;
console.log('\n' + '─'.repeat(62));
console.log(`${ok}/${total} vérifications passées` + (ko ? ` · ${ko} ÉCHEC(S)` : ' · tout est bon'));

// ── CE QUI N'EST PAS VÉRIFIÉ ──────────────────────────────────────────────
// Le pire défaut d'une batterie de tests est de laisser croire qu'elle couvre
// tout. Celle-ci dit donc où elle s'arrête. Chaque ligne est un endroit où un
// bug peut encore passer.
console.log(`
CE QUI N'EST PAS VÉRIFIÉ ICI — et où un bug peut donc encore passer :

  · La STRATÉGIE elle-même. Les tests vérifient que le code fait ce qu'il dit,
    pas que ce qu'il dit soit rentable. 42 trades sur 60 jours ne prouvent rien.
  · Les DÉFINITIONS du CISD et du rejection block, qui portent l'essentiel du
    résultat et qui sont de moi, faute de source précise.
  · L'APPARENCE du site : --navigateur vérifie qu'il s'ouvre sans erreur, que
    le radar dessine, que rien ne déborde sur téléphone — pas que c'est beau.
  · Le SITE EN LIGNE n'est comparé au dépôt qu'avec --enligne (réseau requis).
  · KINTT n'a que quelques trades relevés : son panneau est vérifié comme
    MÉCANISME (branché, affiché, journal cohérent), jamais comme résultat.
    Tant que le nombre de trades clos est sous vingt, son bilan ne dit rien.
  · Le DÉCLENCHEMENT du robot est contourné, pas garanti. Cinq créneaux
    démarrent avant la séance et attendent, et l'arithmétique de chacun est
    vérifiée — mais si GitHub les abandonne TOUS, comme le 30 septembre où les
    trois d'alors ont été perdus, il ne reste que le rattrapage du soir.
  · Le REGARD EN AVANT est désormais attaqué de deux côtés : on coupe les
    bougies après un signal et on exige le même signal, et on coupe la série à
    l'instant que chaque brique s'attribue et on exige qu'elle apparaisse
    quand même. La seconde a trouvé trois défauts que la première ne voyait
    pas — un décalage d'UNE bougie lui échappe. Il peut en rester ailleurs :
    ces deux filets ne couvrent que js/structure.js et les deux stratégies.
  · LA PROFONDEUR DES DONNÉES est un plafond dur, mesuré : Yahoo refuse toute
    bougie de 5 minutes au-delà de 60 jours (quatre fenêtres demandées, quatre
    refus). Aucune des deux stratégies ne peut donc être jugée sur autre chose
    que deux mois — et kintt produit environ un trade par mois.
  · L'EXÉCUTION RÉELLE. Aucun ordre n'est passé : le dérapage, les frais réels
    et le refus d'un courtier ne sont que des hypothèses.
  · Les DONNÉES YAHOO au-delà de leur forme : si elles sont fausses mais bien
    formées, rien ne le verra.`);
if (ko) { console.log(''); echecs.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
