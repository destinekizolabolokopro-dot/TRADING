#!/usr/bin/env node
'use strict';
/**
 * Bot 1 — RADAR ZONES (H4 + D1)
 * Détecte FVG, Order Block, Breaker, OTE, liquidité, structure, MSS et le cycle
 * de marché (Accumulation → Manipulation → Expansion → Distribution) sur bougies
 * clôturées, pour BTC/ETH/SOL + DXY, et notifie Discord.
 *   DISCORD_WEBHOOK_ZONES="…" node scripts/bot_zones.js      (--dry pour tester)
 */
const C = require('./lib/ict_core');

const PAIRS = [...C.CRYPTO, C.DXY];
const TFS = [C.TF.D1, C.TF.H4];
const WEBHOOK = process.env.DISCORD_WEBHOOK_ZONES || '';
const DRY = process.argv.includes('--dry');

function block(a, tfName) {
  const L = [];
  L.push(`${C.PHASE_ICON[a.cyc.phase]} **Cycle : ${a.cyc.phase}** — ${a.cyc.note}`);
  L.push(`📐 Structure : ${a.struct.label}`);
  if (a.mss) L.push(`🔀 **MSS ${a.mss.dir}** — retour dans le FVG ${C.fmt(a.mss.fvgBottom)} – ${C.fmt(a.mss.fvgTop)} · stop ${C.fmt(a.mss.sl)}`);
  if (a.fvg) L.push(`▫️ FVG ${a.fvg.type} : ${C.fmt(a.fvg.bottom)} – ${C.fmt(a.fvg.top)}`);
  if (a.ob) L.push(`🧱 Order Block ${a.ob.type} : ${C.fmt(a.ob.bottom)} – ${C.fmt(a.ob.top)}`);
  if (a.breaker) L.push(`⚡ Breaker ${a.breaker.type} : ${C.fmt(a.breaker.bottom)} – ${C.fmt(a.breaker.top)}`);
  if (a.ote) L.push(`🎯 OTE ${a.ote.type} : ${C.fmt(a.ote.bottom)} – ${C.fmt(a.ote.top)}${a.ote.inside ? ' **(prix DEDANS)**' : ''}`);
  if (a.liq.length) L.push('💧 Liquidité : ' + a.liq.map((x) => `${x.kind} ~${C.fmt(x.price)}`).join(' · '));
  return { name: `⏱️ ${tfName} · prix ${C.fmt(a.price)}`, value: L.join('\n'), inline: false };
}

async function main() {
  const embeds = [];
  for (const p of PAIRS) {
    const fields = [];
    for (const tf of TFS) {
      try { fields.push(block(C.analyse(await C.getClosed(p, tf)), tf.name)); }
      catch (e) { console.error('Erreur', p.sym, tf.name, e.message); }
    }
    if (fields.length) embeds.push({ title: `📡 ${p.label}`, color: 0x2f6df0, fields });
  }
  await C.postDiscord(WEBHOOK, {
    username: 'Radar Zones',
    content: `📡 **Radar Zones — H4 + D1** · ${C.nowUTC()}\nPD Arrays sur bougies clôturées · *pédagogique, pas un conseil financier*`,
    embeds,
  }, DRY);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
