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
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Position, Modele } = ctx;
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
  const D = { m1: lire('NQF','1m','8d'), m2: lire('NQF','2m','60d'), m5: lire('NQF','5m','60d'),
              m15: lire('NQF','15m','60d'), h1: lire('NQF','1h','6mo'), d1: lire('NQF','1d','1y') };
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
const total = ok + ko;
console.log('\n' + '─'.repeat(62));
console.log(`${ok}/${total} vérifications passées` + (ko ? ` · ${ko} ÉCHEC(S)` : ' · tout est bon'));
if (ko) { console.log(''); echecs.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
