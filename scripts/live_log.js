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
const FORCE = process.argv.includes('--force');

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
      if (!out.length) throw new Error('aucune bougie');
      return out;
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
  fs.writeFileSync(FICHIER, JSON.stringify(db, null, 1) + '\n');
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

  const d = Modele.evaluer(brut);
  const e = Modele.heure(d.derniereBougie);
  const hNY = String(Math.floor(e.min / 60)).padStart(2, '0') + ':' + String(e.min % 60).padStart(2, '0');
  const db = charger();

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
  fs.writeFileSync(ETAT, JSON.stringify({
    maj: maintenant, source: 'yahoo',
    prix: d.prix, derniereBougie: d.derniereBougie,
    retardMin: Math.round((Date.now() - d.derniereBougie) / 60000),
    hors: d.hors, etat: d.etat, dir: d.dir, score: d.score,
    dol: d.dol, key: d.key, ifvg: d.ifvg, parTF: d.parTF,
    trade: d.trade, dernierSignal: d.dernierSignal, cfg: d.cfg
  }, null, 1) + '\n');

  const t = d.trade || d.dernierSignal;
  const neuf = t && !d.hors &&
    !db.signaux.some(s => s.cle === `${t.t}|${t.sens}|${t.entree}`);

  if (neuf) {
    db.signaux.push(Object.assign({}, commun, {
      cle: `${t.t}|${t.sens}|${t.entree}`,
      sens: t.sens, entree: t.entree, sl: t.sl, tp1: t.tp1, tp: t.tp,
      rr: t.rr, uniteIFVG: t.tf, niveauDeclencheur: t.niveau,
      risquePts: +Math.abs(t.entree - t.sl).toFixed(2),
      raisonnement:
        `Biais ${commun.biais} (score ${Math.abs(d.score)}/4). ` +
        `DOL à ${d.dol}. Niveau clé ${t.niveau}. ` +
        `Le prix l'a touché, puis une inversion ${t.tf} a été confirmée par clôture de corps. ` +
        `Entrée ${t.entree}, stop au bord de l'IFVG à ${t.sl} (${Math.abs(t.entree - t.sl).toFixed(1)} pts), ` +
        `partiel 0,5 R à ${t.tp1} sur 90 % de la taille, le reste court jusqu'à 2,5 R à ${t.tp}.`,
      statut: 'ouvert', resultat: null, r: null, closTs: null
    }));
    console.log(`✅ SIGNAL ${t.sens} · ${commun.jour} ${hNY} NY · entrée ${t.entree} · stop ${t.sl} · ${t.niveau}`);
  } else if (f.ouverte || FORCE) {
    const b = blocage(d);
    db.passages.push(Object.assign({}, commun, { etapeBloquee: b.etape, dit: b.dit }));
    console.log(`— ${commun.jour} ${hNY} NY · ${b.dit}`);
  } else {
    // Hors fenêtre on rafraîchit l'instantané et rien d'autre : consigner un
    // « passage » à 3 h du matin n'apprendrait rien à personne.
    console.log(`Instantané seul — hors fenêtre, ouverture dans ${Math.round(f.ms / 60000)} min.`);
  }

  // Confronte les signaux encore ouverts au prix courant, bougie par bougie.
  const m5 = brut.m5;
  db.signaux.filter(s => s.statut === 'ouvert').forEach(s => {
    const depuis = Date.parse(s.bougie);
    const apres = m5.filter(c => c.t > depuis);
    const L = s.sens === 'LONG';
    for (const c of apres) {
      const touchSL = L ? c.l <= s.sl : c.h >= s.sl;
      const touchTP = L ? c.h >= s.tp : c.l <= s.tp;
      const touchT1 = L ? c.h >= s.tp1 : c.l <= s.tp1;
      if (touchSL) { s.statut = 'clos'; s.resultat = 'perdu'; s.r = -1;
                     s.closTs = new Date(c.t).toISOString(); break; }
      if (touchTP) { s.statut = 'clos'; s.resultat = 'gagné'; s.r = +(0.9 * 0.5 + 0.1 * 2.5).toFixed(3);
                     s.closTs = new Date(c.t).toISOString(); break; }
      if (touchT1 && s.r == null) s.r = 0.45;          // partiel encaissé
    }
    // Un signal qui traîne plus de deux heures sans rien toucher est clôturé
    // au dernier prix : le modèle ne garde pas de position d'un jour à l'autre.
    if (s.statut === 'ouvert' && apres.length && (Date.now() - depuis) > 2 * 3600 * 1000) {
      s.statut = 'clos'; s.resultat = s.r > 0 ? 'gagné' : 'expiré';
      s.r = s.r || 0; s.closTs = new Date(apres[apres.length - 1].t).toISOString();
    }
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
  ecrire(db);
  console.log(`Journal : ${db.bilan.total} signaux (${db.bilan.clos} clos, ${db.bilan.ouverts} ouverts) · ${db.bilan.passages} passages consignés`);
})();
