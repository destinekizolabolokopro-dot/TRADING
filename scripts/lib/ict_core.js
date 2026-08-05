'use strict';
/**
 * Cœur commun ICT/SMC — partagé par tous les bots (Radar, Scalp, Position, Auto).
 * Données réelles (Kraken crypto + Yahoo pour DXY/forex/or, sans clé).
 * Toutes les détections travaillent sur bougies CLÔTURÉES (règle « attendre la clôture »).
 */

const OTE_LOW = 0.62, OTE_HIGH = 0.79, EQ_TOL = 0.0015;

// --- Unités de temps ---------------------------------------------------------
const TF = {
  D1: { name: 'D1', kraken: 1440, yahoo: { interval: '1d', range: '6mo' } },
  H4: { name: 'H4', kraken: 240, yahoo: { interval: '1h', range: '1mo', agg: 4 } },
  H1: { name: 'H1', kraken: 60, yahoo: { interval: '1h', range: '1mo' } },
  M30: { name: 'M30', kraken: 30, yahoo: { interval: '30m', range: '5d' } },
  M15: { name: 'M15', kraken: 15, yahoo: { interval: '15m', range: '5d' } },
};

// --- Instruments -------------------------------------------------------------
const CRYPTO = [
  { sym: 'BTC', label: 'BTC/USD', source: 'kraken', kraken: 'XBTUSD', yahoo: 'BTC-USD' },
  { sym: 'ETH', label: 'ETH/USD', source: 'kraken', kraken: 'ETHUSD', yahoo: 'ETH-USD' },
  { sym: 'SOL', label: 'SOL/USD', source: 'kraken', kraken: 'SOLUSD', yahoo: 'SOL-USD' },
];
const DXY = { sym: 'DXY', label: 'DXY · Dollar Index', source: 'yahoo', yahoo: 'DX-Y.NYB' };

// --- Données -----------------------------------------------------------------
function aggregate(c, n) {
  const out = [], start = c.length % n;
  for (let i = start; i + n <= c.length; i += n) {
    const s = c.slice(i, i + n);
    out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[s.length - 1].c });
  }
  return out;
}
async function krakenClosed(pair, interval) {
  const j = await (await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`)).json();
  if (j.error && j.error.length) throw new Error(pair + ': ' + j.error.join(','));
  const key = Object.keys(j.result).find((k) => k !== 'last');
  return j.result[key].map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] })).slice(0, -1);
}
async function yahooClosed(sym, y) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${y.interval}&range=${y.range}`;
  const j = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  const r = j.chart.result[0], ts = r.timestamp, q = r.indicators.quote[0];
  let c = ts.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
    .filter((x) => x.o != null && x.h != null && x.l != null && x.c != null).slice(0, -1);
  return y.agg ? aggregate(c, y.agg) : c;
}
function getClosed(pair, tf) {
  return pair.source === 'yahoo' ? yahooClosed(pair.yahoo, tf.yahoo) : krakenClosed(pair.kraken, tf.kraken);
}

// --- Détections --------------------------------------------------------------
function swings(c) {
  const hi = [], lo = [];
  for (let i = 2; i < c.length - 2; i++) {
    if (c[i].h > c[i - 1].h && c[i].h > c[i - 2].h && c[i].h > c[i + 1].h && c[i].h > c[i + 2].h) hi.push({ i, p: c[i].h });
    if (c[i].l < c[i - 1].l && c[i].l < c[i - 2].l && c[i].l < c[i + 1].l && c[i].l < c[i + 2].l) lo.push({ i, p: c[i].l });
  }
  return { hi, lo };
}
function lastFVG(c) {
  for (let i = c.length - 2; i >= 1; i--) {
    const prev = c[i - 1], next = c[i + 1], last = c[c.length - 1];
    if (prev.h < next.l) { if (last.c > prev.h) return { type: 'haussier', bottom: prev.h, top: next.l }; }
    else if (prev.l > next.h) { if (last.c < prev.l) return { type: 'baissier', bottom: next.h, top: prev.l }; }
  }
  return null;
}
function lastOB(c) {
  for (let i = c.length - 3; i >= 1; i--) {
    const b = c[i], down = b.c < b.o, up = b.c > b.o;
    if (down && c[i + 1].c > b.h && c[i + 2].c >= c[i + 1].c) return { type: 'haussier', bottom: b.l, top: Math.max(b.o, b.c) };
    if (up && c[i + 1].c < b.l && c[i + 2].c <= c[i + 1].c) return { type: 'baissier', bottom: Math.min(b.o, b.c), top: b.h };
  }
  return null;
}
function lastBreaker(c) {
  for (let i = c.length - 4; i >= 1; i--) {
    const b = c[i], down = b.c < b.o, up = b.c > b.o;
    if (up && c[i + 1].c < b.l) for (let k = i + 2; k < c.length; k++) if (c[k].c > b.h) return { type: 'haussier', bottom: Math.min(b.o, b.c), top: b.h };
    if (down && c[i + 1].c > b.h) for (let k = i + 2; k < c.length; k++) if (c[k].c < b.l) return { type: 'baissier', bottom: b.l, top: Math.max(b.o, b.c) };
  }
  return null;
}
function ote(c, s) {
  const price = c[c.length - 1].c, lastHi = s.hi[s.hi.length - 1], lastLo = s.lo[s.lo.length - 1];
  if (!lastHi || !lastLo) return null;
  const H = lastHi.p, L = lastLo.p, span = H - L;
  if (lastHi.i > lastLo.i) { const zLow = H - OTE_HIGH * span, zHigh = H - OTE_LOW * span; return { type: 'achat', bottom: zLow, top: zHigh, inside: price >= zLow && price <= zHigh }; }
  const zLow = L + OTE_LOW * span, zHigh = L + OTE_HIGH * span; return { type: 'vente', bottom: zLow, top: zHigh, inside: price >= zLow && price <= zHigh };
}
function liquidity(s) {
  const out = [];
  function scan(arr, kind) {
    for (let i = arr.length - 1; i >= 1; i--) for (let j = i - 1; j >= 0; j--) {
      const a = arr[i].p, b = arr[j].p;
      if (Math.abs(a - b) / ((a + b) / 2) <= EQ_TOL) { out.push({ kind, price: (a + b) / 2 }); return; }
    }
  }
  scan(s.hi, 'buyside'); scan(s.lo, 'sellside'); return out;
}
function structure(c, s) {
  const last = c[c.length - 1], h = s.hi, l = s.lo;
  if (!h.length || !l.length) return { label: 'indéterminée', bias: 'neutre' };
  const up = h.length >= 2 && h[h.length - 1].p > h[h.length - 2].p && l.length >= 2 && l[l.length - 1].p > l[l.length - 2].p;
  const dn = h.length >= 2 && h[h.length - 1].p < h[h.length - 2].p && l.length >= 2 && l[l.length - 1].p < l[l.length - 2].p;
  if (last.c > h[h.length - 1].p) return { label: 'BOS haussier', bias: 'haussier' };
  if (last.c < l[l.length - 1].p) return { label: 'BOS baissier', bias: 'baissier' };
  if (up) return { label: 'structure haussière', bias: 'haussier' };
  if (dn) return { label: 'structure baissière', bias: 'baissier' };
  return { label: 'range', bias: 'neutre' };
}
function mss(c, s) {
  const n = c.length;
  const bodies = c.slice(-14).map((x) => Math.abs(x.c - x.o));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
  const a = c[n - 3], b = c[n - 2], d = c[n - 1];
  const bigUp = b.c > b.o && Math.abs(b.c - b.o) > 1.5 * avgBody;
  const bigDn = b.c < b.o && Math.abs(b.c - b.o) > 1.5 * avgBody;
  const lastHi = s.hi[s.hi.length - 1], lastLo = s.lo[s.lo.length - 1];
  if (bigUp && a.h < d.l && lastHi && b.c > lastHi.p) return { dir: 'haussier', fvgBottom: a.h, fvgTop: d.l, sl: lastLo ? lastLo.p : a.l };
  if (bigDn && a.l > d.h && lastLo && b.c < lastLo.p) return { dir: 'baissier', fvgBottom: d.h, fvgTop: a.l, sl: lastHi ? lastHi.p : a.h };
  return null;
}
function cycle(c, s) {
  const n = c.length, look = Math.min(12, n - 2), win = c.slice(n - look);
  const hi = Math.max(...win.map((x) => x.h)), lo = Math.min(...win.map((x) => x.l));
  const price = c[n - 1].c, rangePct = (hi - lo) / price;
  const avgBody = win.map((x) => Math.abs(x.c - x.o)).reduce((a, b) => a + b, 0) / win.length;
  const last = c[n - 1], lastBody = Math.abs(last.c - last.o), lastRange = last.h - last.l, pos = (price - lo) / (hi - lo || 1);
  const lastHi = s.hi[s.hi.length - 1], lastLo = s.lo[s.lo.length - 1];
  if (lastLo && last.l < lastLo.p && last.c > lastLo.p) return { phase: 'Manipulation', note: 'liquidité prise SOUS un creux, clôture au-dessus → piège baissier, pression HAUSSIÈRE probable' };
  if (lastHi && last.h > lastHi.p && last.c < lastHi.p) return { phase: 'Manipulation', note: 'liquidité prise AU-DESSUS d\'un sommet, clôture en-dessous → piège haussier, pression BAISSIÈRE probable' };
  if (lastBody > 1.6 * avgBody && lastBody > 0.55 * lastRange) return { phase: 'Expansion', note: 'impulsion ' + (last.c > last.o ? 'HAUSSIÈRE' : 'BAISSIÈRE') + ' — le mouvement est lancé' };
  if (rangePct < 0.035) return { phase: 'Accumulation', note: 'range serré, faible volatilité → un mouvement se prépare' };
  if (pos > 0.8) return { phase: 'Distribution', note: 'calage en HAUT de range → risque de retournement baissier' };
  if (pos < 0.2) return { phase: 'Distribution', note: 'calage en BAS de range → risque de retournement haussier' };
  return { phase: 'Transition', note: 'pas de phase nette' };
}
function dealingRange(s) {
  const lastHi = s.hi[s.hi.length - 1], lastLo = s.lo[s.lo.length - 1];
  if (!lastHi || !lastLo) return null;
  return { hi: lastHi.p, lo: lastLo.p, eq: (lastHi.p + lastLo.p) / 2 };
}
function analyse(c) {
  const s = swings(c);
  return {
    candles: c, swings: s, price: c[c.length - 1].c,
    fvg: lastFVG(c), ob: lastOB(c), breaker: lastBreaker(c), ote: ote(c, s),
    liq: liquidity(s), struct: structure(c, s), cyc: cycle(c, s), mss: mss(c, s), range: dealingRange(s),
  };
}

// --- Utilitaires -------------------------------------------------------------
function fmt(n) { return n == null ? '—' : (Math.abs(n) >= 1000 ? Math.round(n) : +n.toFixed(Math.abs(n) >= 10 ? 2 : 4)).toLocaleString('fr-FR'); }
const PHASE_ICON = { Accumulation: '🟦', Manipulation: '🟨', Expansion: '🟩', Distribution: '🟥', Transition: '⬜' };

async function postDiscord(webhook, payload, dry) {
  if (dry || !webhook) {
    console.log(JSON.stringify(payload, null, 2));
    if (!webhook && !dry) console.error('\n⚠️  Webhook non défini — affichage seul (aucun envoi).');
    return;
  }
  const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('Discord ' + res.status + ' ' + (await res.text()));
  console.log('✅ Envoyé sur Discord.');
}
function nowUTC() { return new Date().toLocaleString('fr-FR', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC'; }

// --- Métriques d'un trade (barre, réussite, gains) ---------------------------
// Barre de progression : 0 % = setup naissant, 100 % = validé, à prendre maintenant.
function bar(pct, len) {
  len = len || 12; const f = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
  return '█'.repeat(f) + '░'.repeat(len - f) + '  ' + Math.round(pct) + '%';
}
function money(n) { return Math.round(n).toLocaleString('fr-FR') + ' €'; }
// Gain/perte potentiels si on risque `riskPct` % d'un compte (défaut 1 % de 10 000 €).
function potential(rr, account, riskPct) {
  account = account || 10000; riskPct = riskPct == null ? 1 : riskPct;
  const risk = account * riskPct / 100;
  return { risk, gain: risk * rr };
}
// Champs Discord communs aux trades (Position & Auto), pour un rendu identique.
function tradeFields(t, validationPct, successRate, successReal, account) {
  account = account || 10000;
  const p = potential(t.rr, account);
  return [
    { name: '📈 Progression du setup', value: bar(validationPct) + (validationPct >= 100 ? '  ✅ à prendre' : ''), inline: false },
    { name: 'Entrée', value: '`' + fmt(t.entry) + '`', inline: true },
    { name: 'Stop', value: '`' + fmt(t.sl) + '`', inline: true },
    { name: 'Objectif', value: '`' + fmt(t.tp) + '`', inline: true },
    { name: 'Ratio', value: '**' + t.rr + ' R**', inline: true },
    { name: 'Réussite ' + (successReal ? '(historique)' : '(estimée)'), value: successRate + ' %', inline: true },
    { name: 'Sur ' + money(account) + ' (risque 1 %)', value: '✅ +' + money(p.gain) + '  /  ❌ −' + money(p.risk), inline: true },
  ];
}
// Estimation prudente d'un % de réussite à partir de la maturité du setup.
function estRate(validationPct) { return Math.max(30, Math.min(85, Math.round(validationPct * 0.8))); }

module.exports = {
  TF, CRYPTO, DXY, OTE_LOW, OTE_HIGH,
  getClosed, aggregate, swings, lastFVG, lastOB, lastBreaker, ote, liquidity, structure, mss, cycle, dealingRange, analyse,
  fmt, PHASE_ICON, postDiscord, nowUTC,
  bar, money, potential, tradeFields, estRate,
};
