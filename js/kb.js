/*
 * kb.js — LA BASE DE CONNAISSANCES TRADING du site
 * =============================================================================
 * Une base de données de concepts la plus complète possible : ICT, SMC,
 * analyse technique classique, figures chartistes, chandeliers japonais,
 * indicateurs, order flow / volume, gestion du risque, psychologie,
 * macro / fondamental, sessions & horaires, statistiques / quant.
 *
 * Chaque entrée est structurée :
 *   { id, nom, alias[], cat, tags[], def, usage, biais }
 *     - id     : identifiant unique (slug)
 *     - nom    : nom affiché (français)
 *     - alias  : autres noms / termes anglais (pour la recherche)
 *     - cat    : catégorie (voir KB.CATEGORIES)
 *     - tags   : mots-clés pour filtrage/recherche
 *     - def    : définition claire
 *     - usage  : comment on s'en sert concrètement en trading
 *     - biais  : ce que le concept signale (haussier / baissier / neutre / contexte)
 *
 * Le module expose window.KB avec :
 *   KB.CATEGORIES        liste des catégories { id, nom, emoji }
 *   KB.all               tableau de tous les concepts
 *   KB.byId(id)          un concept par id
 *   KB.byCat(catId)      tous les concepts d'une catégorie
 *   KB.search(q)         recherche plein-texte (nom, alias, def, usage, tags)
 *   KB.contextFor(q, n)  bloc texte compact (top n concepts) à injecter dans l'IA
 *   KB.stats()           { total, parCategorie }
 *
 * Objectif : que l'IA (Claude) ET l'utilisateur puissent s'y référer.
 * Pédagogique — pas un conseil financier.
 */
(function (root) {
  'use strict';

  var CATEGORIES = [
    { id: 'ict',      nom: 'ICT (Inner Circle Trader)',   emoji: '🎯' },
    { id: 'smc',      nom: 'Smart Money Concepts',        emoji: '🏦' },
    { id: 'structure',nom: 'Structure de marché',         emoji: '🧱' },
    { id: 'at',       nom: 'Analyse technique classique', emoji: '📐' },
    { id: 'figures',  nom: 'Figures chartistes',          emoji: '📊' },
    { id: 'chandelier',nom:'Chandeliers japonais',        emoji: '🕯️' },
    { id: 'indic',    nom: 'Indicateurs',                 emoji: '📈' },
    { id: 'flow',     nom: 'Order flow & volume',         emoji: '🌊' },
    { id: 'risque',   nom: 'Gestion du risque',           emoji: '🛡️' },
    { id: 'psycho',   nom: 'Psychologie du trading',      emoji: '🧠' },
    { id: 'macro',    nom: 'Macro & fondamental',         emoji: '🌍' },
    { id: 'session',  nom: 'Sessions & horaires',         emoji: '⏰' },
    { id: 'quant',    nom: 'Quant & statistiques',        emoji: '🔬' },
    { id: 'produits', nom: 'Produits & marchés',          emoji: '💱' },
    { id: 'strat',    nom: 'Stratégies de trading',       emoji: '♟️' },
    { id: 'wyckoff',  nom: 'Wyckoff',                     emoji: '📉' },
    { id: 'onchain',  nom: 'Crypto & on-chain',           emoji: '⛓️' }
  ];

  // ---------------------------------------------------------------------------
  // LES CONCEPTS
  // ---------------------------------------------------------------------------
  var C = [];
  function add(o) { C.push(o); }

  /* ===================== ICT (Inner Circle Trader) ===================== */
  add({ id:'fvg', nom:'Fair Value Gap (FVG)', alias:['imbalance','déséquilibre','gap de valeur','FVG','BISI','SIBI'], cat:'ict', tags:['déséquilibre','gap','entrée','3 bougies'],
    def:"Zone de déséquilibre laissée par 3 bougies : l'ombre de la 1ʳᵉ et celle de la 3ᵉ ne se chevauchent pas, laissant un « trou » de prix non négocié entre elles. BISI = déséquilibre haussier, SIBI = déséquilibre baissier.",
    usage:"On s'attend à ce que le prix revienne combler (partiellement ou totalement) le FVG avant de repartir. Sert de zone d'entrée : on entre quand le prix retape le FVG dans le sens du biais.",
    biais:'contexte — un FVG haussier soutient un long, un FVG baissier soutient un short' });
  add({ id:'ob', nom:'Order Block (OB)', alias:['bloc d’ordres','order block','OB','bloc institutionnel'], cat:'ict', tags:['zone','institutionnel','entrée','origine'],
    def:"Dernière bougie opposée avant un mouvement impulsif qui casse la structure. Un OB haussier = dernière bougie baissière avant une forte hausse ; OB baissier = dernière bougie haussière avant une forte baisse.",
    usage:"Zone d'entrée à haute probabilité : on attend le retour du prix dans l'OB pour se positionner dans le sens de l'impulsion qui l'a suivi. On invalide si le prix traverse franchement l'OB.",
    biais:'contexte — l’OB donne le sens et la zone d’entrée' });
  add({ id:'breaker', nom:'Breaker Block', alias:['breaker','bloc cassé'], cat:'ict', tags:['zone','structure cassée','support-résistance'],
    def:"Order block qui a échoué : le prix l'a traversé et a cassé la structure. L'ancien OB devient alors une zone qui joue le rôle inverse (un OB haussier cassé devient résistance).",
    usage:"On l'utilise comme zone de rejet après un changement de structure : le prix revient tester le breaker et repart dans le nouveau sens.",
    biais:'contexte — confirme le nouveau biais après cassure' });
  add({ id:'mss', nom:'Market Structure Shift (MSS)', alias:['MSS','changement de structure','shift'], cat:'ict', tags:['retournement','structure','signal'],
    def:"Cassure de structure qui signale un possible retournement : le prix casse un plus-bas récent (dans une tendance haussière) ou un plus-haut récent (dans une tendance baissière), généralement avec un déplacement énergique.",
    usage:"Signal de retournement le plus fort d'ICT : après un MSS on cherche un FVG/OB dans le nouveau sens pour entrer.",
    biais:'retournement — MSS haussier = biais long, MSS baissier = biais short' });
  add({ id:'bos', nom:'Break of Structure (BOS)', alias:['BOS','cassure de structure','continuation'], cat:'structure', tags:['continuation','tendance','structure'],
    def:"Cassure d'un point de structure DANS le sens de la tendance en cours : nouveau plus-haut au-dessus du dernier sommet (haussier) ou nouveau plus-bas (baissier). Confirme la continuation.",
    usage:"Valide que la tendance se poursuit. On trade les pullbacks après un BOS, pas contre lui.",
    biais:'continuation — confirme la tendance en place' });
  add({ id:'choch', nom:'Change of Character (CHoCH)', alias:['CHoCH','changement de caractère'], cat:'structure', tags:['retournement','premier signal'],
    def:"Premier signe qu'une tendance faiblit : dans une hausse faite de plus-hauts/plus-bas montants, le prix fait pour la première fois un plus-bas plus bas (et inversement en baisse).",
    usage:"Alerte précoce de retournement. Plus doux que le MSS : on attend souvent confirmation avant d'entrer contre la tendance.",
    biais:'retournement potentiel — début de bascule' });
  add({ id:'ote', nom:'Optimal Trade Entry (OTE)', alias:['OTE','entrée optimale','62-79','Fibonacci ICT'], cat:'ict', tags:['fibonacci','retracement','entrée'],
    def:"Zone de retracement Fibonacci 62 %–79 % d'une impulsion, considérée par ICT comme la zone d'entrée optimale (idéalement avec le 70,5 % / OTE profond).",
    usage:"Après une impulsion + MSS, on trace le Fib et on vise une entrée dans la bande 62-79 %, souvent en confluence avec un OB/FVG.",
    biais:'contexte — zone d’entrée dans le sens de l’impulsion' });
  add({ id:'liquidity', nom:'Liquidité (Buy-side / Sell-side)', alias:['liquidity','BSL','SSL','pool de liquidité','stops'], cat:'ict', tags:['stops','pool','cible','aimant'],
    def:"Zones où sont accumulés les ordres stop : au-dessus des plus-hauts (buy-side liquidity, stops des vendeurs) et sous les plus-bas (sell-side liquidity, stops des acheteurs). Le prix est attiré vers ces pools.",
    usage:"On identifie où sont les stops (equal highs/lows, sommets/creux évidents) : ce sont les cibles (objectifs) et les zones de balayage avant retournement.",
    biais:'aimant — indique où le prix veut aller' });
  add({ id:'liquidity-sweep', nom:'Liquidity Sweep / Raid', alias:['sweep','raid','balayage','stop hunt','chasse aux stops'], cat:'ict', tags:['manipulation','faux mouvement','retournement'],
    def:"Balayage d'un pool de liquidité : le prix perce brièvement un plus-haut/plus-bas pour déclencher les stops, puis repart en sens inverse. Faux mouvement typique du smart money.",
    usage:"Setup de retournement clé : on attend le balayage d'un extrême + un MSS/CHoCH pour entrer dans le sens du rejet (Turtle Soup).",
    biais:'retournement — après le balayage, on trade le rejet' });
  add({ id:'turtle-soup', nom:'Turtle Soup', alias:['turtle soup','faux breakout','stop run'], cat:'ict', tags:['retournement','faux breakout','liquidité'],
    def:"Setup contre-tendance : faux dépassement d'un plus-haut/plus-bas (balayage de liquidité) suivi d'un retour rapide dans le range. On fade le faux breakout.",
    usage:"Entrée après le retour à l'intérieur du range + confirmation (MSS). Stop au-delà de l'extrême balayé.",
    biais:'retournement' });
  add({ id:'judas', nom:'Judas Swing', alias:['judas','faux mouvement d’ouverture'], cat:'ict', tags:['manipulation','ouverture','session'],
    def:"Faux mouvement initial en début de session (souvent Londres/New York) qui piège les traders, avant le vrai mouvement en sens inverse.",
    usage:"On se méfie du premier mouvement d'une session ; on attend le balayage + le retournement pour se positionner dans le vrai sens.",
    biais:'manipulation — le 1ᵉʳ mouvement est souvent un piège' });
  add({ id:'silver-bullet', nom:'Silver Bullet', alias:['silver bullet','fenêtre 10-11'], cat:'ict', tags:['horaire','fvg','setup'],
    def:"Setup ICT sur une fenêtre horaire précise (ex. 10h-11h heure de New York) : on cherche un FVG formé dans cette fenêtre pour une entrée rapide vers la liquidité proche.",
    usage:"Dans la fenêtre, repérer l'impulsion, tracer le FVG, entrer sur le retour, viser le pool de liquidité le plus proche.",
    biais:'contexte — dépend du biais du jour' });
  add({ id:'power-of-3', nom:'Power of Three (AMD)', alias:['po3','power of three','AMD','accumulation manipulation distribution'], cat:'ict', tags:['cycle','journée','institutionnel'],
    def:"Modèle en 3 phases d'une bougie/journée institutionnelle : Accumulation (range), Manipulation (faux mouvement / balayage), Distribution (vrai mouvement dirigé).",
    usage:"Cadre pour lire une journée : on attend la manipulation (piège) puis on suit la distribution. Aide à ne pas entrer pendant l'accumulation.",
    biais:'cadre directionnel de la séance' });
  add({ id:'ipda', nom:'IPDA (Interbank Price Delivery Algorithm)', alias:['IPDA','algorithme'], cat:'ict', tags:['théorie','algorithme','institutionnel'],
    def:"Concept ICT : le prix serait livré par un algorithme interbancaire qui recherche liquidité et rééquilibrage des déséquilibres (FVG), sur des plages temporelles récurrentes (20/40/60 jours).",
    usage:"Sert de grille de lecture : le prix va chercher la liquidité et combler les FVG de façon « programmée ». Aide à anticiper les cibles.",
    biais:'cadre théorique' });
  add({ id:'pd-array', nom:'PD Array (Premium/Discount Array)', alias:['pd array','premium discount array'], cat:'ict', tags:['zones','hiérarchie','entrée'],
    def:"Ensemble hiérarchisé des zones d'intérêt ICT (OB, FVG, breaker, mitigation, liquidité) réparties entre premium (cher) et discount (bon marché) d'un range.",
    usage:"On achète dans le discount sur une PD array haussière, on vend dans le premium sur une PD array baissière.",
    biais:'contexte — cadre d’entrée' });
  add({ id:'mitigation', nom:'Mitigation Block', alias:['mitigation','bloc de mitigation'], cat:'ict', tags:['zone','réentrée','institutionnel'],
    def:"Zone d'où le smart money « mitige » (réduit) une position perdante en réentrant : dernier order block avant un mouvement, retesté pour équilibrer les positions.",
    usage:"Zone de réentrée dans le sens de la tendance après un pullback, similaire à l'OB.",
    biais:'contexte — continuation' });
  add({ id:'rejection-block', nom:'Rejection Block', alias:['rejection block','bloc de rejet','mèches'], cat:'ict', tags:['mèches','rejet','zone'],
    def:"Zone définie par un amas de longues mèches (rejets) plutôt que par des corps de bougies — marque un refus de prix marqué.",
    usage:"On l'utilise comme zone de rejet : le prix qui y revient tend à être repoussé.",
    biais:'contexte' });
  add({ id:'smt', nom:'SMT Divergence', alias:['SMT','smart money technique','divergence corrélée'], cat:'ict', tags:['divergence','corrélation','confirmation'],
    def:"Divergence entre deux actifs corrélés : l'un fait un nouveau plus-haut/bas, l'autre non. Signale que le mouvement manque de conviction (ex. ES vs NQ, EUR vs GBP, BTC vs ETH).",
    usage:"Confirmation de retournement : une SMT au moment d'un balayage renforce le signal.",
    biais:'confirmation de retournement' });
  add({ id:'ifvg', nom:'Inversion FVG (iFVG)', alias:['iFVG','inversion fair value gap','FVG inversé'], cat:'ict', tags:['fvg','inversion','support-résistance'],
    def:"FVG traversé qui inverse son rôle : un FVG haussier cassé devient zone de résistance (et inversement). Équivalent du breaker mais pour un FVG.",
    usage:"Zone de rejet après cassure — confirme le nouveau biais.",
    biais:'contexte — confirme le nouveau sens' });
  add({ id:'nwog', nom:'New Week/Day Opening Gap', alias:['NWOG','NDOG','gap d’ouverture','opening gap'], cat:'ict', tags:['gap','ouverture','niveau'],
    def:"Écart entre la clôture du vendredi/veille et l'ouverture du dimanche/jour suivant. Agit comme un niveau d'équilibre que le prix tend à revisiter.",
    usage:"Niveau de référence : zones de rééquilibrage, souvent testées en début de semaine/journée.",
    biais:'niveau d’équilibre' });
  add({ id:'consequent-encroachment', nom:'Consequent Encroachment (CE)', alias:['CE','consequent encroachment','milieu du FVG'], cat:'ict', tags:['fvg','niveau','50%'],
    def:"Le point médian (50 %) d'un FVG. ICT considère que le prix réagit souvent précisément au CE plutôt qu'au bord du gap.",
    usage:"On affine l'entrée au CE du FVG pour un stop plus serré.",
    biais:'niveau précis d’entrée' });
  add({ id:'dealing-range', nom:'Dealing Range', alias:['dealing range','range de travail'], cat:'ict', tags:['range','premium','discount'],
    def:"Le range de référence entre le dernier plus-haut et plus-bas significatifs, servant à mesurer premium/discount et à situer les PD arrays.",
    usage:"On divise ce range en 50 % ; au-dessus = premium (on vend), en dessous = discount (on achète).",
    biais:'cadre — situe premium/discount' });

  /* ===================== SMC (Smart Money Concepts) ===================== */
  add({ id:'premium-discount', nom:'Premium / Discount', alias:['premium','discount','équilibre','50%','cher bon marché'], cat:'smc', tags:['fibonacci','value','zone'],
    def:"Division d'un range par sa moitié (50 %) : au-dessus le prix est « cher » (premium, on cherche à vendre), en dessous il est « bon marché » (discount, on cherche à acheter). Le 50 % = équilibre.",
    usage:"Filtre d'entrée : n'acheter qu'en discount, ne vendre qu'en premium, pour un meilleur ratio.",
    biais:'contexte — améliore le RR' });
  add({ id:'inducement', nom:'Inducement (IDM)', alias:['inducement','IDM','appât','piège'], cat:'smc', tags:['piège','liquidité','avant OB'],
    def:"Liquidité « appât » placée juste avant une zone d'intérêt (OB) : un petit plus-haut/bas évident que le prix va balayer pour piéger les traders précoces avant d'atteindre la vraie zone.",
    usage:"On attend que l'inducement soit pris AVANT de considérer l'OB valide — évite les fausses entrées.",
    biais:'piège — filtre les zones' });
  add({ id:'liquidity-void', nom:'Liquidity Void', alias:['liquidity void','vide de liquidité','zone vide'], cat:'smc', tags:['déséquilibre','mouvement rapide'],
    def:"Large zone de prix parcourue très vite avec peu de transactions (souvent un gros FVG). Le prix tend à revenir la combler.",
    usage:"Cible de rééquilibrage : on anticipe un retour pour remplir le vide.",
    biais:'aimant — cible de retour' });
  add({ id:'equal-highs-lows', nom:'Equal Highs / Equal Lows', alias:['equal highs','equal lows','EQH','EQL','sommets égaux'], cat:'smc', tags:['liquidité','stops','cible'],
    def:"Deux sommets (ou creux) au même niveau : ils concentrent des stops juste au-dessus/dessous — une liquidité évidente que le marché va souvent chercher.",
    usage:"Cible de balayage : on s'attend à ce que le prix aille prendre ces stops avant de tourner.",
    biais:'aimant à liquidité' });
  add({ id:'flip-zone', nom:'Flip Zone / Support-Résistance inversé', alias:['flip','polarité','support devenu résistance'], cat:'smc', tags:['polarité','niveau'],
    def:"Niveau qui change de rôle : un support cassé devient résistance, une résistance cassée devient support (principe de polarité).",
    usage:"On trade le retest du niveau flippé dans le nouveau sens.",
    biais:'contexte — confirme la cassure' });
  add({ id:'supply-demand', nom:'Zones Offre / Demande', alias:['supply','demand','offre','demande','S/D'], cat:'smc', tags:['zone','institutionnel','base'],
    def:"Zones d'où part une forte impulsion : la demande (achat) sous le prix, l'offre (vente) au-dessus. Proches des order blocks mais définies par la base avant l'impulsion.",
    usage:"On achète en zone de demande fraîche, on vend en zone d'offre fraîche ; une zone « fraîche » (non retestée) est plus fiable.",
    biais:'contexte — demande = long, offre = short' });

  /* ===================== Structure de marché ===================== */
  add({ id:'trend', nom:'Tendance (HH/HL, LH/LL)', alias:['tendance','trend','higher high','lower low','plus-haut plus-bas'], cat:'structure', tags:['base','direction'],
    def:"Tendance haussière = suite de plus-hauts (HH) et plus-bas (HL) montants. Baissière = plus-hauts (LH) et plus-bas (LL) descendants. Range = absence de progression.",
    usage:"Base de tout : on trade dans le sens de la tendance de l'unité supérieure. « The trend is your friend ».",
    biais:'directionnel — donne le sens principal' });
  add({ id:'range', nom:'Range / Consolidation', alias:['range','consolidation','trading range','accumulation'], cat:'structure', tags:['latéral','borne'],
    def:"Phase latérale où le prix oscille entre un support et une résistance sans direction nette.",
    usage:"On achète le bas, on vend le haut du range ; ou on attend la cassure (breakout) pour suivre la sortie.",
    biais:'neutre — jusqu’à la cassure' });
  add({ id:'swing', nom:'Points de swing (Swing High/Low)', alias:['swing high','swing low','pivot','sommet','creux'], cat:'structure', tags:['pivot','référence'],
    def:"Sommet local (bougie entourée de bougies plus basses) ou creux local. Points de référence pour tracer la structure.",
    usage:"Servent à définir HH/HL/LH/LL, à placer stops et à détecter BOS/CHoCH.",
    biais:'référence structurelle' });
  add({ id:'mtf', nom:'Analyse multi-unités (Top-Down)', alias:['MTF','multi timeframe','top down','multi-unités'], cat:'structure', tags:['confluence','hiérarchie','biais'],
    def:"Analyse en cascade : l'unité haute (D1) donne le biais, l'unité moyenne (H4) affine la zone, l'unité basse (H1) synchronise l'entrée.",
    usage:"On aligne les unités : trader seulement quand H4 et H1 confirment le biais D1. Cœur de la méthode du site.",
    biais:'cadre — aligne les décisions' });
  add({ id:'internal-external', nom:'Liquidité interne vs externe', alias:['internal liquidity','external liquidity','range interne'], cat:'structure', tags:['liquidité','structure'],
    def:"Liquidité externe = extrêmes majeurs du range (sommets/creux). Liquidité interne = FVG et petits pools à l'intérieur. Le prix alterne : il prend l'interne pour aller vers l'externe.",
    usage:"On lit la séquence : prise de liquidité interne (FVG) → objectif liquidité externe (extrême).",
    biais:'cadre directionnel' });
  add({ id:'consolidation-expansion', nom:'Consolidation → Expansion', alias:['expansion','contraction','cycle de volatilité'], cat:'structure', tags:['volatilité','cycle'],
    def:"Le marché alterne phases de contraction (faible volatilité, range) et d'expansion (forte volatilité, tendance). La compression précède souvent l'explosion.",
    usage:"On se prépare à un mouvement après une longue compression (bandes de Bollinger resserrées, triangles).",
    biais:'cadre — anticipe le mouvement' });

  /* ===================== Analyse technique classique ===================== */
  add({ id:'sr', nom:'Support & Résistance', alias:['support','résistance','S/R','niveau'], cat:'at', tags:['niveau','base','zone'],
    def:"Support = niveau où les achats freinent la baisse ; résistance = niveau où les ventes freinent la hausse. Plus un niveau est testé, plus il est significatif (mais aussi plus il risque de céder).",
    usage:"On achète au support, on vend à la résistance ; on trade la cassure confirmée par un retest.",
    biais:'niveau — réaction attendue' });
  add({ id:'trendline', nom:'Ligne de tendance', alias:['trendline','oblique','ligne directrice'], cat:'at', tags:['dynamique','pente'],
    def:"Droite reliant au moins deux creux (haussière) ou deux sommets (baissier) montante/descendante, servant de support/résistance dynamique.",
    usage:"On trade les rebonds sur la ligne ou sa cassure. Une pente trop raide est fragile.",
    biais:'dynamique — suit la tendance' });
  add({ id:'channel', nom:'Canal', alias:['channel','canal','parallèles'], cat:'at', tags:['range dynamique','parallèle'],
    def:"Deux lignes de tendance parallèles encadrant le prix (canal haussier, baissier ou horizontal).",
    usage:"On achète le bas / vend le haut du canal ; la sortie du canal signale une accélération ou un retournement.",
    biais:'dynamique' });
  add({ id:'fibonacci', nom:'Retracements de Fibonacci', alias:['fibonacci','fibo','retracement','0.618','0.5','0.382'], cat:'at', tags:['retracement','niveau','ratio'],
    def:"Niveaux de retracement (23,6 / 38,2 / 50 / 61,8 / 78,6 %) d'une impulsion, où le prix tend à réagir. Le 61,8 % (nombre d'or) est le plus suivi.",
    usage:"On cherche une entrée dans la zone 50-61,8 % d'un pullback ; en ICT on privilégie 62-79 % (OTE).",
    biais:'contexte — zone d’entrée' });
  add({ id:'fib-extension', nom:'Extensions de Fibonacci', alias:['extension','projection','1.618','objectif fibo'], cat:'at', tags:['objectif','projection'],
    def:"Projections au-delà de 100 % (1,272 / 1,618 / 2,618…) servant à fixer des objectifs de prix.",
    usage:"Objectifs de take-profit après une cassure ou une impulsion.",
    biais:'objectif' });
  add({ id:'pivot-points', nom:'Points pivots', alias:['pivot points','pivots','R1 S1','floor trader pivots'], cat:'at', tags:['niveau','calculé','journalier'],
    def:"Niveaux calculés à partir du haut/bas/clôture de la veille (pivot central + supports S1-S3 et résistances R1-R3). Très suivis en intraday.",
    usage:"Niveaux de référence pour entrées, objectifs et stops intraday. Prix au-dessus du pivot = biais haussier du jour.",
    biais:'niveau — biais intraday' });
  add({ id:'vwap', nom:'VWAP', alias:['vwap','prix moyen pondéré volume'], cat:'indic', tags:['volume','moyenne','institutionnel'],
    def:"Prix moyen pondéré par le volume sur la session. Référence des institutionnels pour juger si le prix est « cher » ou « bon marché » sur la journée.",
    usage:"Au-dessus du VWAP = pression acheteuse ; on l'utilise comme support/résistance dynamique et cible d'exécution.",
    biais:'contexte — biais intraday' });
  add({ id:'ma', nom:'Moyennes mobiles (MA/EMA)', alias:['moyenne mobile','MA','EMA','SMA','20 50 200'], cat:'indic', tags:['tendance','lissage','dynamique'],
    def:"Moyenne du prix sur N périodes (simple SMA ou exponentielle EMA qui pondère le récent). Les 20, 50 et 200 sont les plus suivies.",
    usage:"Filtre de tendance (prix > MA200 = haussier) et support/résistance dynamique. Croisement 50/200 = golden/death cross.",
    biais:'directionnel — filtre de tendance' });
  add({ id:'golden-death-cross', nom:'Golden Cross / Death Cross', alias:['golden cross','death cross','croisement 50 200'], cat:'indic', tags:['croisement','tendance long terme'],
    def:"Golden cross = MA50 passe au-dessus de la MA200 (signal haussier de fond) ; death cross = l'inverse (baissier).",
    usage:"Signal de tendance de fond, lent mais suivi par beaucoup d'acteurs.",
    biais:'directionnel long terme' });

  /* ===================== Indicateurs ===================== */
  add({ id:'rsi', nom:'RSI', alias:['rsi','relative strength index','force relative','surachat survente'], cat:'indic', tags:['momentum','oscillateur','divergence'],
    def:"Oscillateur de momentum (0-100). >70 = suracheté, <30 = survendu. Mesure la vitesse et l'ampleur des variations.",
    usage:"Repérer excès et divergences (prix fait un plus-haut, RSI non = essoufflement). Attention : en forte tendance il reste extrême longtemps.",
    biais:'momentum — excès et divergences' });
  add({ id:'macd', nom:'MACD', alias:['macd','convergence divergence','histogramme'], cat:'indic', tags:['momentum','tendance','croisement'],
    def:"Différence entre deux EMA (12 et 26) avec une ligne de signal (9) et un histogramme. Mesure momentum et direction.",
    usage:"Croisement au-dessus de la ligne de signal = haussier ; divergences MACD/prix = essoufflement.",
    biais:'momentum + tendance' });
  add({ id:'stochastic', nom:'Stochastique', alias:['stochastic','stoch','%K %D'], cat:'indic', tags:['momentum','oscillateur','surachat'],
    def:"Oscillateur comparant la clôture à la fourchette haut-bas récente (0-100). >80 suracheté, <20 survendu.",
    usage:"Signaux de retournement dans les ranges ; croisements %K/%D. Peu fiable seul en tendance.",
    biais:'momentum' });
  add({ id:'bollinger', nom:'Bandes de Bollinger', alias:['bollinger','bandes','écart-type','volatilité'], cat:'indic', tags:['volatilité','moyenne','écart-type'],
    def:"Une moyenne mobile encadrée de deux bandes à ±2 écarts-types. Elles s'écartent quand la volatilité monte, se resserrent quand elle baisse (squeeze).",
    usage:"Le resserrement (squeeze) précède l'explosion ; le prix tend à revenir vers la moyenne. Toucher la bande n'est pas un signal en soi.",
    biais:'volatilité — anticipe le mouvement' });
  add({ id:'atr', nom:'ATR (Average True Range)', alias:['atr','average true range','volatilité','amplitude'], cat:'indic', tags:['volatilité','stop','sizing'],
    def:"Mesure de la volatilité moyenne (amplitude réelle des bougies) sur N périodes. N'indique pas la direction.",
    usage:"Dimensionner stops et objectifs proportionnellement à la volatilité (ex. stop à 1,5×ATR) et calibrer la taille de position.",
    biais:'volatilité — outil de gestion' });
  add({ id:'adx', nom:'ADX / DMI', alias:['adx','dmi','force de tendance','directional movement'], cat:'indic', tags:['tendance','force'],
    def:"Mesure la FORCE d'une tendance (0-100), pas sa direction. >25 = tendance nette, <20 = marché sans direction.",
    usage:"Filtre : on applique les stratégies de tendance quand ADX>25, les stratégies de range quand ADX est bas.",
    biais:'force — filtre de régime' });
  add({ id:'ichimoku', nom:'Ichimoku Kinko Hyo', alias:['ichimoku','nuage','kumo','tenkan kijun'], cat:'indic', tags:['tendance','support','japonais','tout-en-un'],
    def:"Système japonais complet : deux lignes (Tenkan/Kijun), un nuage (Kumo) qui projette support/résistance futurs, et une ligne retardée (Chikou).",
    usage:"Prix au-dessus du nuage = haussier ; le nuage épais = zone forte. Croisements Tenkan/Kijun pour timing.",
    biais:'directionnel + support/résistance' });
  add({ id:'obv', nom:'OBV (On-Balance Volume)', alias:['obv','on balance volume','volume cumulé'], cat:'flow', tags:['volume','confirmation','divergence'],
    def:"Volume cumulé additionné les jours de hausse et soustrait les jours de baisse. Mesure la pression achat/vente sous-jacente.",
    usage:"Confirme la tendance (OBV monte avec le prix) ou la contredit (divergence = essoufflement).",
    biais:'confirmation par le volume' });
  add({ id:'supertrend', nom:'SuperTrend', alias:['supertrend','suiveur ATR'], cat:'indic', tags:['tendance','stop suiveur','atr'],
    def:"Indicateur suiveur basé sur l'ATR qui bascule au-dessus/dessous du prix, donnant un signal directionnel binaire et un stop dynamique.",
    usage:"Suivre la tendance et trailer le stop ; il reste en retard sur les retournements brusques.",
    biais:'directionnel + trailing stop' });

  /* ===================== Figures chartistes ===================== */
  add({ id:'head-shoulders', nom:'Tête-épaules', alias:['tête épaules','head and shoulders','ETE','H&S'], cat:'figures', tags:['retournement','sommet'],
    def:"Figure de retournement : trois sommets, le central (tête) plus haut que les deux épaules, reliés par une ligne de cou (neckline). Inversée en creux = retournement haussier.",
    usage:"Cassure de la ligne de cou = signal ; objectif = hauteur tête-cou projetée sous la cassure.",
    biais:'retournement — H&S = baissier, inversée = haussier' });
  add({ id:'double-top-bottom', nom:'Double sommet / Double creux', alias:['double top','double bottom','W','M','double sommet'], cat:'figures', tags:['retournement','niveau'],
    def:"Deux sommets (M, baissier) ou deux creux (W, haussier) au même niveau : échec à dépasser l'extrême = retournement.",
    usage:"Entrée sur cassure du niveau intermédiaire ; objectif = hauteur de la figure.",
    biais:'retournement' });
  add({ id:'triangle', nom:'Triangles (sym./asc./desc.)', alias:['triangle','ascendant','descendant','symétrique','wedge'], cat:'figures', tags:['compression','continuation','breakout'],
    def:"Compression du prix entre deux lignes convergentes. Ascendant (résistance plate) = biais haussier ; descendant = baissier ; symétrique = neutre jusqu'à la cassure.",
    usage:"On trade la cassure dans le sens de la sortie ; objectif = hauteur de la base du triangle.",
    biais:'continuation le plus souvent' });
  add({ id:'flag-pennant', nom:'Drapeau / Fanion', alias:['flag','pennant','drapeau','fanion'], cat:'figures', tags:['continuation','pause','tendance'],
    def:"Petite consolidation (drapeau = canal court contre-tendance ; fanion = petit triangle) après une forte impulsion (le « mât »).",
    usage:"Figure de continuation : on entre sur la cassure dans le sens du mât ; objectif = longueur du mât projetée.",
    biais:'continuation' });
  add({ id:'wedge', nom:'Biseau (Wedge)', alias:['wedge','biseau','rising wedge','falling wedge'], cat:'figures', tags:['retournement','compression'],
    def:"Deux lignes convergentes inclinées dans le même sens : biseau ascendant (généralement baissier), biseau descendant (généralement haussier).",
    usage:"On trade la cassure à contre-pente ; souvent figure de retournement.",
    biais:'retournement — ascendant baissier, descendant haussier' });
  add({ id:'cup-handle', nom:'Tasse avec anse', alias:['cup and handle','tasse anse'], cat:'figures', tags:['continuation','haussier'],
    def:"Figure haussière : un arrondi en U (la tasse) suivi d'une petite consolidation (l'anse) avant la cassure haussière.",
    usage:"Achat sur cassure du bord de la tasse ; objectif = profondeur de la tasse.",
    biais:'continuation haussière' });
  add({ id:'rounding', nom:'Arrondi (Rounding top/bottom)', alias:['rounding bottom','soucoupe','arrondi'], cat:'figures', tags:['retournement','lent'],
    def:"Retournement progressif en forme de bol (bottom, haussier) ou de dôme (top, baissier), sans point net.",
    usage:"Retournement lent de fond ; on entre à la sortie de l'arrondi.",
    biais:'retournement' });

  /* ===================== Chandeliers japonais ===================== */
  add({ id:'doji', nom:'Doji', alias:['doji','indécision','corps plat'], cat:'chandelier', tags:['indécision','retournement'],
    def:"Bougie dont l'ouverture ≈ la clôture (corps minuscule) : indécision entre acheteurs et vendeurs.",
    usage:"Signal d'essoufflement en fin de mouvement, surtout à un niveau clé. À confirmer par la bougie suivante.",
    biais:'indécision — retournement potentiel' });
  add({ id:'marteau', nom:'Marteau / Pendu', alias:['hammer','marteau','hanging man','pendu','pin bar'], cat:'chandelier', tags:['rejet','mèche','retournement'],
    def:"Petit corps en haut, longue mèche basse (rejet des plus-bas). En bas de tendance = marteau (haussier) ; en haut = pendu (baissier).",
    usage:"Signal de rejet à un niveau ; on entre après confirmation dans le sens du rejet.",
    biais:'retournement selon le contexte' });
  add({ id:'etoile-filante', nom:'Étoile filante / Marteau inversé', alias:['shooting star','étoile filante','inverted hammer'], cat:'chandelier', tags:['rejet','mèche haute'],
    def:"Petit corps en bas, longue mèche haute (rejet des plus-hauts). En haut de tendance = étoile filante (baissier).",
    usage:"Signal de rejet du haut ; entrée baissière après confirmation.",
    biais:'retournement baissier en haut' });
  add({ id:'engulfing', nom:'Avalement (Engulfing)', alias:['engulfing','avalement','englobante'], cat:'chandelier', tags:['retournement','fort','deux bougies'],
    def:"Une grande bougie dont le corps englobe entièrement la précédente en sens opposé. Avalement haussier après une baisse, baissier après une hausse.",
    usage:"Signal de retournement fort, surtout à un niveau clé ou après un balayage.",
    biais:'retournement — fort' });
  add({ id:'harami', nom:'Harami', alias:['harami','bougie enfermée','inside'], cat:'chandelier', tags:['indécision','ralentissement'],
    def:"Petite bougie contenue dans le corps de la précédente (opposée) : perte de momentum.",
    usage:"Signale un ralentissement ; retournement potentiel à confirmer.",
    biais:'ralentissement' });
  add({ id:'etoiles', nom:'Étoile du matin / du soir', alias:['morning star','evening star','étoile du matin','étoile du soir'], cat:'chandelier', tags:['retournement','trois bougies'],
    def:"Figure en 3 bougies : impulsion, petite bougie d'indécision (étoile), puis forte bougie inverse. Matin = retournement haussier, soir = baissier.",
    usage:"Signal de retournement fiable en fin de mouvement, surtout à un niveau.",
    biais:'retournement' });
  add({ id:'trois-soldats', nom:'Trois soldats blancs / Trois corbeaux', alias:['three white soldiers','three black crows','soldats corbeaux'], cat:'chandelier', tags:['continuation','momentum'],
    def:"Trois grandes bougies consécutives dans le même sens (haussières = soldats, baissières = corbeaux) : forte conviction directionnelle.",
    usage:"Confirme un fort momentum ; attention à l'excès si le mouvement est déjà étendu.",
    biais:'continuation forte' });

  /* ===================== Order flow & volume ===================== */
  add({ id:'volume', nom:'Volume', alias:['volume','participation','flux'], cat:'flow', tags:['confirmation','participation'],
    def:"Quantité échangée sur une période. Confirme la conviction d'un mouvement : une cassure sur fort volume est plus fiable qu'une cassure sur faible volume.",
    usage:"On cherche l'expansion de volume sur les cassures et l'absence de volume sur les faux mouvements.",
    biais:'confirmation' });
  add({ id:'volume-profile', nom:'Volume Profile (VPVR)', alias:['volume profile','vpvr','profil de volume','POC','value area'], cat:'flow', tags:['niveau','POC','institutionnel'],
    def:"Histogramme du volume échangé par NIVEAU de prix (et non par temps). Le POC (point of control) = niveau le plus échangé ; la value area = 70 % du volume.",
    usage:"Le POC et les bords de value area agissent comme aimants et support/résistance. Les zones à faible volume (LVN) sont traversées vite.",
    biais:'niveau — aimants de prix' });
  add({ id:'delta', nom:'Delta / Cumulative Delta', alias:['delta','cvd','order flow','agressivité'], cat:'flow', tags:['agressivité','achat vente','institutionnel'],
    def:"Différence entre volume acheteur agressif (au marché) et vendeur agressif. Le CVD cumule ce delta pour montrer qui domine.",
    usage:"Divergence prix/CVD (prix monte, delta baisse) = achat qui s'essouffle. Outil avancé d'order flow.",
    biais:'confirmation d’agressivité' });
  add({ id:'footprint', nom:'Footprint / DOM', alias:['footprint','dom','carnet d’ordres','order book','tape'], cat:'flow', tags:['micro','carnet','institutionnel'],
    def:"Vue micro des transactions : le footprint montre le volume acheteur/vendeur à chaque prix ; le DOM (carnet) montre les ordres en attente.",
    usage:"Détecter absorption, icebergs, murs d'ordres. Réservé au scalping/day trading avancé.",
    biais:'micro-structure' });
  add({ id:'absorption', nom:'Absorption', alias:['absorption','iceberg','mur d’ordres'], cat:'flow', tags:['institutionnel','retournement'],
    def:"Un gros acteur absorbe passivement toute la pression (achats ou ventes) sans que le prix bouge : signe qu'une grosse main se positionne à contre-courant.",
    usage:"Absorption des ventes à un support = retournement haussier probable.",
    biais:'retournement — grosse main' });

  /* ===================== Gestion du risque ===================== */
  add({ id:'rr', nom:'Ratio Risque/Rendement (RR)', alias:['rr','risk reward','ratio','R:R'], cat:'risque', tags:['base','asymétrie','tp sl'],
    def:"Rapport entre le gain visé (distance entrée→objectif) et le risque pris (distance entrée→stop). Un RR de 3 = on vise 3× ce qu'on risque.",
    usage:"Cœur de la rentabilité : avec un RR de 2-3, on peut être rentable même en gagnant moins de la moitié des trades. Règle du site : jamais sous 1 RR.",
    biais:'gestion — asymétrie' });
  add({ id:'position-sizing', nom:'Taille de position', alias:['position sizing','sizing','lot','taille'], cat:'risque', tags:['calcul','capital','stop'],
    def:"Nombre d'unités/lots calculé pour que la perte au stop = un % fixe du capital. Taille = (capital × risque%) ÷ (distance au stop).",
    usage:"On dimensionne à partir du stop, jamais l'inverse. C'est ce qui protège le compte sur le long terme.",
    biais:'gestion — protège le capital' });
  add({ id:'risk-per-trade', nom:'Risque par trade (1 %)', alias:['risque 1%','risk per trade','fixed fractional'], cat:'risque', tags:['règle','capital','discipline'],
    def:"Ne jamais risquer plus d'un petit % fixe du capital sur un seul trade (souvent 1 %). Limite les dégâts d'une série de pertes.",
    usage:"Règle d'or : à 1 %, il faudrait 20+ pertes d'affilée pour perdre 20 % — statistiquement rare. Règle affichée sur le site.",
    biais:'gestion — survie' });
  add({ id:'stop-loss', nom:'Stop-loss', alias:['stop','sl','stop loss','arrêt de perte'], cat:'risque', tags:['protection','sortie','discipline'],
    def:"Ordre qui clôture automatiquement une position perdante à un niveau défini. Placé au-delà d'une structure/balayage logique, pas à distance arbitraire.",
    usage:"Non négociable : définir le stop AVANT d'entrer. On ne l'élargit jamais pour « laisser une chance ».",
    biais:'gestion — protection' });
  add({ id:'take-profit', nom:'Take-profit', alias:['tp','take profit','objectif','cible'], cat:'risque', tags:['sortie','objectif','liquidité'],
    def:"Niveau de sortie en gain, placé sur un obstacle logique : prochain pool de liquidité, extrême de range, niveau clé.",
    usage:"On peut sortir en plusieurs fois (partiels) et sécuriser le reste au seuil de rentabilité (break-even).",
    biais:'gestion — objectif' });
  add({ id:'break-even', nom:'Break-even / Sécurisation', alias:['break even','seuil de rentabilité','be','stop au prix d’entrée'], cat:'risque', tags:['sécurisation','trailing'],
    def:"Déplacer le stop au prix d'entrée une fois le trade suffisamment en profit : le trade devient « sans risque ».",
    usage:"À utiliser après un premier objectif ou un mouvement favorable net ; attention à ne pas le faire trop tôt (bruit).",
    biais:'gestion — sécurise' });
  add({ id:'trailing-stop', nom:'Stop suiveur (Trailing)', alias:['trailing stop','stop suiveur','suivi de tendance'], cat:'risque', tags:['tendance','laisser courir'],
    def:"Stop qui suit le prix à distance fixe ou selon la structure (sous chaque nouveau HL), pour laisser courir les gains dans une tendance.",
    usage:"Maximise les grandes tendances ; il coupe plus tôt dans les marchés hachés.",
    biais:'gestion — laisser courir' });
  add({ id:'drawdown', nom:'Drawdown', alias:['drawdown','perte maximale','dd'], cat:'risque', tags:['capital','série de pertes'],
    def:"Baisse depuis un sommet du capital jusqu'au creux suivant, exprimée en %. Mesure la douleur d'une stratégie.",
    usage:"On suit son drawdown max pour juger la robustesse ; un drawdown profond exige une taille de position plus prudente.",
    biais:'gestion — mesure du risque' });
  add({ id:'kelly', nom:'Critère de Kelly', alias:['kelly','kelly criterion','fraction optimale'], cat:'risque', tags:['sizing','optimal','maths'],
    def:"Formule donnant la fraction du capital à miser pour maximiser la croissance à long terme, selon le win rate et le gain moyen.",
    usage:"En pratique on utilise une fraction (demi-Kelly) car le plein Kelly est très volatil. Cadre théorique du sizing.",
    biais:'gestion — sizing mathématique' });
  add({ id:'expectancy', nom:'Espérance de gain', alias:['expectancy','espérance','edge','avantage'], cat:'risque', tags:['statistique','rentabilité'],
    def:"Gain moyen attendu par trade = (win% × gain moyen) − (loss% × perte moyenne). Positive = stratégie rentable sur la durée.",
    usage:"La vraie boussole : mieux vaut une petite espérance positive répétée que des gros coups aléatoires.",
    biais:'gestion — rentabilité réelle' });
  add({ id:'correlation-risk', nom:'Risque de corrélation', alias:['corrélation','exposition corrélée','concentration'], cat:'risque', tags:['exposition','diversification'],
    def:"Prendre plusieurs positions corrélées (BTC + ETH + SOL longs) = en réalité un seul gros pari. Le risque total dépasse la somme apparente.",
    usage:"On additionne le risque des positions corrélées et on plafonne l'exposition globale à un thème.",
    biais:'gestion — exposition réelle' });

  /* ===================== Psychologie ===================== */
  add({ id:'fomo', nom:'FOMO', alias:['fomo','peur de rater','fear of missing out'], cat:'psycho', tags:['émotion','entrée tardive'],
    def:"Peur de rater le mouvement, qui pousse à entrer tard, au pire moment, sans setup valide — souvent juste avant le retournement.",
    usage:"Antidote : un plan écrit et des règles d'entrée strictes. Si le setup est passé, on laisse filer.",
    biais:'biais — pousse aux erreurs' });
  add({ id:'revenge-trading', nom:'Revenge trading', alias:['revenge trading','trading de revanche','vengeance'], cat:'psycho', tags:['émotion','tilt','pertes'],
    def:"Vouloir « se refaire » immédiatement après une perte en surtradant ou en augmentant la taille : spirale destructrice.",
    usage:"Antidote : limite de pertes journalière + pause obligatoire après une série de pertes.",
    biais:'biais — destructeur' });
  add({ id:'discipline', nom:'Discipline & plan de trading', alias:['discipline','plan de trading','règles','process'], cat:'psycho', tags:['process','constance'],
    def:"Suivre un plan écrit (setups, gestion, horaires) indépendamment des émotions. La constance du process prime sur le résultat d'un trade.",
    usage:"On juge sa performance à la qualité d'exécution du plan, pas au P&L d'un trade isolé.",
    biais:'clé de la réussite' });
  add({ id:'journal', nom:'Journal de trading', alias:['journal','trading journal','carnet','revue'], cat:'psycho', tags:['revue','progression','données'],
    def:"Enregistrement systématique de chaque trade (setup, raison, émotion, résultat) pour identifier ses forces/faiblesses.",
    usage:"On relit régulièrement pour corriger les erreurs récurrentes. Le site tient un journal automatique des trades.",
    biais:'outil de progression' });
  add({ id:'overtrading', nom:'Surtrading (Overtrading)', alias:['overtrading','surtrading','trop de trades'], cat:'psycho', tags:['excès','frais','fatigue'],
    def:"Prendre trop de positions, souvent par ennui ou besoin d'action, sur des setups médiocres. Multiplie frais et erreurs.",
    usage:"Antidote : quotas de trades, checklist de qualité, accepter de ne rien faire quand il n'y a pas de setup A+.",
    biais:'biais — érode le compte' });
  add({ id:'loss-aversion', nom:'Aversion à la perte', alias:['loss aversion','aversion perte','couper les gains'], cat:'psycho', tags:['biais cognitif','asymétrie'],
    def:"Biais qui fait ressentir une perte ~2× plus fort qu'un gain équivalent : on coupe les gains trop tôt et on laisse courir les pertes (l'inverse du bon comportement).",
    usage:"Antidote : stops et objectifs mécaniques, décidés avant d'entrer, exécutés sans émotion.",
    biais:'biais cognitif' });
  add({ id:'confirmation-bias', nom:'Biais de confirmation', alias:['confirmation bias','biais de confirmation'], cat:'psycho', tags:['biais cognitif','analyse'],
    def:"Ne retenir que les informations qui confirment son idée de trade en ignorant les signaux contraires.",
    usage:"Antidote : chercher activement l'argument contraire (le « et si j'ai tort ? ») avant d'entrer.",
    biais:'biais cognitif' });

  /* ===================== Macro & fondamental ===================== */
  add({ id:'dxy', nom:'DXY (Indice du dollar)', alias:['dxy','dollar index','indice dollar','usd'], cat:'macro', tags:['dollar','corrélation','risque'],
    def:"Indice mesurant le dollar face à un panier de devises. Référence de la vigueur du dollar. Inversement corrélé au risque (crypto, or, actions).",
    usage:"Sur le site : DXY baissier = favorable au crypto/or (biais long) ; DXY haussier = défavorable. Filtre de contexte macro.",
    biais:'contexte — inversé pour risque' });
  add({ id:'taux', nom:'Taux d’intérêt / Banques centrales', alias:['taux','fed','bce','banque centrale','interest rates'], cat:'macro', tags:['fed','politique monétaire','liquidité'],
    def:"Les décisions des banques centrales (Fed, BCE) sur les taux directeurs pilotent la liquidité mondiale. Taux hauts = argent cher = pression sur actifs risqués.",
    usage:"On évite de trader à contre-courant juste avant/après une réunion (FOMC) ; le régime de taux oriente le biais de fond.",
    biais:'contexte macro majeur' });
  add({ id:'inflation-cpi', nom:'Inflation (CPI/PCE)', alias:['inflation','cpi','pce','indice des prix'], cat:'macro', tags:['données','volatilité','fed'],
    def:"Mesure de la hausse des prix. Guide les banques centrales : inflation forte → taux hauts → pression sur les actifs risqués.",
    usage:"Publications à fort impact (volatilité). On réduit l'exposition ou on attend la digestion des chiffres.",
    biais:'catalyseur macro' });
  add({ id:'nfp', nom:'NFP / Emploi', alias:['nfp','non farm payrolls','emploi','chômage'], cat:'macro', tags:['données','volatilité','usd'],
    def:"Rapport mensuel sur l'emploi américain (Non-Farm Payrolls). Donnée à très fort impact sur le dollar et les marchés.",
    usage:"Volatilité extrême à la publication : beaucoup préfèrent ne pas être en position au moment du chiffre.",
    biais:'catalyseur — forte volatilité' });
  add({ id:'risk-on-off', nom:'Risk-on / Risk-off', alias:['risk on','risk off','appétit pour le risque','aversion'], cat:'macro', tags:['régime','sentiment','corrélation'],
    def:"Régime de marché global : risk-on = appétit pour le risque (actions/crypto montent, refuges baissent) ; risk-off = fuite vers la sécurité (dollar, or, obligations).",
    usage:"Aligner ses paris risqués avec un environnement risk-on ; se méfier des longs risqués en risk-off.",
    biais:'contexte — régime global' });
  add({ id:'seasonality', nom:'Saisonnalité', alias:['saisonnalité','seasonality','effets de calendrier'], cat:'macro', tags:['statistique','calendrier','tendance'],
    def:"Tendances récurrentes liées au calendrier (ex. « sell in May », rallye de fin d'année, effet janvier). Statistiques, pas des certitudes.",
    usage:"Contexte de fond secondaire ; jamais une raison suffisante d'entrer seule.",
    biais:'contexte statistique' });
  add({ id:'halving', nom:'Halving (Bitcoin)', alias:['halving','bitcoin halving','réduction de récompense'], cat:'macro', tags:['crypto','offre','cycle'],
    def:"Division par deux, tous les ~4 ans, de la récompense des mineurs de Bitcoin : choc d'offre historiquement associé aux grands cycles haussiers.",
    usage:"Contexte de fond pour le cycle crypto ; effet différé, pas un signal de timing court terme.",
    biais:'contexte — cycle crypto' });
  add({ id:'funding-rate', nom:'Funding rate', alias:['funding rate','taux de financement','perp'], cat:'macro', tags:['crypto','sentiment','contrats perpétuels'],
    def:"Sur les contrats perpétuels crypto, paiement périodique entre longs et shorts. Funding très positif = excès de longs (surchauffe), très négatif = excès de shorts.",
    usage:"Indicateur de sentiment contrarian : un funding extrême précède souvent un dégonflement (squeeze).",
    biais:'sentiment — contrarian' });
  add({ id:'open-interest', nom:'Open Interest', alias:['open interest','oi','positions ouvertes'], cat:'flow', tags:['dérivés','participation','crypto'],
    def:"Nombre total de contrats dérivés ouverts. Sa hausse avec le prix confirme la tendance ; sa chute signale des débouclages.",
    usage:"OI qui grimpe fort + funding extrême = risque de liquidation en cascade (squeeze).",
    biais:'confirmation / risque de squeeze' });

  /* ===================== Sessions & horaires ===================== */
  add({ id:'sessions', nom:'Sessions (Asie/Londres/NY)', alias:['sessions','londres','new york','asie','tokyo','killzone'], cat:'session', tags:['horaire','volatilité','liquidité'],
    def:"Le marché 24h se découpe en sessions : Asie (calme, range), Londres (forte volatilité, souvent le vrai mouvement), New York (volatilité, recouvrement avec Londres).",
    usage:"On concentre le trading sur les heures liquides (Londres, NY). Le range d'Asie sert souvent de liquidité à balayer.",
    biais:'contexte — timing' });
  add({ id:'killzone', nom:'Killzones (ICT)', alias:['killzone','kill zone','fenêtre ICT','londres open','ny open'], cat:'session', tags:['horaire','ict','setup'],
    def:"Fenêtres horaires ICT à forte probabilité (ex. Londres 02h-05h, New York 07h-10h heure de NY) où se forment les meilleurs setups.",
    usage:"On cible ses entrées dans ces fenêtres ; en dehors, la probabilité baisse.",
    biais:'contexte — timing ICT' });
  add({ id:'asian-range', nom:'Range asiatique', alias:['asian range','range asie','plage asiatique'], cat:'session', tags:['range','liquidité','londres'],
    def:"Fourchette étroite formée pendant la session asiatique. Ses bornes concentrent de la liquidité que Londres vient souvent balayer.",
    usage:"On note haut/bas du range d'Asie : leur balayage en ouverture de Londres est un setup classique.",
    biais:'contexte — liquidité' });
  add({ id:'opening-range', nom:'Opening Range', alias:['opening range','orb','range d’ouverture'], cat:'session', tags:['breakout','ouverture','intraday'],
    def:"Fourchette des premières minutes d'une séance (ex. 15-30 min). Sa cassure (ORB) donne un biais directionnel pour la journée.",
    usage:"Stratégie ORB : on trade la cassure du range d'ouverture avec objectif = son amplitude.",
    biais:'biais intraday' });
  add({ id:'daily-open', nom:'Ouverture journalière / hebdo', alias:['daily open','weekly open','ouverture du jour','minuit'], cat:'session', tags:['niveau','référence'],
    def:"Prix d'ouverture du jour/semaine (ex. minuit NY) servant de référence : au-dessus = biais haussier du jour, en dessous = baissier.",
    usage:"Niveau pivot intraday, souvent combiné aux gaps d'ouverture (NWOG/NDOG).",
    biais:'niveau — biais du jour' });

  /* ===================== Quant & statistiques ===================== */
  add({ id:'momentum-factor', nom:'Momentum (facteur)', alias:['momentum','facteur momentum','force relative','tendance persistante'], cat:'quant', tags:['facteur','anomalie','persistance'],
    def:"Anomalie robuste : les actifs qui ont surperformé récemment tendent à continuer à court/moyen terme. Base du volet Quant du site (momentum relatif).",
    usage:"On classe les actifs par performance et on privilégie les plus forts (long) vs les plus faibles (short).",
    biais:'facteur — persistance' });
  add({ id:'mean-reversion', nom:'Retour à la moyenne', alias:['mean reversion','retour à la moyenne','réversion'], cat:'quant', tags:['range','excès','statistique'],
    def:"Tendance d'un prix à revenir vers sa moyenne après un excès. Fonctionne en range/sur actifs stationnaires, dangereux en forte tendance.",
    usage:"On achète les excès baissiers / vend les excès haussiers autour d'une moyenne (Bollinger, z-score).",
    biais:'stratégie — range' });
  add({ id:'market-neutral', nom:'Market-neutral', alias:['market neutral','neutre au marché','long short'], cat:'quant', tags:['long short','hedge','facteur'],
    def:"Portefeuille équilibré long (actifs forts) / short (actifs faibles) dont l'exposition nette au marché est ~nulle : on gagne sur l'ÉCART, pas sur la direction.",
    usage:"Cœur du volet Quant : viser un bon Sharpe indépendamment de la hausse/baisse générale.",
    biais:'stratégie — indépendante du sens' });
  add({ id:'sharpe', nom:'Ratio de Sharpe', alias:['sharpe','ratio de sharpe','rendement risque'], cat:'quant', tags:['performance','risque','métrique'],
    def:"Rendement excédentaire divisé par la volatilité : mesure le rendement par unité de risque. >1 correct, >2 très bon, >3 excellent.",
    usage:"La vraie métrique des fonds (bien plus que le win rate). Le site vise le Sharpe sur son panier factoriel.",
    biais:'métrique — qualité du rendement' });
  add({ id:'zscore', nom:'Z-score', alias:['z-score','zscore','écart normalisé','standardisation'], cat:'quant', tags:['statistique','excès','normalisation'],
    def:"Nombre d'écarts-types séparant une valeur de sa moyenne. Permet de comparer des excès sur des échelles différentes.",
    usage:"Signal de retour à la moyenne (|z|>2 = excès) et normalisation des facteurs pour les comparer.",
    biais:'outil statistique' });
  add({ id:'backtest', nom:'Backtest & Walk-forward', alias:['backtest','walk forward','test historique','out of sample'], cat:'quant', tags:['validation','robustesse','overfitting'],
    def:"Tester une stratégie sur l'historique. Le walk-forward teste sur des données JAMAIS vues (out-of-sample) pour éviter le sur-ajustement (overfitting).",
    usage:"On ne fait confiance qu'aux résultats out-of-sample. Le volet IA du site s'évalue en walk-forward strict.",
    biais:'validation — robustesse' });
  add({ id:'overfitting', nom:'Surajustement (Overfitting)', alias:['overfitting','surajustement','curve fitting','optimisation excessive'], cat:'quant', tags:['piège','validation'],
    def:"Stratégie trop ajustée au passé (elle « mémorise » le bruit) qui brille en backtest et échoue en réel.",
    usage:"On l'évite par la simplicité, la validation out-of-sample et la méfiance envers les courbes trop parfaites.",
    biais:'piège quant' });
  add({ id:'monte-carlo', nom:'Monte-Carlo', alias:['monte carlo','simulation','robustesse'], cat:'quant', tags:['simulation','probabilité','risque'],
    def:"Simulation de milliers de scénarios (en rebattant l'ordre des trades) pour estimer la distribution des résultats et du drawdown possibles.",
    usage:"Évaluer la robustesse d'une stratégie et le risque de ruine au-delà d'une seule courbe d'équité.",
    biais:'validation — risque' });
  add({ id:'calibration', nom:'Calibration des probabilités', alias:['calibration','ece','probabilité fiable'], cat:'quant', tags:['probabilité','fiabilité','ia'],
    def:"Une probabilité est « calibrée » si, quand le modèle annonce 70 %, l'événement se produit ~70 % du temps. L'ECE mesure l'écart moyen.",
    usage:"Le site affiche l'ECE de son IA : plus il est bas, plus le « % » affiché est fiable.",
    biais:'métrique — fiabilité IA' });

  /* ===================== Produits & marchés ===================== */
  add({ id:'spread', nom:'Spread', alias:['spread','écart achat vente','bid ask'], cat:'produits', tags:['coût','liquidité','frais'],
    def:"Écart entre le prix d'achat (ask) et de vente (bid). Coût implicite de chaque trade ; plus large sur les actifs peu liquides et en news.",
    usage:"On évite de trader quand le spread s'élargit (nuit, news) ; il compte dans le calcul du RR sur petits objectifs.",
    biais:'coût — friction' });
  add({ id:'leverage', nom:'Effet de levier', alias:['levier','leverage','marge','margin'], cat:'produits', tags:['risque','amplification','liquidation'],
    def:"Emprunter pour prendre une position plus grosse que son capital. Amplifie gains ET pertes ; un excès de levier mène à la liquidation.",
    usage:"Le levier ne change pas le bon sizing : on dimensionne toujours par le risque en %, pas par le levier maximal disponible.",
    biais:'risque — à manier avec prudence' });
  add({ id:'liquidation', nom:'Liquidation / Squeeze', alias:['liquidation','short squeeze','long squeeze','cascade'], cat:'produits', tags:['levier','cascade','crypto'],
    def:"Fermeture forcée des positions à levier quand la marge est insuffisante. En cascade, elle provoque des mouvements violents (short/long squeeze).",
    usage:"On repère les zones de liquidation massives (au-dessus/dessous d'extrêmes) comme cibles de mouvements brusques.",
    biais:'catalyseur — volatilité' });
  add({ id:'slippage', nom:'Slippage', alias:['slippage','glissement','dérapage'], cat:'produits', tags:['exécution','coût','liquidité'],
    def:"Écart entre le prix attendu et le prix réellement exécuté, surtout sur ordres au marché en faible liquidité ou forte volatilité.",
    usage:"On l'anticipe sur les news et les actifs peu liquides ; les ordres limites le limitent (au prix de non-exécution).",
    biais:'coût — exécution' });
  add({ id:'correlation', nom:'Corrélations inter-marchés', alias:['corrélation','intermarket','btc eth','or dollar'], cat:'produits', tags:['relation','confluence','dxy'],
    def:"Relations statistiques entre actifs : BTC↔ETH (positive), or↔dollar (négative), actions↔crypto (souvent positive en risk-on).",
    usage:"Confluence et couverture : une divergence de corrélation (SMT) signale une faiblesse ; on évite d'empiler des paris corrélés.",
    biais:'contexte — relations' });
  add({ id:'gap', nom:'Gap (fenêtre)', alias:['gap','fenêtre','trou de cotation','weekend gap'], cat:'produits', tags:['ouverture','déséquilibre','comblement'],
    def:"Discontinuité de prix entre deux séances (ouverture loin de la clôture précédente). Les gaps tendent souvent à être comblés.",
    usage:"On trade le comblement du gap (retour au niveau) ou sa continuation s'il tient sur volume.",
    biais:'contexte — souvent comblé' });

  /* ===================== ICT (compléments avancés) ===================== */
  add({ id:'crt', nom:'CRT (Candle Range Theory)', alias:['crt','candle range theory','range de bougie'], cat:'ict', tags:['range','manipulation','fractal'],
    def:"Théorie ICT où chaque grande bougie contient un cycle complet : un range se forme, un balayage d'un côté (manipulation), puis expansion vers l'autre extrême. Fractale du Power of Three.",
    usage:"On repère le range de la bougie mère, on attend le balayage d'un côté puis on trade l'expansion vers l'extrême opposé.",
    biais:'cadre directionnel intra-bougie' });
  add({ id:'unicorn', nom:'Modèle Unicorn (Breaker + FVG)', alias:['unicorn','breaker fvg','unicorn model'], cat:'ict', tags:['confluence','entrée','haute proba'],
    def:"Setup à haute probabilité où un breaker block et un FVG se chevauchent exactement sur la même zone, après un balayage de liquidité + MSS.",
    usage:"Entrée dans la zone de recouvrement breaker+FVG ; double confluence = signal plus fiable.",
    biais:'contexte — entrée haute proba' });
  add({ id:'bpr', nom:'Balanced Price Range (BPR)', alias:['bpr','balanced price range','fvg opposés'], cat:'ict', tags:['fvg','zone','réaction'],
    def:"Zone où deux FVG opposés (un haussier et un baissier) se superposent : le prix y a été « équilibré » dans les deux sens, créant une zone de réaction sensible.",
    usage:"Zone d'entrée/rejet : le prix réagit souvent nettement en revenant sur un BPR.",
    biais:'contexte — zone de réaction' });
  add({ id:'cbdr', nom:'CBDR / Range de nuit', alias:['cbdr','central bank dealers range','flout','range de nuit'], cat:'ict', tags:['range','nuit','projection'],
    def:"Range formé la nuit (heures des dealers de banques centrales, ~14h-20h NY). Ses écarts-types servent à projeter les extrêmes probables de la séance suivante.",
    usage:"On projette 1-3 écarts-types du CBDR pour anticiper les cibles de la journée.",
    biais:'cadre — projection de cibles' });
  add({ id:'std-projection', nom:'Projections en écarts-types (ICT)', alias:['standard deviation','projection écart-type','std dev ict'], cat:'ict', tags:['projection','objectif','range'],
    def:"Technique ICT : projeter des multiples d'écart-type d'un range (CBDR, range asiatique, FVG) pour estimer jusqu'où le prix peut aller.",
    usage:"Fixe des objectifs mesurés (-1, -2, -2,5 dev) au lieu de cibles arbitraires.",
    biais:'objectif — mesuré' });
  add({ id:'quarterly-theory', nom:'Quarterly Theory / Cycles 90 min', alias:['quarterly theory','90 minute cycles','cycles trimestriels','time theory'], cat:'ict', tags:['temps','cycle','fractal'],
    def:"Le temps se découpe en quarts fractals (année→trimestres, journée→4 sessions, session→90 min, 90min→22,5min), chacun suivant un cycle Accumulation-Manipulation-Distribution-Continuation.",
    usage:"On aligne le setup avec le bon quart temporel pour timer l'entrée (souvent le 2ᵉ quart = manipulation).",
    biais:'cadre — timing fractal' });
  add({ id:'daily-bias', nom:'Biais journalier (Daily Bias)', alias:['daily bias','biais du jour','direction du jour'], cat:'ict', tags:['biais','htf','direction'],
    def:"Direction attendue de la journée, déduite du contexte HTF : liquidité prise, FVG à combler, position dans le dealing range, tendance D1.",
    usage:"On établit le biais AVANT la séance, puis on ne prend que les setups qui vont dans son sens.",
    biais:'directionnel — cadre du jour' });
  add({ id:'ict-macros', nom:'ICT Macros (fenêtres algo)', alias:['ict macro','macro times','fenêtres algorithmiques'], cat:'ict', tags:['horaire','algo','liquidité'],
    def:"Courtes fenêtres (souvent ~20 min, ex. 09h50-10h10 NY) où l'algorithme rechercherait activement la liquidité et rééquilibrerait les FVG.",
    usage:"On surveille ces fenêtres pour des mouvements dirigés vers la liquidité proche.",
    biais:'contexte — timing algo' });
  add({ id:'reclaimed-ob', nom:'Order Block récupéré / Propulsion', alias:['reclaimed order block','propulsion block','ob récupéré'], cat:'ict', tags:['ob','continuation','réentrée'],
    def:"Order block réactivé après avoir été partiellement traversé puis « repris » par le prix (propulsion), servant de tremplin pour continuer le mouvement.",
    usage:"Zone de réentrée en continuation quand un OB tient malgré une incursion.",
    biais:'contexte — continuation' });
  add({ id:'volume-imbalance', nom:'Volume Imbalance', alias:['volume imbalance','vi','déséquilibre corps'], cat:'ict', tags:['gap corps','déséquilibre','micro'],
    def:"Petit écart entre la clôture d'une bougie et l'ouverture de la suivante (les corps ne se touchent pas, mais les mèches oui). Micro-déséquilibre à combler.",
    usage:"Micro-cible de rééquilibrage, utile pour affiner entrées/stops en bas timeframe.",
    biais:'micro-aimant' });

  add({ id:'displacement', nom:'Displacement (Déplacement)', alias:['displacement','déplacement','impulsion','expansion énergique'], cat:'ict', tags:['impulsion','fvg','intention'],
    def:"Mouvement impulsif, énergique et vertical qui révèle l'intention institutionnelle. Un vrai displacement laisse presque toujours un Fair Value Gap dans son sillage et casse la structure.",
    usage:"C'est le déclencheur clé : on ne valide un MSS/BOS que s'il est accompagné d'un displacement (sinon la cassure est suspecte). Le FVG qu'il crée devient la zone d'entrée.",
    biais:'confirmation — révèle l’intention directionnelle' });
  add({ id:'dol', nom:'Draw on Liquidity (DOL)', alias:['dol','draw on liquidity','aimant de liquidité','cible'], cat:'ict', tags:['cible','liquidité','objectif'],
    def:"La cible vers laquelle le prix est « aspiré » : le pool de liquidité le plus probable que le marché cherche à atteindre (un plus-haut/bas évident, des equal highs/lows, un FVG à combler).",
    usage:"On définit le DOL AVANT d'entrer : c'est l'objectif logique du trade. Tout setup doit pointer vers un DOL clair, sinon on s'abstient.",
    biais:'directionnel — indique la cible' });
  add({ id:'model-2022', nom:'Modèle ICT 2022', alias:['2022 model','modèle 2022','mentorship 2022','ict 2022'], cat:'ict', tags:['modèle','setup complet','journalier'],
    def:"Modèle phare d'ICT : biais journalier HTF → balayage de liquidité dans une killzone (Londres ou New York) → displacement qui laisse un FVG → entrée sur le retour au FVG → objectif au pool de liquidité opposé.",
    usage:"Cadre d'exécution clé en main : biais, timing (killzone), déclencheur (sweep + FVG), entrée, cible. Le squelette de la plupart des trades ICT modernes.",
    biais:'modèle — setup directionnel complet' });
  add({ id:'mmxm', nom:'Market Maker Model (achat/vente)', alias:['mmxm','mmbm','mmsm','market maker buy model','market maker sell model','modèle teneur de marché'], cat:'ict', tags:['cycle','institutionnel','profil'],
    def:"Profil complet d'un cycle de teneur de marché : consolidation, phase de contrat (accumulation d'un côté), retournement (smart money reversal), puis phase d'expansion (redistribution) vers la liquidité opposée. MMBM = version haussière, MMSM = baissière.",
    usage:"Grille de lecture d'un swing entier : repérer où l'on est dans le cycle du teneur de marché pour anticiper le retournement et la cible.",
    biais:'cadre — cycle directionnel complet' });
  add({ id:'smr', nom:'Smart Money Reversal (SMR)', alias:['smr','smart money reversal','retournement smart money'], cat:'ict', tags:['retournement','sweep','mss'],
    def:"Point de bascule du market maker model : un balayage de liquidité à un extrême suivi d'un displacement qui casse la structure (MSS) — le moment précis où le smart money inverse le marché.",
    usage:"Signal de retournement majeur : on entre après le sweep + MSS, en visant le DOL opposé.",
    biais:'retournement — bascule majeure' });
  add({ id:'ref-levels', nom:'Niveaux de référence (PDH/PDL, PWH/PWL)', alias:['pdh','pdl','pwh','pwl','previous day high low','previous week high low','plus-haut de la veille'], cat:'ict', tags:['liquidité','niveau','référence'],
    def:"Plus-haut/plus-bas de la veille (PDH/PDL), de la semaine (PWH/PWL) ou du mois (PMH/PML). Ce sont des pools de liquidité évidents et très surveillés que le marché va souvent chercher.",
    usage:"Cibles de balayage et niveaux pivots : au-dessus du PDH = liquidité côté achat, sous le PDL = liquidité côté vente. Servent de DOL naturels.",
    biais:'niveau — liquidité de référence' });
  add({ id:'weekly-profiles', nom:'Profils hebdomadaires ICT', alias:['weekly profiles','profils hebdo','seek and destroy','classic buy day','wednesday low'], cat:'ict', tags:['temps','semaine','template'],
    def:"Modèles récurrents de la semaine : le plus-bas (marché haussier) ou plus-haut (baissier) hebdo se forme souvent en début de semaine (mardi/mercredi de Londres), avant l'expansion. « Seek & destroy » = semaine sans direction qui chasse les deux côtés.",
    usage:"Anticiper le jour probable du point d'extrême hebdomadaire pour timer les entrées de swing.",
    biais:'cadre — timing hebdomadaire' });
  add({ id:'institutional-orderflow', nom:'Flux d’ordres institutionnel', alias:['institutional order flow','order flow institutionnel','biais de flux'], cat:'ict', tags:['biais','htf','direction'],
    def:"Direction sous-jacente imposée par les gros acteurs, lisible via la séquence FVG/OB respectés et la structure HTF. Tant que les FVG haussiers tiennent, le flux est haussier (et inversement).",
    usage:"Filtre directionnel : on ne trade que dans le sens du flux institutionnel tant qu'il n'est pas invalidé par un displacement opposé.",
    biais:'directionnel — biais de fond' });
  add({ id:'gap-types', nom:'Types de gaps (breakaway/runaway/exhaustion)', alias:['breakaway gap','runaway gap','exhaustion gap','common gap','gaps chartistes'], cat:'figures', tags:['gap','tendance','signal'],
    def:"Breakaway (cassure d'une zone, début de tendance, tient), Runaway/measuring (au milieu d'une tendance, la confirme), Exhaustion (en fin de tendance, signale l'essoufflement et se comble vite), Common (dans le bruit, sans signification).",
    usage:"Identifier le type de gap situe où l'on est dans la tendance : breakaway = suivre, exhaustion = se méfier/fader.",
    biais:'contexte — position dans la tendance' });

  /* ===================== Wyckoff ===================== */
  add({ id:'wyckoff-cycle', nom:'Cycle de Wyckoff', alias:['wyckoff','accumulation distribution','cycle wyckoff'], cat:'wyckoff', tags:['cycle','phases','institutionnel'],
    def:"Le marché évolue en 4 phases : Accumulation (les mains fortes achètent en range), Hausse (markup), Distribution (elles revendent en range), Baisse (markdown). Base historique du smart money.",
    usage:"Situer la phase actuelle : on achète en fin d'accumulation, on vend en fin de distribution.",
    biais:'cadre — cycle de fond' });
  add({ id:'composite-man', nom:'Composite Man', alias:['composite man','homme composite','main forte'], cat:'wyckoff', tags:['théorie','institutionnel','manipulation'],
    def:"Métaphore de Wyckoff : imaginer un unique opérateur institutionnel qui manipule le marché de façon logique (accumule bas, distribue haut) pour lire ses intentions.",
    usage:"On se demande « que ferait la main forte ici ? » pour anticiper les pièges.",
    biais:'cadre théorique' });
  add({ id:'spring', nom:'Spring (Ressort)', alias:['spring','ressort','faux plus-bas wyckoff'], cat:'wyckoff', tags:['balayage','retournement','accumulation'],
    def:"En fin d'accumulation, le prix casse brièvement sous le support pour piéger les vendeurs (balayage), puis remonte vivement : signal haussier fort.",
    usage:"Entrée longue après le retour au-dessus du support ; équivalent Wyckoff du liquidity sweep haussier.",
    biais:'retournement haussier' });
  add({ id:'upthrust', nom:'Upthrust (UTAD)', alias:['upthrust','utad','faux plus-haut wyckoff'], cat:'wyckoff', tags:['balayage','retournement','distribution'],
    def:"En fin de distribution, le prix casse brièvement au-dessus de la résistance pour piéger les acheteurs, puis rechute : signal baissier fort.",
    usage:"Entrée courte après le retour sous la résistance ; miroir baissier du spring.",
    biais:'retournement baissier' });
  add({ id:'sos-sow', nom:'SOS / SOW (Signes de force/faiblesse)', alias:['sos','sow','sign of strength','sign of weakness'], cat:'wyckoff', tags:['confirmation','volume','phase'],
    def:"SOS = mouvement large et volumineux prouvant la demande (fin d'accumulation) ; SOW = équivalent baissier prouvant l'offre (fin de distribution).",
    usage:"Confirmation qu'une phase se termine et que le markup/markdown commence.",
    biais:'confirmation de phase' });

  /* ===================== Figures harmoniques (compléments) ===================== */
  add({ id:'quasimodo', nom:'Quasimodo (QM)', alias:['quasimodo','qm','over and under','qml'], cat:'figures', tags:['retournement','smc','structure'],
    def:"Figure de retournement SMC : un plus-haut est dépassé (prise de liquidité) puis la structure casse dans l'autre sens, dessinant une tête-épaules asymétrique.",
    usage:"Entrée sur le retour à la QM line (niveau de l'épaule gauche) après la cassure.",
    biais:'retournement' });
  add({ id:'harmonics', nom:'Figures harmoniques (Gartley, Bat, Butterfly, Crab)', alias:['harmonic','gartley','bat','butterfly','crab','shark','cypher','harmoniques'], cat:'figures', tags:['fibonacci','ratios','retournement'],
    def:"Figures en 5 points (XABCD) définies par des ratios de Fibonacci précis. Chaque figure (Gartley 0,786 ; Bat 0,886 ; Butterfly 1,27 ; Crab 1,618) donne une zone de retournement (PRZ).",
    usage:"On entre dans la PRZ (zone de retournement potentiel) avec stop juste au-delà du point D. Précis mais exigeant.",
    biais:'retournement — zones Fibonacci' });
  add({ id:'abcd', nom:'Pattern ABCD', alias:['abcd','ab=cd','pattern abcd'], cat:'figures', tags:['fibonacci','symétrie','projection'],
    def:"Figure symétrique où la jambe CD reproduit la jambe AB (en distance/temps), souvent avec un retracement BC de 0,618. Base des harmoniques.",
    usage:"Projeter le point D comme zone de retournement/objectif.",
    biais:'retournement / objectif' });
  add({ id:'three-drives', nom:'Trois poussées (Three Drives)', alias:['three drives','trois poussées','trois sommets fibo'], cat:'figures', tags:['épuisement','fibonacci','retournement'],
    def:"Trois poussées successives vers de nouveaux extrêmes reliées par des retracements Fibonacci symétriques : épuisement de la tendance.",
    usage:"Signal de retournement après la 3ᵉ poussée, surtout avec divergence.",
    biais:'retournement' });
  add({ id:'rectangle', nom:'Rectangle / Range chartiste', alias:['rectangle','range horizontal','box'], cat:'figures', tags:['range','borne','breakout'],
    def:"Consolidation entre un support et une résistance horizontaux parallèles. Continuation ou retournement selon le sens de sortie.",
    usage:"On trade les bornes ou la cassure ; objectif = hauteur du rectangle.",
    biais:'neutre — jusqu’à la sortie' });
  add({ id:'broadening', nom:'Élargissement (Megaphone)', alias:['broadening','megaphone','élargissement','expanding'], cat:'figures', tags:['volatilité','instabilité'],
    def:"Figure où les sommets montent et les creux baissent (extrêmes divergents) : volatilité croissante, marché instable et émotionnel.",
    usage:"Difficile à trader ; souvent signe de sommet de marché. On fade les extrêmes avec prudence.",
    biais:'instabilité — retournement possible' });
  add({ id:'island-reversal', nom:'Île de retournement', alias:['island reversal','île de retournement','gap isolé'], cat:'figures', tags:['gap','retournement','isolé'],
    def:"Groupe de bougies isolé par un gap de chaque côté (un gap à l'entrée, un gap opposé à la sortie) : retournement violent.",
    usage:"Signal de retournement marqué ; rare mais fiable.",
    biais:'retournement' });

  /* ===================== Chandeliers (compléments) ===================== */
  add({ id:'piercing-darkcloud', nom:'Ligne perçante / Couvert en nuage noir', alias:['piercing line','dark cloud cover','ligne perçante','nuage noir'], cat:'chandelier', tags:['retournement','deux bougies'],
    def:"Ligne perçante (haussière) : bougie qui ouvre sous puis clôture au-dessus de la moitié de la précédente baissière. Nuage noir : miroir baissier.",
    usage:"Retournement modéré à un niveau ; moins fort que l'avalement.",
    biais:'retournement' });
  add({ id:'tweezer', nom:'Pinces (Tweezer top/bottom)', alias:['tweezer','pinces','sommets jumeaux','mèches égales'], cat:'chandelier', tags:['retournement','niveau','mèches'],
    def:"Deux bougies aux extrêmes (mèches) quasi identiques, marquant un rejet répété du même niveau.",
    usage:"Confirme un support/résistance et un retournement local.",
    biais:'retournement' });
  add({ id:'marubozu', nom:'Marubozu', alias:['marubozu','bougie pleine','sans mèche'], cat:'chandelier', tags:['momentum','conviction'],
    def:"Grande bougie sans mèche (ou presque) : les acheteurs (ou vendeurs) ont dominé du début à la fin. Forte conviction directionnelle.",
    usage:"Confirme un momentum puissant ; souvent au cœur d'un déplacement (impulsion).",
    biais:'continuation forte' });
  add({ id:'inside-outside-bar', nom:'Inside bar / Outside bar', alias:['inside bar','outside bar','bougie intérieure','englobante'], cat:'chandelier', tags:['compression','expansion','breakout'],
    def:"Inside bar : bougie entièrement contenue dans la précédente (compression, pause). Outside bar : bougie qui englobe la précédente (expansion, volatilité).",
    usage:"Inside bar = setup de cassure ; outside bar = signal de retournement/force selon la clôture.",
    biais:'contexte — compression ou expansion' });
  add({ id:'dragonfly-gravestone', nom:'Doji libellule / pierre tombale', alias:['dragonfly doji','gravestone doji','libellule','pierre tombale'], cat:'chandelier', tags:['rejet','doji','retournement'],
    def:"Doji libellule : longue mèche basse, pas de mèche haute (rejet des bas = haussier). Pierre tombale : l'inverse (rejet des hauts = baissier).",
    usage:"Signal de rejet directionnel à un niveau clé.",
    biais:'retournement selon le type' });

  /* ===================== Indicateurs (compléments) ===================== */
  add({ id:'cci', nom:'CCI (Commodity Channel Index)', alias:['cci','commodity channel index'], cat:'indic', tags:['momentum','oscillateur','excès'],
    def:"Oscillateur mesurant l'écart du prix à sa moyenne. Au-delà de +100/−100 = mouvement fort ou excès selon le contexte.",
    usage:"Détecter début de tendance (sortie de ±100) ou excès/divergences.",
    biais:'momentum' });
  add({ id:'williams-r', nom:'Williams %R', alias:['williams %r','%r','williams'], cat:'indic', tags:['momentum','surachat','oscillateur'],
    def:"Oscillateur (0 à −100) proche du stochastique : −20 suracheté, −80 survendu.",
    usage:"Timing de retournement dans les ranges ; peu fiable seul en tendance.",
    biais:'momentum' });
  add({ id:'psar', nom:'Parabolic SAR', alias:['parabolic sar','psar','sar','stop and reverse'], cat:'indic', tags:['tendance','trailing','retournement'],
    def:"Points qui suivent le prix et basculent d'un côté à l'autre : donnent un stop suiveur et un signal de retournement.",
    usage:"Trailing stop en tendance ; génère beaucoup de faux signaux en range.",
    biais:'directionnel + trailing' });
  add({ id:'keltner-donchian', nom:'Canaux de Keltner / Donchian', alias:['keltner','donchian','canaux','breakout channel'], cat:'indic', tags:['volatilité','breakout','canal'],
    def:"Keltner : canal basé sur l'ATR autour d'une EMA. Donchian : plus-haut/plus-bas des N périodes (base du système Turtle).",
    usage:"Donchian pour trader les cassures (breakout) ; Keltner combiné à Bollinger pour repérer les squeezes.",
    biais:'volatilité / breakout' });
  add({ id:'heikin-ashi', nom:'Heikin Ashi', alias:['heikin ashi','ha','bougies moyennées'], cat:'indic', tags:['lissage','tendance','visuel'],
    def:"Bougies recalculées (moyennes) qui lissent le bruit et rendent les tendances plus lisibles : suite de bougies pleines sans mèche opposée = tendance forte.",
    usage:"Rester dans une tendance ; le changement de couleur + mèches signale l'essoufflement. Attention : prix affiché ≠ prix réel.",
    biais:'directionnel — lissé' });
  add({ id:'mfi', nom:'MFI (Money Flow Index)', alias:['mfi','money flow index','rsi volumique'], cat:'indic', tags:['volume','momentum','flux'],
    def:"« RSI pondéré par le volume » (0-100) : mesure la pression d'achat/vente en tenant compte des volumes. >80 suracheté, <20 survendu.",
    usage:"Divergences prix/MFI plus fiables que le RSI seul car elles intègrent le volume.",
    biais:'momentum + volume' });
  add({ id:'renko', nom:'Renko', alias:['renko','briques','filtre bruit'], cat:'indic', tags:['tendance','filtre','prix pur'],
    def:"Graphique en briques basées uniquement sur le mouvement de prix (pas le temps) : une nouvelle brique n'apparaît qu'après un déplacement fixe. Filtre le bruit.",
    usage:"Isoler la tendance de fond et les vrais supports/résistances ; peu adapté au timing précis.",
    biais:'directionnel — filtré' });

  /* ===================== Order flow (compléments) ===================== */
  add({ id:'market-profile', nom:'Market Profile (TPO)', alias:['market profile','tpo','profil de marché','value area'], cat:'flow', tags:['distribution','value area','auction'],
    def:"Représentation de la distribution du temps passé à chaque prix (lettres TPO), révélant la value area, le POC et la forme de l'enchère (équilibre vs tendance).",
    usage:"Trader les retours vers la value area (équilibre) ou les cassures hors value (déséquilibre).",
    biais:'niveau — équilibre/déséquilibre' });
  add({ id:'auction-theory', nom:'Théorie de l’enchère', alias:['auction market theory','théorie enchère','équilibre déséquilibre'], cat:'flow', tags:['fondement','value','déséquilibre'],
    def:"Le marché est une enchère continue cherchant un prix « juste » (équilibre) : il s'y attarde, puis le rejette (déséquilibre) pour chercher un nouveau niveau.",
    usage:"Cadre mental : acheter le déséquilibre confirmé, fader les excès loin de la valeur.",
    biais:'cadre — logique de fond' });
  add({ id:'liquidity-heatmap', nom:'Heatmap de liquidité', alias:['liquidity heatmap','carte de liquidité','clusters de liquidation'], cat:'flow', tags:['liquidation','levier','crypto'],
    def:"Carte montrant où sont accumulés les ordres de liquidation à effet de levier. Ces amas agissent comme des aimants pour le prix.",
    usage:"On anticipe les mouvements vers les grosses zones de liquidation (chasse aux stops à grande échelle).",
    biais:'aimant — cibles de liquidation' });
  add({ id:'tape-reading', nom:'Lecture du tape (Time & Sales)', alias:['tape reading','time and sales','fil des transactions'], cat:'flow', tags:['micro','vitesse','institutionnel'],
    def:"Lire le flux brut des transactions exécutées (prix, taille, vitesse) pour sentir l'agressivité acheteuse/vendeuse en temps réel.",
    usage:"Scalping avancé : détecter accélérations, gros blocs, absorption au niveau du tick.",
    biais:'micro — agressivité' });

  /* ===================== Gestion du risque (compléments) ===================== */
  add({ id:'risk-of-ruin', nom:'Risque de ruine', alias:['risk of ruin','risque de ruine','faillite'], cat:'risque', tags:['probabilité','survie','sizing'],
    def:"Probabilité de perdre tout (ou une part fatale) de son capital compte tenu du win rate, du RR et de la taille de position. Explose quand on risque trop par trade.",
    usage:"On la maintient quasi nulle en risquant peu par trade (1 %) — c'est la survie avant la performance.",
    biais:'gestion — survie' });
  add({ id:'r-multiple', nom:'R-multiple', alias:['r multiple','r','gain en r','unité de risque'], cat:'risque', tags:['mesure','normalisation','journal'],
    def:"Exprimer chaque résultat en multiples du risque initial (1R = le montant risqué). Un trade qui rapporte 3× le risque = +3R ; un stop touché = −1R.",
    usage:"Standardise le suivi : on juge la performance en R cumulés, indépendamment des montants.",
    biais:'mesure — normalise les résultats' });
  add({ id:'winrate-rr', nom:'Win rate vs RR (seuil de rentabilité)', alias:['win rate rr','taux de réussite','break-even winrate'], cat:'risque', tags:['maths','rentabilité','arbitrage'],
    def:"Relation clé : plus le RR est élevé, moins il faut de trades gagnants pour être rentable. À RR 2, il suffit de ~34 % de réussite ; à RR 3, ~26 %.",
    usage:"Choisir sa cible de RR selon son win rate réel (mesuré dans le journal), pas l'inverse.",
    biais:'maths — arbitrage clé' });
  add({ id:'max-daily-loss', nom:'Perte journalière max', alias:['max daily loss','stop journalier','limite du jour'], cat:'risque', tags:['discipline','circuit breaker','tilt'],
    def:"Plafond de perte quotidien (ex. 3 %) au-delà duquel on arrête de trader pour la journée. Coupe les spirales émotionnelles.",
    usage:"Règle mécanique anti-tilt : atteint = on ferme la plateforme, point.",
    biais:'gestion — discipline' });
  add({ id:'portfolio-heat', nom:'Chaleur du portefeuille (Heat)', alias:['portfolio heat','exposition totale','risque agrégé'], cat:'risque', tags:['exposition','agrégat','corrélation'],
    def:"Somme des risques ouverts simultanément (toutes positions). Même à 1 % chacune, 6 positions corrélées = 6 % de risque réel d'un coup.",
    usage:"On plafonne la chaleur totale (ex. 3-6 %) et on réduit quand plusieurs paris sont corrélés.",
    biais:'gestion — exposition globale' });
  add({ id:'scaling', nom:'Scaling in / out & pyramidage', alias:['scaling in','scaling out','pyramidage','partiels','anti-martingale'], cat:'risque', tags:['exécution','partiels','gestion'],
    def:"Entrer/sortir en plusieurs fois : scaling in (bâtir la position par paliers), scaling out (prendre des profits partiels), pyramidage (ajouter sur une position gagnante).",
    usage:"Lisse l'exécution et sécurise des gains ; on n'ajoute JAMAIS sur une position perdante (≠ moyenne à la baisse).",
    biais:'gestion — exécution' });
  add({ id:'hedging', nom:'Couverture (Hedging)', alias:['hedging','couverture','protection'], cat:'risque', tags:['protection','corrélation','options'],
    def:"Prendre une position opposée/corrélée (ou une option) pour neutraliser temporairement le risque d'une position existante.",
    usage:"Protéger un portefeuille avant un événement à risque sans tout liquider ; a un coût.",
    biais:'gestion — protection' });

  /* ===================== Psychologie (compléments) ===================== */
  add({ id:'recency-bias', nom:'Biais de récence', alias:['recency bias','biais de récence'], cat:'psycho', tags:['biais cognitif','mémoire'],
    def:"Surpondérer les événements récents : après quelques pertes on devient trop craintif, après quelques gains trop confiant.",
    usage:"Antidote : raisonner sur un large échantillon (le journal), pas sur les 3 derniers trades.",
    biais:'biais cognitif' });
  add({ id:'gamblers-fallacy', nom:'Illusion du joueur', alias:['gamblers fallacy','illusion du joueur','loi des séries'], cat:'psycho', tags:['biais cognitif','probabilité'],
    def:"Croire qu'après plusieurs pertes un gain est « dû » (ou l'inverse). Chaque trade est indépendant : le marché n'a pas de mémoire de tes trades.",
    usage:"Antidote : garder une taille constante ; ne pas augmenter pour « compenser ».",
    biais:'biais cognitif' });
  add({ id:'process-outcome', nom:'Process vs Résultat', alias:['process over outcome','process résultat','bon trade perdant'], cat:'psycho', tags:['état d’esprit','probabilité','constance'],
    def:"Un bon trade (plan respecté) peut perdre, un mauvais trade (impulsif) peut gagner. Sur un seul trade, le hasard domine ; c'est le process répété qui paie.",
    usage:"On s'évalue sur la qualité d'exécution, pas sur le P&L d'un trade isolé. Clé de la stabilité mentale.",
    biais:'état d’esprit — fondamental' });
  add({ id:'analysis-paralysis', nom:'Paralysie d’analyse', alias:['analysis paralysis','paralysie','trop d’indicateurs'], cat:'psycho', tags:['surcharge','indécision'],
    def:"Empiler trop d'indicateurs/avis jusqu'à ne plus pouvoir décider — ou toujours trouver une raison de douter.",
    usage:"Antidote : un plan simple avec 2-3 critères clairs. La confluence, pas la surcharge.",
    biais:'biais — indécision' });

  /* ===================== Macro (compléments) ===================== */
  add({ id:'yield-curve', nom:'Courbe des taux / Inversion', alias:['yield curve','courbe des taux','inversion','obligations'], cat:'macro', tags:['obligations','récession','signal'],
    def:"Écart entre taux courts et longs. Quand elle s'inverse (courts > longs), c'est un signal historique de récession à venir (avec délai).",
    usage:"Contexte de fond pour le régime risk-on/off ; signal lent, pas de timing.",
    biais:'contexte macro — récession' });
  add({ id:'pmi', nom:'PMI / Indices d’activité', alias:['pmi','ism','indices avancés','activité'], cat:'macro', tags:['données','cycle','avancé'],
    def:"Enquêtes auprès des directeurs d'achat. >50 = expansion, <50 = contraction. Indicateurs avancés du cycle économique.",
    usage:"Situer le cycle (expansion/ralentissement) qui oriente l'appétit pour le risque.",
    biais:'contexte — cycle' });
  add({ id:'qe-qt', nom:'QE / QT (Liquidité des banques centrales)', alias:['qe','qt','quantitative easing','tightening','liquidité'], cat:'macro', tags:['liquidité','bilan','fed'],
    def:"QE = la banque centrale injecte des liquidités (achète des actifs) → favorable au risque. QT = elle retire des liquidités → défavorable.",
    usage:"Le régime de liquidité globale est un moteur de fond majeur des actifs risqués (dont crypto).",
    biais:'contexte macro — liquidité' });
  add({ id:'opex', nom:'OPEX / Expiration des options', alias:['opex','triple witching','expiration options','quadruple witching'], cat:'session', tags:['options','volatilité','flux'],
    def:"Jours d'expiration des options (mensuels, et « triple witching » trimestriel) : gros volumes, aimantation du prix vers les strikes majeurs (max pain), volatilité.",
    usage:"On s'attend à des mouvements liés aux gros strikes et à un regain de volatilité autour de ces dates.",
    biais:'contexte — flux d’options' });

  /* ===================== Crypto & on-chain ===================== */
  add({ id:'btc-dominance', nom:'Dominance BTC', alias:['btc dominance','dominance bitcoin','dominance','alt season'], cat:'onchain', tags:['crypto','rotation','altcoins'],
    def:"Part de la capitalisation totale crypto détenue par le Bitcoin. Sa baisse (avec marché haussier) signale une rotation vers les altcoins (alt season).",
    usage:"Filtre de rotation : dominance qui monte = privilégier BTC ; qui baisse = les alts surperforment.",
    biais:'contexte — rotation crypto' });
  add({ id:'onchain-metrics', nom:'Métriques on-chain (MVRV, SOPR…)', alias:['on-chain','mvrv','sopr','nupl','realized price'], cat:'onchain', tags:['crypto','valorisation','cycle'],
    def:"Données de la blockchain mesurant profits/pertes latents des détenteurs (MVRV, SOPR, NUPL) et le prix de revient moyen (realized price). Repèrent extrêmes de cycle.",
    usage:"Situer les sommets/creux de cycle crypto (euphorie vs capitulation) ; contexte de fond, pas du timing court.",
    biais:'contexte — extrêmes de cycle' });
  add({ id:'exchange-flows', nom:'Flux vers/depuis les exchanges', alias:['exchange flows','netflow','réserves exchange','stablecoins'], cat:'onchain', tags:['crypto','offre','pression'],
    def:"Entrées de coins vers les exchanges = pression vendeuse potentielle ; sorties (vers cold wallets) = accumulation. Les réserves de stablecoins = « poudre sèche » prête à acheter.",
    usage:"Contexte de pression achat/vente : grosses sorties = signal d'accumulation de fond.",
    biais:'contexte — pression offre/demande' });
  add({ id:'whale-activity', nom:'Activité des baleines', alias:['whales','baleines','gros portefeuilles','smart money crypto'], cat:'onchain', tags:['crypto','institutionnel','flux'],
    def:"Suivi des très gros portefeuilles : leurs accumulations/distributions précèdent souvent les mouvements majeurs.",
    usage:"Indice de positionnement du smart money crypto ; à croiser avec la technique.",
    biais:'contexte — positionnement' });
  add({ id:'etf-flows', nom:'Flux des ETF (spot BTC/ETH)', alias:['etf flows','etf spot','flux etf','institutionnels'], cat:'onchain', tags:['crypto','institutionnel','demande'],
    def:"Entrées/sorties nettes des ETF spot crypto : mesurent la demande institutionnelle réelle. De fortes entrées soutiennent le prix.",
    usage:"Baromètre de la demande institutionnelle ; entrées soutenues = biais de fond haussier.",
    biais:'contexte — demande institutionnelle' });

  /* ===================== Produits & marchés (compléments) ===================== */
  add({ id:'order-types', nom:'Types d’ordres', alias:['order types','limit','market','stop','oco','iceberg','ordre limite'], cat:'produits', tags:['exécution','base','plateforme'],
    def:"Marché (exécution immédiate, subit le spread/slippage), Limite (prix fixé, exécution non garantie), Stop (déclenché à un niveau), OCO (l'un annule l'autre), Iceberg (gros ordre masqué).",
    usage:"On privilégie les ordres limites pour maîtriser le prix d'entrée ; les stops pour la protection automatique.",
    biais:'exécution — outils de base' });
  add({ id:'options-greeks', nom:'Options & Grecques (Delta/Gamma/Theta/Vega)', alias:['options','greeks','delta','gamma','theta','vega','calls','puts'], cat:'produits', tags:['dérivés','volatilité','couverture'],
    def:"Options = droit d'acheter (call) / vendre (put) à un prix. Les grecques mesurent la sensibilité : Delta (au prix), Gamma (au delta), Theta (au temps), Vega (à la volatilité).",
    usage:"Spéculer avec risque défini, se couvrir, ou jouer la volatilité. Le gamma des market makers influence aussi le spot (gamma exposure).",
    biais:'dérivés — outils avancés' });
  add({ id:'contango-backwardation', nom:'Contango / Backwardation', alias:['contango','backwardation','structure à terme','basis'], cat:'produits', tags:['futures','structure','coût'],
    def:"Contango : les contrats à terme cotent plus cher que le spot (marché normal, coût de portage). Backwardation : à terme moins cher que le spot (tension sur l'offre).",
    usage:"Impacte le coût de roulement des positions à terme et signale l'état de l'offre/demande.",
    biais:'contexte — structure des futures' });
  add({ id:'margin-call', nom:'Appel de marge / Liquidation', alias:['margin call','appel de marge','marge de maintenance'], cat:'produits', tags:['levier','risque','marge'],
    def:"Quand les pertes érodent la marge sous le seuil de maintenance, le courtier exige des fonds ou liquide la position de force.",
    usage:"À éviter absolument : garder une marge tampon large, ne jamais utiliser le levier maximal.",
    biais:'risque — à prévenir' });

  /* ===================== Stratégies de trading ===================== */
  add({ id:'styles', nom:'Styles de trading (Scalp/Day/Swing/Position)', alias:['scalping','day trading','swing trading','position trading','horizon'], cat:'strat', tags:['horizon','style','base'],
    def:"Scalping (secondes-minutes), Day trading (intraday, clôturé le soir), Swing (jours-semaines), Position (semaines-mois). Plus l'horizon est court, plus il faut de temps d'écran et de discipline.",
    usage:"Choisir le style adapté à sa disponibilité et son tempérament. Le site vise le swing/day sur H1-D1.",
    biais:'cadre — choix d’horizon' });
  add({ id:'trend-following', nom:'Suivi de tendance', alias:['trend following','suivi de tendance','momentum trading'], cat:'strat', tags:['tendance','laisser courir','systématique'],
    def:"Entrer dans le sens d'une tendance établie et la suivre jusqu'à son épuisement, avec stop suiveur. Peu de trades gagnants mais gros gains (asymétrie).",
    usage:"On accepte beaucoup de petites pertes en échange de quelques grosses tendances. Discipline du trailing stop essentielle.",
    biais:'stratégie — tendance' });
  add({ id:'breakout-trading', nom:'Trading de cassure (Breakout)', alias:['breakout','cassure','sortie de range','retest'], cat:'strat', tags:['range','volume','momentum'],
    def:"Entrer quand le prix casse un niveau clé (range, figure) sur volume, pariant sur la continuation. Le retest du niveau cassé offre une entrée plus sûre.",
    usage:"On filtre les faux breakouts par le volume et l'attente d'une clôture confirmée / d'un retest.",
    biais:'stratégie — cassure' });
  add({ id:'range-trading', nom:'Trading de range', alias:['range trading','mean reversion range','achat bas vente haut'], cat:'strat', tags:['range','borne','contrarian'],
    def:"Dans un marché latéral, acheter le support et vendre la résistance en pariant sur le rebond. Opposé du breakout.",
    usage:"Fonctionne tant que le range tient ; on coupe vite si le niveau cède (cassure).",
    biais:'stratégie — range' });
  add({ id:'dca', nom:'DCA (Dollar Cost Averaging)', alias:['dca','dollar cost averaging','achats programmés','lissage'], cat:'strat', tags:['investissement','long terme','discipline'],
    def:"Investir un montant fixe à intervalles réguliers quel que soit le prix, pour lisser le prix d'entrée dans le temps. Approche d'investissement, pas de trading.",
    usage:"Réduit le risque de mal timer le marché sur le long terme ; populaire en crypto.",
    biais:'stratégie — investissement' });
  add({ id:'carry-trade', nom:'Carry trade', alias:['carry trade','portage','différentiel de taux'], cat:'strat', tags:['taux','forex','rendement'],
    def:"Emprunter dans une devise à faible taux pour placer dans une à taux élevé, en encaissant le différentiel (le carry). Risque : un retournement violent efface des mois de carry.",
    usage:"Stratégie forex/macro ; sensible aux crises (débouclage brutal en risk-off).",
    biais:'stratégie — rendement' });
  add({ id:'arbitrage', nom:'Arbitrage', alias:['arbitrage','arb','écart de prix','funding arb'], cat:'strat', tags:['sans risque','écart','institutionnel'],
    def:"Exploiter un écart de prix du même actif entre deux marchés (ou spot vs futures) pour un gain quasi sans risque directionnel. Les écarts sont minuscules et disparaissent vite.",
    usage:"Réservé aux acteurs rapides/automatisés ; en crypto, l'arbitrage de funding est courant.",
    biais:'stratégie — écart' });
  add({ id:'grid-martingale', nom:'Grid & Martingale (⚠️ risqué)', alias:['grid trading','martingale','grille','doubler la mise'], cat:'strat', tags:['danger','automatisé','ruine'],
    def:"Grid : placer des ordres en grille pour profiter des oscillations. Martingale : doubler la mise après chaque perte. La martingale mène statistiquement à la ruine sur une longue série.",
    usage:"À manier avec extrême prudence : ces approches cachent le risque et explosent en tendance forte. Le site déconseille la martingale.",
    biais:'stratégie — haut risque' });
  add({ id:'confluence', nom:'Confluence', alias:['confluence','alignement','faisceau','a+'], cat:'strat', tags:['probabilité','filtre','setup'],
    def:"Superposition de plusieurs signaux indépendants au même endroit (ex. OB + FVG + niveau Fibo + liquidité + biais HTF). Plus il y a de confluence, plus la probabilité monte.",
    usage:"Cœur de la sélection : ne prendre que les setups « A+ » riches en confluence, ignorer les signaux isolés. Le site affiche un score de confluence.",
    biais:'stratégie — filtre de qualité' });
  add({ id:'checklist', nom:'Checklist de trade', alias:['checklist','plan d’entrée','critères','pré-trade'], cat:'strat', tags:['discipline','process','filtre'],
    def:"Liste de critères à valider AVANT chaque entrée : biais HTF, zone d'intérêt, confirmation, RR ≥ objectif, taille calculée, événement macro à venir ?",
    usage:"Passe-plat anti-impulsivité : si un critère manque, pas de trade. Transforme le trading en process reproductible.",
    biais:'stratégie — discipline' });

  /* ===================== Tracés & lignes (compléments AT) ===================== */
  add({ id:'trendline-break', nom:'Cassure & retest de trendline', alias:['trendline break','cassure de ligne','retest','throwback','pullback'], cat:'at', tags:['cassure','confirmation','entrée'],
    def:"Quand le prix casse une ligne de tendance, il revient souvent la retester (throwback/pullback) : l'ancien support devient résistance (ou l'inverse). Un retest qui tient valide la cassure.",
    usage:"Plutôt que de chasser la première cassure (souvent piégeuse), on attend le retest de la ligne pour une entrée plus sûre, stop de l'autre côté.",
    biais:'confirmation — valide la cassure' });
  add({ id:'trendline-validation', nom:'Validation d’une trendline', alias:['validation trendline','3 touches','angle de tendance','pente'], cat:'at', tags:['tracé','fiabilité','pente'],
    def:"Une ligne de tendance gagne en fiabilité avec le nombre de touches (2 pour la tracer, 3+ pour la confirmer) et un angle raisonnable (~30-45°). Trop pentue = insoutenable, trop plate = peu significative.",
    usage:"On privilégie les lignes touchées plusieurs fois et d'angle modéré ; on ignore les tracés forcés à travers les mèches.",
    biais:'fiabilité — qualité du tracé' });
  add({ id:'fakeout', nom:'Faux breakout (Fakeout)', alias:['fakeout','faux signal','fausse cassure','bull trap','bear trap'], cat:'at', tags:['piège','liquidité','retournement'],
    def:"Cassure d'un niveau qui échoue et se retourne aussitôt, piégeant ceux qui ont suivi (bull trap au-dessus d'une résistance, bear trap sous un support). Souvent une chasse aux stops.",
    usage:"On filtre par le volume et l'attente d'une clôture ; un fakeout confirmé (retour dans le range) devient un signal de retournement à fader.",
    biais:'retournement — piège classique' });
  add({ id:'sfp', nom:'Swing Failure Pattern (SFP)', alias:['sfp','swing failure','échec de swing','faux plus-haut'], cat:'at', tags:['liquidité','retournement','mèche'],
    def:"Le prix dépasse brièvement un sommet/creux précédent (prise de liquidité) puis clôture de nouveau à l'intérieur : échec à tenir le nouvel extrême = signal de retournement.",
    usage:"Entrée contre le faux dépassement, stop au-delà de la mèche. Équivalent AT du liquidity sweep / turtle soup.",
    biais:'retournement' });
  add({ id:'measured-move', nom:'Mouvement mesuré', alias:['measured move','objectif mesuré','projection de figure','hauteur'], cat:'at', tags:['objectif','projection','figure'],
    def:"Méthode d'objectif : projeter la hauteur d'une figure (range, triangle, drapeau, tête-épaules) depuis le point de cassure pour estimer la cible du mouvement.",
    usage:"Fixe un take-profit logique basé sur la géométrie de la figure plutôt qu'au hasard.",
    biais:'objectif — cible mesurée' });
  add({ id:'psychological-levels', nom:'Niveaux psychologiques (nombres ronds)', alias:['round numbers','nombres ronds','niveaux psychologiques','00 level'], cat:'at', tags:['niveau','ordres','aimant'],
    def:"Les prix ronds (100, 1 000, 50 000…) attirent une concentration d'ordres (stops, limites) : ils agissent comme support/résistance et zones de liquidité naturelles.",
    usage:"On surveille les réactions du prix aux nombres ronds ; ils servent souvent d'objectifs ou de zones de balayage.",
    biais:'niveau — aimant psychologique' });
  add({ id:'pitchfork', nom:'Fourche d’Andrews (Pitchfork)', alias:['andrews pitchfork','fourche d’andrews','median line','pitchfork'], cat:'at', tags:['canal','médiane','tracé'],
    def:"Outil en 3 lignes parallèles tracé à partir de 3 points (creux-sommet-creux) : la ligne médiane attire le prix, les deux lignes externes servent de support/résistance dynamiques.",
    usage:"On trade les rebonds sur les lignes et les retours vers la médiane ; utile pour encadrer une tendance saine.",
    biais:'dynamique — canal statistique' });
  add({ id:'regression-channel', nom:'Canal de régression linéaire', alias:['regression channel','canal de régression','déviation standard','raff channel'], cat:'at', tags:['statistique','canal','moyenne'],
    def:"Canal construit par régression linéaire (droite qui minimise l'écart au prix) encadrée d'écarts-types. Montre la tendance moyenne et ses extrêmes statistiques.",
    usage:"On achète le bas / vend le haut du canal en tendance ; la sortie des bandes signale un excès ou un changement de régime.",
    biais:'dynamique — tendance statistique' });
  add({ id:'fibonacci-fan', nom:'Éventail & arcs de Fibonacci', alias:['fibonacci fan','éventail de fibonacci','arcs','fibonacci time zones'], cat:'at', tags:['fibonacci','dynamique','tracé'],
    def:"Déclinaisons du Fibonacci : l'éventail (obliques depuis un extrême) donne des supports/résistances diagonaux ; les arcs ajoutent une dimension temps ; les time zones marquent des dates de retournement potentielles.",
    usage:"Compléments dynamiques aux retracements horizontaux, pour situer support/résistance dans le temps.",
    biais:'contexte — support/résistance dynamique' });
  add({ id:'gann', nom:'Angles & éventail de Gann', alias:['gann fan','angles de gann','1x1','gann box','w.d. gann'], cat:'at', tags:['géométrie','temps-prix','tracé'],
    def:"Système de W.D. Gann reliant temps et prix par des angles géométriques (le 1×1 / 45° étant l'angle d'équilibre). Les prix respecteraient certaines pentes et divisions.",
    usage:"On utilise l'angle 1×1 comme tendance de fond ; approche controversée et subjective, à croiser avec d'autres outils.",
    biais:'contexte — géométrie temps/prix' });
  add({ id:'dow-theory', nom:'Théorie de Dow', alias:['dow theory','théorie de dow','charles dow','3 mouvements'], cat:'at', tags:['théorie','tendance','fondement'],
    def:"Fondement de l'AT (Charles Dow) : le marché escompte tout, évolue en 3 tendances (primaire, secondaire, mineure) et 3 phases (accumulation, participation, distribution) ; une tendance persiste jusqu'à signal clair de retournement, confirmé par le volume.",
    usage:"Cadre de fond pour définir la tendance primaire et exiger la confirmation (indices/volume) avant de conclure à un retournement.",
    biais:'cadre — fondement de la tendance' });
  add({ id:'elliott-wave', nom:'Vagues d’Elliott', alias:['elliott wave','vagues d’elliott','5-3','impulsion correction','ondes'], cat:'at', tags:['théorie','cycles','fractal'],
    def:"Théorie fractale : le marché progresse en 5 vagues dans le sens de la tendance (impulsion 1-2-3-4-5) puis corrige en 3 vagues (A-B-C), reflet de la psychologie de foule. Guidé par des ratios de Fibonacci.",
    usage:"Situer la phase du cycle (ex. vague 3 = la plus puissante) pour anticiper la suite. Puissant mais très subjectif — plusieurs comptages possibles.",
    biais:'cadre — cycles de sentiment' });
  add({ id:'wolfe-waves', nom:'Vagues de Wolfe', alias:['wolfe waves','vagues de wolfe','5 points'], cat:'at', tags:['figure','retournement','projection'],
    def:"Figure en 5 points qui, correctement identifiée, projette une ligne cible (1→4) et un timing de retournement. Cherche l'équilibre « naturel » du prix.",
    usage:"On entre au point 5 avec objectif sur la ligne 1-4 ; exige une identification stricte pour éviter les faux comptages.",
    biais:'retournement — avec cible projetée' });
  add({ id:'ma-ribbon', nom:'Ruban de moyennes mobiles', alias:['ma ribbon','ruban de moyennes','guppy','gmma','ema stack'], cat:'indic', tags:['tendance','empilement','visuel'],
    def:"Plusieurs moyennes mobiles de périodes croissantes affichées ensemble. Quand elles sont bien empilées et écartées dans l'ordre = tendance forte ; quand elles s'entrelacent = absence de tendance.",
    usage:"Lecture visuelle rapide de la force et de la santé d'une tendance ; le resserrement annonce souvent un tournant.",
    biais:'directionnel — force de tendance' });
  add({ id:'log-scale', nom:'Échelle log vs linéaire', alias:['log scale','échelle logarithmique','semi-log','linéaire'], cat:'at', tags:['graphique','pourcentage','long terme'],
    def:"L'échelle logarithmique représente les variations en pourcentage (une même distance = même % de hausse), l'échelle linéaire en valeur absolue. Sur le long terme et les gros mouvements (crypto), le log est plus fidèle.",
    usage:"On trace les trendlines de fond en échelle log pour les grands mouvements ; les niveaux et angles diffèrent nettement de l'échelle linéaire.",
    biais:'méthode — lecture correcte du graphe' });

  /* ===================== ICT / SMC — compléments avancés (v2, cœur de la méthode) ===================== */
  add({ id:'poi', nom:'Point of Interest (POI)', alias:['poi','point of interest','point d’intérêt','zone d’intérêt'], cat:'smc', tags:['zone','entrée','umbrella'],
    def:"Terme parapluie SMC désignant TOUTE zone d'où le smart money est susceptible de réagir : order block, FVG, breaker, mitigation, zone offre/demande. Un POI n'est valide que s'il est frais, en discount/premium correct et aligné avec le biais HTF.",
    usage:"On ne trade que les POI de haute qualité : frais (non retesté), issu d'un displacement, situé du bon côté de l'équilibre, en confluence avec la liquidité. On attend le retour du prix dessus pour entrer.",
    biais:'contexte — zone d’entrée qualifiée' });
  add({ id:'valid-ob', nom:'Critères d’un Order Block VALIDE', alias:['valid order block','ob valide','critères ob','qualité order block'], cat:'ict', tags:['order block','filtre','qualité'],
    def:"Un OB n'est fiable que s'il coche 3 conditions : (1) il provoque un DISPLACEMENT (mouvement impulsif) ; (2) ce mouvement CASSE la structure (BOS/MSS) ; (3) il laisse un FVG juste après. Un OB sans déplacement ni cassure n'est qu'une bougie ordinaire.",
    usage:"Filtre anti-fausse-zone : on rejette tout OB qui n'a pas causé de déplacement + cassure + FVG. Cela élimine la majorité des faux order blocks.",
    biais:'filtre — ne garder que les vrais OB' });
  add({ id:'ob-refinement', nom:'Raffinement d’Order Block', alias:['ob refinement','raffinement ob','affiner order block','ob sur ltf'], cat:'ict', tags:['order block','précision','ltf'],
    def:"Affiner une grosse zone OB en descendant d'unité de temps : à l'intérieur du gros OB, on repère le FVG ou la mèche précise d'où part réellement l'impulsion, pour un point d'entrée plus fin et un stop plus serré.",
    usage:"On zoome sur le POI HTF en H1/M15 pour entrer sur la partie active de l'OB (souvent son FVG interne ou le 50 %), améliorant nettement le RR.",
    biais:'précision — meilleur RR' });
  add({ id:'extreme-decisional-ob', nom:'OB extrême vs OB décisionnel', alias:['extreme order block','decisional order block','ob extrême','ob décisionnel'], cat:'smc', tags:['order block','hiérarchie','entrée'],
    def:"L'OB extrême est le tout dernier bloc avant le retournement (le plus profond, à l'extrémité du mouvement) ; l'OB décisionnel est celui d'où est partie la cassure de structure. L'extrême offre le meilleur RR, le décisionnel une entrée plus précoce mais moins profonde.",
    usage:"En entrée agressive on vise le décisionnel ; en entrée patiente/meilleur RR on attend l'OB extrême. On peut échelonner sur les deux.",
    biais:'hiérarchie — choix du point d’entrée' });
  add({ id:'entry-model-smc', nom:'Modèle d’entrée SMC (CHoCH → POI)', alias:['smc entry model','modèle entrée smc','choch pullback','entrée smc'], cat:'smc', tags:['setup','séquence','entrée'],
    def:"Séquence d'entrée SMC de référence : (1) le prix balaye une liquidité (sweep) ; (2) il casse la structure interne (CHoCH/MSS) via un displacement ; (3) il laisse un POI (FVG/OB) derrière ; (4) on attend son retour dans ce POI, situé en discount (long) ou premium (short) ; (5) confirmation LTF puis entrée.",
    usage:"Cadre reproductible : sweep → CHoCH → POI → retour → confirmation → entrée, stop au-delà du sweep, cible sur la liquidité opposée. C'est le squelette d'un trade SMC propre.",
    biais:'modèle — séquence d’entrée complète' });
  add({ id:'protected-hl', nom:'Plus-haut / plus-bas protégé', alias:['protected high','protected low','protected high low','point structurel clé'], cat:'structure', tags:['structure','choch','référence'],
    def:"Le sommet/creux dont la cassure changerait officiellement la structure : le dernier plus-haut avant un plus-bas majeur (et inversement). Tant qu'il tient, la tendance en place est intacte ; sa cassure = CHoCH/BOS.",
    usage:"Sert de niveau de référence pour définir invalidations et signaux : on surveille précisément ce point, pas tous les petits swings.",
    biais:'référence — valide/invalide la tendance' });
  add({ id:'impulse-correction', nom:'Jambes impulsives vs correctives', alias:['impulse leg','corrective leg','jambe impulsive','jambe corrective','impulse correction'], cat:'structure', tags:['structure','lecture','tendance'],
    def:"Une tendance alterne des jambes IMPULSIVES (rapides, longues, avec FVG, dans le sens du flux) et des jambes CORRECTIVES (lentes, chevauchées, contre le flux). Le sens des jambes impulsives donne la vraie direction.",
    usage:"On trade DANS le sens des jambes impulsives et on utilise les jambes correctives comme opportunités de pullback vers un POI. Une correction qui devient impulsive à contre-sens = alerte de retournement.",
    biais:'lecture — révèle le vrai sens du flux' });
  add({ id:'swing-internal-structure', nom:'Structure de swing vs interne', alias:['swing structure','internal structure','structure interne','fractale de structure'], cat:'structure', tags:['structure','fractal','htf ltf'],
    def:"Deux niveaux de structure coexistent : la structure de SWING (majeure, sur les grands sommets/creux) et la structure INTERNE (mineure, les swings à l'intérieur d'une jambe). Un CHoCH interne ne renverse pas forcément la structure de swing.",
    usage:"On lit d'abord la structure de swing (biais) puis l'interne (timing) : on entre sur un CHoCH interne UNIQUEMENT s'il va dans le sens de la structure de swing.",
    biais:'cadre — évite les faux retournements' });
  add({ id:'irl-erl', nom:'Liquidité de range interne / externe (IRL ↔ ERL)', alias:['irl','erl','internal range liquidity','external range liquidity','irl erl'], cat:'smc', tags:['liquidité','séquence','cible'],
    def:"ERL = liquidité externe (les extrêmes du range : plus-hauts/bas, equal highs-lows). IRL = liquidité interne (les FVG à l'intérieur). Le prix livre en alternance : il prend l'IRL (comble un FVG) pour se propulser vers l'ERL (un extrême), puis inverse.",
    usage:"On lit la séquence de livraison : après avoir comblé un FVG interne, la cible logique est l'extrême opposé (ERL) ; après un sweep d'ERL, la cible devient le FVG interne (IRL). Donne l'objectif du trade.",
    biais:'séquence — enchaîne les cibles' });
  add({ id:'rebalance', nom:'Rééquilibrage / Efficient Price Delivery', alias:['rebalance','rééquilibrage','efficient price delivery','remplissage fvg','offre efficace'], cat:'ict', tags:['fvg','aimant','logique'],
    def:"Principe moteur ICT : le marché cherche à livrer le prix de façon « efficace », c'est-à-dire à rééquilibrer les zones de déséquilibre (FVG) laissées par les mouvements rapides. Un FVG non comblé est une inefficacité qui attire le prix.",
    usage:"On anticipe les retours du prix pour combler les FVG ouverts (surtout les plus proches et les plus gros) : ce sont des cibles ET des zones d'entrée naturelles.",
    biais:'aimant — le prix revient rééquilibrer' });
  add({ id:'fpfvg', nom:'First Presented FVG (FPFVG)', alias:['fpfvg','first presented fvg','premier fvg de session','fvg d’ouverture'], cat:'ict', tags:['fvg','session','timing'],
    def:"Le premier Fair Value Gap formé après l'ouverture d'une session/journée. ICT le considère comme un niveau de référence privilégié : le prix y réagit souvent en début de séance.",
    usage:"On repère le 1ᵉʳ FVG après l'open (minuit NY, open Londres/NY) : son retour offre une entrée dans le sens du biais du jour.",
    biais:'niveau — référence d’ouverture' });
  add({ id:'fvg-continuation-reversal', nom:'FVG de continuation vs de retournement', alias:['continuation fvg','reversal fvg','fvg continuation','fvg retournement'], cat:'ict', tags:['fvg','contexte','filtre'],
    def:"Un FVG dans le sens de la tendance en place (après un BOS) = FVG de CONTINUATION, fiable pour suivre. Un FVG créé juste après un sweep + MSS contre la tendance = FVG de RETOURNEMENT, utilisé pour entrer dans le nouveau sens.",
    usage:"On classe chaque FVG par son contexte : continuation → on suit ; retournement → on attend confirmation (MSS + sweep) avant d'entrer à contre-tendance.",
    biais:'contexte — qualifie le FVG' });
  add({ id:'trendline-liquidity', nom:'Liquidité de trendline', alias:['trendline liquidity','liquidité de trendline','stops sous la ligne','angular liquidity'], cat:'ict', tags:['liquidité','trendline','piège'],
    def:"Les stops que les traders placent le long d'une ligne de tendance forment une liquidité « diagonale » que le smart money vient raider. Une trendline « trop parfaite » est souvent construite comme un appât.",
    usage:"On identifie les trendlines évidentes comme cibles de balayage : leur cassure est souvent un piège (fakeout) suivi d'un retournement — on fade plutôt que de suivre.",
    biais:'piège — cible de raid' });
  add({ id:'liquidity-engineering', nom:'Ingénierie de liquidité', alias:['liquidity engineering','ingénierie de liquidité','fabrication de liquidité','equal highs induction'], cat:'ict', tags:['manipulation','equal highs','liquidité'],
    def:"Le smart money « fabrique » de la liquidité avant de s'en servir : il laisse le prix créer des equal highs/lows, des trendlines nettes ou des figures évidentes, pour attirer un maximum d'ordres (stops), puis raide cette liquidité pour se positionner à contre-courant.",
    usage:"Quand une figure ou un niveau est « trop évident » et que tout le monde le voit, on se méfie : c'est souvent de la liquidité fabriquée destinée à être prise avant le vrai mouvement.",
    biais:'manipulation — le piège précède le mouvement' });
  add({ id:'liquidity-purge', nom:'Double purge de liquidité', alias:['liquidity purge','double purge','purge des deux côtés','swept both sides'], cat:'ict', tags:['liquidité','range','manipulation'],
    def:"Séquence où le prix balaye la liquidité des DEUX côtés d'un range (d'abord un extrême, puis l'autre) pour nettoyer tous les stops avant de choisir sa vraie direction. Typique des phases de manipulation.",
    usage:"Dans un range serré, on attend que les deux bords soient balayés avant de se positionner dans le sens du dernier rejet — évite de se faire piéger par le premier faux mouvement.",
    biais:'manipulation — nettoyage avant expansion' });
  add({ id:'equilibrium-leg', nom:'Équilibre d’une jambe (50 %)', alias:['equilibrium','équilibre','50% de la jambe','fib 0.5 ict'], cat:'ict', tags:['premium','discount','entrée'],
    def:"Le point médian (50 %) d'une jambe de prix sépare son premium (haut, cher) de son discount (bas, bon marché). ICT n'achète qu'en dessous de l'équilibre et ne vend qu'au-dessus, pour ne payer que le « bon » côté de la valeur.",
    usage:"On trace le Fib sur la dernière jambe : entrée longue seulement si le POI est sous le 50 % (discount), short seulement au-dessus (premium). Filtre de RR essentiel.",
    biais:'filtre — n’entrer que du bon côté' });
  add({ id:'ny-reversal', nom:'Retournement de New York (AM / PM)', alias:['ny reversal','new york reversal','ny am','ny pm','retournement new york'], cat:'session', tags:['session','horaire','retournement'],
    def:"La séance de New York offre deux fenêtres de retournement classiques : la session AM (≈08h30-11h NY, souvent le mouvement principal après un piège d'ouverture) et un retournement PM (≈13h30-15h NY) qui peut inverser ou prolonger le mouvement du matin.",
    usage:"On cible les setups de retournement dans ces fenêtres (souvent après un balayage de la liquidité de Londres ou du PDH/PDL), plutôt qu'à la mi-journée (lunch, faible).",
    biais:'timing — fenêtres de retournement' });
  add({ id:'london-model', nom:'Modèle de Londres (Judas + expansion)', alias:['london model','modèle de londres','london open','judas londres'], cat:'session', tags:['session','londres','setup'],
    def:"Schéma récurrent à l'ouverture de Londres : un faux mouvement initial (Judas swing) qui balaye la liquidité du range asiatique, suivi du VRAI mouvement dirigé en sens inverse pour le reste de la matinée.",
    usage:"On note le haut/bas du range d'Asie ; à l'open de Londres on attend le balayage d'un côté + le retournement (MSS) pour entrer dans le vrai sens, cible sur la liquidité opposée.",
    biais:'setup — piège puis expansion' });
  add({ id:'session-liquidity', nom:'Liquidité de session (Asia/London highs-lows)', alias:['session liquidity','asia high low','london high low','liquidité de session'], cat:'session', tags:['liquidité','session','cible'],
    def:"Les plus-hauts/plus-bas de chaque session (Asia High/Low, London High/Low, ainsi que PDH/PDL) sont des pools de liquidité de référence que les sessions suivantes viennent souvent chercher.",
    usage:"On cartographie ces niveaux avant la séance : ils servent de cibles (DOL) et de zones de balayage. Le prix va typiquement chercher la liquidité de la session précédente.",
    biais:'niveau — cibles inter-sessions' });
  add({ id:'stop-placement-ict', nom:'Placement du stop (logique ICT)', alias:['stop placement','placement du stop','stop ict','stop au-delà du sweep'], cat:'risque', tags:['stop','structure','invalidation'],
    def:"En ICT/SMC, le stop se place là où le SCÉNARIO est invalidé, pas à une distance arbitraire : juste au-delà de la mèche du balayage (sweep) ou de l'extrême de l'order block d'où l'on entre. Si ce niveau cède, l'idée est fausse.",
    usage:"On définit d'abord l'invalidation (au-delà du sweep/OB), puis on dimensionne la position pour que cette distance = 1 % du capital. Jamais l'inverse.",
    biais:'gestion — stop au point d’invalidation' });

  /* ===================== ICT / SMC — compléments avancés (v3, finesse d’exécution) ===================== */
  add({ id:'reh-rel', nom:'Relative Equal Highs / Lows (REH/REL)', alias:['reh','rel','relative equal highs','relative equal lows','sommets quasi égaux'], cat:'ict', tags:['liquidité','equal','nuance'],
    def:"Sommets/creux QUASI égaux (à quelques points près), par opposition aux equal highs/lows parfaits. Concentrent une liquidité un peu plus diffuse mais tout aussi ciblée par le smart money.",
    usage:"On les traite comme des pools de liquidité (cibles/sweeps) au même titre que les equal parfaits ; ne pas exiger une égalité au tick près pour valider une zone de liquidité.",
    biais:'aimant — liquidité (tolérance)' });
  add({ id:'liquidity-tiers', nom:'Hiérarchie de liquidité (mineure → majeure)', alias:['liquidity tiers','niveaux de liquidité','short term high','intermediate high','long term high'], cat:'ict', tags:['fractal','structure','dol'],
    def:"La liquidité est fractale : swings de court terme (STH/STL) < intermédiaires (ITH/ITL) < long terme (LTH/LTL). Les plus gros pools (LTH/LTL, PWH/PWL, PMH/PML) sont les aimants les plus puissants.",
    usage:"On choisit le DOL selon l'horizon du trade : pour un swing on vise la liquidité intermédiaire/long terme ; pour un intraday, court terme. On ne confond pas un petit sweep avec une cible majeure.",
    biais:'cadre — calibre la cible' });
  add({ id:'old-high-low', nom:'Anciens plus-hauts / plus-bas (Old High/Low)', alias:['old high','old low','anciens extrêmes','untested high','niveau non testé'], cat:'ict', tags:['liquidité','niveau','cible'],
    def:"Extrêmes de prix anciens jamais retestés : ils gardent une liquidité « oubliée » (stops laissés en place) et agissent comme des aimants de long terme lorsque le marché s'en approche.",
    usage:"On les note comme cibles latentes : un marché sans DOL proche évident se dirige souvent vers l'ancien plus-haut/bas non testé le plus proche.",
    biais:'aimant — liquidité résiduelle' });
  add({ id:'open-price-theory', nom:'Théorie du prix d’ouverture (Midnight/True Open)', alias:['open price theory','midnight open','true day open','prix d’ouverture','00h ny'], cat:'ict', tags:['niveau','premium','discount'],
    def:"L'ouverture de référence (minuit NY pour le jour, ou « true open » à 08h30 NY) sépare la journée en premium (au-dessus) et discount (en dessous). Le smart money vend le premium, achète le discount par rapport à cette ligne.",
    usage:"On trace l'open du jour : ne chercher des longs que sous l'open (discount) et des shorts qu'au-dessus (premium). Filtre directionnel intraday simple et puissant.",
    biais:'niveau — équilibre du jour' });
  add({ id:'breaker-mitigation-ob', nom:'OB vs Breaker vs Mitigation (à ne pas confondre)', alias:['breaker vs mitigation','différence order block breaker','disambiguation ob'], cat:'ict', tags:['clarification','zones','structure'],
    def:"Order Block = dernière bougie opposée AVANT l'impulsion (structure intacte). Breaker = OB qui a ÉCHOUÉ puis été cassé, il joue le rôle inverse. Mitigation = OB retesté pour équilibrer des positions, dans le sens de la tendance. Trois zones proches mais de contextes différents.",
    usage:"On identifie le bon type selon ce qui vient de se passer : après une cassure de structure → breaker (rejet) ; en pullback de tendance → OB/mitigation (continuation). Se tromper de type = se tromper de sens.",
    biais:'clarification — évite les erreurs de sens' });
  add({ id:'smt-pairs', nom:'Paires de corrélation pour la SMT', alias:['smt pairs','paires smt','corrélations divergence','btc eth es nq'], cat:'ict', tags:['smt','corrélation','confirmation'],
    def:"Couples d'actifs corrélés servant à repérer une divergence SMT : BTC↔ETH (et vs total crypto), ES↔NQ (indices US), EUR↔GBP, or↔argent, et l'inverse DXY↔actifs risqués. Si l'un fait un nouvel extrême et l'autre non, le mouvement manque de conviction.",
    usage:"Au moment d'un sweep, on vérifie le corrélé : une divergence (un actif balaye son extrême, l'autre non) confirme le retournement. Confluence forte à ajouter au setup.",
    biais:'confirmation — force du retournement' });
  add({ id:'liquidity-grab-vs-break', nom:'Prise de liquidité vs vraie cassure', alias:['liquidity grab','vraie cassure','grab vs break','mèche vs clôture'], cat:'structure', tags:['filtre','clôture','fakeout'],
    def:"Une PRISE de liquidité = le prix dépasse un niveau par une MÈCHE puis clôture de l'autre côté (rejet, retournement probable). Une VRAIE cassure = clôture franche AU-DELÀ du niveau avec displacement (continuation). Distinguer les deux évite de confondre piège et signal.",
    usage:"On attend la CLÔTURE de bougie : mèche qui dépasse puis rejette = on fade (turtle soup/SFP) ; corps qui clôture au-delà + FVG = on suit. Ne jamais réagir au dépassement en temps réel avant la clôture.",
    biais:'filtre — piège ou continuation' });
  add({ id:'candle-close-confirmation', nom:'Confirmation par clôture de bougie', alias:['candle close','confirmation clôture','body close','attendre la clôture'], cat:'structure', tags:['confirmation','discipline','filtre'],
    def:"Un niveau n'est considéré cassé/validé que sur CLÔTURE de bougie de l'unité concernée, pas sur un simple débordement de mèche intra-bougie. Réduit drastiquement les faux signaux.",
    usage:"On valide BOS/CHoCH/cassures de niveau uniquement à la clôture H1/H4/D1. Une entrée basée sur un dépassement non clôturé est une entrée sur du bruit.",
    biais:'discipline — filtre anti-bruit' });
  add({ id:'stop-run-continuation', nom:'Sweep de continuation (piège inversé)', alias:['stop run continuation','sweep continuation','tous les sweeps ne retournent pas'], cat:'ict', tags:['nuance','honnêteté','tendance'],
    def:"Nuance essentielle : un balayage de liquidité ne mène PAS toujours à un retournement. En tendance forte, le prix prend la liquidité puis CONTINUE dans le même sens (le sweep alimente la poursuite). Le contexte HTF tranche.",
    usage:"On ne fade un sweep que s'il est CONTRE une tendance affaiblie / à un extrême HTF avec MSS. En pleine tendance saine, un sweep dans le sens du flux = signal de CONTINUATION, pas de retournement.",
    biais:'nuance — le contexte décide' });
  add({ id:'anchored-vwap', nom:'VWAP ancré (Anchored VWAP)', alias:['anchored vwap','vwap ancré','avwap','vwap événement'], cat:'indic', tags:['institutionnel','moyenne','niveau'],
    def:"VWAP calculé depuis un événement clé précis (un sommet/creux majeur, une news, un halving) plutôt que depuis l'ouverture de session. Montre le prix moyen payé par tous les acteurs depuis cet ancrage.",
    usage:"Support/résistance dynamique institutionnel : le prix au-dessus de l'AVWAP d'un creux majeur = acheteurs en contrôle depuis le bas. Sert de niveau de confluence et de cible.",
    biais:'niveau — moyenne institutionnelle' });
  add({ id:'adr', nom:'ADR — Plage journalière moyenne', alias:['adr','average daily range','plage journalière','amplitude moyenne','atr journalier'], cat:'indic', tags:['volatilité','objectif','réalisme'],
    def:"Amplitude moyenne (haut-bas) d'une journée sur les N derniers jours. Indique combien un actif « bouge » typiquement par jour.",
    usage:"Jauge de réalisme des objectifs : si l'actif a déjà parcouru ~100 % de son ADR, un gros mouvement supplémentaire est peu probable (on évite d'entrer tard / on réduit la cible). Reste d'ADR disponible = potentiel restant du jour.",
    biais:'contexte — potentiel restant' });
  add({ id:'news-window', nom:'Fenêtre de news (embargo)', alias:['news window','fenêtre de news','embargo','high impact news','fomc cpi nfp'], cat:'risque', tags:['volatilité','discipline','protection'],
    def:"Période autour d'une publication à fort impact (FOMC, CPI, NFP) où le prix devient erratique : spreads larges, faux mouvements, slippage. Les setups techniques y perdent leur fiabilité.",
    usage:"On évite d'ouvrir un trade juste avant/pendant ces fenêtres, ou on réduit fortement la taille. On laisse le marché « digérer » avant de reprendre la lecture ICT/SMC.",
    biais:'gestion — éviter le chaos' });
  add({ id:'setup-grade', nom:'Notation des setups (A+ / A / B)', alias:['setup grade','notation','a+ setup','qualité de setup','grade'], cat:'strat', tags:['sélection','confluence','discipline'],
    def:"Classement d'un setup par sa confluence : A+ (biais HTF + sweep + displacement/MSS + POI en discount/premium + DOL clair + RR ≥ 3) ; A (la plupart des critères, RR ≥ 2) ; B (partiel, RR ~1,5) ; en dessous = pas de trade.",
    usage:"On ne prend QUE du A+/A. Le grade détermine aussi la conviction (et donc la taille dans la limite du 1 %). Filtre de qualité central : peu de trades, mais les bons.",
    biais:'sélection — ne garder que le haut du panier' });

  // ---------------------------------------------------------------------------
  // MOTEUR DE RECHERCHE + API
  // ---------------------------------------------------------------------------
  function norm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, ''); // enlève les accents
  }

  function haystack(item) {
    return norm([
      item.nom, (item.alias || []).join(' '), (item.tags || []).join(' '),
      item.def, item.usage, item.biais, item.cat
    ].join(' '));
  }

  // index de recherche pré-calculé
  C.forEach(function (it) { it._h = haystack(it); });

  function search(q, limit) {
    var nq = norm(q).trim();
    if (!nq) return [];
    var terms = nq.split(/\s+/).filter(Boolean);
    var scored = C.map(function (it) {
      var score = 0;
      var nomN = norm(it.nom);
      var aliasN = norm((it.alias || []).join(' '));
      terms.forEach(function (t) {
        if (nomN === t) score += 100;                 // nom exact
        if (nomN.indexOf(t) !== -1) score += 30;      // dans le nom
        if (aliasN.indexOf(t) !== -1) score += 20;    // dans un alias
        if ((it.tags || []).some(function (tg) { return norm(tg).indexOf(t) !== -1; })) score += 10;
        if (it._h.indexOf(t) !== -1) score += 3;      // n'importe où
      });
      // bonus si TOUS les termes matchent
      var all = terms.every(function (t) { return it._h.indexOf(t) !== -1; });
      if (all) score += 15;
      return { it: it, score: score };
    }).filter(function (r) { return r.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    var out = scored.map(function (r) { return r.it; });
    return typeof limit === 'number' ? out.slice(0, limit) : out;
  }

  function byId(id) {
    for (var i = 0; i < C.length; i++) if (C[i].id === id) return C[i];
    return null;
  }
  function byCat(cat) {
    return C.filter(function (it) { return it.cat === cat; });
  }

  // Bloc texte compact pour injecter dans le prompt de l'IA (RAG léger).
  // q peut être une chaîne (recherche) ou un tableau de mots-clés.
  function contextFor(q, n) {
    n = n || 12;
    var query = Array.isArray(q) ? q.join(' ') : (q || '');
    var hits = query ? search(query, n) : C.slice(0, n);
    if (!hits.length) hits = C.slice(0, n);
    var lines = hits.map(function (it) {
      var catNom = (CATEGORIES.filter(function (c) { return c.id === it.cat; })[0] || {}).nom || it.cat;
      return '• ' + it.nom + ' [' + catNom + '] — ' + it.def +
        ' | Usage : ' + it.usage +
        ' | Signal : ' + it.biais;
    });
    return "BASE DE CONNAISSANCES (extraits pertinents) :\n" + lines.join('\n');
  }

  function stats() {
    var parCat = {};
    CATEGORIES.forEach(function (c) { parCat[c.id] = 0; });
    C.forEach(function (it) { parCat[it.cat] = (parCat[it.cat] || 0) + 1; });
    return { total: C.length, parCategorie: parCat };
  }

  // Digest COMPLET et compact de TOUTE la base, groupé par catégorie.
  // Sert à donner à l'IA l'intégralité du vocabulaire du site en un bloc
  // dense (nom : définition + signal), sans exploser le nombre de tokens.
  // Catégories « actionnables » : pour celles-ci on donne aussi le USAGE
  // (comment s'en servir), car c'est ce qui transforme la connaissance en
  // trade concret. Cœur de la méthode = ICT / SMC / structure / risque.
  var ACTIONABLE = { ict: 1, smc: 1, structure: 1, risque: 1 };

  function digest() {
    var out = "BASE DE CONNAISSANCES COMPLÈTE DU SITE (" + C.length +
      " concepts). Utilise ce vocabulaire et ces définitions comme référence " +
      "pour toute ton analyse — c'est la méthode maison du site. Pour les concepts " +
      "ICT/SMC, structure et risque, le champ « Usage » indique COMMENT t'en servir " +
      "pour construire un trade : appuie-toi dessus.\n";
    CATEGORIES.forEach(function (cat) {
      var items = byCat(cat.id);
      if (!items.length) return;
      out += "\n## " + cat.emoji + " " + cat.nom + "\n";
      items.forEach(function (it) {
        out += "- " + it.nom + " : " + it.def;
        if (ACTIONABLE[it.cat] && it.usage) out += " — Usage : " + it.usage;
        out += " (Signal : " + it.biais + ")\n";
      });
    });
    out += PLAYBOOK + SCORECARD + ANTIPATTERNS + DATAREAD + EXAMPLE;
    return out;
  }

  // Méthode d'exécution pas-à-pas : relie les concepts ci-dessus en un
  // vrai trade ICT/SMC. C'est la checklist directrice du bot.
  var PLAYBOOK =
    "\n## ♟️ PLAYBOOK ICT/SMC — comment assembler un trade (méthode maison, à suivre)\n" +
    "Construis CHAQUE idée de trade selon cette séquence, dans l'ordre :\n" +
    "1) BIAIS HTF (D1) : tendance (HH/HL ou LH/LL), position dans le dealing range (premium/discount), " +
    "FVG D1 ouverts, liquidité déjà prise ou non. Le biais D1 dicte le SENS autorisé.\n" +
    "2) DOL (cible) : identifie la liquidité que le prix veut atteindre (equal highs/lows, PDH/PDL, PWH/PWL, " +
    "FVG à combler, extrême de range). Pas de DOL clair = pas de trade.\n" +
    "3) AFFINAGE H4 : repère le POI de qualité sur le chemin vers le DOL (order block VALIDE — displacement + " +
    "cassure + FVG — breaker, ou FVG de continuation), situé du bon côté de l'équilibre (discount pour un long, " +
    "premium pour un short).\n" +
    "4) DÉCLENCHEUR H1 : attends la séquence — balayage de liquidité (sweep/inducement pris) PUIS displacement qui " +
    "casse la structure interne (MSS/CHoCH) et laisse un FVG. Sans displacement, la cassure est suspecte : on n'entre pas.\n" +
    "5) ENTRÉE : sur le retour dans le POI/FVG (idéalement au CE = 50 % du gap), après le sweep. Raffine l'OB si besoin " +
    "pour un stop plus serré.\n" +
    "6) STOP : juste au-delà de la mèche du balayage ou de l'extrême de l'OB (le point d'INVALIDATION), jamais arbitraire.\n" +
    "7) OBJECTIF : la liquidité opposée / le DOL (séquence IRL↔ERL). Vise le RR le plus élevé atteignable (2, 3, 4+). " +
    "Si le stop logique ne laisse pas ≥ 1 RR jusqu'au DOL, NE PRENDS PAS le trade.\n" +
    "8) CONFLUENCE : renforce si killzone (Londres/NY), SMT divergence, alignement DXY (inversé pour crypto/or), " +
    "premium/discount correct, et accord de l'IA maison / du Quant. Plus de confluence = plus de confiance.\n" +
    "RÈGLE D'OR : mieux vaut 0 trade qu'un trade sans sweep, sans displacement, sans DOL clair, ou sous 1 RR.\n";

  // Barème de notation : force le bot à évaluer chaque idée de façon homogène.
  var SCORECARD =
    "\n## 🎯 BARÈME DE CONFLUENCE (note chaque idée sur 100, remplis le champ \"confiance\")\n" +
    "Additionne les points présents, puis n'envoie que les idées ≥ 60 :\n" +
    "+25 Biais HTF (D1) aligné avec le sens du trade\n" +
    "+20 Balayage de liquidité (sweep/inducement) réalisé juste avant l'entrée\n" +
    "+20 Displacement qui casse la structure (MSS/CHoCH) et laisse un FVG\n" +
    "+15 Entrée sur un POI de qualité (OB valide / FVG / breaker) du bon côté de l'équilibre (discount long / premium short)\n" +
    "+10 DOL clair (equal highs-lows, PDH/PDL, FVG opposé) laissant un RR ≥ 2\n" +
    "+10 Confluence supplémentaire (killzone, SMT, DXY aligné, accord IA maison/Quant, niveau psychologique)\n" +
    "Interprétation : ≥ 85 = A+ (pleine conviction) · 70-84 = A · 60-69 = B (prudent) · < 60 = NE PAS ENVOYER.\n" +
    "Reporte cette note (0-100) dans \"confiance\". Ne gonfle jamais la note pour justifier un trade.\n";

  // Anti-patterns : raisons EXPLICITES de refuser/ne pas envoyer un trade.
  var ANTIPATTERNS =
    "\n## 🚫 ANTI-PATTERNS — refuse le trade si l'un de ces points est vrai\n" +
    "- Pas de balayage de liquidité avant l'entrée (tu entres sur du vide).\n" +
    "- Pas de displacement / cassure de structure : la « cassure » n'est qu'une mèche non clôturée.\n" +
    "- Trade CONTRE le biais D1 sans MSS de retournement confirmé à un extrême HTF.\n" +
    "- Achat en premium / vente en discount (mauvais côté de l'équilibre) : RR pourri.\n" +
    "- Pas de DOL clair : aucune cible logique = pas de trade.\n" +
    "- Le stop logique (au-delà du sweep/OB) ne laisse pas au moins 1 RR jusqu'au DOL.\n" +
    "- Entrée tardive : l'actif a déjà parcouru l'essentiel de son ADR ou le mouvement est déjà étendu (FOMO).\n" +
    "- Zone déjà mitigée (POI non frais, déjà retesté et vidé de sa réaction).\n" +
    "- Fenêtre de news imminente (FOMC/CPI/NFP) : le technique n'est pas fiable.\n" +
    "- Signaux qui se contredisent sans confluence nette : mieux vaut s'abstenir.\n" +
    "Dans le doute, renvoie une liste vide. La discipline prime sur l'activité.\n";

  // Guide de lecture des données réelles fournies dans le message.
  var DATAREAD =
    "\n## 📥 COMMENT LIRE LES DONNÉES FOURNIES\n" +
    "- DONNÉES MULTI-UNITÉS (D1→H4→H1) : sers-t'en pour l'alignement top-down. D1 = biais, H4 = zone/POI, H1 = déclencheur/entrée. N'entre que si les trois racontent la même histoire.\n" +
    "- RÉSUMÉ par paire : prix, sens calculé, cycle (phase AMD), confluence %, et niveaux entrée/stop/objectif proposés par le site. Traite-les comme une base à VALIDER avec la méthode, pas comme une vérité.\n" +
    "- AVIS DES AUTRES MOTEURS (IA maison ML + Quant) : confluence. Accord = renforce ta confiance ; désaccord net = sois prudent ou explique ta divergence. Ne suis jamais aveuglément.\n" +
    "- DXY / forex dans le résumé : le DXY est INVERSÉ pour crypto/or (DXY baissier = favorable au risque).\n";

  // Exemple type (schématique, chiffres illustratifs) pour ancrer le raisonnement.
  var EXAMPLE =
    "\n## 🧩 EXEMPLE TYPE (schéma de raisonnement, chiffres illustratifs)\n" +
    "Contexte : D1 haussier (HH/HL), prix en discount du dealing range, un FVG D1 haussier ouvert plus bas ; " +
    "au-dessus, des equal highs = DOL (liquidité côté achat).\n" +
    "Séquence : en H1 dans la killzone NY, le prix balaye un plus-bas mineur (sweep de la sell-side) → " +
    "displacement haussier qui casse la microstructure (MSS) et laisse un FVG H1. On attend le retour au CE (50 %) de ce FVG, " +
    "qui coïncide avec un OB haussier valide en discount.\n" +
    "Trade : entrée au CE du FVG ; stop quelques points sous la mèche du sweep (invalidation) ; objectif sur les equal highs (DOL). " +
    "Si distance stop = 1 % du capital et distance objectif = 3 %, RR = 3 → setup A+. Confluence : killzone + discount + biais D1 + " +
    "sweep + displacement. Note ≈ 90/100.\n" +
    "Contre-exemple à REFUSER : le prix touche le FVG SANS avoir balayé de liquidité et SANS displacement, en premium, " +
    "objectif flou → aucune confluence, note < 60 → on n'envoie pas.\n";

  root.KB = {
    CATEGORIES: CATEGORIES,
    all: C,
    byId: byId,
    byCat: byCat,
    search: search,
    contextFor: contextFor,
    digest: digest,
    stats: stats
  };
})(typeof window !== 'undefined' ? window : this);
