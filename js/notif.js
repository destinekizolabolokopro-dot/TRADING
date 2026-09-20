'use strict';
/**
 * NOTIFICATIONS — le site prévient au lieu d'attendre qu'on le regarde.
 *
 * ⚠️ HONNÊTETÉ SUR LE DÉLAI. Yahoo Finance sert le NQ avec environ 10 minutes
 * de retard : c'est mesuré, pas supposé. Une notification d'ici n'est donc PAS
 * un signal d'entrée en temps réel — c'est une alerte de surveillance. Le
 * temps réel demande TradingView (pine/MECH_LIVE.pine) ou le flux Rithmic /
 * Tradovate d'un compte prop firm.
 *
 * Le module affiche systématiquement l'âge de la donnée dans la notification,
 * pour qu'on ne puisse pas se tromper là-dessus.
 */
var Notif = (function () {

  var CLE_ETAT = 'notif.actif';
  var CLE_VUS  = 'notif.vus';

  function supporte() { return typeof Notification !== 'undefined'; }
  function actif()    { try { return localStorage.getItem(CLE_ETAT) === '1'; } catch (e) { return false; } }
  function permis()   { return supporte() && Notification.permission === 'granted'; }

  function activer() {
    if (!supporte()) return Promise.resolve(false);
    return Notification.requestPermission().then(function (p) {
      var ok = p === 'granted';
      try { localStorage.setItem(CLE_ETAT, ok ? '1' : '0'); } catch (e) {}
      return ok;
    });
  }
  function desactiver() { try { localStorage.setItem(CLE_ETAT, '0'); } catch (e) {} }

  // Mémoire des signaux déjà notifiés, pour ne pas sonner à chaque rafraîchissement.
  function dejaVu(id) {
    try {
      var v = JSON.parse(localStorage.getItem(CLE_VUS) || '[]');
      if (v.indexOf(id) >= 0) return true;
      v.push(id);
      if (v.length > 60) v = v.slice(-60);
      localStorage.setItem(CLE_VUS, JSON.stringify(v));
      return false;
    } catch (e) { return false; }
  }

  /** Âge de la dernière bougie reçue, en minutes. */
  // Le modèle renvoie `derniereBougie`. Ce module lisait `derniere_bougie`,
  // qui n'a jamais existé : l'âge était donc toujours nul et la notification
  // annonçait « retard inconnu ».
  function ageMin(d) {
    if (!d || !d.derniereBougie) return null;
    return Math.round((Date.now() - d.derniereBougie) / 60000);
  }

  /**
   * Notifie s'il y a un trade possible non encore signalé.
   * @param d instantané renvoyé par Modele.evaluer()  (ce module lisait la
   *          forme de NQ.load(), qui n'est plus appelée nulle part)
   */
  function verifier(d) {
    // ⚠️ CORRIGÉ. La condition était `!d.trade.possible`. Or le modèle ne
    // produit AUCUN champ `possible` : il renvoie sens, entree, sl, tp, rr,
    // tf, niveau. `undefined` étant faux, cette ligne coupait TOUTES les
    // notifications, y compris sur un signal parfaitement valide. C'est la
    // raison pour laquelle le bot n'a jamais rien envoyé.
    if (!d || !d.trade) return null;
    // La fenêtre à respecter est celle du MODÈLE (09 h 30 → 10 h 00 à New
    // York), pas celle de session.js, qui couvre toute la séance de Wall
    // Street et n'a rien à voir.
    if (d.hors) return null;
    if (window.Modele && Modele.fenetre && !Modele.fenetre().ouverte) return null;

    var t = d.trade, unite = t.tf || '?';
    // Identité d'un signal : jour + sens + entrée + unité. Deux
    // rafraîchissements du même setup donnent le même identifiant.
    var id = [new Date().toISOString().slice(0, 10), t.sens, t.entree, unite].join('|');
    if (dejaVu(id)) return null;

    var age = ageMin(d);
    var retard = age == null ? 'retard inconnu' : 'donnée vieille de ' + age + ' min';
    var corps = t.sens + ' NQ · entrée ' + t.entree + ' · stop ' + t.sl +
                ' · objectif ' + t.tp + ' (RR ' + t.rr + ')\n' +
                (t.niveau || unite) + ' — ' + retard + ', vérifie le graphique avant d\'agir.';

    if (permis() && actif()) {
      try {
        new Notification('Signal MECH — ' + t.sens + ' NQ', {
          body: corps, tag: id, requireInteraction: false
        });
      } catch (e) {}
    }
    return { id: id, sens: t.sens, corps: corps, age: age };
  }

  return { supporte: supporte, actif: actif, permis: permis,
           activer: activer, desactiver: desactiver,
           verifier: verifier, ageMin: ageMin };
})();
if (typeof window !== 'undefined') window.Notif = Notif;
