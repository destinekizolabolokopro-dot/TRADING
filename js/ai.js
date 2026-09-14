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
  var STYLE_STORE = 'anthropic.style';
  var ENDPOINT = 'https://api.anthropic.com/v1/messages';

  // Styles de trading = quelles unités de temps le bot exploite.
  var STYLES = {
    scalp:    { nom: 'Scalp',    tfs: 'M1, M5, M15',  htf: 'M15/H1', ltf: 'M1/M5',  horizon: 'quelques minutes à 1-2 h' },
    intraday: { nom: 'Intraday', tfs: 'M15, H1, H4',  htf: 'H4/H1',  ltf: 'M15',    horizon: 'quelques heures (clôturé le jour même)' },
    swing:    { nom: 'Swing',    tfs: 'H1, H4, D1',   htf: 'D1/H4',  ltf: 'H1',     horizon: 'quelques jours' }
  };

  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(KEY_STORE, (k || '').trim()); } catch (e) {} }
  function getModel() { try { return localStorage.getItem(MODEL_STORE) || 'claude-haiku-4-5'; } catch (e) { return 'claude-haiku-4-5'; } }
  function setModel(m) { try { localStorage.setItem(MODEL_STORE, m); } catch (e) {} }
  function getStyle() { try { return localStorage.getItem(STYLE_STORE) || 'swing'; } catch (e) { return 'swing'; } }
  function setStyle(s) { try { localStorage.setItem(STYLE_STORE, s); } catch (e) {} }

  var SYSTEM =
    "Tu es le CERVEAU CENTRAL d'un site de trading ICT/SMC, propulsé par Claude (Anthropic). Tu écris en français. " +
    "Tu centralises TOUTES les données du site — signaux ICT/SMC, IA maison (ML), Quant (market-neutral), Stratégies Pro, " +
    "calendrier économique et la base de 303 concepts + setups — pour produire LES positions finales unifiées. Rien n'est éparpillé : tout converge vers ta décision. " +
    "Tu opères sur les unités de temps du STYLE demandé (précisé dans le message : Scalp, Intraday ou Swing). " +
    "Tu raisonnes en TOP-DOWN : le biais vient de l'unité haute du style, tu affines sur l'intermédiaire, tu synchronises l'entrée sur l'unité basse. " +
    "Tu bases tes décisions PRINCIPALEMENT sur les concepts ICT/SMC (structure & BOS/CHoCH, MSS, FVG, order blocks, " +
    "breaker, OTE 62-79%, liquidité/equal highs-lows, premium/discount, cycles Accumulation-Manipulation-Expansion-Distribution), " +
    "MAIS tu es LIBRE d'employer toute autre technique intelligente et pertinente (momentum, confluence multi-unités, " +
    "corrélations, contexte DXY) si elle augmente la probabilité de gagner. " +
    "Le DXY est inversé pour crypto/or : DXY baissier = favorable, DXY haussier = défavorable. " +
    "Tu appliques UNE SEULE stratégie : le MECH MODEL de PB Blake (modèle mécanique, règles fixes, zéro interprétation). " +
    "PRIORITÉ ABSOLUE : MAXIMISER LE TAUX DE RÉUSSITE (~70-80 %), pas le gain. RR visé : 1:1 à 1:1,5 — petit RR, objectif TRÈS PROCHE " +
    "(l'EQ du gap non comblé), atteint souvent. Un trade à 80 % pour +1 RR vaut MIEUX qu'un trade à 40 % pour +3 RR : " +
    "l'objectif est une série de petits gains réguliers. " +
    "RÈGLE STRICTE : n'envoie JAMAIS un trade sous 1 RR. Point d'entrée précis, stop au-delà d'un balayage/structure, objectif proche et réaliste. " +
    "Sois HONNÊTE : si aucun setup n'est net, renvoie une liste vide plutôt que de forcer un trade. " +
    "En PLUS de tes idées de trade, tu fais DEUX choses : " +
    "(1) AMD — pour chaque actif pertinent, identifie sa phase du Power of 3 : Accumulation (range), " +
    "Manipulation (faux mouvement / balayage de liquidité), Distribution (vrai mouvement dirigé) ou Expansion. " +
    "(2) PRESHOT — repère les setups EN PRÉPARATION (pré-signaux) : les conditions s'alignent mais le déclencheur " +
    "n'est PAS encore validé. Pour chacun, dis ce qui manque et le déclencheur précis à surveiller. Un preshot n'est PAS " +
    "un trade à prendre maintenant : c'est une alerte « bientôt prêt ». " +
    "Pour CHAQUE idée de trade, le champ \"pourquoi\" doit être DÉTAILLÉ et structuré (2 à 4 phrases) : " +
    "1) le BIAIS et son unité de temps ; 2) le SETUP précis (nom) et le DÉCLENCHEUR qui l'a validé (sweep, MSS, FVG…) ; " +
    "3) la CONFLUENCE (killzone, discount/premium, SMT, DXY…) ; 4) POURQUOI le stop est là (invalidation) et POURQUOI la cible (liquidité visée). " +
    "FENÊTRE DE TRADING : tu ne proposes de NOUVELLES positions QU'ENTRE l'ouverture de Wall Street (09 h 30 à New York) et 17 h 00 heure française. Hors de cette fenêtre, \"idees\" doit être VIDE, quoi qu'il arrive — même si un setup MECH parfait se présente. L'état exact de la fenêtre t'est donné dans le message. "
    "Tu n'es pas un conseiller financier ; règle de gestion : risque max 1 % du compte par trade.";

  function buildUser(pairs, mtf, collab, style) {
    var st = STYLES[style] || STYLES.swing;
    var snap = pairs.map(function (p) {
      return {
        paire: p.sym, prix: p.price, sens_calcule: p.dir, cycle: p.cycle,
        confluence_pct: p.conf, entree: p.entry, stop: p.sl, objectif: p.tp, rr: p.rr, note: p.note
      };
    });
    var txt = "";
    // La fenêtre de trading passe AVANT tout le reste : si elle est fermée,
    // aucune analyse ne peut déboucher sur une position.
    if (root.WINDOW && typeof root.WINDOW.promptBlock === 'function') {
      txt += root.WINDOW.promptBlock() + "\n\n";
    }
    // LES DONNÉES DU MECH : NQ (exécution) + ES (SMT). Sans elles, pas de modèle.
    // Elles passent juste après la fenêtre, avant toute autre information.
    if (root.NQ && typeof root.NQ.promptBlock === 'function') {
      txt += root.NQ.promptBlock() + "\n\n";
    }
    txt += "STYLE DEMANDÉ : " + st.nom.toUpperCase() + " — travaille sur les unités " + st.tfs +
      " (biais sur " + st.htf + ", entrée sur " + st.ltf + "), horizon ~" + st.horizon + ". " +
      "Adapte tes entrées/stops/objectifs à ce style (en scalp, stops et objectifs plus serrés).\n\n" +
      "Tu es le Bot IA du site. Sois ULTRA-SÉLECTIF : n'envoie QUE des setups A ou A+ (confiance >= 70), " +
      "0 à 2 idées MAXIMUM, sur les unités du style ci-dessus, classées de la plus forte à la plus faible. " +
      "Mieux vaut renvoyer une liste VIDE que des trades moyens — la sélectivité prime sur la quantité. " +
      "N'inclus QUE des trades dont le rr est >= 1 (privilégie 2, 3, 4 ou plus). Jamais de trade sous 1 RR. " +
      "Ajoute AUSSI : \"amd\" (phase Power of 3 de chaque actif pertinent) et \"preshot\" (setups en préparation, " +
      "pas encore déclenchés). " +
      "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :\n" +
      '{"marche":"résumé global en 1-2 phrases",' +
      '"amd":[{"paire":"BTC/USD","phase":"Accumulation|Manipulation|Distribution|Expansion","note":"courte explication"}],' +
      '"preshot":[{"paire":"NQ","sens":"LONG|SHORT","tf":"M5|M15","setup":"étape du MECH atteinte (ex. sweep de liquidité, structure valide, attente d\'inversion)",' +
      '"zone":"zone/niveau à surveiller","manque":"ce qui manque pour valider","declencheur":"le signal précis qui validera l\'entrée","confiance":0}],' +
      '"idees":[{"paire":"NQ","sens":"LONG|SHORT","tf":"M5|M15","strategie":"MECH Model (précise l\'entrée : inversion M1 / order block / FVG)",' +
      '"entree":00,"stop":00,"objectif":00,"rr":0.0,"confiance":0,"pourquoi":"déclencheur + confirmations + confluence indicateurs, en français"}]}\n' +
      "Si rien n'atteint au moins 1 RR, renvoie \"idees\": []. Renvoie \"amd\": [] et \"preshot\": [] si tu n'as rien à signaler.";
    if (mtf && mtf.length) {
      txt += "\n\nDONNÉES MULTI-UNITÉS (D1 → H4 → H1) pour l'alignement top-down :\n" + JSON.stringify(mtf, null, 2);
    }
    txt += "\n\nRÉSUMÉ par paire (toutes paires, dont DXY/forex) :\n" + JSON.stringify(snap, null, 2);
    // Liaison des IA : on donne à Claude l'avis des autres moteurs du site
    // (IA maison ML + Quant market-neutral) comme confluence supplémentaire.
    if (collab) {
      txt += "\n\n=== DONNÉES DE TOUS LES MOTEURS DU SITE (tu es le CERVEAU CENTRAL qui les unifie) ===\n" +
        JSON.stringify(collab, null, 2) +
        "\nTu centralises TOUTES ces sources (signaux ICT/SMC, IA maison ML, Quant market-neutral, Stratégies Pro) " +
        "en UNE décision. Méthode d'unification : un actif où PLUSIEURS moteurs sont d'accord (ex. ICT LONG + IA maison fort + Quant jambe longue + Pro haussier) = signal RENFORCÉ, priorité haute et confiance élevée ; " +
        "en cas de désaccord entre moteurs, tranche avec la méthode ICT/SMC (structure, liquidité, biais HTF) et baisse la confiance, ou n'envoie rien. " +
        "Dans le champ \"pourquoi\", cite quels moteurs sont alignés (ex. « 4/4 moteurs d'accord »). Ne suis jamais un seul moteur aveuglément.";
    }
    // Méthode obligatoire : d'abord les stratégies enregistrées, puis à défaut
    // un setup concepts ICT/SMC + confluence indicateurs.
    txt += "\n\n=== TU TRADES UNE SEULE STRATÉGIE : LE MECH MODEL (PB Blake) ===\n" +
      "IGNORE toute autre stratégie. Le MECH Model est un modèle MÉCANIQUE : si les règles ne sont pas TOUTES cochées, il n'y a PAS de trade.\n" +
      "PROCÉDURE pour CHAQUE actif :\n" +
      "1) CONTEXTE : marque le biais du jour, les niveaux clés HTF, les pools de liquidité des sessions ASIE et LONDRES, " +
      "le PDH/PDL (plus-haut/plus-bas de la veille), les hauts/bas marquants dans les gaps, et les FVG H1/H4/D1.\n" +
      "2) CIBLE : identifie les GAPS NON COMBLÉS en M5/M15 — c'est l'objectif du modèle (l'EQ/équilibre du gap).\n" +
      "3) STRUCTURE VALIDE : il faut un swing low, un swing high, un lower low ET un BALAYAGE de liquidité (sweep). Sinon : pas de trade.\n" +
      "4) DÉCLENCHEUR : le prix REJETTE un niveau clé HTF, puis tu entres sur l'INVERSION (repérée dans la plus haute unité de la jambe ; " +
      "le setup d'inversion M1 suffit). Entrée alternative : order block (OB haussier = bougie rouge entre deux vertes) ou FVG. " +
      "Tiens compte des CLÔTURES : si la bougie clôture haut, privilégie un ORDRE LIMITE plutôt que de chasser.\n" +
      "5) STOP : au swing low du gap ou de l'OB (ou toute la structure de la bougie OB, ou le bas du FVG).\n" +
      "6) OBJECTIF : l'EQ du gap non comblé ; secondaire 1:1. RR visé 1:1 à 1:1,5 — PETIT RR, GROS TAUX DE RÉUSSITE (~70-80 %). " +
      "Break-even : stop au point d'entrée une fois le gap comblé OU le 1:1 atteint.\n" +
      "7) FILTRES ÉLIMINATOIRES (c'est eux qui font le win rate) : ❌ JAMAIS contre une divergence SMT ; ❌ jamais contre la tendance dominante ; " +
      "❌ évite les entrées avec déplacement au-dessus du buy-side/sell-side. Le meilleur cas : rejet de liquidité ET rejet de période alignés.\n" +
      "Mets toujours 'strategie':'MECH Model' (précise l'entrée : inversion M1 / order block / FVG). " +
      "Un setup repéré mais pas encore déclenché va dans 'preshot' avec le niveau exact à surveiller. " +
      "Si les règles du MECH ne sont pas réunies sur un actif : AUCUN trade sur cet actif (liste vide plutôt qu'un trade forcé).\n";
    // Conscience du calendrier : date/heure du jour + annonces économiques à
    // fort impact (FOMC/CPI/NFP/OPEX), pour que l'IA évite de trader dans le chaos.
    if (root.ECON && typeof root.ECON.promptBlock === 'function') {
      txt += "\n\n" + root.ECON.promptBlock();
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
    var style = getStyle();
    var body = {
      model: model,
      max_tokens: 6000, // marge pour AMD + preshot + raisons détaillées + JSON
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUser(pairs, mtf, collab, style) }]
    };
    // Le paramètre `effort` n'est supporté que par certains modèles (Opus/Sonnet
    // récents). Haiku 4.5 le refuse (erreur 400) — on ne l'envoie que si le
    // modèle le connaît, sinon on l'omet.
    if (/opus|sonnet/i.test(model)) {
      body.output_config = { effort: 'low' }; // rapide & économique pour une analyse structurée
    }
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

  root.AI = { analyze: analyze, getKey: getKey, setKey: setKey, getModel: getModel, setModel: setModel,
    getStyle: getStyle, setStyle: setStyle, STYLES: STYLES };
})(typeof window !== 'undefined' ? window : this);
