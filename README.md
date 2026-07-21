# TRADEassist — Signaux ICT / SMC en direct

Un site **statique** (aucun serveur) qui affiche en **temps réel** des setups de trading
fondés sur les concepts **ICT / SMC**, avec graphiques, calculateur de risque et alertes.

![TRADEassist](docs/preview.png)

## Fonctionnalités

- **Deux stratégies**
  - **Stratégie 1 — OTE + PD Array + CRT** : zone **OTE** (0.62–0.79) du Fibonacci +
    **PD Array** (Fair Value Gap ou Order Block) en zone **discount/premium** +
    **CRT obligatoire** (sweep de liquidité + retour).
  - **Stratégie 2 — Previous Daily CRT** : balayage du **plus-haut / plus-bas de la veille**
    (PDH / PDL) suivi d'un retour ; objectif sur la liquidité opposée.
- **Confiance proportionnelle** : plus il y a de confluences dans le même sens (OTE, tendance
  EMA 20/50, structure BOS/CHoCH, PD Array, clôture…), plus le pourcentage est élevé.
- Un signal n'est émis qu'avec **R:R ≥ 1.2**. On retient la meilleure des deux stratégies par paire.
- **Graphique chandeliers** intégré (façon TradingView, moteur Canvas maison, hors-ligne) :
  bougies, EMA, niveaux Fibonacci, zone OTE, boxes FVG / Order Blocks, liquidité,
  lignes Entrée / Stop / TP, croix de visée avec lecture OHLC.
- **Tableau de bord** : statistiques (setups, achat/vente, confiance moyenne, R:R moyen),
  filtres (direction, marché, tri), watchlist personnalisable.
- **Calculateur de risque** : capital + risque % → taille de position suggérée sur chaque signal.
- **Alertes** : son + notification navigateur + toast à chaque nouveau setup.
- **Thème clair / sombre**, réglages mémorisés localement.

## Marchés & données

- **Crypto** (BTC/USD, ETH/USD, SOL/USD) : API publique **Binance**, gratuite, sans clé.
- **Forex & Or** (GBP/USD, USD/JPY, EUR/JPY, XAU/USD, XAU/EUR) : **Twelve Data**,
  qui nécessite une **clé API gratuite** (https://twelvedata.com/register) à coller dans l'interface.

La crypto se rafraîchit ~ toutes les 40 s ; le forex/or ~ toutes les 4 min (quota gratuit).

## Utilisation

Site statique — il suffit de l'ouvrir :

```bash
# option 1 : ouvrir directement
#   double-clic sur index.html

# option 2 : petit serveur local
python3 -m http.server 8000   # puis http://localhost:8000
```

### Déploiement (GitHub Pages)

*Settings → Pages → Deploy from a branch → dossier `/root`.* Aucune étape de build.

## Structure

```
index.html        Interface
css/styles.css    Thème (clair + sombre)
js/api.js         Données multi-fournisseurs (Binance + Twelve Data)
js/ict.js         Moteur d'analyse ICT/SMC (+ métadonnées graphique) — testable sous Node
js/chart.js       Graphique chandeliers Canvas
js/app.js         Orchestration, UI, alertes, modale, calculateur
```

Les paramètres de stratégie sont regroupés dans `CONFIG` en tête de `js/ict.js`.

---

⚠️ **Avertissement** — Outil **éducatif**. Ceci n'est **pas** un conseil financier.
Le trading comporte un risque de perte. Fais toujours ta propre analyse et gère ton risque.
