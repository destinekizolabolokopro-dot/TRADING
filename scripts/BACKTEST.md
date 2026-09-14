# Backtester le modèle pour de vrai

Le script `backtest_mech.js` applique les règles bougie par bougie, sans jamais
regarder le futur. Il sait lire **deux sources de données**.

## 1. Yahoo Finance — gratuit, mais court

```bash
node scripts/backtest_mech.js --tf 5m --range 60d
```

Plafonds imposés par Yahoo, et ils sont durs :

| Unité | Historique maximum |
|---|---|
| M1 | **8 jours** |
| M5 · M15 · M30 | **60 jours** |
| H1 | 730 jours |

Sur 60 jours de M5, le modèle produit ~27 trades. **C'est beaucoup trop peu.**
L'intervalle de confiance affiché par le script le dit lui-même : il contient
zéro, donc on ne peut rien conclure.

## 2. Un fichier CSV — la vraie solution

```bash
node scripts/backtest_mech.js --csv NQ_1min.csv --csvcorr ES_1min.csv \
  --inv ifvg --ordre limite --sl zone --zentree mid \
  --disp 0.3 --smt elim --partiel 30 --jours 10
```

Le lecteur accepte n'importe quel export OHLC :

- colonnes `date`/`time`/`timestamp`/`datetime`, `open`, `high`, `low`, `close`
  (l'ordre n'importe pas, `volume` est ignoré) ;
- avec ou sans ligne d'en-tête ;
- séparateur `,` ou `;` ;
- dates en ISO (`2024-03-15 14:30:00`), en secondes ou en millisecondes epoch.
  Une date sans fuseau est lue comme de l'**UTC**.

`--csvcorr` fournit l'actif corrélé (ES) pour la SMT. Sans lui, la SMT est
désactivée.

**Vérifié** : sur les mêmes 60 jours, la voie CSV et la voie Yahoo donnent des
résultats identiques au centième près.

## Où trouver les données

| Source | Ce qu'on y trouve | Coût |
|---|---|---|
| [FirstRate Data](https://firstratedata.com/i/futures/NQ) | 15+ ans de NQ en 1 min, contrat continu déjà raccordé | achat unique |
| [Databento](https://databento.com/catalog/cme/GLBX.MDP3/futures/NQ) | NQ tick et minute, API | crédits offerts au départ |
| [Kaggle](https://www.kaggle.com/datasets/tgtanalytics/nq-futures-1min-bar-2022-2025) | NQ 1 min 2022-2025 | gratuit, qualité à vérifier |

Il faut **le même intervalle et la même période** pour le NQ et l'ES, sinon la
SMT compare n'importe quoi. Le script aligne par horodatage et signale les
bougies manquantes.

## Combien de trades avant de croire un résultat

Le script calcule lui-même le nombre nécessaire :

```
trades            : 13
espérance         : +0,280 R
écart-type        : 1,26 R
IC 95 %           : [-0,403 , +0,962]
trades nécessaires: 78
```

Tant que zéro est dans l'intervalle, **le résultat ne veut rien dire**. Viser
au minimum **100 trades**, sur au moins deux années différentes.

## Valider sans se mentir

```bash
# on décide sur la première moitié
node scripts/backtest_mech.js --csv NQ.csv --csvcorr ES.csv --moitie 1 ...

# on vérifie sur la seconde, SANS RIEN RETOUCHER
node scripts/backtest_mech.js --csv NQ.csv --csvcorr ES.csv --moitie 2 ...
```

Si l'espérance change de signe entre les deux, les réglages collent au passé.
C'est arrivé sur plusieurs paramètres pendant la mise au point — c'est le
signal qu'il n'y a pas d'avantage stable, et il ne faut pas le contourner.

## Ce qu'un backtest ne fera jamais

- Il ne prouve pas qu'une stratégie gagne. Il peut seulement montrer qu'elle perd.
- Il suppose que ton ordre limite est rempli dès que le prix touche le niveau.
  En réel, non — et les trades ratés sont souvent les meilleurs.
- Dans une bougie, il ne sait pas si le stop ou l'objectif est venu en premier.
  Convention retenue : compté **perdant**, et ces cas sont affichés à part.
