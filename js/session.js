/*
 * session.js — FENÊTRE DE TRADING DU BOT
 * -----------------------------------------------------------------------------
 * Règle voulue par l'utilisateur :
 *   le bot ne prend de position QU'ENTRE l'ouverture de Wall Street
 *   (09 h 30 à New York) et 17 h 00 heure française.
 *
 * Pourquoi on calcule les DEUX fuseaux au lieu de coder « 15 h 30 – 17 h 00 » :
 * la France et les États-Unis ne changent PAS d'heure les mêmes semaines
 * (mi-mars et fin octobre). Pendant ces quelques semaines l'écart passe de
 * 6 h à 5 h : l'ouverture de Wall Street tombe alors à 14 h 30 à Paris, pas
 * 15 h 30. On lit donc l'heure réelle dans chaque fuseau, et la fenêtre reste
 * juste toute l'année, sans rien toucher.
 *
 * Hors fenêtre : AUCUNE nouvelle position. Les positions déjà ouvertes
 * continuent d'être suivies (on ne coupe rien de force ici).
 */
(function (root) {
  'use strict';

  var NY = 'America/New_York';
  var PARIS = 'Europe/Paris';
  var OPEN_NY_MIN = 9 * 60 + 30;   // 09 h 30 à New York = ouverture de Wall Street
  var CLOSE_PARIS_MIN = 17 * 60;   // 17 h 00 à Paris = fin de la fenêtre

  // Lit l'heure d'une date dans un fuseau donné (sans dépendre du fuseau du PC).
  function parts(date, tz) {
    var f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).formatToParts(date);
    var o = {};
    f.forEach(function (p) { o[p.type] = p.value; });
    var dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    var h = parseInt(o.hour, 10); if (h === 24) h = 0;   // minuit s'écrit "24" chez certains moteurs
    return {
      y: +o.year, m: +o.month, d: +o.day,
      h: h, mi: parseInt(o.minute, 10),
      dow: dows[o.weekday],
      min: h * 60 + parseInt(o.minute, 10)
    };
  }

  function fmt(mins) {
    if (mins <= 0) return '0 min';
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? (h + ' h' + (m ? ' ' + m + ' min' : '')) : (m + ' min');
  }

  // État complet de la fenêtre à un instant donné.
  function state(date) {
    var now = date || new Date();
    var ny = parts(now, NY);
    var pa = parts(now, PARIS);
    var weekday = ny.dow >= 1 && ny.dow <= 5;          // Wall Street : lundi → vendredi
    var afterOpen = ny.min >= OPEN_NY_MIN;
    var beforeClose = pa.min < CLOSE_PARIS_MIN;
    var open = weekday && afterOpen && beforeClose;

    var raison = open ? 'Fenêtre de trading OUVERTE'
      : !weekday ? 'Week-end — Wall Street est fermé'
      : !afterOpen ? 'Avant l’ouverture de Wall Street (09 h 30 à New York)'
      : 'Après 17 h 00 heure française';

    var resteMin = open ? (CLOSE_PARIS_MIN - pa.min) : null;
    var dansMin = (!open && weekday && !afterOpen) ? (OPEN_NY_MIN - ny.min) : null;

    return {
      ouverte: open,
      raison: raison,
      heure_ny: (ny.h < 10 ? '0' : '') + ny.h + ':' + (ny.mi < 10 ? '0' : '') + ny.mi,
      heure_paris: (pa.h < 10 ? '0' : '') + pa.h + ':' + (pa.mi < 10 ? '0' : '') + pa.mi,
      // L'heure parisienne à laquelle Wall Street ouvre AUJOURD'HUI (14 h 30 ou 15 h 30
      // selon la semaine) : c'est l'écart réel entre les deux fuseaux, pas une constante.
      ouverture_paris_min: OPEN_NY_MIN + (pa.min - ny.min),
      reste_min: resteMin,
      dans_min: dansMin,
      texte: open ? ('Ouverte — fermeture dans ' + fmt(resteMin))
        : (dansMin != null ? ('Fermée — ouverture dans ' + fmt(dansMin)) : 'Fermée — ' + raison)
    };
  }

  function isOpen(date) { return state(date).ouverte; }

  // Bloc injecté dans le prompt du Bot IA.
  function promptBlock(date) {
    var s = state(date);
    var ouvParis = s.ouverture_paris_min;
    var oh = Math.floor(ouvParis / 60), om = ouvParis % 60;
    var t = '=== FENÊTRE DE TRADING (RÈGLE ÉLIMINATOIRE) ===\n';
    t += 'Le bot ne prend de position QU\'ENTRE l\'ouverture de Wall Street (09 h 30 à New York) ';
    t += 'et 17 h 00 heure française.\n';
    t += 'Aujourd\'hui, cela correspond à ' + oh + ' h ' + (om < 10 ? '0' : '') + om + ' → 17 h 00 heure de Paris.\n';
    t += 'Il est actuellement ' + s.heure_paris + ' à Paris (' + s.heure_ny + ' à New York).\n';
    t += 'ÉTAT : ' + (s.ouverte ? 'FENÊTRE OUVERTE' : 'FENÊTRE FERMÉE') + ' — ' + s.raison + '.\n';
    if (s.ouverte) {
      t += 'Il reste ' + fmt(s.reste_min) + ' avant la fermeture. ';
      t += 'N\'ouvre AUCUNE position dont l\'objectif ne peut raisonnablement pas être atteint dans ce délai : ';
      t += 'à moins de 30 minutes de la fermeture, ne propose plus de nouvelle entrée.\n';
    } else {
      t += '⛔ INTERDICTION ABSOLUE : renvoie "idees": [] — AUCUNE nouvelle position hors de cette fenêtre. ';
      t += 'Tu peux en revanche remplir "amd" et "preshot" pour préparer la prochaine ouverture.\n';
    }
    return t;
  }

  root.WINDOW = { state: state, isOpen: isOpen, promptBlock: promptBlock, parts: parts };
})(typeof window !== 'undefined' ? window : this);
