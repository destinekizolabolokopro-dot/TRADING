#!/usr/bin/env node
'use strict';
/**
 * Bot 4 — AUTONOME (D1)
 * Travaille seul en Daily : note chaque paire par CONFLUENCE (structure, FVG, OB,
 * OTE, MSS, premium/discount, contexte DXY), et envoie ses meilleurs trades.
 * Apprend de ses résultats et devient sélectif.
 *   DISCORD_WEBHOOK_AUTO="…" node scripts/bot_auto.js          (--dry pour tester)
 */
const C = require('./lib/ict_core');
const L = require('./lib/learning');

const PAIRS = C.CRYPTO;
const WEBHOOK = process.env.DISCORD_WEBHOOK_AUTO || '';
const DRY = process.argv.includes('--dry');
const HIST = 'auto_history';
const MIN_CONF = 55, MIN_RR = 1; // ratio minimum demandé : 1 RR

function score(a, dxyBias) {
  const dir = a.struct.bias === 'haussier' ? 'LONG' : a.struct.bias === 'baissier' ? 'SHORT' : null;
  if (!dir) return { dir: null };
  const long = dir === 'LONG';
  const zoneName = a.range ? (a.price < a.range.eq ? 'discount' : 'premium') : '—';
  let pct = 40; const why = [`structure ${a.struct.label}`];
  if ((long && zoneName === 'discount') || (!long && zoneName === 'premium')) { pct += 15; why.push('zone ' + zoneName); }
  if (a.fvg && a.fvg.type === a.struct.bias) { pct += 12; why.push('FVG D1'); }
  if (a.ob && a.ob.type === a.struct.bias) { pct += 10; why.push('OB D1'); }
  if (a.ote && a.ote.inside && ((long && a.ote.type === 'achat') || (!long && a.ote.type === 'vente'))) { pct += 10; why.push('OTE dedans'); }
  if (a.mss && a.mss.dir === a.struct.bias) { pct += 13; why.push('MSS'); }
  if (a.cyc.phase === 'Expansion' || a.cyc.phase === 'Accumulation') { pct += 5; why.push(a.cyc.phase.toLowerCase()); }
  const fav = (long && dxyBias === 'baissier') || (!long && dxyBias === 'haussier');
  if (fav) { pct += 10; why.push('DXY favorable'); }
  else if (dxyBias && dxyBias !== 'neutre') { pct -= 8; why.push('DXY à contre-courant'); }
  return { dir, pct: Math.max(0, Math.min(100, pct)), zoneName, why };
}

function trade(a, dir) {
  const long = dir === 'LONG';
  // POI aligné (FVG puis OB) → stop SERRÉ juste au-delà, cible sur la liquidité (extrême de range).
  let poi = null;
  if (a.fvg && a.fvg.type === a.struct.bias) poi = [a.fvg.bottom, a.fvg.top];
  else if (a.ob && a.ob.type === a.struct.bias) poi = [a.ob.bottom, a.ob.top];
  if (!poi || !a.range) return null; // pas de POI aligné → pas de trade
  const entry = (poi[0] + poi[1]) / 2;
  const span = Math.abs(poi[1] - poi[0]) || a.price * 0.0015;
  const sl = long ? poi[0] - span * 0.6 : poi[1] + span * 0.6;
  const tp = long ? a.range.hi : a.range.lo;
  const risk = Math.abs(entry - sl), rew = Math.abs(tp - entry);
  const ok = long ? (sl < entry && tp > entry) : (sl > entry && tp < entry);
  if (!ok || risk <= 0) return null;
  return { entry, sl, tp, rr: +(rew / risk).toFixed(1) };
}

async function main() {
  let hist = L.load(HIST);
  let dxyBias = null, dxyPrice = null;
  try { const d = C.analyse(await C.getClosed(C.DXY, C.TF.D1)); dxyBias = d.struct.bias; dxyPrice = d.price; } catch (e) {}

  const rows = [];
  for (const p of PAIRS) {
    try {
      const a = C.analyse(await C.getClosed(p, C.TF.D1));
      const s = score(a, dxyBias);
      rows.push({ p, a, s, price: a.price });
    } catch (e) { console.error('Erreur', p.sym, e.message); }
  }

  // Apprentissage : clôturer au prix courant + stats
  const priceBySym = {}; rows.forEach((r) => { priceBySym[r.p.sym] = r.price; });
  L.evaluate(hist, priceBySym);
  const learn = L.factor(L.stats(hist), 'auto');

  const picks = rows.filter((r) => r.s.dir && r.s.pct >= MIN_CONF).sort((a, b) => b.s.pct - a.s.pct);
  const embeds = [];
  for (const r of picks) {
    const t = trade(r.a, r.s.dir);
    if (!t || t.rr < MIN_RR) continue;
    const long = r.s.dir === 'LONG';
    const flag = learn.phase === 'évite' ? `\n🧠 *Le bot ÉVITE ce profil (taux ${learn.rate}% sur ${learn.n}) — indicatif.*` : '';
    const real = learn.n >= L.MIN_SAMPLE;
    const rate = real ? learn.rate : C.estRate(r.s.pct);
    embeds.push({
      title: `${long ? '🟢' : '🔴'} ${r.p.label} — ${r.s.dir}`,
      color: long ? 0x1f9d5f : 0xd1435b,
      description: `Pourquoi : ${r.s.why.join(' · ')}${flag}`,
      fields: C.tradeFields(t, r.s.pct, rate, real),
    });
    if (learn.phase !== 'évite' && !L.alreadyOpen(hist, r.p.sym, 'auto', r.s.dir)) {
      hist.push({ ts: Date.now(), symbol: r.p.sym, setup: 'auto', direction: r.s.dir, entry: t.entry, sl: t.sl, tp: t.tp, status: 'open', result: null, r: null });
    }
  }
  L.save(HIST, hist);

  const b = L.bilan(hist);
  const bilanLine = b.total ? `📊 Bilan appris : ${b.wins}/${b.total} (${b.rate}%) · ${b.rsum >= 0 ? '+' : ''}${b.rsum}R · ${b.open} en cours` : `📊 Bilan : premiers trades (${b.open} en cours)`;
  const dxyLine = dxyBias ? `DXY ${dxyBias} (${C.fmt(dxyPrice)})` : 'DXY indisponible';
  const content = embeds.length
    ? `🤖 **Bot Autonome — D1** · ${C.nowUTC()}\n${bilanLine} · ${dxyLine}\n*pédagogique, pas un conseil financier · risque max 1 %/trade*`
    : `🤖 **Bot Autonome — D1** · ${C.nowUTC()}\n${bilanLine} · ${dxyLine}\nAucune confluence ≥ ${MIN_CONF}% aujourd'hui — le bot reste à l'écart.`;
  await C.postDiscord(WEBHOOK, { username: 'Bot Autonome', content, embeds }, DRY);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
