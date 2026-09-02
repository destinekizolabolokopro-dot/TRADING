/*
 * econcal.js — Conscience des ANNONCES ÉCONOMIQUES à fort impact.
 * -----------------------------------------------------------------------------
 * Donne au site ET au Bot IA une notion du calendrier : il sait quel jour on est
 * (heure de New York / ET) et repère les fenêtres à risque autour des grandes
 * publications (NFP, FOMC, CPI, OPEX) pour éviter de trader dans le chaos.
 *
 * Calendrier INDICATIF, hors-ligne, sans clé :
 *   - NFP (emploi US) = 1er vendredi du mois, 08h30 ET      → calculé (fiable)
 *   - OPEX (expiration options) = 3e vendredi du mois        → calculé (fiable)
 *   - FOMC (décision Fed) = dates 2026 prévisionnelles       → codées en dur
 *   - CPI (inflation US) = ~mi-mois                          → ESTIMÉ (à vérifier)
 * ⚠️ Sert de garde-fou, pas de vérité absolue : vérifie un calendrier officiel
 *    (ex. investing.com/forexfactory) avant tout trade autour d'une news.
 *
 * Expose window.ECON :
 *   ECON.status(now?)      → { etIso, etLabel, level, alerts[], next, message }
 *   ECON.promptBlock(now?) → bloc texte compact à injecter dans le prompt IA
 *   ECON.bannerHTML(now?)  → petit HTML coloré pour l'interface
 */
(function (root) {
  'use strict';

  // Jour de décision du FOMC (2e jour de réunion), annonce ~14h ET. 2026 prévisionnel.
  var FOMC = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
              '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
              // marge 2027 pour la fin d'année
              '2027-01-27', '2027-03-17'];

  var MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août',
              'septembre','octobre','novembre','décembre'];
  var JOURS = { Mon:'lundi', Tue:'mardi', Wed:'mercredi', Thu:'jeudi',
                Fri:'vendredi', Sat:'samedi', Sun:'dimanche' };

  // Composants heure de New York (ET) — fiable via Intl (gère l'heure d'été).
  function etParts(d) {
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
      var o = {}; f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
      return { y: +o.year, m: +o.month, day: +o.day,
        h: +(o.hour === '24' ? 0 : o.hour), min: +o.minute, wd: o.weekday };
    } catch (e) {
      var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate(),
        h: d.getHours(), min: d.getMinutes(), wd: days[d.getDay()] };
    }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(y, m, day) { return y + '-' + pad(m) + '-' + pad(day); }
  // Numéro de jour absolu (pour différences de dates, indépendant du fuseau).
  function dayNum(y, m, day) { return Math.floor(Date.UTC(y, m - 1, day) / 864e5); }
  // n-ième vendredi d'un mois → jour du mois.
  function nthFriday(y, m, n) {
    var dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=dim..6=sam
    return 1 + ((5 - dow + 7) % 7) + (n - 1) * 7;
  }

  // Construit la liste des événements autour d'un mois (mois courant + suivant).
  function eventsAround(y, m) {
    var list = [];
    function monthEvents(yy, mm) {
      // NFP : 1er vendredi, 08:30 ET
      list.push({ name: 'NFP (emploi US)', iso: isoOf(yy, mm, nthFriday(yy, mm, 1)), h: 8, min: 30, impact: 'high', calc: 'calculé' });
      // OPEX : 3e vendredi, journée (impact modéré), repère 16:00 ET
      list.push({ name: 'OPEX (expiration options)', iso: isoOf(yy, mm, nthFriday(yy, mm, 3)), h: 16, min: 0, impact: 'mid', calc: 'calculé' });
      // CPI : estimation mi-mois (12), décalée au jour de semaine, 08:30 ET
      var cd = 12, wd = new Date(Date.UTC(yy, mm - 1, cd)).getUTCDay();
      if (wd === 6) cd = 11; else if (wd === 0) cd = 13; // évite le week-end
      list.push({ name: 'CPI (inflation US, estimé)', iso: isoOf(yy, mm, cd), h: 8, min: 30, impact: 'high', calc: 'estimé' });
    }
    monthEvents(y, m);
    var nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
    monthEvents(ny, nm);
    // FOMC codés en dur
    FOMC.forEach(function (iso) { list.push({ name: 'FOMC (décision Fed)', iso: iso, h: 14, min: 0, impact: 'high', calc: 'prévisionnel' }); });
    return list;
  }

  // ---------------------------------------------------------------------------
  // CALENDRIER LIVE (flux hebdo ForexFactory via proxy CORS) — TOUTES les annonces
  // ---------------------------------------------------------------------------
  var FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
  var PROXY = 'https://api.allorigins.win/raw?url='; // ajoute l'en-tête CORS manquant
  var CACHE = 'tradeassist.econ.v1';
  var TTL = 45 * 60 * 1000; // 45 min
  var _live = null; // { events:[...], at:ms }

  function loadCache() { try { var j = JSON.parse(localStorage.getItem(CACHE) || 'null'); return (j && j.events) ? j : null; } catch (e) { return null; } }
  function saveCache(o) { try { localStorage.setItem(CACHE, JSON.stringify(o)); } catch (e) {} }

  // Parse le XML (sans DOMParser → marche aussi côté Node) champ par champ.
  function field(block, tag) {
    var x = block.match(new RegExp('<' + tag + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/' + tag + '>'));
    return x ? x[1].trim() : '';
  }
  function parseFeed(txt) {
    var out = [], re = /<event>([\s\S]*?)<\/event>/g, m;
    while ((m = re.exec(txt))) {
      var b = m[1];
      out.push({ title: field(b, 'title'), country: field(b, 'country'),
        date: field(b, 'date'), time: field(b, 'time'), impact: field(b, 'impact'),
        forecast: field(b, 'forecast'), previous: field(b, 'previous'),
        actual: field(b, 'actual'), url: field(b, 'url') });
    }
    return out;
  }
  // Récupère le flux (avec cache). Résout toujours (null si échec + pas de cache).
  function fetchLive(force) {
    var c = loadCache();
    if (!force && c && (Date.now() - c.at) < TTL) { _live = c; return Promise.resolve(c); }
    if (typeof fetch === 'undefined') { _live = c; return Promise.resolve(c); }
    return fetch(PROXY + encodeURIComponent(FEED)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.text();
    }).then(function (txt) {
      var ev = parseFeed(txt);
      if (!ev.length) throw new Error('flux vide');
      var o = { events: ev, at: Date.now() }; _live = o; saveCache(o); return o;
    }).catch(function () { _live = c; return c; });
  }

  var CUR_LABEL = { USD: '🇺🇸 USD', EUR: '🇪🇺 EUR', GBP: '🇬🇧 GBP', JPY: '🇯🇵 JPY',
    CAD: '🇨🇦 CAD', AUD: '🇦🇺 AUD', NZD: '🇳🇿 NZD', CHF: '🇨🇭 CHF', CNY: '🇨🇳 CNY', ALL: '🌐' };
  function impactLevel(imp) { var i = (imp || '').toLowerCase(); return i.indexOf('high') >= 0 ? 'high' : i.indexOf('med') >= 0 ? 'mid' : 'low'; }
  function parseEvTime(e) {
    var d = (e.date || '').split('-'); if (d.length !== 3) return null; // MM-DD-YYYY
    var h = 0, min = 0, allday = true, t = (e.time || '').toLowerCase().replace(/\s/g, '');
    var mt = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (mt) { h = (+mt[1] % 12) + (mt[3] === 'pm' ? 12 : 0); min = +mt[2]; allday = false; }
    return { y: +d[2], m: +d[0], day: +d[1], h: h, min: min, allday: allday };
  }
  // Événements live normalisés au même format que le calendrier calculé.
  function liveNormalized() {
    if (!_live || !_live.events) return null;
    var arr = [];
    _live.events.forEach(function (e) {
      var t = parseEvTime(e); if (!t) return;
      arr.push({ name: e.title, country: e.country, impact: impactLevel(e.impact),
        y: t.y, m: t.m, day: t.day, h: t.h, min: t.min, allday: t.allday, calc: 'live',
        forecast: e.forecast, previous: e.previous, actual: e.actual });
    });
    return arr;
  }
  // Convertit le calendrier calculé au format normalisé.
  function computedNormalized(y, m) {
    return eventsAround(y, m).map(function (e) {
      var p = e.iso.split('-');
      return { name: e.name, country: 'USD', impact: e.impact, y: +p[0], m: +p[1], day: +p[2],
        h: e.h, min: e.min, allday: false, calc: e.calc };
    });
  }

  function status(now) {
    var d = now || new Date();
    var et = etParts(d);
    var todayNum = dayNum(et.y, et.m, et.day);
    var nowMin = et.h * 60 + et.min;
    var live = liveNormalized();
    var evs = (live && live.length) ? live : computedNormalized(et.y, et.m);
    var usingLive = !!(live && live.length);

    var alerts = [], upcoming = [];
    evs.forEach(function (e) {
      var en = dayNum(e.y, e.m, e.day);
      var diff = en - todayNum; // en jours
      if (diff < 0 || diff > 12) return;
      var evMin = e.h * 60 + e.min;
      var label = JOURS[etParts(new Date(Date.UTC(e.y, e.m - 1, e.day, 12))).wd] || '';
      var who = (usingLive && e.country && e.country !== 'USD') ? ' (' + e.country + ')' : '';
      var human = label + ' ' + pad(e.day) + '/' + pad(e.m) + (e.allday ? '' : ' à ' + pad(e.h) + 'h' + pad(e.min) + ' ET');
      if (diff === 0) {
        var delta = evMin - nowMin; // minutes avant (négatif = passé)
        if (e.impact === 'high' && !e.allday && delta <= 120 && delta >= -90) {
          alerts.push({ level: 'high', name: e.name + who, when: 'IMMINENT (' + (delta >= 0 ? 'dans ~' + delta + ' min' : 'il y a ' + (-delta) + ' min') + ')', calc: e.calc });
        } else if (e.impact === 'high' || e.impact === 'mid') {
          alerts.push({ level: (e.impact === 'high' ? 'watch' : 'watch'), name: e.name + who, when: "aujourd'hui" + (e.allday ? '' : ' à ' + pad(e.h) + 'h' + pad(e.min) + ' ET'), calc: e.calc });
        }
      } else if (diff === 1 && e.impact === 'high') {
        alerts.push({ level: 'watch', name: e.name + who, when: 'demain' + (e.allday ? '' : ' ' + pad(e.h) + 'h' + pad(e.min) + ' ET'), calc: e.calc });
      } else if (diff >= 1 && e.impact === 'high') {
        upcoming.push({ name: e.name + who, human: human, diff: diff, calc: e.calc });
      }
    });
    // dédoublonne/limite les alertes (le flux peut être dense)
    var seen = {}; alerts = alerts.filter(function (a) { var k = a.level + a.name + a.when; if (seen[k]) return false; seen[k] = 1; return true; });
    var order = { high: 0, watch: 1 };
    alerts.sort(function (a, b) { return order[a.level] - order[b.level]; });
    alerts = alerts.slice(0, 8);
    upcoming.sort(function (a, b) { return a.diff - b.diff; });

    var level = alerts.some(function (a) { return a.level === 'high'; }) ? 'high'
      : (alerts.length ? 'watch' : 'none');
    var etLabel = (JOURS[et.wd] || '') + ' ' + et.day + ' ' + MOIS[et.m - 1] + ' ' + et.y +
      ', ' + pad(et.h) + 'h' + pad(et.min) + ' (heure de New York)';

    var message;
    if (level === 'high') message = "⚠️ Annonce à FORT IMPACT imminente — évite d'ouvrir un trade maintenant (spreads larges, faux mouvements).";
    else if (level === 'watch') message = "🟠 Annonce à fort impact aujourd'hui/demain — reste prudent près de l'heure indiquée.";
    else message = "🟢 Aucune annonce majeure imminente.";

    return { etIso: isoOf(et.y, et.m, et.day), etLabel: etLabel, level: level,
      alerts: alerts, next: upcoming[0] || null, upcoming: upcoming.slice(0, 3),
      message: message, source: usingLive ? 'live' : 'calculé',
      updated: usingLive && _live ? _live.at : null };
  }

  // Bloc texte pour le prompt de l'IA (n'envoie que le pertinent, pas toute la semaine).
  function promptBlock(now) {
    var s = status(now);
    var t = "CONTEXTE TEMPOREL & ANNONCES ÉCONOMIQUES (heure de New York / ET) :\n";
    t += "- Maintenant : " + s.etLabel + ".\n";
    if (s.alerts.length) {
      t += "- Annonces aujourd'hui/demain : " + s.alerts.map(function (a) {
        return (a.level === 'high' ? '⚠️ ' : '🟠 ') + a.name + ' — ' + a.when;
      }).join(' ; ') + ".\n";
    } else {
      t += "- Aucune annonce à fort impact dans la fenêtre immédiate.\n";
    }
    if (s.next) t += "- Prochaine à fort impact : " + s.next.name + ' — ' + s.next.human + ' (dans ' + s.next.diff + ' j).\n';
    t += "CONSIGNE : n'ouvre PAS de nouveau trade dans la fenêtre d'une annonce à fort impact. " +
      "Si une alerte 'IMMINENT' est active, privilégie l'attente ou réduis fortement le risque, et mentionne-le dans ton analyse. " +
      (s.source === 'live'
        ? "Source : calendrier économique live (ForexFactory), toutes devises."
        : "Source : calendrier interne indicatif (NFP/OPEX calculés, FOMC prévisionnel, CPI estimé) — flux live indisponible.");
    return t;
  }

  // Petit bandeau HTML pour l'interface (modal Bot IA).
  function bannerHTML(now) {
    var s = status(now);
    var bg = s.level === 'high' ? 'rgba(255,80,80,.14)' : s.level === 'watch' ? 'rgba(255,176,32,.14)' : 'rgba(64,220,140,.10)';
    var bd = s.level === 'high' ? 'rgba(255,80,80,.5)' : s.level === 'watch' ? 'rgba(255,176,32,.5)' : 'rgba(64,220,140,.35)';
    var lines = '<b>' + s.message + '</b><br><span style="opacity:.8">🕐 ' + s.etLabel + '</span>';
    if (s.alerts.length) lines += '<br>' + s.alerts.slice(0, 5).map(function (a) {
      return (a.level === 'high' ? '⚠️ ' : '🟠 ') + a.name + ' — ' + a.when;
    }).join('<br>');
    else if (s.next) lines += '<br><span style="opacity:.8">Prochaine : ' + s.next.name + ' — ' + s.next.human + ' (dans ' + s.next.diff + ' j)</span>';
    var src = s.source === 'live' ? 'Calendrier live (ForexFactory) — toutes devises.' : 'Calendrier interne indicatif (flux live indisponible).';
    return '<div style="margin:12px 0;padding:10px 12px;border:1px solid ' + bd + ';background:' + bg +
      ';border-radius:10px;font-size:13px;line-height:1.5">' + lines +
      '<br><span style="opacity:.55;font-size:11px">' + src + ' Vérifie un calendrier officiel avant de trader une news.</span></div>';
  }

  // TOUS les événements de la semaine, groupés par jour (pour l'onglet Économie).
  // Renvoie [{ dayIso, dayLabel, items:[{time,country,impact,name,forecast,previous,actual}] }].
  function weekEvents() {
    var live = liveNormalized();
    var src = (live && live.length) ? live : computedNormalized(etParts(new Date()).y, etParts(new Date()).m);
    var byDay = {};
    src.forEach(function (e) {
      var iso = isoOf(e.y, e.m, e.day);
      (byDay[iso] = byDay[iso] || []).push(e);
    });
    return Object.keys(byDay).sort().map(function (iso) {
      var p = iso.split('-');
      var wd = JOURS[etParts(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12))).wd] || '';
      var items = byDay[iso].sort(function (a, b) {
        return (a.allday ? -1 : a.h * 60 + a.min) - (b.allday ? -1 : b.h * 60 + b.min);
      }).map(function (e) {
        return { time: e.allday ? '—' : pad(e.h) + 'h' + pad(e.min), country: e.country || '',
          curLabel: CUR_LABEL[e.country] || ('🏳️ ' + (e.country || '')), impact: e.impact,
          name: e.name, forecast: e.forecast || '', previous: e.previous || '', actual: e.actual || '' };
      });
      return { dayIso: iso, dayLabel: wd + ' ' + p[2] + '/' + p[1], items: items };
    });
  }

  root.ECON = { status: status, promptBlock: promptBlock, bannerHTML: bannerHTML,
    fetchLive: fetchLive, weekEvents: weekEvents };
})(typeof window !== 'undefined' ? window : this);
