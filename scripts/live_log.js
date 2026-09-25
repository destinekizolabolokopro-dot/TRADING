'use strict';
/**
 * JOURNAL EN DIRECT — enregistre ce que le modèle fait sur le marché réel,
 * que quelqu'un regarde ou non.
 *
 * Le site est une page statique : il ne calcule que pendant qu'un onglet est
 * ouvert. Personne ne garde un onglet ouvert tous les jours de 15 h 30 à
 * 16 h 00. Ce script fait le travail à sa place, depuis une GitHub Action,
 * et écrit le résultat dans data/signaux.json — qui est versionné, donc
 * conservé pour toujours.
 *
 * Il consigne DEUX choses :
 *   · chaque signal émis, avec son raisonnement complet ;
 *   · chaque passage sans signal, avec l'étape qui a bloqué.
 * La deuxième est aussi instructive que la première : elle montre pourquoi
 * le modèle s'est tu.
 *
 * ⚠️ Ce n'est PAS du trading. Aucun ordre n'est passé nulle part. Les prix
 * viennent de Yahoo, avec une dizaine de minutes de retard : les entrées
 * consignées ici ne sont pas des prix qu'on aurait obtenus, ce sont les prix
 * de clôture des bougies. C'est un test à blanc, pas un relevé de compte.
 *
 *   node scripts/live_log.js            enregistre le passage courant
 *   node scripts/live_log.js --force    ignore la fenêtre (pour tester)
 */
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'js', 'structure.js'));
require(path.join(__dirname, '..', 'js', 'modele.js'));

const FICHIER = path.join(__dirname, '..', 'data', 'signaux.json');
const ETAT    = path.join(__dirname, '..', 'data', 'etat.json');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const SERIES = [['1m','8d','m1'],['2m','60d','m2'],['5m','60d','m5'],
                ['15m','60d','m15'],['60m','3mo','h1'],['1d','1y','d1']];
const DUREE = { '1m': 6e4, '2m': 12e4, '5m': 3e5, '15m': 9e5, '60m': 36e5, '1d': 864e5 };
const FORCE = process.argv.includes('--force');

// ⚠️ Yahoo ajoute le PRIX EN DIRECT à la fin de la série, déguisé en
// bougie : haut = bas = clôture, et un horodatage qui avance de quelques
// secondes à chaque appel. Mesuré : deux appels à six secondes d'écart
// rendent « 14:41:47 · 30907.75 » puis « 14:41:53 · 30905.25 ».
//
// Traitée comme une vraie bougie, elle fausse tout : elle ne peut former
// ni FVG ni CISD puisqu'elle n'a pas de corps, elle n'est pas alignée sur
// la grille des cinq minutes, et elle change en permanence — donc un
// signal peut apparaître puis disparaître entre deux relevés.
//
// Le repère fiable est l'ESPACEMENT, pas le temps écoulé : les vraies
// bougies sont posées sur la grille de leur intervalle, l'imposteur ne
// l'est pas. Relevé sur une série 5 min :
//
//   14:20:00  écart 300 s   O 30950     H 30960.75  L 30934.25  C 30951.25
//   14:40:00  écart 300 s   O 30943.75  H 30949.50  L 30896.25  C 30914.50
//   14:43:05  écart 185 s   O 30898.5   H 30898.5   L 30898.5   C 30898.5
//
// On retire donc de la fin toute entrée trop rapprochée de la précédente.
// Un simple « intervalle écoulé » ne suffisait pas : à 14 h 53, la fausse
// bougie de 14 h 43 avait bien cinq minutes d'âge et passait le test.
function nettoie(cs, interval) {
  const d = DUREE[interval];
  if (!d || cs.length < 2) return cs;
  const out = cs.slice();
  while (out.length >= 2 && out[out.length - 1].t - out[out.length - 2].t < d) out.pop();
  return out;
}

async function serie(sym, interval, range) {
  const url = `${YF}${sym}?interval=${interval}&range=${range}`;
  for (let essai = 0; essai < 4; essai++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const res = j.chart && j.chart.result && j.chart.result[0];
      if (!res) throw new Error('réponse vide');
      const t = res.timestamp || [], q = res.indicators.quote[0];
      const out = [];
      for (let i = 0; i < t.length; i++) {
        if (q.open[i] == null || q.close[i] == null) continue;
        out.push({ t: t[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      }
      const propre = nettoie(out, interval);
      if (!propre.length) throw new Error('aucune bougie clôturée');
      if (propre.length < out.length)
        console.log(`  ${interval} : ${out.length - propre.length} entrée(s) non clôturée(s) écartée(s)`);
      return propre;
    } catch (e) {
      if (essai === 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, essai)));
    }
  }
}

function charger() {
  try { return JSON.parse(fs.readFileSync(FICHIER, 'utf8')); }
  catch (e) { return { version: 1, signaux: [], passages: [] }; }
}
function ecrire(db) {
  // On borne les passages : un an de séances à six passages par jour tient
  // largement, mais le fichier ne doit pas gonfler indéfiniment.
  db.passages = db.passages.slice(-3000);
  fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
  // Même précaution que pour l'instantané : `bilan.maj` avance à chaque
  // passage, y compris quand rien n'a changé. Réécrire pour ça seul
  // produirait un commit toutes les cinq minutes.
  const utile = o => JSON.stringify({ signaux: o.signaux, passages: o.passages });
  let ancien = null;
  try { ancien = JSON.parse(fs.readFileSync(FICHIER, 'utf8')); } catch (e) {}
  if (ancien && utile(ancien) === utile(db)) return false;
  fs.writeFileSync(FICHIER, JSON.stringify(db, null, 1) + '\n');
  return true;
}

// Quelle étape de la chaîne a bloqué ? C'est le « raisonnement » que
// l'utilisateur veut lire en rentrant.
function blocage(d) {
  if (d.dir === 0)  return { etape: 'biais', dit: `Biais neutre (score ${d.score}/4, il en faut ${d.cfg.seuil}) — aucune position possible.` };
  const sens = d.dir > 0 ? 'haussier' : 'baissier';
  if (d.dol == null) return { etape: 'dol', dit: `Biais ${sens}, mais plus aucune liquidité intacte dans ce sens.` };
  if (!d.key)        return { etape: 'niveau', dit: `Biais ${sens}, DOL à ${d.dol} — mais aucun niveau clé valide du bon côté.` };
  const k = `${d.key.type} ${d.key.tf} (${d.key.bas} – ${d.key.haut})`;
  // Hors fenêtre, la machine à états ne tourne pas : on ne SAIT pas si le
  // prix a touché le niveau. On ne l'affirme donc pas.
  if (d.hors) return { etape: 'fenetre', dit: `Hors fenêtre. Biais ${sens}, DOL à ${d.dol}, niveau le plus proche ${k}.` };
  if (d.etat === 'ATTEND_TOUCHE') return { etape: 'touche', dit: `Biais ${sens}, niveau ${k} repéré — le prix n'y est pas encore venu.` };
  if (!d.ifvg)       return { etape: 'ifvg', dit: `Le prix a touché ${k}, mais aucune inversion confirmée par clôture de corps.` };
  return { etape: 'stop', dit: `Inversion ${d.ifvg.tf} confirmée sur ${k}, mais le stop était trop serré face à l'ATR.` };
}

(async () => {
  const f = Modele.fenetre();
  const maintenant = new Date().toISOString();

  let brut;
  try {
    brut = {};
    for (const [iv, rg, cle] of SERIES) brut[cle] = await serie('NQ=F', iv, rg);
  } catch (e) {
    console.error('Récupération impossible : ' + e.message);
    process.exit(1);
  }

  // Le site affiche des euros : il lui faut EUR/USD. Il allait le chercher
  // lui-même via les relais CORS, qui sont morts. On le relève ici.
  let eurusd = null;
  try {
    const cs = await serie('EURUSD=X', '1d', '5d');
    const v = cs[cs.length - 1].c;
    if (v > 0.5 && v < 2) eurusd = +v.toFixed(4);
  } catch (e) { console.error('EUR/USD indisponible : ' + e.message); }

  const d = Modele.evaluer(brut);
  const e = Modele.heure(d.derniereBougie);
  const hNY = String(Math.floor(e.min / 60)).padStart(2, '0') + ':' + String(e.min % 60).padStart(2, '0');
  const db = charger();

  // Rattrapage des doublons produits par l'ancienne clé : on garde le
  // PREMIER relevé de chaque bougie, celui qui a été vu en direct.
  const vues = new Set(), propre = [];
  for (const s of db.signaux) {
    const k = `${Date.parse(s.bougie)}|${s.sens}`;
    if (vues.has(k)) { console.log(`Doublon retiré : ${s.jour} ${s.heureNY} ${s.sens} (${s.niveauDeclencheur})`); continue; }
    vues.add(k); s.cle = k; propre.push(s);
  }
  db.signaux = propre;

  const commun = {
    ts: maintenant, bougie: new Date(d.derniereBougie).toISOString(),
    jour: e.jour, heureNY: hNY, prix: d.prix,
    retardMin: Math.round((Date.now() - d.derniereBougie) / 60000),
    biais: d.dir === 0 ? 'neutre' : d.dir > 0 ? 'haussier' : 'baissier',
    score: d.score, dol: d.dol,
    niveau: d.key ? `${d.key.type} ${d.key.tf}` : null,
    etat: d.etat,
    niveauxParUnite: d.parTF.map(v => `${v.tf}:${v.n}`).join(' ')
  };

  // ── INSTANTANÉ DE MARCHÉ ────────────────────────────────────────────
  // Yahoo ne sert pas d'en-tête CORS : un navigateur ne peut pas l'appeler
  // directement, et les quatre relais publics que le site utilisait sont
  // tous morts (500, 429, 429, 522 au dernier test). Node, lui, n'a pas
  // cette contrainte. C'est donc ici qu'on récupère le marché, une fois,
  // et le site se contente de lire ce fichier — servi par GitHub avec
  // `access-control-allow-origin: *`.
  const instantane = {
    maj: maintenant, source: 'yahoo', eurusd: eurusd,
    prix: d.prix, derniereBougie: d.derniereBougie,
    retardMin: Math.round((Date.now() - d.derniereBougie) / 60000),
    hors: d.hors, etat: d.etat, dir: d.dir, score: d.score,
    dol: d.dol, key: d.key, ifvg: d.ifvg, parTF: d.parTF,
    trade: d.trade, dernierSignal: d.dernierSignal, cfg: d.cfg
  };
  // Marché fermé, rien n'a bougé : n'écrire que l'horodatage produirait un
  // commit toutes les cinq minutes pour rien — une trentaine par jour, qui
  // noieraient les vrais relevés. On ne réécrit le fichier que si son
  // contenu utile a changé. `maj` et `retardMin` ne comptent pas : ils
  // avancent tout seuls, même quand le marché dort.
  const utile = o => { const c = Object.assign({}, o); delete c.maj; delete c.retardMin; return JSON.stringify(c); };
  let ancien = null;
  try { ancien = JSON.parse(fs.readFileSync(ETAT, 'utf8')); } catch (e) {}
  if (ancien && utile(ancien) === utile(instantane)) {
    console.log('Instantané inchangé — rien à réécrire.');
  } else {
    fs.writeFileSync(ETAT, JSON.stringify(instantane, null, 1) + '\n');
  }

  // ── RÉPARATION DES ANCIENS ENREGISTREMENTS ──────────────────────────
  // Les signaux consignés avant le correctif portent le contexte de la
  // dernière bougie reçue au lieu du leur : l'un d'eux s'explique par
  // « biais neutre 0/4, DOL à null », ce qu'aucun signal valide ne peut
  // être. On les recolle sur le contexte que le modèle leur attribue.
  (d.tousSignaux || []).forEach(sig => {
    const k = `${sig.t}|${sig.sens}`;
    const vieux = db.signaux.find(x => x.cle === k);
    if (!vieux || vieux.biaisScore != null) return;
    const sens = sig.biaisDir > 0 ? 'haussier' : 'baissier';
    vieux.biais = sens; vieux.score = sig.biaisScore; vieux.dol = sig.dol;
    vieux.biaisScore = sig.biaisScore;
    vieux.raisonnement =
      `Biais ${sens} (score ${Math.abs(sig.biaisScore)}/4). ` +
      `DOL à ${sig.dol}. Niveau clé ${sig.niveau}. ` +
      `Le prix l'a touché, puis une inversion ${sig.tf} a été confirmée par clôture de corps. ` +
      `Entrée ${sig.entree}, stop au bord de l'IFVG à ${sig.sl} (${Math.abs(sig.entree - sig.sl).toFixed(1)} pts), ` +
      `partiel 0,5 R à ${sig.tp1} sur 90 % de la taille, le reste court jusqu'à 2,5 R à ${sig.tp}.`;
    console.log(`Raisonnement réparé : ${vieux.jour} ${vieux.heureNY} ${vieux.sens}`);
  });

  // ── LE SIGNAL EST-IL RECEVABLE ? ────────────────────────────────────
  // ⚠️ Le test portait sur `d.hors`, qui décrit la DERNIÈRE bougie reçue,
  // pas celle qui a produit le signal. Or Yahoo livre avec une dizaine de
  // minutes de retard : quand la bougie de 09 h 55 arrive, la dernière
  // connue est déjà à 10 h 05, donc `hors` vaut vrai et le signal était
  // jeté. Mesuré sur le jeu réel, les créneaux 09 h 50 et 09 h 55 pèsent
  // 6 signaux sur 55 — un sur neuf, perdu en silence.
  //
  // Le bon critère est l'heure de la bougie DU SIGNAL.
  function dansLaFenetre(ts) {
    const e = Modele.heure(ts);
    return e.dow >= 1 && e.dow <= 5 &&
           e.min >= Modele.CFG.ghDeb && e.min < Modele.CFG.ghFin;
  }
  // ⚠️ La clé incluait le prix d'entrée. Or Yahoo révise ses bougies entre
  // deux relevés : la MÊME bougie de 09 h 35 a rendu une entrée à 30292.5
  // à 13 h 48, puis 30296.5 à 13 h 59, et le niveau retenu est passé de
  // ITL M5 à ITL H4. Deux clés différentes, donc deux lignes au journal
  // pour un seul événement de marché — un gain compté deux fois.
  //
  // L'identité d'un signal, c'est SA BOUGIE et son sens. Le modèle n'en
  // produit qu'un par bougie, et ses deux signaux quotidiens tombent
  // forcément sur des bougies différentes.
  const cleDe = x => `${x.t}|${x.sens}`;
  // On reprend TOUS les signaux de la passe tombés dans la fenêtre, pas
  // seulement le dernier : le déclenchement automatique n'étant pas fiable,
  // un seul relevé doit suffire à rattraper toute la séance.
  // Borné au JOUR EN COURS — celui de la dernière bougie reçue. Sans cette
  // borne, `tousSignaux` remonte les soixante jours de l'historique et
  // déverse cinquante-cinq reconstitutions dans le journal en direct, qui
  // ne doit contenir que ce que le robot a réellement observé. Les
  // reconstitutions ont leur propre place, dans js/mesure.js, étiquetées
  // comme telles.
  const jourCourant = Modele.heure(d.derniereBougie).jour;
  const candidats = (d.tousSignaux || [d.trade || d.dernierSignal])
    .filter(x => x && dansLaFenetre(x.t))
    .filter(x => Modele.heure(x.t).jour === jourCourant)
    .filter(x => !db.signaux.some(s => s.cle === cleDe(x)));
  const neuf = candidats.length > 0;

  // Chaque candidat donne une ligne. Les champs de contexte décrivent la
  // bougie DU SIGNAL, pas la dernière reçue : avec le retard de Yahoo les
  // deux diffèrent toujours, et un relevé qui mélange les deux est faux.
  candidats.forEach(t => {
    const eSig = Modele.heure(t.t);
    const hSig = String(Math.floor(eSig.min / 60)).padStart(2, '0') + ':' +
                 String(eSig.min % 60).padStart(2, '0');
    db.signaux.push(Object.assign({}, commun, {
      bougie: new Date(t.t).toISOString(), jour: eSig.jour, heureNY: hSig,
      prix: t.entree,
      retardMin: Math.round((Date.now() - t.t) / 60000),
      cle: cleDe(t),
      sens: t.sens, entree: t.entree, sl: t.sl, tp1: t.tp1, tp: t.tp,
      rr: t.rr, uniteIFVG: t.tf, niveauDeclencheur: t.niveau,
      risquePts: +Math.abs(t.entree - t.sl).toFixed(2),
      // Contexte DU SIGNAL, figé par le modèle au moment où il l'a produit.
      // On n'utilise plus d.dir / d.score / d.dol : ceux-là décrivent la
      // dernière bougie reçue, qui peut dater d'heures plus tard.
      biais: t.biaisDir > 0 ? 'haussier' : 'baissier',
      score: t.biaisScore, biaisScore: t.biaisScore, dol: t.dol,
      // Réglages sous lesquels ce signal a été produit. Sans eux, un
      // changement de stop ou d'objectif rend tout l'historique incomparable
      // sans qu'on puisse le savoir après coup.
      slx: Modele.CFG.slx, cfgTp1: Modele.CFG.tp1, cfgTp2: Modele.CFG.tp2,
      cfgSortieMin: Modele.CFG.sortieMin,
      raisonnement:
        `Biais ${t.biaisDir > 0 ? 'haussier' : 'baissier'} (score ${Math.abs(t.biaisScore)}/4). ` +
        `DOL à ${t.dol}. Niveau clé ${t.niveau}. ` +
        `Le prix l'a touché, puis une inversion ${t.tf} a été confirmée par clôture de corps. ` +
        `Entrée ${t.entree}, stop à ${t.sl} — ${Math.abs(t.entree - t.sl).toFixed(1)} pts, soit ` +
        `${Modele.CFG.slx} fois le bord de l'IFVG, pour ne pas être sorti par la respiration du prix. ` +
        `Partiel ${String(Modele.CFG.tp1).replace('.', ',')} R à ${t.tp1} sur ${Math.round(Modele.CFG.part * 100)} % de la taille, ` +
        `le reste court jusqu'à ${String(Modele.CFG.tp2).replace('.', ',')} R à ${t.tp}. ` +
        `Solde au marché à ${String(Math.floor(Modele.CFG.sortieMin / 60)).padStart(2, '0')} h ` +
        `${String(Modele.CFG.sortieMin % 60).padStart(2, '0')} New York si rien n'est touché avant.`,
      statut: 'ouvert', resultat: null, r: null, closTs: null
    }));
    console.log(`✅ SIGNAL ${t.sens} · ${eSig.jour} ${hSig} NY · entrée ${t.entree} · stop ${t.sl} · ${t.niveau}`);
  });
  // Les signaux rattrapés sont triés : un relevé tardif peut en ramener
  // plusieurs d'un coup, dans le désordre par rapport à l'existant.
  if (neuf) db.signaux.sort((a, b) => Date.parse(a.bougie) - Date.parse(b.bougie));

  // Un passage explicatif est consigné si la fenêtre est ouverte, MAIS AUSSI
  // si la journée s'est déroulée sans qu'aucun passage ne l'ait décrite.
  // Le planificateur de GitHub abandonne souvent les créneaux de la séance
  // et ne déclenche que le soir : sans cette seconde condition, ces
  // journées-là ne laissaient aucune trace de ce que le modèle avait vu,
  // alors qu'expliquer son silence est la moitié de l'intérêt du relevé.
  const jourDejaDecrit = db.passages.some(p => p.jour === jourCourant) ||
                         db.signaux.some(x => x.jour === jourCourant);
  if (neuf) { /* déjà journalisé ci-dessus */ }
  else if (f.ouverte || FORCE || !jourDejaDecrit) {
    const b = blocage(d);
    db.passages.push(Object.assign({}, commun, {
      jour: jourCourant, etapeBloquee: b.etape, dit: b.dit,
      apresCoup: !f.ouverte && !FORCE
    }));
    console.log(`— ${jourCourant} ${hNY} NY · ${b.dit}`);
  } else {
    // Hors fenêtre on rafraîchit l'instantané et rien d'autre : consigner un
    // « passage » à 3 h du matin n'apprendrait rien à personne.
    console.log(`Instantané seul — hors fenêtre, ouverture dans ${Math.round(f.ms / 60000)} min.`);
  }

  // ── SUIVI DES POSITIONS ─────────────────────────────────────────────
  // ⚠️ CORRIGÉ. Le suivi se faisait en bougies de 5 minutes, et il testait
  // l'OBJECTIF AVANT LE STOP. Or une bougie de 5 minutes ne dit pas dans
  // quel ordre son haut et son bas ont été atteints : quand elle touche les
  // deux, l'ancien code choisissait l'objectif. Avec un partiel à 0,5 R —
  // souvent 5 à 10 points seulement — ce cas n'est pas rare, il est la
  // règle. Vérification faite en rejouant les huit positions du journal sur
  // les bougies de 1 MINUTE, où l'ordre est connu :
  //
  //     2026-09-21 09:30 LONG   annoncé +0,45  →  stop touché en 3 min
  //     2026-09-21 09:35 LONG   annoncé +0,70  →  stop touché en 1 min
  //     2026-09-23 09:30 SHORT  annoncé +0,45  →  stop touché en 1 min
  //     2026-09-24 09:30 LONG   annoncé +0,70  →  stop touché en 1 min
  //
  //   le journal annonçait  +1,20 R  (+300 €)
  //   la vérité en 1 minute  −5,10 R  (−1 275 €)
  //
  // Quatre positions sur huit étaient fausses. Deux corrections, donc :
  //   1. suivre en 1 MINUTE dès que la série la couvre — Yahoo en sert 8
  //      jours, et une position se dénoue en quelques minutes, donc c'est
  //      presque toujours le cas ;
  //   2. quand il faut retomber sur le 5 minutes, tester le STOP D'ABORD.
  //      Le journal sous-estimera parfois un gain ; il ne racontera plus de
  //      victoires qui n'ont pas eu lieu.
  // Tirés de CFG : écrits en dur, ils s'étaient déjà désynchronisés du modèle.
  const PART = Modele.CFG.part, TP1R = Modele.CFG.tp1, TP2R = Modele.CFG.tp2;
  const SORTIE = Modele.CFG.sortieMin;
  const m5 = brut.m5, m1 = brut.m1 || [];

  // Réparation : les positions closes par l'ANCIEN suivi (5 minutes, objectif
  // testé avant le stop) sont réouvertes dès que le 1 minute les couvre, pour
  // être rejugées correctement. Une fois marquées `suiviUnite: '1m'`, elles ne
  // sont plus touchées. Cela rattrape l'historique déjà écrit sans le réécrire
  // à chaque passage.
  // ── ARCHIVAGE DES ANCIENS RÉGLAGES ──────────────────────────────────
  // Les signaux consignés avant l'élargissement du stop (slx) ont un stop
  // quatre fois plus serré : ce ne sont pas les mêmes positions, et les
  // mélanger au bilan rendrait le taux de réussite affiché faux. Ils sont
  // déplacés dans `archive`, gardés mais sortis du décompte.
  db.archive = db.archive || [];
  const ancienne = db.signaux.filter(s => s.slx == null);
  if (ancienne.length) {
    db.archive = db.archive.concat(ancienne.map(s => Object.assign({ reglages: 'v1 · stop au bord de l\'IFVG' }, s)));
    db.signaux = db.signaux.filter(s => s.slx != null);
    console.log(`${ancienne.length} signal(aux) des anciens réglages déplacé(s) dans l'archive.`);
  }

  let repares = 0;
  db.signaux.forEach(s => {
    if (s.statut !== 'clos' || s.suiviUnite === '1m') return;
    const depuis = Date.parse(s.bougie);
    if (!m1.length || m1[0].t > depuis) return;
    s.statut = 'ouvert'; delete s.resultat; delete s.r; delete s.closTs;
    delete s.barres; s.part1 = false; repares++;
  });
  if (repares) console.log(`${repares} position(s) rejugée(s) sur les bougies de 1 minute.`);
  db.signaux.filter(s => s.statut === 'ouvert').forEach(s => {
    const depuis = Date.parse(s.bougie);
    // le 1 minute est préféré, mais seulement s'il remonte jusqu'au signal
    const fin1m = m1.length && m1[0].t <= depuis;
    const cs = fin1m ? m1 : m5, unite = fin1m ? '1m' : '5m';
    const MAXBARRES = fin1m ? 1000 : 200;
    const apres = cs.filter(c => c.t > depuis);
    const L = s.sens === 'LONG';
    // Si la série couvre le signal, on rejoue depuis le début : l'état
    // mémorisé au passage précédent a pu être établi sur l'autre unité.
    let sl = s.sl, part1 = apres.length && cs[0].t <= depuis ? false : s.part1 === true;
    if (part1) sl = s.entree;
    let n = 0, ambigu = 0;
    for (const c of apres) {
      n++;
      const touche = niv => L ? c.h >= niv : c.l <= niv;
      const stoppe = () => L ? c.l <= sl : c.h >= sl;
      if (stoppe() && touche(part1 ? s.tp : s.tp1)) ambigu++;
      if (stoppe()) {
        if (part1) { s.statut = 'clos'; s.resultat = 'gagné'; s.r = +(PART * TP1R).toFixed(3); }
        else       { s.statut = 'clos'; s.resultat = 'perdu'; s.r = -1; }
      } else if (!part1 && touche(s.tp1)) {          // partiel encaissé, stop au seuil
        part1 = true; sl = s.entree;
      } else if (part1 && touche(s.tp)) {
        s.statut = 'clos'; s.resultat = 'gagné';
        s.r = +(PART * TP1R + (1 - PART) * TP2R).toFixed(3);
      } else if (SORTIE != null && (Modele.heure(c.t).jour !== s.jour || Modele.heure(c.t).min >= SORTIE)) {
        // Sortie forcée AU MARCHÉ. Sans elle, une position sur douze passait
        // la nuit — un risque de gap que la règle de drawdown d'un compte
        // financé ne pardonne pas, et que le backtest ne sait pas chiffrer.
        const brut = (L ? c.c - s.entree : s.entree - c.c) / s.risquePts;
        s.statut = 'clos';
        s.r = +(part1 ? PART * TP1R + (1 - PART) * Math.max(-1, Math.min(TP2R, brut))
                      : Math.max(-1, Math.min(TP2R, brut))).toFixed(3);
        s.resultat = s.r > 0 ? 'gagné' : 'perdu';
        s.sortie = 'horaire';
      } else if (n > MAXBARRES) {
        const rBrut = (L ? c.c - s.entree : s.entree - c.c) / s.risquePts;
        s.statut = 'clos'; s.resultat = 'expiré';
        s.r = +(part1 ? PART * TP1R + (1 - PART) * Math.max(0, Math.min(TP2R, rBrut))
                      : Math.max(-1, Math.min(TP2R, rBrut))).toFixed(3);
      }
      if (s.statut === 'clos') { s.closTs = new Date(c.t).toISOString(); s.barres = n; break; }
    }
    s.part1 = part1;
    s.suiviUnite = unite;
    s.ambigu = ambigu;
    if (s.statut === 'ouvert') s.slCourant = sl;
  });

  const clos = db.signaux.filter(s => s.statut === 'clos');
  const g = clos.filter(s => s.r > 0);
  db.bilan = {
    maj: maintenant, total: db.signaux.length, clos: clos.length,
    ouverts: db.signaux.length - clos.length,
    reussite: clos.length ? +(g.length / clos.length * 100).toFixed(1) : null,
    cumulR: +clos.reduce((a, s) => a + (s.r || 0), 0).toFixed(3),
    passages: db.passages.length
  };
  const ecrit = ecrire(db);
  console.log(`Journal : ${db.bilan.total} signaux (${db.bilan.clos} clos, ${db.bilan.ouverts} ouverts) · ` +
    `${db.bilan.passages} passages consignés` + (ecrit ? '' : ' — inchangé, non réécrit'));
})();
