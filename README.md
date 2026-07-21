# ICT / SMC — Signaux de trading en direct

Un site **statique** (aucun serveur, aucune clé API) qui affiche en **temps réel** des
setups de trading crypto fondés sur les concepts **ICT / SMC** :

- **Fibonacci — Premium / Discount** : on trace le dealing range (dernier swing haut ↔ bas),
  l’*equilibrium* est à 0.5. En dessous = **discount** (on cherche des achats),
  au-dessus = **premium** (on cherche des ventes). La zone **OTE** (0.62–0.79) est mise en avant.
- **PD Arrays** : détection des **Fair Value Gaps** (imbalances). Un PD Array situé dans la zone
  discount/premium devient une zone d’intérêt.
- **CRT (Candle Range Theory)** : prise de liquidité (*sweep* d’un plus-bas/plus-haut) suivie
  d’un retour dans le range → déclencheur de retournement.
- **Clôture sur le PD Array** : une bougie qui **clôture au-dessus** (achat) ou **en-dessous**
  (vente) du PD Array valide le *reclaim*.

Un signal n’est émis que si la confluence est complète :

> **PD Array en zone discount/premium** **+** (**CRT** *ou* **clôture au-dessus/en-dessous du PD Array**),
> avec un **R:R ≥ 1.2**.

Chaque carte de signal indique : direction (Achat/Vente), zone, position Fibonacci, niveau de
confiance, **entrée / stop / TP1-TP2-TP3**, ratio **Risk:Reward** et la liste des confluences.

## Données

Les bougies proviennent de l’**API publique Binance** (`/api/v3/klines`), gratuite, sans clé,
compatible navigateur. Plusieurs hôtes de secours sont essayés automatiquement. Rafraîchissement
toutes les 45 secondes ; unités de temps disponibles : 5m, 15m, 1h, 4h. La watchlist est
personnalisable et mémorisée localement.

## Utilisation

Comme c’est un site statique, il suffit de le servir :

```bash
# depuis la racine du projet
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

### Déploiement (GitHub Pages)

1. *Settings → Pages*
2. *Source* : la branche du projet, dossier `/root`
3. Le site est en ligne à l’URL fournie par GitHub.

Aucune étape de build : HTML/CSS/JS pur.

## Structure

```
index.html        Tableau de bord
css/styles.css    Thème sombre épuré
js/api.js         Récupération des bougies Binance (avec timeout + hôtes de secours)
js/ict.js         Moteur d’analyse ICT/SMC (testable sous Node)
js/app.js         Orchestration & rendu
```

Le moteur (`js/ict.js`) est isolé et exporté pour Node, ce qui permet de le tester :

```bash
node -e "const ICT=require('./js/ict.js'); console.log(typeof ICT.analyze)"
```

## Réglages

Les paramètres de la stratégie sont regroupés dans `CONFIG` en haut de `js/ict.js`
(profondeur des swings, bornes OTE, marge de stop, R:R minimal, etc.).

---

⚠️ **Avertissement** — Outil **éducatif**. Ceci n’est **pas** un conseil financier ni une
incitation à investir. Les marchés comportent un risque de perte. Faites toujours votre propre
analyse et gérez votre risque.
