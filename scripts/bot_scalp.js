#!/usr/bin/env node
'use strict';
/**
 * Bot 2 — SCALP (H1 · M30 · M15)
 * Mêmes détections que le Radar Zones mais sur les petites unités, pour le
 * scalping. Ne notifie une unité que si quelque chose d'exploitable est présent
 * (MSS, FVG frais, ou OTE avec prix dedans) — sinon on ne spamme pas.
 *   DISCORD_WEBHOOK_SCALP="…" node scripts/bot_scalp.js      (--dry pour tester)
 */
const C = require('./lib/ict_core');

const PAIRS = [...C.CRYPTO, C.DXY];
const TFS = [C.TF.H1, C.TF.M30, C.TF.M15];
const WEBHOOK = process.env.DISCORD_WEBHOOK_SCALP || '';
const DRY = process.argv.includes('--dry');

function interesting(a) { return a.mss || (a.ote && a.ote.inside) || a.cyc.phase === 'Manipulation' || a.cyc.phase === 'Expansion'; }

function block(a, tfName) {
  const L = [];
  L.push(`${C.PHASE_ICON[a.cyc.phase]} ${a.cyc.phase} · 📐 ${a.struct.label}`);
  if (a.mss) L.push(`🔀 **MSS ${a.mss.dir}** — FVG ${C.fmt(a.mss.fvgBottom)}–${C.fmt(a.mss.fvgTop)} · stop ${C.fmt(a.mss.sl)}`);
  if (a.fvg) L.push(`▫️ FVG ${a.fvg.type} : ${C.fmt(a.fvg.bottom)}–${C.fmt(a.fvg.top)}`);
  if (a.ote && a.ote.inside) L.push(`🎯 OTE ${a.ote.type} ${C.fmt(a.ote.bottom)}–${C.fmt(a.ote.top)} **(prix dedans)**`);
  if (a.ob) L.push(`🧱 OB ${a.ob.type} : ${C.fmt(a.ob.bottom)}–${C.fmt(a.ob.top)}`);
  return { name: `⏱️ ${tfName} · ${C.fmt(a.price)}`, value: L.join('\n'), inline: false };
}

async function main() {
  const embeds = [];
  for (const p of PAIRS) {
    const fields = [];
    for (const tf of TFS) {
      try { const a = C.analyse(await C.getClosed(p, tf)); if (interesting(a)) fields.push(block(a, tf.name)); }
      catch (e) { console.error('Erreur', p.sym, tf.name, e.message); }
    }
    if (fields.length) embeds.push({ title: `⚡ ${p.label}`, color: 0xe0791f, fields });
  }
  const content = embeds.length
    ? `⚡ **Scalp — H1/M30/M15** · ${C.nowUTC()}\nOpportunités court terme sur bougies clôturées · *pédagogique*`
    : `⚡ **Scalp** · ${C.nowUTC()} — rien d'exploitable pour l'instant, on patiente.`;
  await C.postDiscord(WEBHOOK, { username: 'Scalp', content, embeds }, DRY);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
