#!/usr/bin/env node
/**
 * Bot 1 — RADAR ZONES  (H4 + D1)
 * -----------------------------------------------------------------------------
 * Détecte les PD Arrays ICT sur bougies CLÔTURÉES (jamais la bougie en cours,
 * conformément à la règle « attendre la clôture ») et notifie Discord :
 *   • FVG (Fair Value Gap)        • Order Block
 *   • Breaker Block               • OTE (retracement Fibo 62–79 %)
 *   • Liquidité (equal highs/lows) • Structure (BOS / CHoCH)
 *   • CYCLE de marché : Accumulation → Manipulation → Expansion → Distribution
 *
 * Usage :
 *   DISCORD_WEBHOOK_ZONES="https://discord.com/api/webhooks/…" node scripts/bot_zones.js
 *   node scripts/bot_zones.js --dry     # test sans envoyer
 */

'use strict';

const PAIRS = [
  { sym: 'BTC', label: 'BTC/USD', source: 'kraken', kraken: 'XBTUSD' },
  { sym: 'ETH', label: 'ETH/USD', source: 'kraken', kraken: 'ETHUSD' },
  { sym: 'SOL', label: 'SOL/USD', source: 'kraken', kraken: 'SOLUSD' },
  { sym: 'DXY', label: 'DXY · Dollar Index', source: 'yahoo', yahoo: 'DX-Y.NYB' },
];
// Kraken n'a pas le DXY → on le prend chez Yahoo (gratuit, sans clé).
// H4 côté Yahoo : on récupère du H1 puis on agrège 4 bougies.
const TFS = [
  { name: 'D1', kraken: 1440, yahoo: { interval: '1d', range: '6mo' } },
  { name: 'H4', kraken: 240, yahoo: { interval: '1h', range: '1mo', agg: 4 } },
];
const WEBHOOK = process.env.DISCORD_WEBHOOK_ZONES || '';
const DRY = process.argv.includes('--dry');
const OTE_LOW = 0.62, OTE_HIGH = 0.79, EQ_TOL = 0.0015;

// Agrégation alignée à droite : chaque bougie agrégée est complète.
function aggregate(c, n) {
  const out = [], start = c.length % n;
  for (let i = start; i + n <= c.length; i += n) {
    const s = c.slice(i, i + n);
    out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[s.length - 1].c });
  }
  return out;
}

// --- Données : on ENLÈVE la dernière bougie (celle en cours) → clôturées seules
async function krakenClosed(pair, interval) {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
  const j = await (await fetch(url)).json();
  if (j.error && j.error.length) throw new Error(pair + ': ' + j.error.join(','));
  const key = Object.keys(j.result).find((k) => k !== 'last');
  const c = j.result[key].map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
  return c.slice(0, -1); // règle « clôture » : on retire la bougie non terminée
}
async function yahooClosed(sym, y) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${y.interval}&range=${y.range}`;
  const j = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  const r = j.chart.result[0], ts = r.timestamp, q = r.indicators.quote[0];
  let c = ts.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
    .filter((x) => x.o != null && x.h != null && x.l != null && x.c != null);
  c = c.slice(0, -1); // on retire la bougie en cours
  if (y.agg) c = aggregate(c, y.agg);
  return c;
}
function getClosed(pair, tf) {
  return pair.source === 'yahoo' ? yahooClosed(pair.yahoo, tf.yahoo) : krakenClosed(pair.kraken, tf.kraken);
}

// --- Swings (fractales 2 côtés) ---------------------------------------------
function swings(c) {
  const hi = [], lo = [];
  for (let i = 2; i < c.length - 2; i++) {
    if (c[i].h > c[i - 1].h && c[i].h > c[i - 2].h && c[i].h > c[i + 1].h && c[i].h > c[i + 2].h) hi.push({ i, p: c[i].h });
    if (c[i].l < c[i - 1].l && c[i].l < c[i - 2].l && c[i].l < c[i + 1].l && c[i].l < c[i + 2].l) lo.push({ i, p: c[i].l });
  }
  return { hi, lo };
}

// --- FVG (validé à la clôture) : le plus récent non comblé -------------------
function lastFVG(c) {
  for (let i = c.length - 2; i >= 1; i--) {
    const prev = c[i - 1], next = c[i + 1], last = c[c.length - 1];
    if (prev.h < next.l) { if (last.c > prev.h) return { type: 'haussier', bottom: prev.h, top: next.l }; }
    else if (prev.l > next.h) { if (last.c < prev.l) return { type: 'baissier', bottom: next.h, top: prev.l }; }
  }
  return null;
}

// --- Order Block : dernière bougie opposée avant l'impulsion qui casse -------
function lastOB(c) {
  for (let i = c.length - 3; i >= 1; i--) {
    const b = c[i], down = b.c < b.o, up = b.c > b.o;
    if (down && c[i + 1].c > b.h && c[i + 2].c >= c[i + 1].c) return { type: 'haussier', bottom: b.l, top: Math.max(b.o, b.c), i };
    if (up && c[i + 1].c < b.l && c[i + 2].c <= c[i + 1].c) return { type: 'baissier', bottom: Math.min(b.o, b.c), top: b.h, i };
  }
  return null;
}

// --- Breaker Block : un OB cassé/réclamé dans l'autre sens -------------------
function lastBreaker(c) {
  const last = c[c.length - 1].c;
  for (let i = c.length - 4; i >= 1; i--) {
    const b = c[i], down = b.c < b.o, up = b.c > b.o;
    // OB baissier réclamé à la hausse → breaker HAUSSIER (devient support)
    if (up && c[i + 1].c < b.l) {
      for (let k = i + 2; k < c.length; k++) if (c[k].c > b.h) return { type: 'haussier', bottom: Math.min(b.o, b.c), top: b.h };
    }
    // OB haussier cassé à la baisse → breaker BAISSIER (devient résistance)
    if (down && c[i + 1].c > b.h) {
      for (let k = i + 2; k < c.length; k++) if (c[k].c < b.l) return { type: 'baissier', bottom: b.l, top: Math.max(b.o, b.c) };
    }
  }
  return null;
}

// --- OTE : zone de retracement 62–79 % de la dernière jambe ------------------
function ote(c, s) {
  const price = c[c.length - 1].c;
  const lastHi = s.hi[s.hi.length - 1], lastLo = s.lo[s.lo.length - 1];
  if (!lastHi || !lastLo) return null;
  if (lastHi.i > lastLo.i) { // jambe haussière L→H : OTE d'achat en discount
    const H = lastHi.p, L = lastLo.p, span = H - L;
    const zLow = H - OTE_HIGH * span, zHigh = H - OTE_LOW * span;
    return { type: 'achat', bottom: zLow, top: zHigh, inside: price >= zLow && price <= zHigh };
  }
  const H = lastHi.p, L = lastLo.p, span = H - L; // jambe baissière H→L : OTE de vente en premium
  const zLow = L + OTE_LOW * span, zHigh = L + OTE_HIGH * span;
  return { type: 'vente', bottom: zLow, top: zHigh, inside: price >= zLow && price <= zHigh };
}

// --- Liquidité equal highs / lows -------------------------------------------
function liquidity(s) {
  const out = [];
  function scan(arr, kind) {
    for (let i = arr.length - 1; i >= 1; i--)
      for (let j = i - 1; j >= 0; j--) {
        const a = arr[i].p, b = arr[j].p;
        if (Math.abs(a - b) / ((a + b) / 2) <= EQ_TOL) { out.push({ kind, price: (a + b) / 2 }); return; }
      }
  }
  scan(s.hi, 'buyside (au-dessus)'); scan(s.lo, 'sellside (en-dessous)');
  return out;
}

// --- Structure BOS / CHoCH --------------------------------------------------
function structure(c, s) {
  const last = c[c.length - 1];
  const h = s.hi, l = s.lo;
  if (!h.length || !l.length) return { label: 'indéterminée', bias: 'neutre' };
  const up = h.length >= 2 && h[h.length - 1].p > h[h.length - 2].p && l.length >= 2 && l[l.length - 1].p > l[l.length - 2].p;
  const dn = h.length >= 2 && h[h.length - 1].p < h[h.length - 2].p && l.length >= 2 && l[l.length - 1].p < l[l.length - 2].p;
  if (last.c > h[h.length - 1].p) return { label: 'BOS haussier', bias: 'haussier' };
  if (last.c < l[l.length - 1].p) return { label: 'BOS baissier', bias: 'baissier' };
  if (up) return { label: 'structure haussière', bias: 'haussier' };
  if (dn) return { label: 'structure baissière', bias: 'baissier' };
  return { label: 'range', bias: 'neutre' };
}

// --- MSS : Market Structure Shift (cassure AVEC displacement + FVG) ----------
// Règle ICT : après un balayage de liquidité, une impulsion casse le dernier
// swing opposé et laisse un FVG → l'entrée se fait au retour dans ce FVG.
function mss(c, s) {
  const n = c.length, last = c[n - 1];
  const bodies = c.slice(-14).map((x) => Math.abs(x.c - x.o));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
  // FVG laissé par les 3 dernières bougies clôturées (displacement récent)
  const a = c[n - 3], b = c[n - 2], d = c[n - 1];
  const bigUp = b.c > b.o && Math.abs(b.c - b.o) > 1.5 * avgBody;
  const bigDn = b.c < b.o && Math.abs(b.c - b.o) > 1.5 * avgBody;
  const lastHi = s.hi[s.hi.length - 1], lastLo = s.lo[s.lo.length - 1];
  if (bigUp && a.h < d.l && lastHi && b.c > lastHi.p) // casse un sommet à la hausse + FVG
    return { dir: 'haussier', fvgBottom: a.h, fvgTop: d.l, sl: lastLo ? lastLo.p : a.l };
  if (bigDn && a.l > d.h && lastLo && b.c < lastLo.p) // casse un creux à la baisse + FVG
    return { dir: 'baissier', fvgBottom: d.h, fvgTop: a.l, sl: lastHi ? lastHi.p : a.h };
  return null;
}

// --- CYCLE : Accumulation → Manipulation → Expansion → Distribution ----------
function cycle(c, s) {
  const n = c.length, look = Math.min(12, n - 2);
  const win = c.slice(n - look);
  const hi = Math.max(...win.map((x) => x.h)), lo = Math.min(...win.map((x) => x.l));
  const price = c[n - 1].c, rangePct = (hi - lo) / price;
  const bodies = win.map((x) => Math.abs(x.c - x.o));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
  const last = c[n - 1], lastBody = Math.abs(last.c - last.o), lastRange = last.h - last.l;
  const pos = (price - lo) / (hi - lo || 1); // 0 = bas du range, 1 = haut

  // Manipulation = la dernière bougie balaie un swing puis referme à l'intérieur
  const lastHi = s.hi[s.hi.length - 1], lastLo = s.lo[s.lo.length - 1];
  const sweepUp = lastHi && last.h > lastHi.p && last.c < lastHi.p;
  const sweepDn = lastLo && last.l < lastLo.p && last.c > lastLo.p;
  if (sweepDn) return { phase: 'Manipulation', dir: 'bas', note: 'liquidité prise SOUS un creux, clôture au-dessus → piège baissier, pression HAUSSIÈRE probable' };
  if (sweepUp) return { phase: 'Manipulation', dir: 'haut', note: 'liquidité prise AU-DESSUS d\'un sommet, clôture en-dessous → piège haussier, pression BAISSIÈRE probable' };

  // Expansion = grosse bougie directionnelle qui sort du range
  if (lastBody > 1.6 * avgBody && lastBody > 0.55 * lastRange) {
    const dir = last.c > last.o ? 'HAUSSIÈRE' : 'BAISSIÈRE';
    return { phase: 'Expansion', dir: last.c > last.o ? 'haut' : 'bas', note: 'impulsion ' + dir + ' — le mouvement est lancé' };
  }
  // Accumulation / range serré
  if (rangePct < 0.035) return { phase: 'Accumulation', dir: null, note: 'range serré, faible volatilité → un mouvement se prépare' };
  // Distribution = calage en haut/bas de range après une jambe (essoufflement)
  if (pos > 0.8) return { phase: 'Distribution', dir: 'haut', note: 'calage en HAUT de range → risque de retournement baissier' };
  if (pos < 0.2) return { phase: 'Distribution', dir: 'bas', note: 'calage en BAS de range → risque de retournement haussier' };
  return { phase: 'Transition', dir: null, note: 'pas de phase nette' };
}

// --- Analyse d'une paire sur une TF -----------------------------------------
function analyse(c) {
  const s = swings(c);
  return {
    price: c[c.length - 1].c,
    fvg: lastFVG(c), ob: lastOB(c), breaker: lastBreaker(c),
    ote: ote(c, s), liq: liquidity(s), struct: structure(c, s), cyc: cycle(c, s), mss: mss(c, s),
  };
}

// --- Formatage Discord ------------------------------------------------------
function fmt(n) { return n == null ? '—' : (n >= 1000 ? Math.round(n) : +n.toFixed(n >= 10 ? 2 : 4)).toLocaleString('fr-FR'); }
const PHASE_ICON = { Accumulation: '🟦', Manipulation: '🟨', Expansion: '🟩', Distribution: '🟥', Transition: '⬜' };

function embedFor(pair, tfBlocks) {
  const fields = [];
  for (const b of tfBlocks) {
    const a = b.a, lines = [];
    lines.push(`${PHASE_ICON[a.cyc.phase]} **Cycle : ${a.cyc.phase}** — ${a.cyc.note}`);
    lines.push(`📐 Structure : ${a.struct.label}`);
    if (a.mss) lines.push(`🔀 **MSS ${a.mss.dir}** — entrée au retour dans le FVG ${fmt(a.mss.fvgBottom)} – ${fmt(a.mss.fvgTop)} · stop ${fmt(a.mss.sl)}`);
    if (a.fvg) lines.push(`▫️ FVG ${a.fvg.type} : ${fmt(a.fvg.bottom)} – ${fmt(a.fvg.top)}`);
    if (a.ob) lines.push(`🧱 Order Block ${a.ob.type} : ${fmt(a.ob.bottom)} – ${fmt(a.ob.top)}`);
    if (a.breaker) lines.push(`⚡ Breaker ${a.breaker.type} : ${fmt(a.breaker.bottom)} – ${fmt(a.breaker.top)}`);
    if (a.ote) lines.push(`🎯 OTE ${a.ote.type} : ${fmt(a.ote.bottom)} – ${fmt(a.ote.top)}${a.ote.inside ? ' **(prix DEDANS)**' : ''}`);
    if (a.liq.length) lines.push('💧 Liquidité : ' + a.liq.map((x) => `${x.kind} ~${fmt(x.price)}`).join(' · '));
    fields.push({ name: `⏱️ ${b.tf} · prix ${fmt(a.price)}`, value: lines.join('\n'), inline: false });
  }
  return { title: `📡 ${pair.label}`, color: 0x2f6df0, fields };
}

async function main() {
  const embeds = [];
  for (const p of PAIRS) {
    const blocks = [];
    for (const tf of TFS) {
      try { blocks.push({ tf: tf.name, a: analyse(await getClosed(p, tf)) }); }
      catch (e) { console.error('Erreur', p.sym, tf.name, e.message); }
    }
    if (blocks.length) embeds.push(embedFor(p, blocks));
  }
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
  const payload = {
    username: 'Radar Zones',
    content: `📡 **Radar Zones — H4 + D1** · ${now} UTC\nPD Arrays sur bougies clôturées · *pédagogique, pas un conseil financier*`,
    embeds,
  };

  if (DRY || !WEBHOOK) {
    console.log(JSON.stringify(payload, null, 2));
    if (!WEBHOOK && !DRY) console.error('\n⚠️  DISCORD_WEBHOOK_ZONES non défini — affichage seul.');
    return;
  }
  const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('Discord ' + res.status + ' ' + (await res.text()));
  console.log('✅ Radar Zones envoyé (' + embeds.length + ' paires).');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
