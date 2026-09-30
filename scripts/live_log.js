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
require(path.join(__dirname, '..', 'js', 'position.js'));
require(path.join(__dirname, '..', 'js', 'modele.js'));
// La seconde stratégie tourne DANS LE MÊME relevé, sur les MÊMES bougies.
// C'est la seule façon de les comparer sans qu'un écart de données explique
// l'écart de résultats — l'erreur déjà commise entre le robot et le banc d'essai.
require(path.join(__dirname, '..', 'js', 'kintt.js'));

const FICHIER = path.join(__dirname, '..', 'data', 'signaux.json');
const ETAT    = path.join(__dirname, '..', 'data', 'etat.json');
// Journal SÉPARÉ pour kintt. Mélanger les deux stratégies dans signaux.json
// rendrait tout bilan affiché faux : trois trades à 10 h n'ont rien à voir
// avec quarante-et-un trades à 9 h, et la moyenne des deux ne décrit ni l'une
// ni l'autre.
const KINTT   = path.join(__dirname, '..', 'data', 'kintt.json');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
// Où déposer les séries téléchargées, pour que scripts/test.js puisse les
// contrôler juste après. Vide = on ne dépose rien.
const CACHE = process.env.MECH_CACHE || '';
// ⚠️ LES SÉRIES NE SONT PLUS DÉCLARÉES ICI. Elles l'étaient, et elles avaient
// divergé de celles du banc d'essai : le robot chargeait 60 minutes sur 3 mois
// pendant que le backtest chargeait 1 heure sur 6 mois. Sur les mêmes bougies
// d'exécution cela donnait 37 signaux contre 42, et pas les mêmes jours — le
// backtest mesurait donc une AUTRE stratégie que celle qui tournait ici.
// js/modele.js les déclare, puisque c'est lui qui les consomme.
const SERIES  = Modele.SERIES.map(s => [s.interval, s.range, s.cle]);
// Le plan source exige que la narrative soit confirmée sur NQ ET ES. Le
// second marché est donc téléchargé comme le premier : sans lui, le modèle
// ne peut pas appliquer la règle et le dit (`sansConfirmation`).
const SERIES2 = Modele.SERIES2.map(s => [s.interval, s.range, s.cle]);
const SYM2 = 'ES=F';

// ── DES EUROS, PAS DES R ───────────────────────────────────────────────────
// Le R est une unité de travail : « 1 R » = ce qu'on risque sur un trade.
// Personne ne lit un journal en R. Tout ce qui est écrit pour un humain est
// traduit ici, sur la base du risque réellement calibré.
const RISQUE = +(process.env.RISQUE_EUR || 250);       // 0,5 % d'un compte de 50 000 €
const euros = v => (v >= 0 ? '+' : '') + Math.round(v) + ' €';
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
      // Les séries sont déposées dans MECH_CACHE quand il est défini. Sans ça,
      // les vérifications sur les DONNÉES D'ENTRÉE (bougies désordonnées, haut
      // sous le bas, cotation en cours prise pour une bougie…) sont sautées
      // dans l'action GitHub faute de cache — c'est-à-dire précisément là où
      // elles serviraient, puisque c'est là que le robot tourne vraiment.
      if (CACHE) try {
        fs.mkdirSync(CACHE, { recursive: true });
        fs.writeFileSync(path.join(CACHE, `${sym.replace(/\W/g, '')}_${interval}_${range}.json`),
                         JSON.stringify(propre));
      } catch (e) { /* le cache est un confort, jamais un obstacle */ }
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
  // ── UN RATTRAPAGE DOIT RACONTER LA SÉANCE, PAS L'INSTANT PRÉSENT ──────
  // Quand GitHub abandonne les créneaux de la séance — mesuré le 30 septembre,
  // les trois créneaux perdus, le travail parti à 16 h 26 — le seul relevé de
  // la journée tombe l'après-midi. Il disait alors « hors fenêtre, biais
  // haussier », c'est-à-dire l'état du marché à 13 h 40, ce qui n'apprend
  // RIEN sur ce qui s'est passé entre 09 h et 10 h. Le modèle garde à part ce
  // qu'il a vu dans la fenêtre : c'est ça qu'on consigne.
  const f = d.etapeFenetre;
  if (d.hors && f) {
    const hh = m => String(Math.floor(m / 60)).padStart(2, '0') + ' h ' + String(m % 60).padStart(2, '0');
    const quand = `Séance du jour (relevée après coup, dernière bougie vue à ` +
                  `${new Date(f.t).toISOString().slice(11, 16)} UTC)`;
    if (f.dir === 0) return { etape: 'biais', dit: `${quand} : biais resté neutre (score ${f.score}/4, il en faut ${d.cfg.seuil}) — aucune position possible.` };
    const s2 = f.dir > 0 ? 'haussier' : 'baissier';
    if (f.dol == null) return { etape: 'dol', dit: `${quand} : biais ${s2}, mais plus aucune liquidité intacte dans ce sens.` };
    if (!f.key) return { etape: 'niveau', dit: `${quand} : biais ${s2}, DOL à ${f.dol} — mais aucun niveau clé valide du bon côté.` };
    const k2 = `${f.key.type} ${f.key.tf} (${f.key.bas} – ${f.key.haut})`;
    if (!f.ifvg) return { etape: 'ifvg', dit: `${quand} : biais ${s2}, niveau ${k2} retenu, mais aucune inversion confirmée par clôture de corps.` };
    return { etape: 'stop', dit: `${quand} : inversion ${f.ifvg.tf} confirmée sur ${k2}, mais le stop était trop serré face à l'ATR.` };
  }

  if (d.dir === 0)  return { etape: 'biais', dit: `Biais neutre (score ${d.score}/4, il en faut ${d.cfg.seuil}) — aucune position possible.` };
  const sens = d.dir > 0 ? 'haussier' : 'baissier';
  if (d.dol == null) return { etape: 'dol', dit: `Biais ${sens}, mais plus aucune liquidité intacte dans ce sens.` };
  if (!d.key)        return { etape: 'niveau', dit: `Biais ${sens}, DOL à ${d.dol} — mais aucun niveau clé valide du bon côté.` };
  const k = `${d.key.type} ${d.key.tf} (${d.key.bas} – ${d.key.haut})`;
  // Hors fenêtre et sans étape de séance (week-end, jour férié) : on ne SAIT
  // pas si le prix a touché le niveau. On ne l'affirme donc pas.
  if (d.hors) return { etape: 'fenetre', dit: `Hors fenêtre. Biais ${sens}, DOL à ${d.dol}, niveau le plus proche ${k}.` };
  if (d.etat === 'ATTEND_TOUCHE') return { etape: 'touche', dit: `Biais ${sens}, niveau ${k} repéré — le prix n'y est pas encore venu.` };
  if (!d.ifvg)       return { etape: 'ifvg', dit: `Le prix a touché ${k}, mais aucune inversion confirmée par clôture de corps.` };
  return { etape: 'stop', dit: `Inversion ${d.ifvg.tf} confirmée sur ${k}, mais le stop était trop serré face à l'ATR.` };
}


// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  KINTT — la seconde stratégie, relevée dans le même passage.          ║
// ╚═══════════════════════════════════════════════════════════════════════╝
// Elle a son propre journal et son propre bilan. Rien n'est mutualisé sauf
// LES BOUGIES et LE SUIVI DE POSITION (js/position.js) : le reste doit rester
// séparé, sinon on ne compare plus deux stratégies mais une moyenne des deux.

// L'instantané envoyé au site. `etape.zone` porte la SÉRIE DE BOUGIES
// entière (`cs`) : la recopier telle quelle ferait un etat.json de plusieurs
// mégaoctets, téléchargé à chaque ouverture de la page. On ne garde que les
// bornes.
function instantaneKintt(k, m5, m1) {
  if (!k) return null;
  const e = k.etape;
  const leger = e ? {
    t: e.t, score: e.score, dir: e.dir, conf: e.conf,
    zone: e.zone ? { tf: e.zone.tf, bas: e.zone.bas, haut: e.zone.haut,
                     haussier: e.zone.haussier } : null,
    sweep: e.sweep ? { t: e.sweep.t, ext: e.sweep.ext } : null
  } : null;
  return {
    hors: k.hors, prix: k.prix, derniereBougie: k.derniereBougie,
    etape: leger, trade: k.trade, dernierSignal: k.dernierSignal,
    entonnoir: k.entonnoir, cfg: k.cfg,
    // rejouée à chaque passage, pour ne jamais être en retard sur le code
    mesure: mesureKintt(k, m5 || [], m1 || [])
  };
}

// Où la chaîne s'est arrêtée, en français, pour la même raison que `blocage`
// pour l'autre modèle : expliquer le silence est la moitié de l'intérêt.
function blocageKintt(k) {
  if (!k) return { etape: 'données', dit: 'Bougies insuffisantes.' };
  const e = k.etape;
  if (!e) return { etape: 'fenetre', dit: 'Hors de la fenêtre 09 h 30 → 12 h 00 New York.' };
  const sens = e.dir > 0 ? 'haussier' : e.dir < 0 ? 'baissier' : null;
  if (!sens) return { etape: 'biais', dit: `Biais neutre (score ${e.score} sur 4, il en faut ${k.cfg.seuil}) — le plan interdit d'entrer.` };
  if (e.conf === 'ES en désaccord') return { etape: 'es', dit: `Le NQ est ${sens}, l'ES dit le contraire — le plan exige les deux ensemble.` };
  if (!e.zone) return { etape: 'zone', dit: `Biais ${sens}, mais aucune zone intacte (M15 → H4) où le prix soit venu.` };
  const z = `FVG ${e.zone.tf} (${e.zone.bas} – ${e.zone.haut})`;
  if (!e.sweep) return { etape: 'balayage', dit: `Prix dans ${z}, mais aucun balayage du plus bas ou du plus haut de séance.` };
  if (e.conf !== 'ok') return { etape: 'confirmation', dit: `Balayage à ${e.sweep.ext} sur ${z}, mais la confirmation manque (${e.conf}).` };
  return { etape: 'risque', dit: `Tout est là sur ${z}, mais le stop ou le rapport gain/risque a été refusé.` };
}

// ── LA RECONSTITUTION, ÉTIQUETÉE COMME TELLE ──────────────────────────────
// Le journal en direct de kintt ne contient que ce que le robot a vu depuis
// qu'il le relève, c'est-à-dire presque rien. Or la question « est-ce que ça
// marche ? » a besoin des soixante jours d'historique. On les rejoue donc,
// avec LE MÊME suivi (js/position.js), et on écrit noir sur blanc qu'il
// s'agit d'une reconstitution : ce ne sont pas des trades qui ont été pris.
function mesureKintt(k, m5, m1) {
  if (!k || !Array.isArray(k.tousSignaux) || !k.tousSignaux.length) return null;
  const T = [];
  for (const sg of k.tousSignaux) {
    const fin1m = m1.length && m1[0].t <= sg.t;
    const cs = fin1m ? m1 : m5;
    const cfg = Object.assign({}, k.cfg, { tp2: sg.rr != null ? sg.rr : k.cfg.tpR });
    let fin;
    try {
      fin = Position.suivre(sg, cs.filter(c => c.t > sg.t), cfg, {
        prudent: true, maxBarres: fin1m ? 1000 : 200,
        heure: Kintt.heure, jourSignal: Kintt.heure(sg.t).jour });
    } catch (e) { continue; }
    if (fin.ouverte) continue;
    // Le coût aller-retour est retiré : un stop serré coûte plus cher en
    // proportion, et l'ignorer flatte toujours la stratégie.
    T.push(fin.r - Position.cout(sg.risq));
  }
  if (!T.length) return null;
  const R = T.reduce((a, x) => a + x, 0), g = T.filter(x => x > 0);
  const pos = g.length ? g.reduce((a, x) => a + x, 0) / g.length : 0;
  const neg = T.filter(x => x < 0);
  const per = neg.length ? Math.abs(neg.reduce((a, x) => a + x, 0)) / neg.length : 0;
  let pic = 0, cum = 0, dd = 0;
  for (const x of T) { cum += x; if (cum > pic) pic = cum; if (pic - cum > dd) dd = pic - cum; }
  return {
    reconstitution: true,
    clos: T.length, gagnes: g.length,
    reussite: +(g.length / T.length * 100).toFixed(1),
    euros: Math.round(R * RISQUE),
    parTrade: Math.round(R / T.length * RISQUE),
    gainMoyen: Math.round(pos * RISQUE), perteMoyenne: -Math.round(per * RISQUE),
    // Le taux de réussite à partir duquel la stratégie cesse de perdre de
    // l'argent. Sans lui, « 33 % gagnés » ne dit pas si c'est bon ou mauvais.
    seuil: (pos + per) > 0 ? +(per / (pos + per) * 100).toFixed(1) : null,
    pireCreux: -Math.round(dd * RISQUE),
    risqueParTrade: RISQUE
  };
}

function chargerKintt() {
  try { return JSON.parse(fs.readFileSync(KINTT, 'utf8')); }
  catch (e) { return { version: 1, strategie: 'kintt', signaux: [], passages: [] }; }
}

// Le journal de kintt, tenu comme celui de l'autre modèle : on n'inscrit que
// ce qui a été VU pendant la journée en cours, jamais la reconstitution des
// soixante jours d'historique.
function journalKintt(k, m5, m1, maintenant) {
  const db = chargerKintt();
  db.signaux = db.signaux || []; db.passages = db.passages || [];
  if (!k) return db;
  const eD = Kintt.heure(k.derniereBougie);
  const cle = x => `${x.t}|${x.sens}`;
  const neufs = (k.tousSignaux || [])
    .filter(x => x && Kintt.heure(x.t).jour === eD.jour)
    .filter(x => !db.signaux.some(s => s.cle === cle(x)));

  neufs.forEach(t => {
    const e = Kintt.heure(t.t);
    const hNY = String(Math.floor(e.min / 60)).padStart(2, '0') + ':' +
                String(e.min % 60).padStart(2, '0');
    db.signaux.push({
      ts: maintenant, cle: cle(t), bougie: new Date(t.t).toISOString(),
      jour: e.jour, heureNY: hNY, fenetre: t.fenetre,
      retardMin: Math.round((Date.now() - t.t) / 60000),
      sens: t.sens, entree: t.entree, sl: t.sl, tp1: t.tp1, tp: t.tp, rr: t.rr,
      risq: t.risq, risquePts: +Math.abs(t.entree - t.sl).toFixed(2),
      niveau: t.niveau, uniteIFVG: t.tf,
      balayage: t.sweepNiveau, balayageExt: t.sweepExt,
      biais: t.biaisDir > 0 ? 'haussier' : 'baissier', score: t.biaisScore,
      // Le rapport gain/risque de kintt n'est PAS un réglage : il dépend de
      // la zone visée, donc il change d'un trade à l'autre. Il est consigné
      // avec le signal, sans quoi le suivi ne saurait pas où s'arrête le gain.
      cfgPart: k.cfg.part, cfgTp1: k.cfg.tp1,
      statut: 'ouvert', resultat: null, r: null, closTs: null
    });
    console.log(`✅ KINTT ${t.sens} · ${e.jour} ${hNY} NY · entrée ${t.entree} · stop ${t.sl} · objectif ${t.tp} (${t.rr}) · ${t.niveau}`);
  });
  if (neufs.length) db.signaux.sort((a, b) => Date.parse(a.bougie) - Date.parse(b.bougie));

  // Un passage par jour, même sans signal : sinon les journées muettes ne
  // laissent aucune trace et on ne sait pas si la stratégie a regardé.
  const decrit = db.passages.some(p => p.jour === eD.jour) ||
                 db.signaux.some(x => x.jour === eD.jour);
  if (!neufs.length && !decrit) {
    const b = blocageKintt(k);
    db.passages.push({ ts: maintenant, jour: eD.jour, prix: k.prix,
                       etapeBloquee: b.etape, dit: b.dit });
    console.log(`— KINTT ${eD.jour} · ${b.dit}`);
  }

  // ── SUIVI : LE MÊME CODE QUE L'AUTRE MODÈLE ─────────────────────────
  // Position.suivre, et rien d'autre. Une copie de cette boucle a déjà
  // annoncé quatre positions gagnantes sur huit alors qu'elles étaient
  // perdantes ; scripts/test.js refuse qu'une seconde copie réapparaisse.
  db.signaux.filter(s => s.statut === 'ouvert').forEach(s => {
    const depuis = Date.parse(s.bougie);
    const fin1m = m1.length && m1[0].t <= depuis;
    const cs = fin1m ? m1 : m5;
    // kintt vise un PRIX, pas un multiple du risque : le plafond du suivi est
    // donc propre à CE signal. Sans cette ligne, `plafond` vaut NaN et le
    // garde-fou de Position.suivre lève à chaque passage.
    const cfg = Object.assign({}, k.cfg, { tp2: s.rr != null ? s.rr : k.cfg.tpR });
    const fin = Position.suivre(s, cs.filter(c => c.t > depuis), cfg, {
      prudent: true, maxBarres: fin1m ? 1000 : 200,
      heure: Kintt.heure, jourSignal: s.jour
    });
    if (!fin.ouverte) {
      s.statut = 'clos'; s.r = +fin.r.toFixed(3);
      s.resultat = fin.sortie === 'expiré' ? 'expiré' : (s.r > 0 ? 'gagné' : s.r < 0 ? 'perdu' : 'seuil');
      s.closTs = new Date(fin.t).toISOString(); s.barres = fin.barres;
    }
    s.suiviUnite = fin1m ? '1m' : '5m';
    s.ambigu = fin.ambigu;
    if (s.statut === 'ouvert') s.slCourant = fin.part1 ? s.entree : s.sl;
  });

  const clos = db.signaux.filter(s => s.statut === 'clos');
  const g = clos.filter(s => s.r > 0);
  db.bilan = {
    maj: maintenant, total: db.signaux.length, clos: clos.length,
    ouverts: db.signaux.length - clos.length,
    reussite: clos.length ? +(g.length / clos.length * 100).toFixed(1) : null,
    cumulR: +clos.reduce((a, s) => a + (s.r || 0), 0).toFixed(3),
    euros: Math.round(clos.reduce((a, s) => a + (s.r || 0), 0) * RISQUE),
    passages: db.passages.length
  };
  db.passages = db.passages.slice(-3000);
  return db;
}

function ecrireKintt(db) {
  const utile = o => JSON.stringify({ signaux: o.signaux, passages: o.passages });
  let ancien = null;
  try { ancien = JSON.parse(fs.readFileSync(KINTT, 'utf8')); } catch (e) {}
  if (ancien && utile(ancien) === utile(db)) return false;
  fs.mkdirSync(path.dirname(KINTT), { recursive: true });
  fs.writeFileSync(KINTT, JSON.stringify(db, null, 1) + '\n');
  return true;
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

  // Le second marché. S'il manque, le modèle ne filtre PAS en silence : il
  // rend `sansConfirmation` et on le consigne, parce qu'un signal non
  // confirmé n'est pas le même objet qu'un signal confirmé.
  let brut2 = null;
  try {
    brut2 = {};
    for (const [iv, rg, cle] of SERIES2) brut2[cle] = await serie(SYM2, iv, rg);
  } catch (e) {
    brut2 = null;
    console.error(`${SYM2} indisponible : ${e.message} — confirmation impossible.`);
  }

  // Le site affiche des euros : il lui faut EUR/USD. Il allait le chercher
  // lui-même via les relais CORS, qui sont morts. On le relève ici.
  let eurusd = null;
  try {
    const cs = await serie('EURUSD=X', '1d', '5d');
    const v = cs[cs.length - 1].c;
    if (v > 0.5 && v < 2) eurusd = +v.toFixed(4);
  } catch (e) { console.error('EUR/USD indisponible : ' + e.message); }

  const d = Modele.evaluer(brut, brut2);
  // La seconde stratégie, sur les MÊMES bougies, dans le même passage.
  // Une panne de kintt ne doit pas faire tomber le relevé du modèle en
  // place : c'est lui qui est en test à blanc depuis trois semaines.
  let k = null;
  try { k = Kintt.evaluer(brut, brut2); }
  catch (e) { console.error('KINTT en échec : ' + e.message); }
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
    // Le second marché sert-il vraiment ? Sans ça, on ne saurait pas
    // distinguer « aucun signal » de « signal écarté faute de confirmation ».
    confirmePar: brut2 ? SYM2 : null, sansConfirmation: !!d.sansConfirmation,
    prix: d.prix, derniereBougie: d.derniereBougie,
    retardMin: Math.round((Date.now() - d.derniereBougie) / 60000),
    hors: d.hors, etat: d.etat, dir: d.dir, score: d.score,
    dol: d.dol, key: d.key, ifvg: d.ifvg, parTF: d.parTF,
    trade: d.trade, dernierSignal: d.dernierSignal, cfg: d.cfg,
    // La seconde stratégie voyage dans le même fichier : le site n'a qu'un
    // seul instantané à charger, et les deux décrivent forcément la même
    // bougie — impossible d'afficher deux prix différents côte à côte.
    kintt: instantaneKintt(k, brut.m5, brut.m1 || [])
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
      `objectif partiel à ${sig.tp1} sur ${Math.round(Modele.CFG.part * 100)} % de la position ` +
      `(${euros(Modele.CFG.tp1 * RISQUE)}), le reste court jusqu'à ${sig.tp} (${euros(Modele.CFG.tp2 * RISQUE)}).`;
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
      // Quel MOTEUR a produit ce signal. Les signaux d'avant le 30 septembre
      // viennent d'un modèle qui lisait des bougies non terminées : leur taux
      // de réussite ne dit rien de celui-ci, et les mélanger fausserait le
      // bilan affiché. Ce marqueur est ce qui permet de les sortir du compte.
      moteur: 'bougies-closes',
      // La phrase n'est plus écrite ici : js/position.js la compose, et le
      // site la RECOMPOSE à l'affichage. Sans ça elle reste figée dans le
      // journal — deux positions du 28 septembre parlaient encore en R
      // longtemps après qu'on eut décidé d'arrêter, sans moyen de les corriger.
      raisonnement: Position.raisonnement({
        sens: t.sens, entree: t.entree, sl: t.sl, tp1: t.tp1, tp: t.tp,
        niveauDeclencheur: t.niveau, uniteIFVG: t.tf,
        biais: t.biaisDir > 0 ? 'haussier' : 'baissier',
        biaisScore: t.biaisScore, dol: t.dol
      }, Modele.CFG, RISQUE),
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
  // ⚠️ « DÉCRITE » NE VEUT PAS DIRE « UN PASSAGE EXISTE ».
  // Le test portait sur l'existence d'un passage ce jour-là, quelle que soit
  // son heure. Or le robot tourne aussi la nuit : le 30 septembre, un passage
  // de 01 h 20 New York — marché fermé, « hors fenêtre » — a suffi à marquer
  // la journée décrite. Les rattrapages de l'après-midi n'ont donc RIEN
  // consigné de la séance, et il ne reste aucune trace de ce que le modèle a
  // vu entre 09 h et 10 h. Une nuit ne décrit pas une séance.
  //
  // Est décrit un jour qui porte soit un signal, soit un passage tombé DANS
  // la fenêtre, soit un passage de rattrapage explicitement marqué comme tel.
  // Un passage ne décrit la séance que s'il a été pris PENDANT la fenêtre, ou
  // APRÈS sa fermeture. `apresCoup` ne suffit pas : le passage de 01 h 20 du
  // 30 septembre le portait, et il précédait la séance de huit heures.
  const minNY = hNY2 => +hNY2.slice(0, 2) * 60 + +hNY2.slice(3);
  const jourDejaDecrit =
    db.signaux.some(x => x.jour === jourCourant) ||
    db.passages.some(p => p.jour === jourCourant && p.heureNY &&
                          minNY(p.heureNY) >= Modele.CFG.ghDeb);
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
  // ── ET CEUX PRODUITS PAR UN MOTEUR QUI LISAIT L'AVENIR ──────────────
  // Jusqu'au 30 septembre, le modèle interrogeait des bougies H4, H1 et M15
  // NON TERMINÉES, et datait ce qu'il apprenait de l'OUVERTURE de la bougie
  // qui tranche au lieu de sa clôture. Il voyait donc, à 09 h 35, des choses
  // qui ne seraient vraies qu'à midi. Retirer ce regard en avant fait passer
  // la mesure sur soixante jours de 41 trades à +2 622 € à 25 trades à
  // +606 €. Les signaux émis avant le correctif ne viennent pas du même
  // modèle : ils sont gardés, et sortis du bilan.
  const regardAvant = db.signaux.filter(s => s.moteur == null);
  if (regardAvant.length) {
    db.archive = db.archive.concat(regardAvant.map(s =>
      Object.assign({ reglages: 'v2 · moteur qui lisait des bougies non terminées' }, s)));
    db.signaux = db.signaux.filter(s => s.moteur != null);
    console.log(`${regardAvant.length} signal(aux) de l'ancien moteur déplacé(s) dans l'archive.`);
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
    // Si la série couvre le signal, on rejoue depuis le début : l'état
    // mémorisé au passage précédent a pu être établi sur l'autre unité.
    const repart = apres.length && cs[0].t <= depuis ? false : s.part1 === true;

    // ⚠️ LE SUIVI N'EST PAS ÉCRIT ICI. Il vit dans js/position.js, et lui
    // seul. Cette boucle en était une copie ; c'est une copie qui a annoncé
    // quatre positions gagnantes sur huit alors qu'elles étaient perdantes,
    // parce qu'elle testait l'objectif avant le stop. scripts/test.js refuse
    // désormais qu'une copie réapparaisse.
    const fin = Position.suivre(s, apres, Modele.CFG, {
      prudent: true, maxBarres: MAXBARRES, part1: repart,
      heure: Modele.heure, jourSignal: s.jour
    });
    const part1 = fin.part1, ambigu = fin.ambigu;
    if (!fin.ouverte) {
      s.statut = 'clos';
      s.r = +fin.r.toFixed(3);
      s.resultat = fin.sortie === 'expiré' ? 'expiré' : (s.r > 0 ? 'gagné' : 'perdu');
      if (fin.sortie === 'horaire') s.sortie = 'horaire';
      s.closTs = new Date(fin.t).toISOString();
      s.barres = fin.barres;
    }
    s.part1 = part1;
    s.suiviUnite = unite;
    s.ambigu = ambigu;
    // Le stop courant : au prix d'entrée une fois le partiel encaissé, sinon
    // celui d'origine. Il est déduit de l'état, plus recopié d'une variable
    // de boucle qui n'existe plus.
    if (s.statut === 'ouvert') s.slCourant = part1 ? s.entree : s.sl;
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
  // ── LE JOURNAL DE KINTT ─────────────────────────────────────────────
  try {
    const dbK = journalKintt(k, brut.m5, brut.m1 || [], maintenant);
    const ecritK = ecrireKintt(dbK);
    console.log(`Kintt  : ${dbK.bilan ? dbK.bilan.total : 0} signaux ` +
      `(${dbK.bilan ? dbK.bilan.clos : 0} clos) · ${dbK.passages.length} passages` +
      (ecritK ? '' : ' — inchangé, non réécrit'));
  } catch (e) { console.error('Journal kintt en échec : ' + e.message); }

  const ecrit = ecrire(db);
  console.log(`Journal : ${db.bilan.total} signaux (${db.bilan.clos} clos, ${db.bilan.ouverts} ouverts) · ` +
    `${db.bilan.passages} passages consignés` + (ecrit ? '' : ' — inchangé, non réécrit'));
})();
