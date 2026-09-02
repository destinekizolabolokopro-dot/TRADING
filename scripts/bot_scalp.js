#!/usr/bin/env node
'use strict';
/**
 * Bot 2 — SIGNAUX INTRADAY (H1 · H4 · D1)
 * Mêmes détections que le Radar Zones, mais ne notifie une unité que si quelque
 * chose d'EXPLOITABLE est présent (MSS, FVG frais, OTE avec prix dedans,
 * manipulation/expansion) — sinon on ne spamme pas. Aucune unité sous H1 :
 * toute prise de position reste en HTF.
 *   DISCORD_WEBHOOK_SCALP="…" node scripts/bot_scalp.js      (--dry pour tester)
 */
const C = require('./lib/ict_core');

const PAIRS = [...C.CRYPTO, C.DXY];
const TFS = [C.TF.D1, C.TF.H4, C.TF.H1];
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
    ? `⚡ **Signaux intraday — H1/H4/D1** · ${C.nowUTC()}\nOpportunités HTF sur bougies clôturées · *pédagogique*`
    : `⚡ **Signaux intraday** · ${C.nowUTC()} — rien d'exploitable pour l'instant, on patiente.`;
  await C.postDiscord(WEBHOOK, { username: 'Signaux H1/H4/D1', content, embeds }, DRY);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
