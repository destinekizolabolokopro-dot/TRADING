#!/usr/bin/env node
'use strict';
/**
 * Bot 3 — POSITION (timeframe alignment D1 → H4)
 * Méthode top-down ICT :
 *   1) BIAIS + POI en D1 (structure, FVG/OB, premium/discount)
 *   2) TIMING d'entrée en H4 (MSS ou FVG dans le sens du biais)
 *   3) Croise le contexte DXY (inversé pour les cryptos)
 *   4) APPREND de ses trades (taux de réussite, devient sélectif)
 *   DISCORD_WEBHOOK_POSITION="…" node scripts/bot_position.js   (--dry pour tester)
 */
const C = require('./lib/ict_core');
const L = require('./lib/learning');

const PAIRS = C.CRYPTO;
const WEBHOOK = process.env.DISCORD_WEBHOOK_POSITION || '';
const DRY = process.argv.includes('--dry');
const HIST = 'position_history';
const MIN_RR = 1; // ratio minimum demandé : 1 RR

// Contexte DXY : baissier = favorable au risque (cryptos), haussier = défavorable.
async function dxyContext() {
  try {
    const a = C.analyse(await C.getClosed(C.DXY, C.TF.D1));
    return { bias: a.struct.bias, price: a.price };
  } catch (e) { return null; }
}

function buildTrade(pair, d1, h4) {
  const dir = d1.struct.bias === 'haussier' ? 'LONG' : d1.struct.bias === 'baissier' ? 'SHORT' : null;
  if (!dir) return { pair, skip: 'biais D1 neutre (range)' };

  // Timing H4 dans le sens du biais D1
  let zone = null, sl = null, via = null;
  if (h4.mss && ((dir === 'LONG' && h4.mss.dir === 'haussier') || (dir === 'SHORT' && h4.mss.dir === 'baissier'))) {
    zone = [h4.mss.fvgBottom, h4.mss.fvgTop]; sl = h4.mss.sl; via = 'MSS H4';
  } else if (h4.fvg && ((dir === 'LONG' && h4.fvg.type === 'haussier') || (dir === 'SHORT' && h4.fvg.type === 'baissier'))) {
    zone = [h4.fvg.bottom, h4.fvg.top];
    sl = dir === 'LONG' ? (h4.range ? h4.range.lo : h4.fvg.bottom) : (h4.range ? h4.range.hi : h4.fvg.top);
    via = 'FVG H4';
  } else return { pair, skip: 'pas de timing H4 aligné (ni MSS ni FVG dans le sens)' };

  const entry = (zone[0] + zone[1]) / 2;
  const tp = dir === 'LONG' ? (d1.range ? d1.range.hi : entry * 1.05) : (d1.range ? d1.range.lo : entry * 0.95);
  const risk = Math.abs(entry - sl), rew = Math.abs(tp - entry);
  // Validité géométrique
  const ok = dir === 'LONG' ? (sl < entry && tp > entry) : (sl > entry && tp < entry);
  if (!ok || risk <= 0) return { pair, skip: 'géométrie invalide (SL/TP mal placés)' };
  const rr = rew / risk;
  if (rr < MIN_RR) return { pair, skip: `ratio trop faible (${rr.toFixed(1)}R < ${MIN_RR}R)` };

  // Premium/discount D1
  const zoneName = d1.range ? (entry < d1.range.eq ? 'discount' : 'premium') : '—';
  const zoneOk = (dir === 'LONG' && zoneName === 'discount') || (dir === 'SHORT' && zoneName === 'premium');
  return { pair, dir, via, entry, sl, tp, rr: +rr.toFixed(1), zoneName, zoneOk, zoneLow: zone[0], zoneHigh: zone[1], viaMSS: via === 'MSS H4' };
}

async function main() {
  let hist = L.load(HIST);
  const dxy = await dxyContext();

  const analysed = [];
  for (const p of PAIRS) {
    try {
      const d1 = C.analyse(await C.getClosed(p, C.TF.D1));
      const h4 = C.analyse(await C.getClosed(p, C.TF.H4));
      analysed.push({ p, t: buildTrade(p, d1, h4), price: h4.price });
    } catch (e) { console.error('Erreur', p.sym, e.message); }
  }

  // 1) Apprentissage : clôturer les trades en cours au prix courant
  const priceBySym = {}; analysed.forEach((x) => { priceBySym[x.p.sym] = x.price; });
  L.evaluate(hist, priceBySym);
  const st = L.stats(hist);
  const learn = L.factor(st, 'position');

  // 2) Nouveaux trades (filtrés par l'apprentissage)
  const embeds = [];
  for (const x of analysed) {
    const t = x.t;
    if (t.skip) { embeds.push({ title: `⏸️ ${t.pair.label}`, color: 0x8a8a8a, description: `On attend — ${t.skip}` }); continue; }
    // contexte DXY (inverse pour cryptos)
    let dxyNote = 'DXY indisponible', dxyFav = false;
    if (dxy) {
      dxyFav = (t.dir === 'LONG' && dxy.bias === 'baissier') || (t.dir === 'SHORT' && dxy.bias === 'haussier');
      dxyNote = `DXY ${dxy.bias} (${C.fmt(dxy.price)}) → ${dxyFav ? '✅ favorable' : dxy.bias === 'neutre' ? '➖ neutre' : '⚠️ à contre-courant'}`;
    }
    // Barre de progression du setup (0 → 100 = validé, à prendre)
    const price = x.price, inZone = price >= Math.min(t.zoneLow, t.zoneHigh) && price <= Math.max(t.zoneLow, t.zoneHigh);
    let val = 50 + (t.zoneOk ? 15 : 0) + (t.viaMSS ? 15 : 5) + (dxyFav ? 10 : 0) + (inZone ? 15 : 0);
    val = Math.min(100, val);
    const long = t.dir === 'LONG';
    const flag = learn.phase === 'évite' ? '\n🧠 *Le bot ÉVITE ce type de setup (taux ' + learn.rate + '% sur ' + learn.n + ' trades) — signal donné à titre indicatif.*' : '';
    const real = learn.n >= L.MIN_SAMPLE;
    const rate = real ? learn.rate : C.estRate(val);
    embeds.push({
      title: `${long ? '🟢' : '🔴'} ${t.pair.label} — ${t.dir}`,
      color: long ? 0x1f9d5f : 0xd1435b,
      description: `Timing via **${t.via}** · zone D1 **${t.zoneName}** ${t.zoneOk ? '✓' : '⚠️'}${inZone ? ' · prix DANS la zone' : ' · en attente du retour en zone'}\n${dxyNote}${flag}`,
      fields: C.tradeFields(t, val, rate, real),
    });
    // mémoriser le trade (si pas déjà ouvert et si le bot ne l'évite pas)
    if (learn.phase !== 'évite' && !L.alreadyOpen(hist, t.pair.sym, 'position', t.dir)) {
      hist.push({ ts: Date.now(), symbol: t.pair.sym, setup: 'position', direction: t.dir, entry: t.entry, sl: t.sl, tp: t.tp, status: 'open', result: null, r: null });
    }
  }
  L.save(HIST, hist);

  const b = L.bilan(hist);
  const bilanLine = b.total ? `📊 Bilan appris : ${b.wins}/${b.total} gagnés (${b.rate}%) · ${b.rsum >= 0 ? '+' : ''}${b.rsum}R · ${b.open} en cours` : `📊 Bilan : premiers trades en cours (${b.open} ouverts)`;
  await C.postDiscord(WEBHOOK, {
    username: 'Position (D1→H4)',
    content: `🎯 **Position — alignement D1 → H4** · ${C.nowUTC()}\n${bilanLine}\n*pédagogique, pas un conseil financier · risque max 1 %/trade*`,
    embeds,
  }, DRY);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
