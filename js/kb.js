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
    { id: 'produits', nom: 'Produits & marchés',          emoji: '💱' }
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

  root.KB = {
    CATEGORIES: CATEGORIES,
    all: C,
    byId: byId,
    byCat: byCat,
    search: search,
    contextFor: contextFor,
    stats: stats
  };
})(typeof window !== 'undefined' ? window : this);
