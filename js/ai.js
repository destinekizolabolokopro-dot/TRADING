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
  function getModel() { try { return localStorage.getItem(MODEL_STORE) || 'claude-opus-5'; } catch (e) { return 'claude-opus-5'; } }
  function setModel(m) { try { localStorage.setItem(MODEL_STORE, m); } catch (e) {} }

  var SYSTEM =
    "Tu es un analyste de trading ICT/SMC, prudent et honnête. Tu écris en français. " +
    "Tu n'es PAS un conseiller financier : tes idées sont pédagogiques, jamais des garanties. " +
    "Tu ne retiens que les setups à haute probabilité avec un ratio risque/rendement >= 2. " +
    "Tu croises le contexte DXY (un DXY baissier favorise crypto/or, un DXY haussier les défavorise). " +
    "Si aucun setup n'est convaincant, tu le dis clairement plutôt que de forcer un trade. " +
    "Rappelle une règle de gestion : risque max 1 % du compte par trade.";

  function buildUser(pairs) {
    var snap = pairs.map(function (p) {
      return {
        paire: p.sym, prix: p.price, sens_calcule: p.dir, cycle: p.cycle,
        confluence_pct: p.conf, entree: p.entry, stop: p.sl, objectif: p.tp, rr: p.rr, note: p.note
      };
    });
    return "Voici l'état actuel du marché (données réelles, analyse ICT/SMC déjà calculée par le site). " +
      "Donne TES meilleures idées de trade (0 à 3), classées de la plus forte à la plus faible. " +
      "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :\n" +
      '{"marche":"résumé global du marché en 1-2 phrases","idees":[{"paire":"BTC/USD","sens":"LONG|SHORT",' +
      '"entree":00,"stop":00,"objectif":00,"rr":0.0,"confiance":0,"pourquoi":"explication courte en français"}]}\n' +
      "Si rien ne vaut le coup, renvoie \"idees\": []. Données :\n" + JSON.stringify(snap, null, 2);
  }

  function analyze(pairs) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('Aucune clé API. Colle ta clé Anthropic dans les réglages.'));
    var model = getModel();
    var body = {
      model: model,
      max_tokens: 2000,
      output_config: { effort: 'low' }, // rapide & économique pour une analyse structurée
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUser(pairs) }]
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
