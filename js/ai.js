/*
 * Couche IA — appelle l'API Claude (Anthropic) depuis le navigateur.
 * -----------------------------------------------------------------------------
 * La clé API reste EN LOCAL (localStorage), ne quitte pas la machine de l'utilisateur.
 * Claude reçoit l'état du marché (données réelles déjà calculées) et renvoie
 * ses meilleures idées de trade, raisonnées, en français.
 *
 * ⚠️ Idées pédagogiques, pas un conseil financier. L'IA n'est pas infaillible.
 */
(function (root) {
  'use strict';

  var KEY_STORE = 'anthropic.key';
  var MODEL_STORE = 'anthropic.model';
  var ENDPOINT = 'https://api.anthropic.com/v1/messages';

  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(KEY_STORE, (k || '').trim()); } catch (e) {} }
  function getModel() { try { return localStorage.getItem(MODEL_STORE) || 'claude-haiku-4-5'; } catch (e) { return 'claude-haiku-4-5'; } }
  function setModel(m) { try { localStorage.setItem(MODEL_STORE, m); } catch (e) {} }

  var SYSTEM =
    "Tu es un BOT DE TRADING autonome, propulsé par Claude (Anthropic), intégré à un site ICT/SMC. Tu écris en français. " +
    "Tu opères UNIQUEMENT sur les unités de temps H1, H4 et D1 — jamais en dessous de H1. " +
    "Tu raisonnes en TOP-DOWN : le biais vient du D1, tu affines en H4, tu synchronises l'entrée en H1. " +
    "Tu bases tes décisions PRINCIPALEMENT sur les concepts ICT/SMC (structure & BOS/CHoCH, MSS, FVG, order blocks, " +
    "breaker, OTE 62-79%, liquidité/equal highs-lows, premium/discount, cycles Accumulation-Manipulation-Expansion-Distribution), " +
    "MAIS tu es LIBRE d'employer toute autre technique intelligente et pertinente (momentum, confluence multi-unités, " +
    "corrélations, contexte DXY) si elle augmente la probabilité de gagner. " +
    "Le DXY est inversé pour crypto/or : DXY baissier = favorable, DXY haussier = défavorable. " +
    "Ton objectif est d'être RENTABLE : cherche EN PRIORITÉ les meilleurs ratios risque/rendement — vise 2, 3, 4 ou plus " +
    "quand la structure le permet (objectif au prochain pool de liquidité / extrême de range, stop serré mais logique). " +
    "RÈGLE STRICTE : n'envoie JAMAIS un trade sous 1 RR. Si tu ne peux pas obtenir au moins 1 RR avec un stop logique, " +
    "n'envoie tout simplement PAS ce trade (ne le mets pas dans la liste). Point d'entrée précis, stop au-delà d'un balayage/structure, objectif atteignable. " +
    "Sois HONNÊTE : si aucun setup n'est net, renvoie une liste vide plutôt que de forcer un trade. " +
    "Tu n'es pas un conseiller financier ; règle de gestion : risque max 1 % du compte par trade.";

  function buildUser(pairs, mtf, collab) {
    var snap = pairs.map(function (p) {
      return {
        paire: p.sym, prix: p.price, sens_calcule: p.dir, cycle: p.cycle,
        confluence_pct: p.conf, entree: p.entry, stop: p.sl, objectif: p.tp, rr: p.rr, note: p.note
      };
    });
    var txt = "Tu es le Bot IA du site. Analyse le marché et envoie TES meilleures idées de trade (0 à 3), " +
      "sur H1/H4/D1 uniquement, classées de la plus forte à la plus faible. " +
      "N'inclus QUE des trades dont le rr est >= 1 (privilégie 2, 3, 4 ou plus). Jamais de trade sous 1 RR. " +
      "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :\n" +
      '{"marche":"résumé global en 1-2 phrases","idees":[{"paire":"BTC/USD","sens":"LONG|SHORT","tf":"H1|H4|D1",' +
      '"entree":00,"stop":00,"objectif":00,"rr":0.0,"confiance":0,"pourquoi":"explication ICT/SMC courte en français"}]}\n' +
      "Si rien n'atteint au moins 1 RR, renvoie \"idees\": [].";
    if (mtf && mtf.length) {
      txt += "\n\nDONNÉES MULTI-UNITÉS (D1 → H4 → H1) pour l'alignement top-down :\n" + JSON.stringify(mtf, null, 2);
    }
    txt += "\n\nRÉSUMÉ par paire (toutes paires, dont DXY/forex) :\n" + JSON.stringify(snap, null, 2);
    // Liaison des IA : on donne à Claude l'avis des autres moteurs du site
    // (IA maison ML + Quant market-neutral) comme confluence supplémentaire.
    if (collab) {
      txt += "\n\nAVIS DES AUTRES MOTEURS DU SITE (confluence — à confronter, PAS à suivre aveuglément) :\n" +
        JSON.stringify(collab, null, 2) +
        "\nSi tes idées vont dans le sens de l'IA maison et/ou du Quant, c'est un signal renforcé ; " +
        "en cas de désaccord net, sois plus prudent ou explique pourquoi tu diverges.";
    }
    // Base de connaissances : on injecte TOUTE la base (digest complet) pour
    // que l'IA raisonne sur les définitions et la méthode maison du site.
    var kb = root.KB;
    if (kb && typeof kb.digest === 'function') {
      txt += "\n\n" + kb.digest();
    } else if (kb && typeof kb.contextFor === 'function') {
      txt += "\n\n" + kb.contextFor('ICT SMC structure liquidité risque', 20);
    }
    return txt;
  }

  function analyze(pairs, mtf, collab) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('Aucune clé API. Colle ta clé Anthropic dans les réglages.'));
    var model = getModel();
    var body = {
      model: model,
      max_tokens: 4000, // marge pour la réflexion + le JSON (sinon risque de réponse coupée)
      output_config: { effort: 'low' }, // rapide & économique pour une analyse structurée
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUser(pairs, mtf, collab) }]
    };
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true' // requis pour appeler depuis un navigateur
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          if (res.status === 401) throw new Error('Clé API invalide (401).');
          if (res.status === 429) throw new Error('Limite atteinte (429) — réessaie plus tard.');
          throw new Error('Erreur API ' + res.status + ' : ' + t.slice(0, 200));
        });
      }
      return res.json();
    }).then(function (data) {
      if (data.stop_reason === 'refusal') throw new Error('Requête refusée par la sécurité du modèle.');
      var text = (data.content || []).filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; }).join('');
      var parsed = null;
      var m = text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (e) {} }
      return { raw: text, parsed: parsed, usage: data.usage || {}, model: data.model || model };
    });
  }

  root.AI = { analyze: analyze, getKey: getKey, setKey: setKey, getModel: getModel, setModel: setModel };
})(typeof window !== 'undefined' ? window : this);
