#!/usr/bin/env node
'use strict';
/**
 * BACKTEST DU MECH MODEL — sur les vraies bougies, sans regarder le futur.
 * ---------------------------------------------------------------------------
 *   node scripts/backtest_mech.js [--tf 15m] [--range 60d] [--sym NQ=F]
 *
 * Le piège d'un backtest, c'est de tricher sans le vouloir. Trois précautions :
 *
 *  1. UN PIVOT N'EXISTE QU'APRÈS COUP. Un swing en position i n'est confirmé
 *     qu'à i+len. Le setup ne peut donc s'armer qu'à ce moment-là, jamais avant.
 *  2. UN GAP EST « NON COMBLÉ » À UNE DATE DONNÉE. On retient sa date de
 *     naissance et sa date de comblement, et on juge à l'instant de l'entrée.
 *  3. LA SMT SE LIT SUR LE PASSÉ SEULEMENT. Aucune donnée postérieure à la
 *     bougie d'entrée n'entre dans la décision.
 *
 * Quand le stop ET l'objectif sont touchés dans la MÊME bougie, on ne peut pas
 * savoir lequel est arrivé en premier : ces trades sont comptés PERDANTS et
 * signalés à part. C'est le choix pessimiste, celui qui ne flatte pas.
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });
const TF     = args.tf || '15m';
const RANGE  = args.range || '60d';
const SYM    = args.sym || 'NQ=F';
const CORR   = args.corr || 'ES=F';
const PIVOTS = +(args.pivots || 5);
const EXPIRE = +(args.expire || 30);
const BUF    = +(args.buffer || 0.02);   // % du prix
const RRMIN  = +(args.rrmin || 1.0);
const ATRMIN = +(args.atrmin || 0.5);    // stop minimum, en fraction d'ATR
const DISP   = +(args.disp || 1.0);      // displacement : corps > ATR x DISP
const INV    = args.inv || 'cisd';       // cisd | ifvg | ifvg-retest | mss | engulf
const IFVGAGE= +(args.ifvgage || 120);   // âge max d'un FVG pour pouvoir s'inverser
const QUIET  = args.quiet === '1';
const JOURS  = +(args.jours || 0);       // journal des N derniers jours de bourse
const COUT   = +(args.cout || 0.06);     // coût aller-retour estimé, en R
const STRAT  = args.strat || 'mech';     // mech | ifvg
const ENTREE = args.entree || 'retest';  // retest | cassure
const TPMODE = args.tp || 'fvg';         // fvg | rr
const TPRR   = +(args.tprr || 2.0);      // objectif en R si tp=rr
const CIBLE  = args.cible || 'eq';       // eq (50 % du gap) | bord (première touche)
const ORDRE  = args.ordre || 'marche';   // marche (clôture) | limite (retour dans la zone)
const LIMBAR = +(args.limbar || 8);      // validité de l'ordre limite, en bougies
const HTFOK  = args.htf === '1';         // n'accepter que les trades alignés H1
const PART   = +(args.partiel || 0);     // % clôturé au 1:1 (0 = désactivé)
const UNIQUE = args.unique === '1';      // refuser si plusieurs FVG dans la jambe
const ZENTREE= args.zentree || 'mid';    // mid | bord : où poser la limite DANS la zone IFVG
const SLMODE = args.sl || 'zone';        // zone | balayage | large (le plus loin des deux)
const MOITIE = +(args.moitie || 0);      // 0 = tout · 1 = 1re moitié · 2 = 2e moitié
const SMTMOD = args.smt || 'elim';       // off | elim (éliminatoire) | conflu (bonus seulement)
const CSV    = args.csv || null;         // fichier OHLC local, à la place de Yahoo
const CSVC   = args.csvcorr || null;     // même chose pour l'actif corrélé (SMT)
const DUMP   = args.dump === '1';        // sortir les R bruts, pour regrouper plusieurs marchés

// ------------------------------------------------------------- lecture CSV --
// Yahoo plafonne à 60 jours en M5 et 8 jours en M1 : bien trop court pour
// conclure quoi que ce soit. Cette fonction accepte n'importe quel CSV OHLC
// (FirstRate, Databento, export de courtier) pour backtester sur des années.
//
// Colonnes reconnues, dans n'importe quel ordre, avec ou sans en-tête :
//   date/time/timestamp/datetime · open · high · low · close · (volume ignoré)
// Formats de date acceptés : ISO (2024-03-15 14:30:00), epoch secondes,
// epoch millisecondes. Une date sans fuseau est lue comme de l'UTC.
const fsMod = require('fs');

function lireCSV(chemin) {
  const brut = fsMod.readFileSync(chemin, 'utf8').trim();
  const lignes = brut.split(/\r?\n/).filter(l => l.trim());
  if (!lignes.length) throw new Error(chemin + ' : fichier vide');

  const sep = (lignes[0].match(/;/g) || []).length > (lignes[0].match(/,/g) || []).length ? ';' : ',';
  let iT = 0, iO = 1, iH = 2, iL = 3, iC = 4, debut = 0;

  const tete = lignes[0].toLowerCase().split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
  const estEntete = tete.some(x => /^(date|time|timestamp|datetime|open|high|low|close)$/.test(x));
  if (estEntete) {
    const trouve = (...noms) => tete.findIndex(x => noms.includes(x));
    iT = trouve('timestamp', 'datetime', 'date', 'time');
    iO = trouve('open'); iH = trouve('high'); iL = trouve('low'); iC = trouve('close');
    if ([iT, iO, iH, iL, iC].some(x => x < 0))
      throw new Error(chemin + ' : colonnes manquantes. Attendu date/open/high/low/close, trouvé : ' + tete.join(', '));
    debut = 1;
  }

  const out = [];
  for (let i = debut; i < lignes.length; i++) {
    const ch = lignes[i].split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
    const t = parseDate(ch[iT]);
    const o = parseFloat(ch[iO]), h = parseFloat(ch[iH]), l = parseFloat(ch[iL]), c = parseFloat(ch[iC]);
    if (t == null || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    out.push({ t, o, h, l, c });
  }
  if (out.length < 100) throw new Error(chemin + ' : seulement ' + out.length + ' bougies lisibles');
  out.sort((a, b) => a.t - b.t);
  return out;
}

function parseDate(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (isFinite(n) && /^\d+$/.test(String(v).trim())) {
    if (n > 1e12) return n;              // millisecondes
    if (n > 1e9)  return n * 1000;       // secondes
    return null;
  }
  // « 2024-03-15 14:30:00 » sans fuseau : on la lit comme de l'UTC.
  let str = String(v).trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) str += 'Z';
  const d = Date.parse(str);
  return isFinite(d) ? d : null;
}

// ----------------------------------------------------------------- données --
async function fetchCandles(sym, interval, range) {
  const u = `${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${sym} ${interval} : HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error(`${sym} : ${(j.chart && j.chart.error && j.chart.error.description) || 'réponse vide'}`);
  const q = res.indicators.quote[0], out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  return out;
}

// ------------------------------------------------------------------ heures --
const fmtET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false,
  weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtPA = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour12: false,
  hour: '2-digit', minute: '2-digit' });
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function horaires(cs) {
  return cs.map(c => {
    const o = {}; fmtET.formatToParts(new Date(c.t)).forEach(p => o[p.type] = p.value);
    let h = +o.hour; if (h === 24) h = 0;
    const p2 = {}; fmtPA.formatToParts(new Date(c.t)).forEach(p => p2[p.type] = p.value);
    let hp = +p2.hour; if (hp === 24) hp = 0;
    return { jour: `${o.year}-${o.month}-${o.day}`, dow: DOW[o.weekday],
             et: h * 60 + (+o.minute), paris: hp * 60 + (+p2.minute) };
  });
}

// Les deux créneaux : ouverture de New York → 17 h Paris, puis 19 h → 21 h Paris.
function ecartParis(t) {
  // Différence Paris - New York, ramenée dans [-12 h, +12 h]. Sans ça, une
  // bougie à 20 h à New York (02 h à Paris) donne un écart de -18 h et fait
  // croire qu'on est en pleine séance.
  let e = t.paris - t.et;
  if (e < -720) e += 1440;
  if (e > 720) e -= 1440;
  return e;
}
function dansFenetre(t) {
  if (t.dow < 1 || t.dow > 5) return false;
  const ouvertureParis = 9 * 60 + 30 + ecartParis(t);   // 14 h 30 ou 15 h 30 selon la semaine
  const f1 = t.paris >= ouvertureParis && t.paris < 17 * 60;
  const f2 = t.paris >= 19 * 60 && t.paris < 21 * 60;
  return f1 || f2;
}

// -------------------------------------------------------------- structures --
function pivots(cs, len) {
  const hauts = [], bas = [];
  for (let i = len; i < cs.length - len; i++) {
    let ok = true;
    for (let k = i - len; k <= i + len; k++) if (k !== i && cs[k].h >= cs[i].h) { ok = false; break; }
    if (ok) hauts.push({ i, prix: cs[i].h, vu: i + len });      // « vu » = quand on le SAIT
    ok = true;
    for (let k = i - len; k <= i + len; k++) if (k !== i && cs[k].l <= cs[i].l) { ok = false; break; }
    if (ok) bas.push({ i, prix: cs[i].l, vu: i + len });
  }
  return { hauts, bas };
}

// Gaps avec leur date de naissance ET leur date de comblement.
function gaps(cs) {
  const g = [];
  for (let i = 2; i < cs.length; i++) {
    let lo = null, hi = null, dir = null;
    if (cs[i].l > cs[i - 2].h) { lo = cs[i - 2].h; hi = cs[i].l; dir = 'haussier'; }
    else if (cs[i].h < cs[i - 2].l) { lo = cs[i].h; hi = cs[i - 2].l; dir = 'baissier'; }
    if (lo == null) continue;
    let comble = null;
    for (let k = i + 1; k < cs.length; k++) if (cs[k].l <= hi && cs[k].h >= lo) { comble = k; break; }
    g.push({ lo, hi, eq: (lo + hi) / 2, dir, ne: i, comble });
  }
  return g;
}

function atrSerie(cs, n = 14) {
  const a = new Array(cs.length).fill(null);
  let somme = 0;
  for (let i = 1; i < cs.length; i++) {
    const pc = cs[i - 1].c;
    const tr = Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - pc), Math.abs(cs[i].l - pc));
    somme += tr;
    if (i > n) { const p = cs[i - n]; const pc2 = cs[i - n - 1].c;
      somme -= Math.max(p.h - p.l, Math.abs(p.h - pc2), Math.abs(p.l - pc2)); }
    if (i >= n) a[i] = somme / n;
  }
  return a;
}

// Pools de liquidité connus à l'instant i : PDH/PDL et extrêmes de session.
function poolsParJour(cs, hs) {
  const jours = {}, asia = {}, lon = {};
  cs.forEach((c, i) => {
    const j = hs[i].jour;
    (jours[j] || (jours[j] = { h: -Infinity, l: Infinity }));
    jours[j].h = Math.max(jours[j].h, c.h); jours[j].l = Math.min(jours[j].l, c.l);
    if (hs[i].et >= 3 * 60 && hs[i].et < 6 * 60) {
      (lon[j] || (lon[j] = { h: -Infinity, l: Infinity }));
      lon[j].h = Math.max(lon[j].h, c.h); lon[j].l = Math.min(lon[j].l, c.l);
    }
    if (hs[i].et >= 20 * 60) {       // soirée -> session asiatique du LENDEMAIN
      const d = new Date(c.t + 24 * 3600 * 1000);
      const o = {}; fmtET.formatToParts(d).forEach(p => o[p.type] = p.value);
      const dem = `${o.year}-${o.month}-${o.day}`;
      (asia[dem] || (asia[dem] = { h: -Infinity, l: Infinity }));
      asia[dem].h = Math.max(asia[dem].h, c.h); asia[dem].l = Math.min(asia[dem].l, c.l);
    }
  });
  const ordre = Object.keys(jours).sort();
  const veille = {}; ordre.forEach((j, k) => { if (k > 0) veille[j] = jours[ordre[k - 1]]; });
  return { veille, asia, lon };
}

// Aligne la série corrélée sur les horodatages de la série principale : sans
// ça, une bougie manquante d'un côté décale tout et la SMT compare n'importe quoi.
function aligner(nq, es) {
  if (!es) return null;
  const m = new Map();
  es.forEach(c => m.set(c.t, c));
  let manquants = 0;
  const out = nq.map(c => { const x = m.get(c.t); if (!x) manquants++; return x || null; });
  // On bouche les trous avec la dernière bougie connue, faute de mieux.
  for (let i = 1; i < out.length; i++) if (!out[i]) out[i] = out[i - 1];
  return { serie: out, manquants };
}

function smtContre(nq, es, i, n, sens) {
  if (!es || i < 2 * n) return false;
  const mx = (a, s, e) => Math.max(...a.slice(s, e).map(x => x.h));
  const mn = (a, s, e) => Math.min(...a.slice(s, e).map(x => x.l));
  if (i >= es.length || !es[i] || !es[i - 2 * n]) return false;
  const nHH = mx(nq, i - n, i + 1) > mx(nq, i - 2 * n, i - n);
  const eHH = mx(es, i - n, i + 1) > mx(es, i - 2 * n, i - n);
  const nLL = mn(nq, i - n, i + 1) < mn(nq, i - 2 * n, i - n);
  const eLL = mn(es, i - n, i + 1) < mn(es, i - 2 * n, i - n);
  if (nHH !== eHH && sens === 'LONG') return true;     // divergence baissière
  if (nLL !== eLL && sens === 'SHORT') return true;    // divergence haussière
  return false;
}

// ---------------------------------------------------------------- IFVG -----
// L'INVERSION, version mécanique : un FVG qui se fait TRAVERSER change de camp.
//   FVG baissier (résistance) dont le prix CLÔTURE au-dessus  -> IFVG HAUSSIER
//   FVG haussier (support)    dont le prix CLÔTURE en dessous -> IFVG BAISSIER
// C'est la seule définition d'« inversion » qui soit entièrement mécanique :
// pas de seuil arbitraire, pas d'appréciation. La zone inversée devient un
// support (ou une résistance) et l'entrée se fait dessus.
function zonesFVG(cs) {
  const z = [];
  for (let i = 2; i < cs.length; i++) {
    if (cs[i].l > cs[i - 2].h)      z.push({ bas: cs[i - 2].h, haut: cs[i].l, haussier: true,  ne: i, casse: null });
    else if (cs[i].h < cs[i - 2].l) z.push({ bas: cs[i].h,     haut: cs[i - 2].l, haussier: false, ne: i, casse: null });
  }
  // Date de cassure : première CLÔTURE au-delà de la zone, du mauvais côté.
  z.forEach(x => {
    for (let k = x.ne + 1; k < cs.length; k++) {
      if (k - x.ne > IFVGAGE) break;
      if (x.haussier ? cs[k].c < x.bas : cs[k].c > x.haut) { x.casse = k; break; }
    }
  });
  return z;
}

// Y a-t-il une inversion IFVG dans le sens voulu, à la bougie i ?
function inversionIFVG(cs, zones, i, long, retest) {
  for (const z of zones) {
    if (z.casse == null) continue;
    // Un FVG BAISSIER cassé vers le HAUT donne une inversion HAUSSIÈRE.
    if (long !== !z.haussier) continue;
    if (retest) {
      // Entrée au RETEST : la zone a été cassée avant, et le prix y revient.
      if (z.casse >= i) continue;
      if (i - z.casse > IFVGAGE) continue;
      const touche = long ? (cs[i].l <= z.haut && cs[i].c > z.bas)
                          : (cs[i].h >= z.bas && cs[i].c < z.haut);
      const rejet  = long ? cs[i].c > cs[i].o : cs[i].c < cs[i].o;
      if (touche && rejet) return z;
    } else if (z.casse === i) {
      return z;                       // entrée sur la bougie de cassure
    }
  }
  return null;
}

// ------------------------------------------------------------- la marche ----
function backtest(cs, es, hs) {
  const piv = pivots(cs, PIVOTS);
  const gs = gaps(cs);
  const atr = atrSerie(cs, 14);
  const { veille, asia, lon } = poolsParJour(cs, hs);
  const zones = zonesFVG(cs);

  const trades = [];
  let enPos = null, pendant = null;

  // Pour chaque bougie, les pivots CONNUS à cet instant.
  let ih = 0, ib = 0;
  const hautsVus = [], basVus = [];

  for (let i = 0; i < cs.length; i++) {
    while (ih < piv.hauts.length && piv.hauts[ih].vu <= i) hautsVus.push(piv.hauts[ih++]);
    while (ib < piv.bas.length   && piv.bas[ib].vu   <= i) basVus.push(piv.bas[ib++]);

    // ---- 1. gestion d'une position ouverte -------------------------------
    if (enPos) {
      const c = cs[i], L = enPos.sens === 'LONG';
      const toucheSL = L ? c.l <= enPos.sl : c.h >= enPos.sl;
      const toucheTP = L ? c.h >= enPos.tp : c.l <= enPos.tp;
      const toucheBE = L ? c.h >= enPos.be : c.l <= enPos.be;

      // Prise PARTIELLE au 1:1 : on encaisse une fraction, on passe le reste à
      // l'entrée. Un trade qui touche le 1:1 puis revient devient alors un
      // petit GAGNANT, plus un simple break-even. C'est vraisemblablement ainsi
      // que se comptent les taux de réussite annoncés.
      const frac = PART / 100;
      const acquis = enPos.beFait ? frac * 1 : 0;     // en R, déjà encaissé
      if (toucheSL && toucheTP) {
        enPos.sortie = acquis > 0 ? 'gain partiel' : 'ambigu'; enPos.r = acquis > 0 ? acquis : -1;
      } else if (toucheSL) {
        enPos.sortie = acquis > 0 ? 'gain partiel' : (enPos.beFait ? 'break-even' : 'perte');
        enPos.r = acquis > 0 ? acquis : (enPos.beFait ? 0 : -1);
      } else if (toucheTP) {
        enPos.sortie = 'gain'; enPos.r = acquis + (1 - frac) * enPos.rr;
      } else {
        if (toucheBE && !enPos.beFait) { enPos.beFait = true; enPos.sl = enPos.entree; }  // stop à l'entrée au 1:1
        if (i - enPos.iEntree > 200) {
          // Sortie au marché : on calcule le R RÉELLEMENT obtenu, on n'invente pas.
          const risque = Math.abs(enPos.entree - enPos.slInit);
          enPos.sortie = 'expiré';
          enPos.r = ((L ? c.c - enPos.entree : enPos.entree - c.c) / risque);
          enPos.r = Math.max(-1, Math.min(enPos.rr, enPos.r));
        }
      }
      if (enPos.sortie) { enPos.iSortie = i; enPos.duree = i - enPos.iEntree; trades.push(enPos); enPos = null; }
      else continue;                                    // un seul trade à la fois
    }

    // ---- 1 bis. ordre LIMITE en attente ------------------------------------
    // Blake : « si la bougie clôture haut, privilégie un ORDRE LIMITE plutôt
    // que de chasser ». On attend donc que le prix REVIENNE dans la bougie
    // d'inversion au lieu d'entrer à sa clôture. Entrée meilleure = risque plus
    // petit = RR plus haut ET objectif plus proche.
    if (pendant) {
      const o = pendant, L2 = o.sens === 'LONG';
      const touche = L2 ? cs[i].l <= o.prix : cs[i].h >= o.prix;
      if (touche) {
        const entree = o.prix;
        const risque = Math.abs(entree - o.sl);
        const rr = risque > 0 ? Math.abs(o.tp - entree) / risque : 0;
        pendant = null;
        if (risque > 0 && risque >= atr[i] * ATRMIN && rr >= RRMIN) {
          enPos = { sens: o.sens, iEntree: i, t: cs[i].t, entree, sl: o.sl, slInit: o.sl,
                    tp: o.tp, rr, be: L2 ? entree + risque : entree - risque, beFait: false,
                    pool: o.pool, src: o.src, mode: INV + '+limite', jour: hs[i].jour,
                    paris: hs[i].paris, creneau: hs[i].paris < 17 * 60 ? 'après-midi' : 'soirée' };
        }
        continue;
      }
      // L'objectif atteint avant l'entrée : occasion manquée, on annule.
      if (L2 ? cs[i].h >= o.tp : cs[i].l <= o.tp) { pendant = null; continue; }
      if (i - o.iSignal > LIMBAR) { pendant = null; }       // ordre expiré
      else continue;                                         // on attend encore
    }

    // ---- 2. recherche d'un nouveau setup ---------------------------------
    if (MOITIE === 1 && i > cs.length / 2) continue;
    if (MOITIE === 2 && i <= cs.length / 2) continue;
    if (!dansFenetre(hs[i])) continue;
    if (basVus.length < 2 || hautsVus.length < 2) continue;

    const j = hs[i].jour;
    const pdh = veille[j] ? veille[j].h : null, pdl = veille[j] ? veille[j].l : null;
    const aL = asia[j] ? asia[j].l : null, aH = asia[j] ? asia[j].h : null;
    const lL = (lon[j] && hs[i].et >= 6 * 60) ? lon[j].l : null;
    const lH = (lon[j] && hs[i].et >= 6 * 60) ? lon[j].h : null;

    // séquence LONG : swing low -> swing high -> lower low qui balaye
    let setup = null;
    for (let n = basVus.length - 1; n >= 1; n--) {
      const cur = basVus[n], prec = basVus[n - 1];
      if (i - cur.i > EXPIRE) break;
      if (cur.prix >= prec.prix) continue;
      if (!hautsVus.some(x => x.i > prec.i && x.i < cur.i)) continue;
      const pools = [[pdl, 'PDL'], [aL, 'bas Asie'], [lL, 'bas Londres'], [prec.prix, 'swing low précédent']];
      let pris = null;
      pools.forEach(([v, nom]) => { if (v != null && cur.prix <= v && (!pris || v > pris[0])) pris = [v, nom]; });
      if (pris) { setup = { sens: 'LONG', swing: cur, pool: pris }; break; }
    }
    if (!setup) {
      for (let n = hautsVus.length - 1; n >= 1; n--) {
        const cur = hautsVus[n], prec = hautsVus[n - 1];
        if (i - cur.i > EXPIRE) break;
        if (cur.prix <= prec.prix) continue;
        if (!basVus.some(x => x.i > prec.i && x.i < cur.i)) continue;
        const pools = [[pdh, 'PDH'], [aH, 'haut Asie'], [lH, 'haut Londres'], [prec.prix, 'swing high précédent']];
        let pris = null;
        pools.forEach(([v, nom]) => { if (v != null && cur.prix >= v && (!pris || v < pris[0])) pris = [v, nom]; });
        if (pris) { setup = { sens: 'SHORT', swing: cur, pool: pris }; break; }
      }
    }
    if (!setup) continue;

    // ---- 3. inversion SUR la bougie courante ------------------------------
    const L = setup.sens === 'LONG';
    if (i <= setup.swing.i) continue;
    let inv = false, zoneInv = null;
    if (INV === 'ifvg' || INV === 'ifvg-retest') {
      zoneInv = inversionIFVG(cs, zones, i, L, INV === 'ifvg-retest');
      inv = !!zoneInv;
      // « Entry on candle closure through IFVG IF THERE IS CLEAR DISPLACEMENT » :
      // le displacement s'applique aussi à la bougie qui traverse la zone. Il ne
      // l'était pas — le paramètre était mort en mode IFVG.
      if (inv && zoneInv) {
        const k = zoneInv.casse;
        const corps = Math.abs(cs[k].c - cs[k].o);
        if (!atr[k] || corps <= atr[k] * DISP) { inv = false; zoneInv = null; }
      }
      // « Multiple FVGs in the leg reduce accuracy » : on peut exiger que la
      // jambe entre le balayage et l'inversion ne contienne QU'UN seul FVG.
      if (inv && UNIQUE) {
        const dans = zones.filter(z => z.ne > setup.swing.i && z.ne <= i).length;
        if (dans > 1) { inv = false; zoneInv = null; }
      }
    } else {
      const corps = Math.abs(cs[i].c - cs[i].o);
      if (!atr[i] || corps <= atr[i] * DISP) continue;           // displacement
      if (INV === 'mss') {
        const ref = L ? Math.max(...hautsVus.slice(-1).map(x => x.prix)) : Math.min(...basVus.slice(-1).map(x => x.prix));
        inv = L ? cs[i].c > ref : cs[i].c < ref;
      } else if (INV === 'engulf') {
        inv = L ? (cs[i].c > cs[i].o && cs[i].c > cs[i - 1].h) : (cs[i].c < cs[i].o && cs[i].c < cs[i - 1].l);
      } else {                                                    // cisd
        let ext = cs[i - 1].o;
        for (let k = Math.max(0, i - 5); k < i; k++) ext = L ? Math.max(ext, cs[k].o) : Math.min(ext, cs[k].o);
        inv = L ? (cs[i].c > ext && cs[i].c > cs[i].o) : (cs[i].c < ext && cs[i].c < cs[i].o);
      }
    }
    if (!inv) continue;

    // SMT : les sources se contredisent, on rend le comportement explicite.
    //   elim   — divergence à contre-sens = pas de trade
    //   conflu — on exige au contraire une divergence FAVORABLE
    //   off    — on ignore la SMT
    const smtBloque = smtContre(cs, es, i, 20, setup.sens);
    if (SMTMOD === 'elim'   && smtBloque) continue;
    if (SMTMOD === 'conflu' && !smtContre(cs, es, i, 20, setup.sens === 'LONG' ? 'SHORT' : 'LONG')) continue;
    // Le modèle n'exige pas de biais haute unité, mais la source dit que la
    // probabilité monte nettement quand le trade va dans le même sens. On peut
    // donc en faire un filtre, et mesurer ce qu'il coûte et ce qu'il rapporte.
    if (HTFOK) {
      const fen = 100;
      if (i < fen) continue;
      const debut = cs[i - fen].c, tendance = cs[i].c > debut ? 'LONG' : 'SHORT';
      if (tendance !== setup.sens) continue;
    }

    // ---- 4. niveaux ------------------------------------------------------
    const entree = cs[i].c;
    const buf = entree * BUF / 100;
    let bas = cs[i].l, haut = cs[i].h;
    for (let k = Math.max(0, i - 2); k <= i; k++) { bas = Math.min(bas, cs[k].l); haut = Math.max(haut, cs[k].h); }
    let sl = L ? bas - buf : haut + buf;
    let src = "structure de l'inversion";
    // « Stop just below the FVG OR the swing low created by the sweep » : la
    // source donne les DEUX. Le bord de zone est serré, le swing du balayage
    // est large. On les compare au lieu d'en supposer un.
    if (zoneInv) {
      const zs = L ? zoneInv.bas - buf : zoneInv.haut + buf;
      const bs = L ? setup.swing.prix - buf : setup.swing.prix + buf;
      if (SLMODE === 'balayage')  { sl = bs; src = 'swing du balayage'; }
      else if (SLMODE === 'large'){ sl = L ? Math.min(zs, bs) : Math.max(zs, bs); src = 'le plus large des deux'; }
      else                        { sl = zs; src = 'zone IFVG'; }
    }
    if (Math.abs(entree - sl) < atr[i] * ATRMIN) {                // trop serré -> on recule au balayage
      sl = L ? setup.swing.prix - buf : setup.swing.prix + buf; src = 'balayage';
    }
    // cible : un gap NON COMBLÉ À CET INSTANT, au-delà de l'entrée
    // CIBLE : le milieu du gap (consequent encroachment) ou son BORD le plus
    // proche. Le bord est touché AVANT le milieu — donc atteint bien plus
    // souvent, pour un RR plus faible. C'est le principal levier sur le taux
    // de réussite, et je ne l'avais pas implémenté.
    // CIBLE. La source donne comme PREMIER objectif « Internal Liquidity
    // (recent high/low) », pas un gap. Un plus-haut récent est bien plus proche
    // qu'un gap non comblé : c'est le principal écart qui me restait.
    let tp = null;
    if (CIBLE === 'liq') {
      const liste = L ? hautsVus : basVus;
      for (let n = liste.length - 1; n >= 0; n--) {
        const v = liste[n].prix;
        if (L ? v <= entree : v >= entree) continue;
        if (tp == null || (L ? v < tp : v > tp)) tp = v;
        if (liste.length - n >= 6) break;          // on reste sur la liquidité RÉCENTE
      }
    } else {
      gs.forEach(g => {
        if (g.ne > i) return;                       // pas encore né
        if (g.comble != null && g.comble <= i) return;  // déjà comblé
        const niv = CIBLE === 'bord' ? (L ? g.lo : g.hi) : g.eq;
        if (L ? niv <= entree : niv >= entree) return;
        if (tp == null || (L ? niv < tp : niv > tp)) tp = niv;
      });
    }
    if (tp == null) continue;

    const risque = Math.abs(entree - sl);
    if (!(risque > 0) || risque < atr[i] * ATRMIN) continue;
    const rr = Math.abs(tp - entree) / risque;
    if (rr < RRMIN) continue;

    if (ORDRE === 'limite') {
      // Limite au milieu de la bougie d'inversion : on laisse le prix revenir.
      // « Entry on a return to the IFVG » : la limite se pose DANS la zone
      // inversée (son milieu, ou son bord le plus proche), pas au milieu de la
      // bougie d'inversion comme je le faisais.
      let px = (cs[i].h + cs[i].l) / 2;
      if (zoneInv) {
        px = ZENTREE === 'bord' ? (L ? zoneInv.haut : zoneInv.bas)      // 0 % — première touche
           : ZENTREE === 'loin' ? (L ? zoneInv.bas : zoneInv.haut)      // 100 % — remplissage complet
           : (zoneInv.bas + zoneInv.haut) / 2;                          // 50 % — midpoint
      }
      pendant = { sens: setup.sens, iSignal: i, prix: px, sl, tp, pool: setup.pool[1], src };
    } else {
      enPos = { sens: setup.sens, iEntree: i, t: cs[i].t, entree, sl, slInit: sl, tp, rr,
                be: L ? entree + risque : entree - risque, beFait: false,
                pool: setup.pool[1], src, mode: INV, jour: j, paris: hs[i].paris,
                creneau: hs[i].paris < 17 * 60 ? 'après-midi' : 'soirée' };
    }
  }
  return trades;
}

// ------------------------------------------------------------- le rapport --
function pct(n, d) { return d ? (n / d * 100).toFixed(1) + ' %' : '—'; }

function rapport(trades, cs, TFnom) {
  const n = trades.length;
  console.log('\n' + '='.repeat(74));
  console.log(`  BACKTEST MECH MODEL — ${CSV ? CSV : SYM} en ${CSV ? "données locales" : TFnom} · ${cs.length} bougies`);
  console.log(`  du ${new Date(cs[0].t).toISOString().slice(0, 10)} au ${new Date(cs[cs.length - 1].t).toISOString().slice(0, 10)}`);
  console.log('='.repeat(74));
  if (!n) { console.log('\n  Aucun trade déclenché sur la période.\n'); return; }

  // Un « gain partiel » (1:1 encaissé puis retour à l'entrée) est un GAGNANT :
  // de l'argent a été pris. Le compter comme un break-even fausse le taux.
  const gains = trades.filter(t => t.sortie === 'gain' || t.sortie === 'gain partiel');
  const partiels = trades.filter(t => t.sortie === 'gain partiel');
  const pertes = trades.filter(t => t.sortie === 'perte');
  const be = trades.filter(t => t.sortie === 'break-even');
  const amb = trades.filter(t => t.sortie === 'ambigu');
  const exp = trades.filter(t => t.sortie === 'expiré');
  const sommeR = trades.reduce((s, t) => s + t.r, 0);
  const esperance = sommeR / n;
  const rrMoy = gains.length ? gains.reduce((s, t) => s + t.rr, 0) / gains.length : 0;
  // Le taux de réussite « utile » : un break-even n'est pas une perte.
  const decisifs = gains.length + pertes.length + amb.length;

  console.log('\n  RÉSULTATS');
  console.log(`    Trades déclenchés .......... ${n}`);
  console.log(`    Gagnants ................... ${gains.length}  (${pct(gains.length, n)})`);
  if (partiels.length) console.log(`      dont gains partiels ...... ${partiels.length}  (1:1 encaissé puis retour à l'entrée)`);
  console.log(`    Perdants ................... ${pertes.length}  (${pct(pertes.length, n)})`);
  console.log(`    Sortis au break-even ....... ${be.length}  (${pct(be.length, n)})   ← ni gain ni perte`);
  console.log(`    Ambigus (SL+TP même bougie)  ${amb.length}  (${pct(amb.length, n)})   ← comptés PERDANTS`);
  console.log(`    Expirés .................... ${exp.length}`);
  console.log(`\n    Taux de réussite sur trades décisifs : ${pct(gains.length, decisifs)}`);
  console.log(`    Taux de réussite sur TOUS les trades : ${pct(gains.length, n)}`);
  console.log(`    RR moyen des gagnants ................ ${rrMoy.toFixed(2)}`);
  console.log(`    ESPÉRANCE PAR TRADE .................. ${esperance >= 0 ? '+' : ''}${esperance.toFixed(3)} R`);
  console.log(`    Résultat cumulé ...................... ${sommeR >= 0 ? '+' : ''}${sommeR.toFixed(1)} R`);

  const parCreneau = {};
  trades.forEach(t => { (parCreneau[t.creneau] || (parCreneau[t.creneau] = [])).push(t); });
  console.log('\n  PAR CRÉNEAU');
  Object.keys(parCreneau).forEach(k => {
    const l = parCreneau[k], g = l.filter(t => t.sortie === 'gain').length;
    const r = l.reduce((s, t) => s + t.r, 0);
    console.log(`    ${k.padEnd(12)} ${String(l.length).padStart(3)} trades · ${pct(g, l.length).padStart(7)} de réussite · ${(r >= 0 ? '+' : '') + r.toFixed(1)} R`);
  });

  const parSens = {};
  trades.forEach(t => { (parSens[t.sens] || (parSens[t.sens] = [])).push(t); });
  console.log('\n  PAR SENS');
  Object.keys(parSens).forEach(k => {
    const l = parSens[k], g = l.filter(t => t.sortie === 'gain').length;
    const r = l.reduce((s, t) => s + t.r, 0);
    console.log(`    ${k.padEnd(12)} ${String(l.length).padStart(3)} trades · ${pct(g, l.length).padStart(7)} de réussite · ${(r >= 0 ? '+' : '') + r.toFixed(1)} R`);
  });

  const parStop = {};
  trades.forEach(t => { (parStop[t.src] || (parStop[t.src] = [])).push(t); });
  console.log('\n  PAR PLACEMENT DU STOP');
  Object.keys(parStop).forEach(k => {
    const l = parStop[k], g = l.filter(t => t.sortie === 'gain').length;
    const r = l.reduce((s, t) => s + t.r, 0);
    console.log(`    ${k.padEnd(28)} ${String(l.length).padStart(3)} trades · ${pct(g, l.length).padStart(7)} · ${(r >= 0 ? '+' : '') + r.toFixed(1)} R`);
  });

  console.log('\n  FIABILITÉ : ' + (n < 20 ? '⚠️ moins de 20 trades — ces chiffres ne veulent rien dire encore.'
    : n < 50 ? 'indicatif (20 à 50 trades) — une tendance, pas une preuve.'
    : 'significatif (50+ trades).'));

  console.log('\n  LES 12 DERNIERS TRADES');
  console.log('    date        sens   entrée     stop       objectif   RR     sortie');
  trades.slice(-12).forEach(t => {
    console.log(`    ${new Date(t.t).toISOString().slice(0, 16).replace('T', ' ')}  ${t.sens.padEnd(6)} ` +
      `${t.entree.toFixed(2).padStart(9)} ${t.slInit.toFixed(2).padStart(10)} ${t.tp.toFixed(2).padStart(10)} ` +
      `${t.rr.toFixed(2).padStart(5)}  ${t.sortie}`);
  });
  console.log('');
}

// ===========================================================================
// STRATÉGIE IFVG — autonome, sans la structure du MECH
// ---------------------------------------------------------------------------
//   FVG → le prix le TRAVERSE en clôture (invalidation) → la zone s'inverse
//   → RETEST de la zone → entrée dans le sens de l'inversion
//   → stop de l'autre côté de la zone → objectif → break-even au 1:1
//
// Différence avec le MECH : ici on n'exige NI balayage de liquidité, NI
// séquence de swings. C'est le modèle complet à lui seul, comme dans la spec.
// ===========================================================================
function backtestIFVG(cs, es, hs) {
  const zones = zonesFVG(cs);
  const gs = gaps(cs);
  const atr = atrSerie(cs, 14);
  const trades = [];
  let enPos = null;

  for (let i = 0; i < cs.length; i++) {
    // ---- gestion de la position ------------------------------------------
    if (enPos) {
      const c = cs[i], L = enPos.sens === 'LONG';
      const sl = L ? c.l <= enPos.sl : c.h >= enPos.sl;
      const tp = L ? c.h >= enPos.tp : c.l <= enPos.tp;
      const be = L ? c.h >= enPos.be : c.l <= enPos.be;
      if (sl && tp)      { enPos.sortie = 'ambigu'; enPos.r = enPos.beFait ? 0 : -1; }
      else if (sl)       { enPos.sortie = enPos.beFait ? 'break-even' : 'perte'; enPos.r = enPos.beFait ? 0 : -1; }
      else if (tp)       { enPos.sortie = 'gain'; enPos.r = enPos.rr; }
      else {
        if (be && !enPos.beFait) { enPos.beFait = true; enPos.sl = enPos.entree; }
        if (i - enPos.iEntree > 200) {
          const risque = Math.abs(enPos.entree - enPos.slInit);
          enPos.sortie = 'expiré';
          enPos.r = Math.max(-1, Math.min(enPos.rr, (L ? c.c - enPos.entree : enPos.entree - c.c) / risque));
        }
      }
      if (enPos.sortie) { enPos.iSortie = i; enPos.duree = i - enPos.iEntree; trades.push(enPos); enPos = null; }
      else continue;
    }

    if (!dansFenetre(hs[i]) || !atr[i]) continue;

    // ---- recherche d'une zone inversée exploitable -------------------------
    for (const z of zones) {
      if (z.casse == null) continue;
      const L = !z.haussier;                    // FVG baissier traversé vers le haut => LONG
      let declencheur = false;
      if (ENTREE === 'cassure') {
        declencheur = (z.casse === i);
      } else {
        if (z.casse >= i || i - z.casse > IFVGAGE) continue;
        // Le prix revient DANS la zone et la rejette (clôture du bon côté).
        const touche = L ? (cs[i].l <= z.haut && cs[i].l >= z.bas) : (cs[i].h >= z.bas && cs[i].h <= z.haut);
        const rejet  = L ? (cs[i].c > z.haut || (cs[i].c > cs[i].o && cs[i].c > z.bas))
                         : (cs[i].c < z.bas  || (cs[i].c < cs[i].o && cs[i].c < z.haut));
        declencheur = touche && rejet;
      }
      if (!declencheur) continue;
      if (smtContre(cs, es, i, 20, L ? 'LONG' : 'SHORT')) continue;

      const entree = cs[i].c;
      const buf = entree * BUF / 100;
      const sl = L ? z.bas - buf : z.haut + buf;
      const risque = Math.abs(entree - sl);
      if (!(risque > 0) || risque < atr[i] * ATRMIN) continue;

      let tp = null;
      if (TPMODE === 'rr') {
        tp = L ? entree + risque * TPRR : entree - risque * TPRR;
      } else {
        gs.forEach(g => {
          if (g.ne > i) return;
          if (g.comble != null && g.comble <= i) return;
          if (L ? g.eq <= entree : g.eq >= entree) return;
          if (tp == null || (L ? g.eq < tp : g.eq > tp)) tp = g.eq;
        });
      }
      if (tp == null) continue;
      const rr = Math.abs(tp - entree) / risque;
      if (rr < RRMIN) continue;

      enPos = { sens: L ? 'LONG' : 'SHORT', iEntree: i, t: cs[i].t, entree, sl, slInit: sl, tp, rr,
                be: L ? entree + risque : entree - risque, beFait: false,
                pool: 'zone IFVG ' + z.bas.toFixed(2) + '–' + z.haut.toFixed(2),
                src: 'zone IFVG', mode: 'ifvg-' + ENTREE, jour: hs[i].jour, paris: hs[i].paris,
                creneau: hs[i].paris < 17 * 60 ? 'après-midi' : 'soirée' };
      break;
    }
  }
  return trades;
}

// ------------------------------------------------- journal d'une semaine ---
// Ce que tu vivrais réellement : tu arrives à 15 h 30, tu regardes, tu prends
// ou pas ; tu reviens à 19 h, pareil. Le reste de la journée n'existe pas.
function journal(trades, cs, hs, nJours) {
  const jours = [...new Set(hs.map(h => h.jour))].filter(j => {
    const d = hs.find(h => h.jour === j);
    return d.dow >= 1 && d.dow <= 5;
  }).sort();
  const derniers = jours.slice(-nJours);
  const parJour = {};
  trades.forEach(t => { (parJour[t.jour] || (parJour[t.jour] = [])).push(t); });

  console.log('\n' + '='.repeat(74));
  console.log(`  JOURNAL — les ${derniers.length} dernières séances, créneau par créneau`);
  console.log('='.repeat(74));

  let cumul = 0, nb = 0, g = 0, p = 0, be = 0;
  derniers.forEach(j => {
    const l = (parJour[j] || []).sort((a, b) => a.iEntree - b.iEntree);
    console.log(`\n  ${j}`);
    ['après-midi', 'soirée'].forEach(cr => {
      const h = cr === 'après-midi' ? '15 h 30 → 17 h 00' : '19 h 00 → 21 h 00';
      const ts = l.filter(t => t.creneau === cr);
      if (!ts.length) { console.log(`    ${h}   —  aucun setup valide`); return; }
      ts.forEach(t => {
        nb++; cumul += t.r;
        if (t.sortie === 'gain') g++; else if (t.sortie === 'break-even') be++; else p++;
        const heure = String(Math.floor(t.paris / 60)).padStart(2, '0') + 'h' + String(t.paris % 60).padStart(2, '0');
        const ico = t.sortie === 'gain' ? '✅' : t.sortie === 'break-even' ? '➖' : '❌';
        console.log(`    ${h}   ${ico} ${heure} ${t.sens.padEnd(5)} ` +
          `entrée ${t.entree.toFixed(2)} · stop ${t.slInit.toFixed(2)} · cible ${t.tp.toFixed(2)} · RR ${t.rr.toFixed(2)}`);
        console.log(`                        balayage ${t.pool} · stop sur ${t.src} · sortie : ${t.sortie} (${t.r >= 0 ? '+' : ''}${t.r.toFixed(2)} R)`);
      });
    });
  });

  const net = cumul - nb * COUT;
  console.log('\n  ' + '-'.repeat(70));
  console.log(`  BILAN DE LA PÉRIODE : ${nb} trade(s) · ${g} gagnant(s) · ${be} break-even · ${p} perdant(s)`);
  console.log(`  Résultat brut ......... ${cumul >= 0 ? '+' : ''}${cumul.toFixed(2)} R`);
  console.log(`  Frais estimés ......... -${(nb * COUT).toFixed(2)} R  (${COUT} R par trade : commission + slippage)`);
  console.log(`  RÉSULTAT NET .......... ${net >= 0 ? '+' : ''}${net.toFixed(2)} R`);
  console.log(`  Sur un compte de 10 000 € à 1 % de risque : ${net >= 0 ? '+' : ''}${Math.round(net * 100)} €`);
  console.log('');
}

(async () => {
  if (!QUIET && !DUMP) console.log(CSV ? `Lecture de ${CSV}` + (CSVC ? ` et ${CSVC}` : ' (pas de SMT)') + '…'
                                : `Récupération ${SYM} et ${CORR} en ${TF} sur ${RANGE}…`);
  const [nq, es] = CSV
    ? [lireCSV(CSV), CSVC ? lireCSV(CSVC) : null]
    : await Promise.all([
        fetchCandles(SYM, TF, RANGE),
        fetchCandles(CORR, TF, RANGE).catch(() => null)
      ]);
  if (!nq || nq.length < 100) throw new Error('pas assez de bougies');
  if (!QUIET && !DUMP) console.log(`  ${nq.length} bougies ${SYM}` + (es ? `, ${es.length} bougies ${CORR} (SMT active)` : ', pas de SMT'));
  const hs = horaires(nq);
  const al = aligner(nq, es);
  if (al && al.manquants && !QUIET) console.log(`  ⚠️ ${al.manquants} bougies ${CORR} manquantes, comblées par la précédente`);
  const trades = STRAT === 'ifvg' ? backtestIFVG(nq, al ? al.serie : null, hs)
                                  : backtest(nq, al ? al.serie : null, hs);
  if (DUMP) {
    console.log(JSON.stringify(trades.map(t => +t.r.toFixed(4))));
  } else if (QUIET) {
    const g = trades.filter(t => t.sortie === 'gain' || t.sortie === 'gain partiel').length;
    const p = trades.filter(t => t.sortie === 'perte' || t.sortie === 'ambigu').length;
    const b = trades.filter(t => t.sortie === 'break-even').length;
    const R = trades.reduce((s, t) => s + t.r, 0);
    // Intervalle de confiance sur l'espérance. C'est LA question : avec si peu
    // de trades, l'écart-type des résultats écrase la moyenne, et l'intervalle
    // va de la ruine à la fortune. Tant qu'il contient zéro, on ne sait rien.
    const moy = trades.length ? R / trades.length : 0;
    const varr = trades.length > 1
      ? trades.reduce((a, t) => a + Math.pow(t.r - moy, 2), 0) / (trades.length - 1) : 0;
    const sd = Math.sqrt(varr);
    const se = trades.length ? sd / Math.sqrt(trades.length) : 0;
    const ic = [moy - 1.96 * se, moy + 1.96 * se];
    // Combien de trades faudrait-il pour que l'intervalle exclue zéro ?
    const requis = moy !== 0 ? Math.ceil(Math.pow(1.96 * sd / Math.abs(moy), 2)) : null;
    console.log(JSON.stringify({ tf: CSV ? "csv" : TF, moitie: MOITIE, sl: SLMODE, zentree: ZENTREE, disp: DISP, partiel: PART, smt: SMTMOD, n: trades.length, gains: g, pertes: p, be: b,
      wr: trades.length ? +(g / trades.length * 100).toFixed(1) : 0,
      esperance: +moy.toFixed(3), ecartType: +sd.toFixed(2),
      ic95: [+ic[0].toFixed(3), +ic[1].toFixed(3)],
      tradesRequis: requis, cumulR: +R.toFixed(1) }));
  } else { rapport(trades, nq, TF); if (JOURS) journal(trades, nq, hs, JOURS); }
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
