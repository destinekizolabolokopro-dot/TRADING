#!/usr/bin/env node
/**
 * TRADEassist → Discord
 * Récupère les vraies bougies (Kraken), applique la logique ICT/SMC
 * (biais Daily → structure H4 → FVG + premium/discount) et publie les
 * positions du jour dans un salon Discord via un webhook.
 *
 * Usage :
 *   DISCORD_WEBHOOK="https://discord.com/api/webhooks/…" node scripts/discord_signals.js
 *   node scripts/discord_signals.js --dry     # affiche le message sans l'envoyer
 *
 * Paires suivies : BTC, ETH, SOL (crypto, sans clé). Kraken est gratuit.
 */

'use strict';

const PAIRS = [
  { sym: 'BTC', kraken: 'XBTUSD', label: 'BTC / USD' },
  { sym: 'ETH', kraken: 'ETHUSD', label: 'ETH / USD' },
  { sym: 'SOL', kraken: 'SOLUSD', label: 'SOL / USD' },
];

const WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const DRY = process.argv.includes('--dry');

// --- Données -----------------------------------------------------------------
async function ohlc(pair, interval) {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.error && j.error.length) throw new Error(pair + ': ' + j.error.join(','));
  const key = Object.keys(j.result).find((k) => k !== 'last');
  return j.result[key].map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
}

// --- Analyse ICT/SMC ---------------------------------------------------------
function swings(c) {
  const hi = [], lo = [];
  for (let i = 2; i < c.length - 2; i++) {
    if (c[i].h > c[i - 1].h && c[i].h > c[i - 2].h && c[i].h > c[i + 1].h && c[i].h > c[i + 2].h) hi.push({ i, p: c[i].h });
    if (c[i].l < c[i - 1].l && c[i].l < c[i - 2].l && c[i].l < c[i + 1].l && c[i].l < c[i + 2].l) lo.push({ i, p: c[i].l });
  }
  return { hi, lo };
}
function bias(c) {
  const s = swings(c), lh = s.hi.slice(-2), ll = s.lo.slice(-2);
  const up = lh.length === 2 && lh[1].p > lh[0].p && ll.length === 2 && ll[1].p > ll[0].p;
  const dn = lh.length === 2 && lh[1].p < lh[0].p && ll.length === 2 && ll[1].p < ll[0].p;
  return up ? 'haussier' : dn ? 'baissier' : 'neutre';
}
function lastFvg(c, dir) {
  for (let i = c.length - 3; i >= 2; i--) {
    if (dir === 'LONG' && c[i].l > c[i - 2].h) { const bot = c[i - 2].h, top = c[i].l; if (c[c.length - 1].c > bot) return { bot, top }; }
    if (dir === 'SHORT' && c[i].h < c[i - 2].l) { const top = c[i - 2].l, bot = c[i].h; if (c[c.length - 1].c < top) return { bot, top }; }
  }
  return null;
}
function range(c) {
  const s = swings(c);
  const hi = Math.max(...s.hi.slice(-3).map((x) => x.p), ...c.slice(-20).map((x) => x.h));
  const lo = Math.min(...s.lo.slice(-3).map((x) => x.p), ...c.slice(-20).map((x) => x.l));
  return { hi, lo };
}
function round(n) { return n >= 1000 ? Math.round(n) : n >= 10 ? +n.toFixed(2) : +n.toFixed(4); }

async function analyse(p) {
  const [d1, h4, h1] = await Promise.all([ohlc(p.kraken, 1440), ohlc(p.kraken, 240), ohlc(p.kraken, 60)]);
  const price = h1[h1.length - 1].c;
  const bD = bias(d1), bH4 = bias(h4);
  const r = range(h4), eq = (r.hi + r.lo) / 2;
  const zone = price < eq ? 'discount' : 'premium';

  let dir = null;
  if (bD === 'haussier' && bH4 !== 'baissier') dir = 'LONG';
  else if (bD === 'baissier' && bH4 !== 'haussier') dir = 'SHORT';
  else if (bH4 === 'haussier') dir = 'LONG';
  else if (bH4 === 'baissier') dir = 'SHORT';

  const zoneOk = (dir === 'LONG' && zone === 'discount') || (dir === 'SHORT' && zone === 'premium');
  // Filtre qualité : on ne publie un trade que si la zone confirme le sens.
  if (!dir || !zoneOk) {
    return { p, price, dir: null, bD, bH4, zone, reason: !dir ? 'biais contradictoire' : 'zone ' + zone + ' contre le sens' };
  }
  const f = lastFvg(h4, dir);
  const entry = f ? (dir === 'LONG' ? f.top : f.bot) : eq;
  let sl, tp;
  if (dir === 'LONG') { sl = (f ? f.bot : r.lo) * 0.997; tp = r.hi; }
  else { sl = (f ? f.top : r.hi) * 1.003; tp = r.lo; }
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
  return {
    p, price, dir, bD, bH4, zone, fvg: !!f,
    entry: round(entry), sl: round(sl), tp: round(tp), rr: +rr.toFixed(1),
  };
}

// --- Formatage Discord (embeds) ----------------------------------------------
function fmt(n) { return n == null ? '—' : n.toLocaleString('fr-FR'); }
function embedFor(a) {
  if (!a.dir) {
    return {
      title: `⏸️ ${a.p.label} — On attend`,
      color: 0xc99a24,
      description: `Prix **${fmt(a.price)}** · pas de setup net (${a.reason}).\nMieux vaut zéro position qu'une mauvaise.`,
      fields: [{ name: 'Contexte', value: `D1 ${a.bD} · H4 ${a.bH4} · zone ${a.zone}`, inline: false }],
    };
  }
  const long = a.dir === 'LONG';
  return {
    title: `${long ? '🟢' : '🔴'} ${a.p.label} — ${long ? 'LONG' : 'SHORT'}`,
    color: long ? 0x1f9d5f : 0xd1435b,
    description: `Prix actuel **${fmt(a.price)}** · ordre **limite**${a.fvg ? ' · FVG H4' : ''}`,
    fields: [
      { name: 'Entrée', value: '`' + fmt(a.entry) + '`', inline: true },
      { name: 'Stop', value: '`' + fmt(a.sl) + '`', inline: true },
      { name: 'Objectif', value: '`' + fmt(a.tp) + '`', inline: true },
      { name: 'Ratio', value: `**${a.rr} R**`, inline: true },
      { name: 'Zone', value: a.zone + ' ✓', inline: true },
      { name: 'Biais', value: `D1 ${a.bD} · H4 ${a.bH4}`, inline: true },
    ],
  };
}

async function main() {
  const results = [];
  for (const p of PAIRS) {
    try { results.push(await analyse(p)); }
    catch (e) { console.error('Erreur', p.sym, e.message); }
  }
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'short' });
  const payload = {
    username: 'TRADEassist',
    content: `📊 **Brief de trading** — ${now} UTC\nDonnées réelles (Kraken) · analyse ICT/SMC · *idées pédagogiques, pas un conseil financier · risque max 1 %/trade*`,
    embeds: results.map(embedFor),
  };

  if (DRY || !WEBHOOK) {
    console.log(JSON.stringify(payload, null, 2));
    if (!WEBHOOK && !DRY) console.error('\n⚠️  DISCORD_WEBHOOK non défini — message non envoyé (affichage seul).');
    return;
  }
  const res = await fetch(WEBHOOK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Discord a répondu ' + res.status + ' ' + (await res.text()));
  console.log('✅ Positions envoyées sur Discord (' + results.length + ' paires).');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
