/*
 * session.js — FENÊTRES DE TRADING DU BOT
 * -----------------------------------------------------------------------------
 * Le bot ne prend de position que pendant DEUX créneaux :
 *
 *   1. De l'ouverture de Wall Street (09 h 30 à New York) à 17 h 00 à Paris.
 *   2. De 19 h 00 à 21 h 00, heure française.
 *
 * Le second créneau correspond à 13 h 00 – 15 h 00 à New York : c'est la
 * deuxième macro de la séance américaine, celle d'après le déjeuner.
 *
 * Pourquoi lire les DEUX fuseaux au lieu de coder « 15 h 30 – 17 h 00 » :
 * la France et les États-Unis ne changent PAS d'heure les mêmes semaines
 * (mi-mars et fin octobre). Pendant ces quelques semaines l'écart passe de
 * 6 h à 5 h : l'ouverture de Wall Street tombe alors à 14 h 30 à Paris. On lit
 * donc l'heure réelle dans chaque fuseau, et les créneaux restent justes toute
 * l'année, sans rien toucher.
 *
 * Hors fenêtre : AUCUNE nouvelle position. Les positions déjà ouvertes
 * continuent d'être suivies (on ne coupe rien de force ici).
 */
(function (root) {
  'use strict';

  var NY = 'America/New_York';
  var PARIS = 'Europe/Paris';

  // Chaque borne dit dans QUEL fuseau elle se lit. C'est tout l'intérêt :
  // l'ouverture suit New York, la fermeture suit Paris.
  var FENETRES = [
    { id: 'wallstreet',
      nom: 'Ouverture de Wall Street → 17 h 00 (heure française)',
      court: 'Wall Street → 17 h',
      debut: { tz: NY,    min: 9 * 60 + 30 },
      fin:   { tz: PARIS, min: 17 * 60 } },
    { id: 'soiree',
      nom: '19 h 00 → 21 h 00 (heure française) — la macro de l’après-midi à New York',
      court: '19 h → 21 h',
      debut: { tz: PARIS, min: 19 * 60 },
      fin:   { tz: PARIS, min: 21 * 60 } }
  ];

  var _fmt = {};
  function fmtFor(tz) {
    if (!_fmt[tz]) _fmt[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
    return _fmt[tz];
  }

  // Lit l'heure d'une date dans un fuseau donné (sans dépendre du fuseau du PC).
  function parts(date, tz) {
    var o = {};
    fmtFor(tz).formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    var dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    var h = parseInt(o.hour, 10); if (h === 24) h = 0;   // minuit s'écrit "24" chez certains moteurs
    return {
      y: +o.year, m: +o.month, d: +o.day,
      h: h, mi: parseInt(o.minute, 10),
      dow: dows[o.weekday],
      min: h * 60 + parseInt(o.minute, 10)
    };
  }

  function fmtDuree(mins) {
    if (mins <= 0) return '0 min';
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? (h + ' h' + (m ? ' ' + m + ' min' : '')) : (m + ' min');
  }
  function hhmm(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + (m < 10 ? '0' : '') + m : '');
  }

  // État complet des fenêtres à un instant donné.
  function state(date) {
    var now = date || new Date();
    var ny = parts(now, NY), pa = parts(now, PARIS);
    var horloge = {}; horloge[NY] = ny; horloge[PARIS] = pa;
    var ouvrable = ny.dow >= 1 && ny.dow <= 5;   // Wall Street : lundi → vendredi

    // Chaque borne ramenée à l'heure de PARIS, pour pouvoir tout comparer.
    var ecart = pa.min - ny.min;                  // décalage réel du jour (5 h ou 6 h)
    function enParis(borne) {
      return borne.tz === PARIS ? borne.min : borne.min + ecart;
    }

    var actives = [], prochaine = null, resteMin = null, dansMin = null;
    FENETRES.forEach(function (f) {
      var d = enParis(f.debut), fin = enParis(f.fin);
      var dedans = ouvrable && pa.min >= d && pa.min < fin;
      if (dedans) {
        actives.push(f);
        var r = fin - pa.min;
        if (resteMin == null || r < resteMin) resteMin = r;
      } else if (ouvrable && pa.min < d) {
        var att = d - pa.min;
        if (dansMin == null || att < dansMin) { dansMin = att; prochaine = f; }
      }
      f._parisDebut = d; f._parisFin = fin;
    });

    var open = actives.length > 0;
    var raison = open ? ('Fenêtre « ' + actives[0].court +' » ouverte')
      : !ouvrable ? 'Week-end — Wall Street est fermé'
      : prochaine ? ('Avant la fenêtre « ' + prochaine.court + ' »')
      : 'Toutes les fenêtres du jour sont passées';

    return {
      ouverte: open,
      fenetre: open ? actives[0].id : null,
      fenetre_nom: open ? actives[0].nom : null,
      raison: raison,
      heure_ny: (ny.h < 10 ? '0' : '') + ny.h + ':' + (ny.mi < 10 ? '0' : '') + ny.mi,
      heure_paris: (pa.h < 10 ? '0' : '') + pa.h + ':' + (pa.mi < 10 ? '0' : '') + pa.mi,
      reste_min: resteMin,
      dans_min: dansMin,
      prochaine: prochaine ? prochaine.court : null,
      // Les créneaux du jour, en heure de Paris (14 h 30 ou 15 h 30 selon la semaine).
      creneaux: FENETRES.map(function (f) {
        return { id: f.id, nom: f.nom, court: f.court,
          debut: hhmm(f._parisDebut), fin: hhmm(f._parisFin),
          active: open && actives.indexOf(f) >= 0 };
      }),
      texte: open ? ('Ouverte (' + actives[0].court + ') — fermeture dans ' + fmtDuree(resteMin))
        : (dansMin != null ? ('Fermée — ' + prochaine.court + ' dans ' + fmtDuree(dansMin))
                           : 'Fermée — ' + raison)
    };
  }

  function isOpen(date) { return state(date).ouverte; }

  // Bloc injecté dans le prompt du Bot IA.
  function promptBlock(date) {
    var s = state(date);
    var t = '=== FENÊTRES DE TRADING (RÈGLE ÉLIMINATOIRE) ===\n';
    t += 'Le bot ne prend de position que pendant ces créneaux, heure de Paris :\n';
    s.creneaux.forEach(function (c) {
      t += '  • ' + c.debut + ' → ' + c.fin + '  (' + c.nom + ')' + (c.active ? '  ← EN COURS' : '') + '\n';
    });
    t += 'Il est actuellement ' + s.heure_paris + ' à Paris (' + s.heure_ny + ' à New York).\n';
    t += 'ÉTAT : ' + (s.ouverte ? 'FENÊTRE OUVERTE' : 'FENÊTRE FERMÉE') + ' — ' + s.raison + '.\n';
    if (s.ouverte) {
      t += 'Il reste ' + fmtDuree(s.reste_min) + ' avant la fermeture de ce créneau. ';
      t += 'N\'ouvre AUCUNE position dont l\'objectif ne peut raisonnablement pas être atteint dans ce délai : ';
      t += 'à moins de 30 minutes de la fermeture, ne propose plus de nouvelle entrée.\n';
    } else {
      t += '⛔ INTERDICTION ABSOLUE : renvoie "idees": [] — AUCUNE nouvelle position hors de ces créneaux. ';
      t += 'Tu peux en revanche remplir "amd" et "preshot" pour préparer la prochaine ouverture.\n';
    }
    return t;
  }

  root.WINDOW = { state: state, isOpen: isOpen, promptBlock: promptBlock, parts: parts, FENETRES: FENETRES };
})(typeof window !== 'undefined' ? window : this);
