#!/usr/bin/env node
'use strict';
/**
 * Bot 5 — NEWS ÉCO (calendrier économique)
 * Récupère les annonces économiques à venir (TradingView, gratuit) et les publie
 * sur Discord : date, heure (UTC), pays, importance, prévision / précédent.
 * Par défaut : les 7 prochains jours, importance moyenne/haute.
 *   DISCORD_WEBHOOK_NEWS="…" node scripts/bot_calendar.js [--days 30] [--all] [--dry]
 */
const C = require('./lib/ict_core');

const WEBHOOK = process.env.DISCORD_WEBHOOK_NEWS || '';
const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--all'); // inclure l'importance faible
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg > -1 ? parseInt(process.argv[daysArg + 1], 10) || 7 : 7;
const COUNTRIES = 'US,EU,GB,JP,CA,CH,AU'; // devises majeures
const FLAG = { US: '🇺🇸', EU: '🇪🇺', GB: '🇬🇧', JP: '🇯🇵', CA: '🇨🇦', CH: '🇨🇭', AU: '🇦🇺' };
const IMP = { 1: '🔴 haute', 0: '🟠 moyenne', '-1': '🟡 faible' };

async function events() {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + DAYS * 86400000).toISOString();
  const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${COUNTRIES}`;
  const j = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.tradingview.com' } })).json();
  return (j.result || []).filter((e) => ALL || e.importance >= 0);
}

function fmtVal(v, unit) { return v == null ? '—' : v + (unit || ''); }

async function main() {
  let evs;
  try { evs = await events(); } catch (e) { console.error('❌ calendrier indisponible', e.message); process.exit(1); }
  evs.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Grouper par jour
  const byDay = {};
  for (const e of evs) {
    const d = new Date(e.date);
    const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    (byDay[day] = byDay[day] || []).push(e);
  }
  // Un champ par jour (name/value), puis on les répartit dans des embeds (max 5 champs chacun)
  const dayFields = Object.keys(byDay).slice(0, 10).map((day) => {
    const lines = byDay[day].slice(0, 10).map((e) => {
      const h = new Date(e.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      const extra = (e.forecast != null || e.previous != null) ? ` — prév. ${fmtVal(e.forecast, e.unit)} / préc. ${fmtVal(e.previous, e.unit)}` : '';
      return `\`${h}\` ${FLAG[e.country] || e.country} ${IMP[e.importance] || ''} **${e.title}**${extra}`;
    });
    return { name: '📅 ' + day.charAt(0).toUpperCase() + day.slice(1), value: lines.join('\n').slice(0, 1024) || '—', inline: false };
  });
  const embeds = [];
  for (let i = 0; i < dayFields.length; i += 5) embeds.push({ color: 0x6d5ae0, fields: dayFields.slice(i, i + 5) });

  const content = `📰 **Calendrier économique — ${DAYS} prochains jours** · ${C.nowUTC()}\nHeures en **UTC** · 🔴 haute / 🟠 moyenne importance · devises majeures`;
  await C.postDiscord(WEBHOOK, { username: 'News Éco', content, embeds: embeds.length ? embeds : undefined }, DRY);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
