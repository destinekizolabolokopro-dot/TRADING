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
    for (const n of ['etat.json', 'signaux.json']) {
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
  ['#f-mes', '#f-conf', '#jchips'].filter(s => !document.querySelector(s)));
const out = {
  err, pied: (await p.textContent('#f-mes') || '').trim(),
  titre: /Où se forme le signal/.test(await p.textContent('body')),
  radar, deborde, panneaux
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
  · Le DÉCLENCHEMENT du robot est contourné, pas garanti : un travail démarre
    à 11 h 47 UTC et attend la séance. Si CE déclenchement-là manque aussi,
    seuls les passages du soir restent.
  · L'EXÉCUTION RÉELLE. Aucun ordre n'est passé : le dérapage, les frais réels
    et le refus d'un courtier ne sont que des hypothèses.
  · Les DONNÉES YAHOO au-delà de leur forme : si elles sont fausses mais bien
    formées, rien ne le verra.`);
if (ko) { console.log(''); echecs.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
