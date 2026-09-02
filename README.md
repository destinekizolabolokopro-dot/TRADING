# TRADEassist — assistant de trading ICT / SMC

Site autonome (un seul fichier HTML) qui lit le marché en **top-down** (D1 → H4 → H1)
selon les concepts **ICT / SMC** et propose des trades **prêts à l'emploi** : sens,
entrée, stop, objectif, ratio (RR) et gain estimé sur un compte de 10 000 € (risque 1 %).

## Ce qui est branché en direct

| Marché | Source | État |
|---|---|---|
| **BTC / ETH / SOL / XRP / BNB** | Binance (bougies D1 + H4) | ✅ **vrais trades** (entrée / SL / TP / RR) |
| **EUR/USD** | Binance `EUR/USDT` | ✅ **vrais trades** |
| **XAU/USD (Or)** | Binance `PAXG/USDT` (or tokenisé) | ✅ **vrais trades** |
| **DXY (indice dollar)** | BCE / Frankfurter (formule ICE) | 🧭 **boussole** : pilote le biais de tous les actifs cotés en USD |

- **Sans clé** pour les données de marché : Binance et Frankfurter sont gratuits et
  ouverts au navigateur (CORS). `USDT ≈ USD` (la structure et les zones sont fidèles ;
  seul le prix absolu peut varier de ~0,1 % vs le spot).
- **Garde-fou anti-données périmées** : une paire figée (dernière bougie > 3 jours) est
  automatiquement ignorée — jamais de prix vieux affiché comme s'il était live.
- Le yen (USD/JPY, EUR/JPY) n'est pas proposé : pas de source intraday gratuite fiable.

## Les trois moteurs

1. **Bot règles** (intégré, sans clé) : applique strictement l'ICT/SMC — biais D1,
   zone premium/discount, POI aligné (FVG puis Order Block), stop logique, cible sur la
   liquidité, **RR entre 1 et 6**. Il reste à l'écart quand la confluence n'est pas nette.
2. **Bot IA (Claude)** *(optionnel)* : un 2ᵉ bot propulsé par l'API Anthropic. Il raisonne
   sur H1/H4/D1, principalement en ICT/SMC, et envoie ses meilleures idées ≥ 1 RR.
   Nécessite **ta** clé API Anthropic (console.anthropic.com), stockée **en local** dans
   ton navigateur — elle ne quitte jamais ton ordinateur.
3. **IA maison** (onglet dédié, sans clé) : un **vrai modèle de machine learning** (régression
   logistique) qui **tourne dans la page**, pas une IA externe. Point clé : au lieu de deviner
   « le prix va-t-il monter ? » (du **pile ou face**, ~50 %), elle apprend une question
   **réellement exploitable** — **quels actifs vont surperformer le panier** (momentum relatif
   / cross-sectionnel, une anomalie quant robuste). Ses features mêlent **11 concepts absolus**
   (structure, FVG, RSI, régime…) et **7 features relatives** (rang / écart de l'actif *vs le
   panier* à l'instant T) — alignées sur la cible relative. Elle **s'entraîne automatiquement à
   chaque ouverture** (apprentissage continu) sur **28 actifs** et **20 000+ exemples**, **note ses
   prédictions passées** (elle apprend de ses erreurs) et affiche sa **précision walk-forward**
   mesurée **strictement par actif (zéro fuite temporelle)**. Résultat honnête : **~64 % quand
   elle s'engage** (précision globale ~61 %) pour repérer les plus forts, nettement au-dessus
   d'un choix naïf. Les signaux sont présentés en **boussole de rotation** (les plus forts / les
   plus faibles du panier). Le site affiche le vrai chiffre, sans le gonfler. Les probabilités
   sont **calibrées (Platt)** et le site affiche l'**erreur de calibration (ECE ~4 %)** : quand
   l'IA dit « 63 % », c'est fiable à quelques points près — vérifiable, pas décoratif. Sa mémoire
   est **sauvegardée automatiquement** (IndexedDB) et **exportable/importable** (`ia-cerveau.json`).
   Une **boussole de rotation** pédagogique — pas une machine à gagner, pas un conseil financier.

## Onglet « Quant / Institutionnel »

Reproduit le fonctionnement réel des grands fonds (Renaissance, Two Sigma, Citadel…) :
un **panier market-neutral long/short**. On note chaque actif sur des **facteurs** (momentum
90 j, tendance vs EMA200, faible volatilité), on **combine** en un score composite (ensemble),
on classe les 28 actifs, puis on va **long le top 20 %** et **short le bottom 20 %**. On gagne
sur l'**écart** entre les deux jambes → peu importe que le marché monte ou baisse. La métrique
visée est le **Sharpe** (rendement ÷ risque), pas le win rate. Backtest walk-forward affiché
(Sharpe, win rate, rendement annualisé, drawdown). ⚠️ Échantillon court, **sans frais ni coût
de vente à découvert**, marché haussier → **indicatif**. Le facteur « reversal court terme »,
mesuré négatif, a été exclu. Market-neutral **≠ sans risque**.

## Onglet « Stratégies Pro »

Les méthodes **systématiques** réellement utilisées par les fonds (suivi de tendance CTA,
cassure Donchian/Turtle, retour à la moyenne, momentum, règle des 200 jours de PTJ,
risk-parity de Dalio…), calculées sur les vraies bougies journalières et **backtestées** sur
l'historique dispo (échantillon court, sans frais → indicatif). Une synthèse multi-méthodes
donne, par actif, le consensus et le régime de marché.

## Sélecteur « Mes outils »

Un bouton **⚙️ Mes outils** (en-tête) ouvre un panneau où tu **actives/désactives** chaque
module : les 4 onglets (ICT/SMC, IA maison, Quant, Stratégies Pro) et les boutons (Bot IA,
Historique). Garde seulement ce que tu utilises → tableau de bord épuré. Les réglages sont
**mémorisés en local** (localStorage), au moins un onglet reste toujours actif.

## Historique

Chaque trade proposé est enregistré (bot d'origine + motif), puis clôturé au TP (gagné)
ou au SL (perdu) selon le prix réel. Le taux de réussite affiché sur les cartes devient
**réel** dès qu'il y a assez de trades clôturés (avant, c'est une estimation marquée « est. »).

## Utilisation

1. Télécharge **`TRADEassist.html`** (fichier autonome).
2. **Double-clique** dessus → il s'ouvre dans ton navigateur.
3. L'indicateur en haut à droite doit passer à **« Données en direct »**.
   (Dans un simple aperçu en ligne, les données réelles sont bloquées → « Mode démo ».)
4. Pour activer le Bot IA : bouton **Bot IA** → colle ta clé Anthropic → *Enregistrer*.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Le site (structure + CSS + logique d'affichage) |
| `js/live.js` | Données en direct + moteur ICT/SMC (calcul des trades) |
| `js/pro.js` | Stratégies systématiques des fonds + backtest (onglet Stratégies Pro) |
| `js/ia.js` | **IA maison** : modèle ML dans le navigateur + entraînement auto + mémoire (onglet IA maison) |
| `js/ai.js` | Appel de l'API Claude (Bot IA) |
| `js/history.js` | Journal des trades (bot d'origine, motif, bilan réel) |
| `TRADEassist.html` | **Version autonome** (tout inliné) générée par `scripts/build_single.js` |

> ⚠️ Outil **pédagogique** — pas un conseil financier. Les bots produisent des
> signaux/analyses sur données réelles ; ils **n'exécutent aucun ordre** chez un courtier.
> Risque max recommandé : 1 % du compte par trade.
