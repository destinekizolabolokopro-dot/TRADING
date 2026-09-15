#!/usr/bin/env node
'use strict';
/**
 * PB BLAKE — MODÈLE COMPLET (architecture en 4 étapes)
 * ===========================================================================
 *   WAIT BIAS → WAIT KEY → WAIT TOUCH → WAIT IFVG CLOSE → ENTRÉE
 *
 * ATTRIBUTION DES RÈGLES — à garder en tête, elles n'ont pas le même poids :
 *
 *  [BLAKE]  contexte New York AM · draw on liquidity · niveau clé haute unité,
 *           souvent un FVG 5M ou supérieur · l'IFVG se cherche DANS la jambe de
 *           manipulation, après la réaction au niveau clé.
 *
 *  [SCRIPT] sélection du PLUS HAUT timeframe d'IFVG disponible entre M1 et M5
 *           (au lieu de prendre M1 d'office) · Golden Hour 09 h 30 – 11 h 00 ET
 *           · maximum deux signaux par séance · la machine à états elle-même.
 *           Ces règles viennent d'une implémentation publique, pas de Blake.
 *
 *  [MOI]    tout ce qui est marqué AMBIGU ci-dessous : les sources ne les
 *           définissent pas, j'ai dû choisir pour que le code tourne.
 *
 * Usage :
 *   node scripts/backtest_pb.js [--sym NQ=F] [--range 60d] [--jours 5]
 *        [--golden 1] [--maxsig 2] [--ifvgtf auto|1m|2m|5m]
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });

const SYM     = args.sym || 'NQ=F';
const RANGE   = args.range || '60d';
const GOLDEN  = args.golden !== '0';          // [SCRIPT] 09 h 30 – 11 h 00 ET
const GHDEB   = args.ghdeb || '09:30';        // début de la fenêtre, heure de New York
const GHFIN   = args.ghfin || '11:00';        // fin de la fenêtre
const MAXSIG  = +(args.maxsig || 2);          // [SCRIPT] deux signaux par séance
const IFVGTF  = args.ifvgtf || 'auto';        // [SCRIPT] auto = le plus haut dispo M1→M5
const BUF     = +(args.buffer || 0.02);       // [MOI] tampon du stop, en % du prix
const RRMIN   = +(args.rrmin || 0.3);         // [MOI]
const ATRMIN  = +(args.atrmin || 0.5);        // [MOI] stop minimum, en fraction d'ATR
const REACT   = +(args.react || 12);          // [AMBIGU] bougies M1 max entre touche et IFVG
const KEYAGE  = +(args.keyage || 400);        // [AMBIGU] âge max d'un niveau clé, en bougies M5
const QUIET   = args.quiet === '1';
const DUMP    = args.dump === '1';
const JOURS   = +(args.jours || 0);
const HORLOGE = args.horloge || '2m';         // série qui cadence le backtest
const CIBLE   = args.cible || 'interne';      // interne | draw | fvgopp (schéma de Blake)
const BIAIS   = args.biais || 'bos';          // amd | seq | bos | proche
const HRL     = args.hrl === '1';             // filtre HRL/LRL sur le stop et l'objectif
const CONTGAP = args.contgap === '1';         // exiger un gap de continuation
const LRLMAX  = +(args.lrlmax || 0);          // obstacles tolérés pour rester « LRL »
const BORDC   = args.bordc || 'proche';       // proche | milieu | loin : où viser DANS le FVG cible
const HRLMIN  = +(args.hrlmin || 1);          // obstacles exigés derrière le stop
const SCOREMIN= +(args.score || 0);           // confluence minimale exigée
const CONF    = args.conf || '';              // liste de critères exigés, ex. amd,ifvgHaut
const MOITIE  = +(args.moitie || 0);          // 0 = tout · 1 = 1re moitié · 2 = 2e
const COUT    = +(args.cout || 0.06);

// ───────────────────────────────────────────────────────────── données ─────
async function fetchCandles(sym, interval, range) {
  const r = await fetch(`${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${sym} ${interval} : HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error(`${sym} ${interval} : ${(j.chart.error || {}).description || 'vide'}`);
  const q = res.indicators.quote[0], out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── horaires ────
const fmtET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false,
  weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function heure(t) {
  const o = {}; fmtET.formatToParts(new Date(t)).forEach(p => o[p.type] = p.value);
  let h = +o.hour; if (h === 24) h = 0;
  return { jour: `${o.year}-${o.month}-${o.day}`, dow: DOW[o.weekday], min: h * 60 + (+o.minute) };
}
// [SCRIPT] Golden Hour : 09 h 30 → 11 h 00, heure de New York.
// Les schémas du Mech Model portent des repères horaires précis — 10 h 00 et
// 10 h 15 — bien plus serrés que la Golden Hour de 09 h 30 à 11 h 00 du script
// communautaire. La fenêtre est donc devenue un paramètre, pour les comparer.
const hhmm = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const GH_DEB = hhmm(GHDEB), GH_FIN = hhmm(GHFIN);
function dansGolden(e) { return e.dow >= 1 && e.dow <= 5 && e.min >= GH_DEB && e.min < GH_FIN; }

// ───────────────────────────────────────────────────────── outils prix ─────
function fvgs(cs) {                       // zones + date de naissance et de cassure
  const z = [];
  for (let i = 2; i < cs.length; i++) {
    if (cs[i].l > cs[i - 2].h)      z.push({ bas: cs[i - 2].h, haut: cs[i].l, haussier: true,  ne: i, t: cs[i].t, casse: null, tCasse: null });
    else if (cs[i].h < cs[i - 2].l) z.push({ bas: cs[i].h,     haut: cs[i - 2].l, haussier: false, ne: i, t: cs[i].t, casse: null, tCasse: null });
  }
  // cassure = CLÔTURE DU CORPS au-delà de la zone, du côté opposé  [BLAKE/ICT]
  z.forEach(x => {
    for (let k = x.ne + 1; k < cs.length; k++) {
      if (x.haussier ? cs[k].c < x.bas : cs[k].c > x.haut) { x.casse = k; x.tCasse = cs[k].t; break; }
    }
  });
  return z;
}
function atrSerie(cs, n = 14) {
  const a = new Array(cs.length).fill(null); let s = 0;
  for (let i = 1; i < cs.length; i++) {
    const pc = cs[i - 1].c;
    s += Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - pc), Math.abs(cs[i].l - pc));
    if (i > n) { const p = cs[i - n], pc2 = cs[i - n - 1].c;
      s -= Math.max(p.h - p.l, Math.abs(p.h - pc2), Math.abs(p.l - pc2)); }
    if (i >= n) a[i] = s / n;
  }
  return a;
}
function pivots(cs, L) {
  const hauts = [], bas = [];
  for (let i = L; i < cs.length - L; i++) {
    let ok = true;
    for (let k = i - L; k <= i + L; k++) if (k !== i && cs[k].h >= cs[i].h) { ok = false; break; }
    if (ok) hauts.push({ i, prix: cs[i].h, t: cs[i].t, vu: cs[i + L].t });
    ok = true;
    for (let k = i - L; k <= i + L; k++) if (k !== i && cs[k].l <= cs[i].l) { ok = false; break; }
    if (ok) bas.push({ i, prix: cs[i].l, t: cs[i].t, vu: cs[i + L].t });
  }
  return { hauts, bas };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFIL AMD PAR SESSION                                    [kintt.fx / ICT]
// ---------------------------------------------------------------------------
//   ASIE    → accumulation : un range étroit
//   LONDRES → manipulation : balaye UN côté du range asiatique
//   NY AM   → distribution : le vrai mouvement, dans le sens OPPOSÉ au balayage
//
// Le biais est donc connu AVANT l'ouverture de New York, ce qui vaut mieux
// qu'un biais relu en continu pendant la séance.
//
// Réserve de la source : une planche montre un NY AM qui RANGE au lieu de
// partir. La distribution dirigée n'est pas systématique.
// ═══════════════════════════════════════════════════════════════════════════
function profilAMD(cs) {
  const asie = {}, londres = {};
  cs.forEach(c => {
    const e = heure(c.t);
    if (e.min >= 20 * 60) {                       // 20 h → minuit = Asie du LENDEMAIN
      const o = {}; fmtET.formatToParts(new Date(c.t + 24 * 3600 * 1000)).forEach(p => o[p.type] = p.value);
      const j = `${o.year}-${o.month}-${o.day}`;
      (asie[j] || (asie[j] = { h: -Infinity, l: Infinity, fin: 0 }));
      asie[j].h = Math.max(asie[j].h, c.h); asie[j].l = Math.min(asie[j].l, c.l);
      asie[j].fin = Math.max(asie[j].fin, c.t);
    } else if (e.min < 3 * 60) {                  // minuit → 03 h : fin de l'Asie
      (asie[e.jour] || (asie[e.jour] = { h: -Infinity, l: Infinity, fin: 0 }));
      asie[e.jour].h = Math.max(asie[e.jour].h, c.h); asie[e.jour].l = Math.min(asie[e.jour].l, c.l);
      asie[e.jour].fin = Math.max(asie[e.jour].fin, c.t);
    }
    if (e.min >= 3 * 60 && e.min < 6 * 60) {      // 03 h → 06 h = Londres
      (londres[e.jour] || (londres[e.jour] = { h: -Infinity, l: Infinity, fin: 0 }));
      londres[e.jour].h = Math.max(londres[e.jour].h, c.h); londres[e.jour].l = Math.min(londres[e.jour].l, c.l);
      londres[e.jour].fin = Math.max(londres[e.jour].fin, c.t);
    }
  });

  const biais = {};
  Object.keys(londres).forEach(j => {
    const a = asie[j], l = londres[j];
    if (!a || a.l === Infinity || !l) return;
    const basPris  = l.l < a.l;                   // Londres a balayé le BAS du range
    const hautPris = l.h > a.h;                   // ou le HAUT
    // Un seul côté pris : le biais est net. Les deux, ou aucun : indécidable.
    if (basPris && !hautPris)      biais[j] = { dir: +1, note: 'Londres a balayé le bas de l\'Asie', asie: a, londres: l };
    else if (hautPris && !basPris) biais[j] = { dir: -1, note: 'Londres a balayé le haut de l\'Asie', asie: a, londres: l };
    else                           biais[j] = { dir: 0,  note: basPris ? 'les deux côtés pris' : 'aucun côté pris', asie: a, londres: l };
  });
  return biais;
}

// ═══════════════════════════════════════════════════════════════════════════
// HRL vs LRL                                                [kintt.fx / ICT]
// ---------------------------------------------------------------------------
//   « You never want to target HRL and you always want to target LRL »
//   « You always want HRL at your stop and LRL at your TP »
//
// LRL — chemin DÉGAGÉ vers la liquidité : rien ne la défend.
// HRL — liquidité ADOSSÉE à des zones non mitigées : chère à atteindre.
//
// Lecture mécanique retenue : compter les zones non mitigées entre le prix et
// le niveau visé. Zéro obstacle = LRL. Un ou plus = HRL.
// ═══════════════════════════════════════════════════════════════════════════
function obstacles(zones, idx, de, vers) {
  const bas = Math.min(de, vers), haut = Math.max(de, vers);
  let n = 0;
  for (const z of zones) {
    if (z.ne > idx) continue;                        // pas encore née
    if (z.casse != null && z.casse <= idx) continue; // déjà invalidée
    if (z.haut < bas || z.bas > haut) continue;      // hors du chemin
    n++;
  }
  return n;
}
function estLRL(zones, idx, de, vers, seuil) {
  return obstacles(zones, idx, de, vers) <= (seuil || 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// LE MODÈLE
// ═══════════════════════════════════════════════════════════════════════════
function backtest(m1, m2, m5, m15, d1) {
  // L'horloge décide de la longueur du backtest. M1 ne couvre que 8 jours chez
  // Yahoo : cadencer dessus réduit l'échantillon à presque rien. M2 couvre 39
  // jours, M5 en couvre 60.
  const clock = HORLOGE === '1m' ? m1 : HORLOGE === '5m' ? m5 : m2;

  const z5 = fvgs(m5), z15 = fvgs(m15);
  const zIF = { '1m': fvgs(m1), '2m': fvgs(m2), '5m': z5 };   // pour l'IFVG d'exécution
  const atrC = atrSerie(HORLOGE === '1m' ? m1 : HORLOGE === '5m' ? m5 : m2, 14);
  const piv15 = pivots(m15, 5);
  const amd = profilAMD(m5);        // profil de session, calculé une fois

  // PDH / PDL par jour ET — le « draw on liquidity » de base           [BLAKE]
  const jourEx = {};
  d1.forEach(c => { const e = heure(c.t); jourEx[e.jour] = { h: c.h, l: c.l }; });
  const joursTries = Object.keys(jourEx).sort();
  const veille = {}; joursTries.forEach((j, k) => { if (k) veille[j] = jourEx[joursTries[k - 1]]; });

  // index temporel : pour un instant t, la dernière bougie CLÔTURÉE de chaque série
  function idxA(serie, t) {
    let lo = 0, hi = serie.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (serie[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }

  const trades = [];
  let pos = null, parJour = {};

  // état de la machine, réinitialisé à chaque séance
  let etat = 'WAIT_BIAS', dir = 0, key = null, tTouche = null, legDeb = null;

  for (let i = 30; i < clock.length; i++) {
    const bar = clock[i], e = heure(bar.t);

    // ── gestion d'une position ouverte ────────────────────────────────────
    if (pos) {
      const L = pos.sens === 'LONG';
      const sl = L ? bar.l <= pos.sl : bar.h >= pos.sl;
      const tp = L ? bar.h >= pos.tp : bar.l <= pos.tp;
      const be = L ? bar.h >= pos.be : bar.l <= pos.be;
      if (sl && tp)  { pos.sortie = pos.beFait ? 'gain partiel' : 'ambigu'; pos.r = pos.beFait ? 0.3 : -1; }
      else if (sl)   { pos.sortie = pos.beFait ? 'gain partiel' : 'perte';  pos.r = pos.beFait ? 0.3 : -1; }
      else if (tp)   { pos.sortie = 'gain'; pos.r = 0.3 + 0.7 * pos.rr; }
      else {
        if (be && !pos.beFait) { pos.beFait = true; pos.sl = pos.entree; }
        if (i - pos.i > 400) { const risq = Math.abs(pos.entree - pos.sl0);
          pos.sortie = 'expiré';
          pos.r = Math.max(-1, Math.min(pos.rr, (L ? bar.c - pos.entree : pos.entree - bar.c) / risq)); }
      }
      if (pos.sortie) { trades.push(pos); pos = null; }
      else continue;
    }

    // ── réinitialisation à chaque séance ──────────────────────────────────
    if (!parJour[e.jour]) { parJour[e.jour] = 0; etat = 'WAIT_BIAS'; dir = 0; key = null; }
    if (MOITIE === 1 && i > clock.length / 2) continue;
    if (MOITIE === 2 && i <= clock.length / 2) continue;
    if (GOLDEN && !dansGolden(e)) continue;                         // [SCRIPT]
    if (parJour[e.jour] >= MAXSIG) continue;                        // [SCRIPT]

    const px = bar.c;

    // ── 1. WAIT BIAS puis DOL — dans CET ordre ──────────────────────────[BLAKE]
    // L'ordre compte : c'est la STRUCTURE haute unité qui donne le contexte, et
    // le draw on liquidity en découle. Je faisais l'inverse — je déduisais le
    // sens de la liquidité la plus proche, ce qui revient à choisir la direction
    // au hasard quand le prix est au milieu de la veille.
    //
    // Règle mécanique du biais : la dernière CASSURE DE STRUCTURE en M15. Le
    // prix clôture au-dessus du dernier swing high confirmé → contexte haussier ;
    // en dessous du dernier swing low → baissier. Le contexte tient jusqu'à la
    // cassure suivante.
    const v = veille[e.jour];
    if (!v) continue;

    if (BIAIS === 'amd') {
      // [kintt.fx] Le biais du jour vient du balayage de Londres. Il est connu
      // avant l'ouverture de New York et ne change plus de la séance.
      const b = amd[e.jour];
      if (!b || b.dir === 0) continue;             // journée indécidable
      if (bar.t < (b.londres.fin || 0)) continue;  // Londres pas encore terminée
      dir = b.dir;
    } else if (BIAIS === 'seq') {
      // [kintt.fx] La tendance est une SÉQUENCE : Higher High ET Higher Low
      // enchaînés, pas une cassure isolée qui peut être un faux signal.
      const hs = piv15.hauts.filter(x => x.vu <= bar.t).slice(-2);
      const bs = piv15.bas.filter(x => x.vu <= bar.t).slice(-2);
      if (hs.length < 2 || bs.length < 2) continue;
      const hh = hs[1].prix > hs[0].prix, hl = bs[1].prix > bs[0].prix;
      const lh = hs[1].prix < hs[0].prix, ll = bs[1].prix < bs[0].prix;
      if (hh && hl)      dir = +1;
      else if (lh && ll) dir = -1;
      else continue;                                // séquence brouillée
    } else if (BIAIS === 'bos') {
      const i15b = idxA(m15, bar.t);
      if (i15b < 20) continue;
      let dernierHaut = null, dernierBas = null;
      for (let k = piv15.hauts.length - 1; k >= 0; k--) if (piv15.hauts[k].vu <= bar.t) { dernierHaut = piv15.hauts[k]; break; }
      for (let k = piv15.bas.length - 1; k >= 0; k--)   if (piv15.bas[k].vu   <= bar.t) { dernierBas   = piv15.bas[k];   break; }
      if (!dernierHaut || !dernierBas) continue;
      // on cherche la cassure la PLUS RÉCENTE des deux
      let tHaussier = -1, tBaissier = -1;
      for (let k = i15b; k > Math.max(0, i15b - 200); k--) {
        if (tHaussier < 0 && m15[k].c > dernierHaut.prix && m15[k].t > dernierHaut.vu) tHaussier = m15[k].t;
        if (tBaissier < 0 && m15[k].c < dernierBas.prix   && m15[k].t > dernierBas.vu)   tBaissier = m15[k].t;
        if (tHaussier >= 0 && tBaissier >= 0) break;
      }
      if (tHaussier < 0 && tBaissier < 0) continue;      // pas de contexte lisible
      dir = tHaussier >= tBaissier ? +1 : -1;
    } else {
      const distH = v.h - px, distL = px - v.l;
      if (distH > 0 && (distL <= 0 || distH <= distL)) dir = +1;
      else if (distL > 0) dir = -1;
      else continue;
    }

    // DOL : la liquidité DANS LE SENS DU BIAIS, pas la plus proche des deux.
    const dol = dir > 0 ? v.h : v.l;
    if (dir > 0 ? px >= dol : px <= dol) continue;        // le draw est déjà atteint
    if (etat === 'WAIT_BIAS') etat = 'WAIT_KEY';

    // ── 2. WAIT KEY — un niveau clé valide, FVG 5M ou supérieur ─────────[BLAKE]
    // On prend le FVG non mitigé le plus proche, sur M5 ou M15, DANS le sens
    // opposé au draw (c'est là que le prix va chercher avant de repartir).
    const i5 = idxA(m5, bar.t), i15 = idxA(m15, bar.t);
    if (etat === 'WAIT_KEY') {
      let best = null;
      const scan = (zs, serie, idx, tf) => zs.forEach(z => {
        if (z.ne > idx || idx - z.ne > KEYAGE) return;
        if (z.casse != null && z.casse <= idx) return;       // déjà invalidé
        if (dir > 0 && !z.haussier) return;                  // draw haussier → on cherche un support
        if (dir < 0 && z.haussier) return;
        const d = dir > 0 ? px - z.haut : z.bas - px;
        if (d < 0) return;                                   // le prix l'a déjà dépassé
        if (!best || d < best.d) best = { z, d, tf };
      });
      scan(z15, m15, i15, 'M15');
      scan(z5,  m5,  i5,  'M5');
      if (best) { key = best; etat = 'WAIT_TOUCH'; }
    }

    // ── 3. WAIT TOUCH — le prix atteint le niveau, la manipulation commence ──
    if (etat === 'WAIT_TOUCH' && key) {
      const dedans = bar.l <= key.z.haut && bar.h >= key.z.bas;
      if (dedans) { etat = 'WAIT_IFVG'; tTouche = bar.t; legDeb = i; }
      // le niveau est traversé sans réaction → il n'était pas valide
      else if (dir > 0 ? bar.c < key.z.bas : bar.c > key.z.haut) { key = null; etat = 'WAIT_KEY'; }
    }

    // ── 4. WAIT IFVG CLOSE — dans la jambe de manipulation ──────[BLAKE+SCRIPT]
    // [SCRIPT] on prend le PLUS HAUT timeframe qui offre un IFVG, de M5 vers M1,
    // au lieu de descendre d'office en M1.
    if (etat === 'WAIT_IFVG' && key) {
      if (i - legDeb > REACT) { etat = 'WAIT_KEY'; key = null; continue; }  // réaction expirée
      const ordre = IFVGTF === 'auto' ? ['5m', '2m', '1m'] : [IFVGTF];
      let choisi = null;
      for (const tf of ordre) {
        const serie = tf === '1m' ? m1 : tf === '2m' ? m2 : m5;
        const idx = idxA(serie, bar.t);
        for (const z of zIF[tf]) {
          if (z.tCasse == null) continue;
          if (z.tCasse < tTouche || z.tCasse > bar.t) continue;   // cassure DANS la jambe
          // un FVG baissier cassé vers le haut donne une inversion haussière
          const sens = z.haussier ? -1 : +1;
          if (sens !== dir) continue;
          choisi = { z, tf }; break;
        }
        if (choisi) break;                                   // plus haut TF trouvé : on s'arrête
      }
      if (choisi) {
        const L = dir > 0;
        const entree = px;
        const buf = entree * BUF / 100;
        const sl = L ? choisi.z.bas - buf : choisi.z.haut + buf;
        const risq = Math.abs(entree - sl);
        const aRef = atrC[i];
        if (risq > 0 && aRef && risq >= aRef * ATRMIN) {
          // OBJECTIF. [BLAKE] le draw on liquidity est la destination finale,
          // mais viser directement le PDH depuis une entrée M1 donne des RR de
          // 50 qui ne sont jamais atteints. La source distingue une PREMIÈRE
          // cible interne — un plus-haut ou plus-bas récent — du draw final.
          let tp;
          if (CIBLE === 'fvgopp') {
            // ══ CIBLE DU SCHÉMA DE BLAKE ══════════════════════════════════
            // Le schéma est explicite : pour un LONG, la cible est un
            // « 5/15Min Unfilled BEARISH FVG » situé au-dessus. Donc un FVG
            // NON COMBLÉ, de polarité OPPOSÉE au trade, sur M5 ou M15.
            // Ce n'est ni un swing récent ni le plus-haut de la veille.
            tp = null;
            const scanC = (zs, idx) => zs.forEach(z => {
              if (z.ne > idx) return;
              if (z.casse != null && z.casse <= idx) return;   // déjà invalidé
              if (z.haussier === (dir > 0)) return;            // polarité OPPOSÉE exigée
              // Le schéma ne dit pas OÙ dans le FVG cible on sort : au premier
              // contact, à l'équilibre, ou au bout. Les trois sont testés.
              const niv = BORDC === 'milieu' ? (z.bas + z.haut) / 2
                        : BORDC === 'loin'   ? (dir > 0 ? z.haut : z.bas)
                        :                      (dir > 0 ? z.bas : z.haut);
              if (dir > 0 ? niv <= entree : niv >= entree) return;
              if (tp == null || (dir > 0 ? niv < tp : niv > tp)) tp = niv;
            });
            scanC(z5, i5); scanC(z15, i15);
            if (tp == null) { etat = 'WAIT_KEY'; key = null; continue; }  // pas de cible = pas de trade
          }
          else if (CIBLE === 'draw') tp = dol;
          else {
            const liste = L ? piv15.hauts : piv15.bas;
            tp = null;
            for (let k = liste.length - 1; k >= 0 && liste.length - k <= 8; k--) {
              if (liste[k].vu > bar.t) continue;               // pivot pas encore confirmé
              const q = liste[k].prix;
              if (L ? q <= entree : q >= entree) continue;
              if (tp == null || (L ? q < tp : q > tp)) tp = q;
            }
            if (tp == null) tp = dol;                          // repli sur le draw
          }
          // ── FILTRE HRL / LRL ───────────────────────────────────────
          // L'objectif doit être une LRL (chemin dégagé), et le stop doit être
          // adossé à une HRL (protégé). Si les deux côtés sont dégagés, on est
          // en « LRL vs LRL » : la source montre cette configuration résolue
          // une fois à la hausse et une fois à la baisse — elle ne se tranche
          // pas, donc on ne la trade pas.
          // ═══ CONFLUENCE ═══════════════════════════════════════════════
          // Le modèle ne fonctionne pas comme une suite de barrières mais par
          // CONVERGENCE : plusieurs éléments doivent pointer dans le même sens.
          // On ne bloque donc plus rien ici — on RELÈVE chaque critère sur le
          // signal, et on trie ensuite par niveau d'accord. C'est la seule
          // façon de savoir si la confluence apporte vraiment quelque chose.
          const zs = z5.concat(z15);
          const obsCible = obstacles(zs, i5, entree, tp);
          const obsStop  = obstacles(zs, i5, entree, sl);

          const crit = {};
          // 1. le profil AMD du jour va-t-il dans le même sens ?
          const bAmd = amd[e.jour];
          crit.amd = !!(bAmd && bAmd.dir === dir);
          // 2. la séquence HH+HL (ou LH+LL) confirme-t-elle ?
          const hs2 = piv15.hauts.filter(x => x.vu <= bar.t).slice(-2);
          const bs2 = piv15.bas.filter(x => x.vu <= bar.t).slice(-2);
          crit.sequence = hs2.length === 2 && bs2.length === 2 &&
            (dir > 0 ? (hs2[1].prix > hs2[0].prix && bs2[1].prix > bs2[0].prix)
                     : (hs2[1].prix < hs2[0].prix && bs2[1].prix < bs2[0].prix));
          // 3. l'objectif est-il dégagé par rapport au stop ? (lecture relative
          //    du HRL/LRL : ce qui compte est le CONTRASTE entre les deux côtés,
          //    pas un nombre absolu d'obstacles)
          crit.lrl = obsCible < obsStop;
          // 4. un gap de continuation s'est-il formé depuis la touche ?
          const zc = HORLOGE === '1m' ? zIF['1m'] : HORLOGE === '2m' ? zIF['2m'] : zIF['5m'];
          crit.contgap = zc.some(z => z.t >= tTouche && z.t <= bar.t && z.haussier === (dir > 0));
          // 5. le niveau clé est-il sur l'unité la plus haute ?
          crit.niveauHaut = key.tf === 'M15';
          // 6. l'IFVG retenu est-il sur l'unité la plus haute disponible ?
          crit.ifvgHaut = choisi.tf === '5m';

          const score = Object.values(crit).filter(Boolean).length;
          const etiq = Object.keys(crit).filter(k => crit[k]).join('+') || 'aucun';
          let okHRL = true;
          if (HRL) okHRL = obsCible <= LRLMAX && obsStop >= HRLMIN;
          // [kintt.fx] gap de continuation : une inefficience laissée sur le
          // mouvement de départ, après la prise de liquidité au niveau clé.
          const rr = Math.abs(tp - entree) / risq;
          // Confluence exigée : liste explicite de critères qui doivent être vrais.
          const confOK = !CONF || CONF.split(',').every(k => crit[k.trim()]);
          if (rr >= RRMIN && okHRL && (!CONTGAP || crit.contgap) && score >= SCOREMIN && confOK) {
            pos = { sens: L ? 'LONG' : 'SHORT', i, t: bar.t, entree, sl, sl0: sl, tp, rr,
                    be: L ? entree + risq : entree - risq, beFait: false,
                    tfIFVG: choisi.tf, niveau: key.tf, jour: e.jour, minET: e.min,
                    score, crit, etiq, obsCible, obsStop,
                    zone: [+choisi.z.bas.toFixed(2), +choisi.z.haut.toFixed(2)] };
            parJour[e.jour]++;
            etat = 'WAIT_KEY'; key = null;
          }
        }
      }
    }
  }
  return trades;
}

// ═══════════════════════════════════════════════════════════════ rapport ══
function stats(t) {
  const n = t.length; if (!n) return null;
  const R = t.reduce((a, x) => a + x.r, 0), moy = R / n;
  const sd = n > 1 ? Math.sqrt(t.reduce((a, x) => a + Math.pow(x.r - moy, 2), 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  return { n, R, moy, sd, se, ic: [moy - 1.96 * se, moy + 1.96 * se], t: se ? moy / se : 0,
    g: t.filter(x => x.r > 0).length };
}

(async () => {
  if (!QUIET && !DUMP) console.log(`Récupération ${SYM} en M1, M2, M5, M15 et D1…`);
  const [m1, m2, m5, m15, d1] = await Promise.all([
    fetchCandles(SYM, '1m', '8d'),
    fetchCandles(SYM, '2m', RANGE),
    fetchCandles(SYM, '5m', RANGE),
    fetchCandles(SYM, '15m', RANGE),
    fetchCandles(SYM, '1d', '3mo')
  ]);
  if (!QUIET && !DUMP)
    console.log(`  M1 ${m1.length} · M2 ${m2.length} · M5 ${m5.length} · M15 ${m15.length} · D1 ${d1.length}`);

  // La série M1 ne couvre que 8 jours : c'est elle qui borne le backtest.
  const trades = backtest(m1, m2, m5, m15, d1);
  const s = stats(trades);

  if (DUMP) {
    console.log(JSON.stringify(trades.map(x => ({ r: +x.r.toFixed(4), s: x.score, c: x.crit }))));
    return;
  }
  if (QUIET) {
    console.log(JSON.stringify(s ? { sym: SYM, n: s.n, wr: +(s.g / s.n * 100).toFixed(1),
      esperance: +s.moy.toFixed(3), ic95: [+s.ic[0].toFixed(3), +s.ic[1].toFixed(3)],
      t: +s.t.toFixed(2), cumulR: +s.R.toFixed(1) } : { sym: SYM, n: 0 }));
    return;
  }

  console.log('\n' + '='.repeat(72));
  console.log(`  PB BLAKE — MODÈLE COMPLET · ${SYM}`);
  console.log('  WAIT BIAS → WAIT KEY → WAIT TOUCH → WAIT IFVG CLOSE → ENTRÉE');
  console.log('='.repeat(72));
  if (!s) { console.log('\n  Aucun signal sur la période.\n'); return; }

  console.log(`\n  Signaux ................ ${s.n}`);
  console.log(`  Gagnants ............... ${s.g}  (${(s.g / s.n * 100).toFixed(1)} %)`);
  console.log(`  Espérance .............. ${s.moy >= 0 ? '+' : ''}${s.moy.toFixed(3)} R`);
  console.log(`  Écart-type ............. ${s.sd.toFixed(2)} R`);
  console.log(`  IC 95 % ................ [${s.ic[0].toFixed(3)} , ${s.ic[1].toFixed(3)}]`);
  console.log(`  t ...................... ${s.t.toFixed(2)}   ${s.ic[0] > 0 ? '✅ significatif' : '(zéro dans l\'intervalle)'}`);
  console.log(`  Cumulé ................. ${s.R >= 0 ? '+' : ''}${s.R.toFixed(1)} R`);
  console.log(`  Net après frais ........ ${(s.moy - COUT) >= 0 ? '+' : ''}${(s.moy - COUT).toFixed(3)} R / trade`);

  const parTF = {}, parKey = {};
  trades.forEach(x => { (parTF[x.tfIFVG] = parTF[x.tfIFVG] || []).push(x.r);
                        (parKey[x.niveau] = parKey[x.niveau] || []).push(x.r); });
  console.log('\n  UNITÉ DE L\'IFVG RETENU   (le script prend le plus haut disponible)');
  Object.keys(parTF).forEach(k => { const a = parTF[k], m = a.reduce((x, y) => x + y, 0) / a.length;
    console.log(`    ${k.padEnd(5)} ${String(a.length).padStart(3)} signaux · espérance ${m >= 0 ? '+' : ''}${m.toFixed(3)} R`); });
  console.log('\n  UNITÉ DU NIVEAU CLÉ');
  Object.keys(parKey).forEach(k => { const a = parKey[k], m = a.reduce((x, y) => x + y, 0) / a.length;
    console.log(`    ${k.padEnd(5)} ${String(a.length).padStart(3)} signaux · espérance ${m >= 0 ? '+' : ''}${m.toFixed(3)} R`); });

  if (JOURS) {
    console.log('\n  DERNIERS SIGNAUX');
    trades.slice(-JOURS).forEach(x => {
      const h = String(Math.floor(x.minET / 60)).padStart(2, '0') + 'h' + String(x.minET % 60).padStart(2, '0');
      const ico = x.r > 0 ? '✅' : x.r < 0 ? '❌' : '➖';
      console.log(`    ${x.jour} ${h} ET  ${ico} ${x.sens.padEnd(5)} IFVG ${x.tfIFVG.padEnd(3)} sur niveau ${x.niveau.padEnd(4)} ` +
        `· entrée ${x.entree.toFixed(2)} stop ${x.sl0.toFixed(2)} cible ${x.tp.toFixed(2)} RR ${x.rr.toFixed(2)} → ${x.r >= 0 ? '+' : ''}${x.r.toFixed(2)} R`);
    });
  }
  console.log('');
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
