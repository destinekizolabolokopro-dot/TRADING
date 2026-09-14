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
const QUIET  = args.quiet === '1';

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

function smtContre(nq, es, i, n, sens) {
  if (!es || i < 2 * n) return false;
  const mx = (a, s, e) => Math.max(...a.slice(s, e).map(x => x.h));
  const mn = (a, s, e) => Math.min(...a.slice(s, e).map(x => x.l));
  if (i >= es.length) return false;
  const nHH = mx(nq, i - n, i + 1) > mx(nq, i - 2 * n, i - n);
  const eHH = mx(es, i - n, i + 1) > mx(es, i - 2 * n, i - n);
  const nLL = mn(nq, i - n, i + 1) < mn(nq, i - 2 * n, i - n);
  const eLL = mn(es, i - n, i + 1) < mn(es, i - 2 * n, i - n);
  if (nHH !== eHH && sens === 'LONG') return true;     // divergence baissière
  if (nLL !== eLL && sens === 'SHORT') return true;    // divergence haussière
  return false;
}

// ------------------------------------------------------------- la marche ----
function backtest(cs, es, hs) {
  const piv = pivots(cs, PIVOTS);
  const gs = gaps(cs);
  const atr = atrSerie(cs, 14);
  const { veille, asia, lon } = poolsParJour(cs, hs);

  const trades = [];
  let enPos = null;

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

      if (toucheSL && toucheTP) {                       // indécidable dans la bougie
        enPos.sortie = 'ambigu'; enPos.r = enPos.beFait ? 0 : -1;
      } else if (toucheSL) {
        enPos.sortie = enPos.beFait ? 'break-even' : 'perte';
        enPos.r = enPos.beFait ? 0 : -1;
      } else if (toucheTP) {
        enPos.sortie = 'gain'; enPos.r = enPos.rr;
      } else {
        if (toucheBE && !enPos.beFait) { enPos.beFait = true; enPos.sl = enPos.entree; }  // stop à l'entrée au 1:1
        if (i - enPos.iEntree > 200) { enPos.sortie = 'expiré'; enPos.r = enPos.beFait ? 0 : -0.5; }
      }
      if (enPos.sortie) { enPos.iSortie = i; enPos.duree = i - enPos.iEntree; trades.push(enPos); enPos = null; }
      else continue;                                    // un seul trade à la fois
    }

    // ---- 2. recherche d'un nouveau setup ---------------------------------
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

    // ---- 3. inversion SUR la bougie courante (CISD + displacement) --------
    const L = setup.sens === 'LONG';
    if (i <= setup.swing.i) continue;
    const corps = Math.abs(cs[i].c - cs[i].o);
    if (!atr[i] || corps <= atr[i] * DISP) continue;             // displacement
    let ext = cs[i - 1].o;
    for (let k = Math.max(0, i - 5); k < i; k++) ext = L ? Math.max(ext, cs[k].o) : Math.min(ext, cs[k].o);
    const inv = L ? (cs[i].c > ext && cs[i].c > cs[i].o) : (cs[i].c < ext && cs[i].c < cs[i].o);
    if (!inv) continue;

    if (smtContre(cs, es, i, 20, setup.sens)) continue;          // SMT éliminatoire

    // ---- 4. niveaux ------------------------------------------------------
    const entree = cs[i].c;
    const buf = entree * BUF / 100;
    let bas = cs[i].l, haut = cs[i].h;
    for (let k = Math.max(0, i - 2); k <= i; k++) { bas = Math.min(bas, cs[k].l); haut = Math.max(haut, cs[k].h); }
    let sl = L ? bas - buf : haut + buf;
    let src = "structure de l'inversion";
    if (Math.abs(entree - sl) < atr[i] * ATRMIN) {                // trop serré -> on recule au balayage
      sl = L ? setup.swing.prix - buf : setup.swing.prix + buf; src = 'balayage';
    }
    // cible : un gap NON COMBLÉ À CET INSTANT, au-delà de l'entrée
    let tp = null;
    gs.forEach(g => {
      if (g.ne > i) return;                       // pas encore né
      if (g.comble != null && g.comble <= i) return;  // déjà comblé
      if (L ? g.eq <= entree : g.eq >= entree) return;
      if (tp == null || (L ? g.eq < tp : g.eq > tp)) tp = g.eq;
    });
    if (tp == null) continue;

    const risque = Math.abs(entree - sl);
    if (!(risque > 0) || risque < atr[i] * ATRMIN) continue;
    const rr = Math.abs(tp - entree) / risque;
    if (rr < RRMIN) continue;

    enPos = { sens: setup.sens, iEntree: i, t: cs[i].t, entree, sl, slInit: sl, tp, rr,
              be: L ? entree + risque : entree - risque, beFait: false,
              pool: setup.pool[1], src, jour: j, paris: hs[i].paris,
              creneau: hs[i].paris < 17 * 60 ? 'après-midi' : 'soirée' };
  }
  return trades;
}

// ------------------------------------------------------------- le rapport --
function pct(n, d) { return d ? (n / d * 100).toFixed(1) + ' %' : '—'; }

function rapport(trades, cs, TFnom) {
  const n = trades.length;
  console.log('\n' + '='.repeat(74));
  console.log(`  BACKTEST MECH MODEL — ${SYM} en ${TFnom} · ${cs.length} bougies`);
  console.log(`  du ${new Date(cs[0].t).toISOString().slice(0, 10)} au ${new Date(cs[cs.length - 1].t).toISOString().slice(0, 10)}`);
  console.log('='.repeat(74));
  if (!n) { console.log('\n  Aucun trade déclenché sur la période.\n'); return; }

  const gains = trades.filter(t => t.sortie === 'gain');
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

(async () => {
  if (!QUIET) console.log(`Récupération ${SYM} et ${CORR} en ${TF} sur ${RANGE}…`);
  const [nq, es] = await Promise.all([
    fetchCandles(SYM, TF, RANGE),
    fetchCandles(CORR, TF, RANGE).catch(() => null)
  ]);
  if (!nq || nq.length < 100) throw new Error('pas assez de bougies');
  if (!QUIET) console.log(`  ${nq.length} bougies ${SYM}` + (es ? `, ${es.length} bougies ${CORR} (SMT active)` : ', pas de SMT'));
  const hs = horaires(nq);
  const trades = backtest(nq, es, hs);
  if (QUIET) {
    const g = trades.filter(t => t.sortie === 'gain').length;
    const p = trades.filter(t => t.sortie === 'perte' || t.sortie === 'ambigu').length;
    const b = trades.filter(t => t.sortie === 'break-even').length;
    const R = trades.reduce((s, t) => s + t.r, 0);
    console.log(JSON.stringify({ tf: TF, disp: DISP, n: trades.length, gains: g, pertes: p, be: b,
      wr: trades.length ? +(g / trades.length * 100).toFixed(1) : 0,
      esperance: trades.length ? +(R / trades.length).toFixed(3) : 0, cumulR: +R.toFixed(1) }));
  } else rapport(trades, nq, TF);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
