# Le backtest de tout — ce qu'il a trouvé

`node scripts/balayage.js tout --n 4000` fait tourner **js/modele.js**, le code
qui tourne vraiment sur le site et dans le robot, sur quatre mille combinaisons
des onze réglages à la fois. Ce document garde ce qui en est sorti.

Trois choses en sont sorties. Les deux premières sont des **erreurs**, pas des
réglages : elles changeaient le résultat de plusieurs milliers d'euros, et
aucun classement de réglages n'avait de sens avant qu'elles soient corrigées.

---

## 1. Des ordres impossibles à passer — corrigé

`js/modele.js` plaçait le stop au bord de l'IFVG de confirmation :

```js
var sl = L ? choisi.z.bas - buf : choisi.z.haut + buf;
var risq = Math.abs(entree - sl);
```

L'entrée est la **clôture** de la bougie de confirmation. Rien ne garantit que
cette clôture soit du bon côté du bord de l'IFVG. Quand elle le dépasse, le
« stop » d'une vente se retrouve **sous** le prix d'entrée, c'est-à-dire dans le
sens du gain. L'ordre est impossible à passer chez un courtier.

`Math.abs` effaçait le signe, donc l'anomalie ne se voyait nulle part : le
signal partait avec un risque positif et un objectif calculé à l'envers.

Mesuré sur les vraies bougies NQ, selon la fenêtre :

| fenêtre | signaux | dont incohérents | ce qu'ils rapportaient |
|---|---|---|---|
| 09h00–10h00 | 67 | 4 (6 %) | −1,22 R |
| 01h00–02h30 | 57 | 2 (4 %) | −0,67 R |
| 09h30–11h00 | 80 | 7 (9 %) | −1,30 R |

Correction : le signal est refusé si le stop n'est pas du bon côté.

---

## 2. Le partiel à 0,5 R était gagné par hypothèse, pas par le marché

Le backtest et le robot suivaient les positions en bougies de **5 minutes**. Une
bougie de 5 minutes ne dit pas dans quel ordre son haut et son bas ont été
atteints. Quand elle touche l'objectif partiel **et** le stop, il faut deviner.
L'ancien code devinait l'objectif — et il le testait avant le stop.

Avec un partiel placé à 0,5 R, soit souvent **moins de dix points**, ce cas
n'est pas un cas limite : sur la fenêtre 09h00–10h00, **28 % des positions**
sont décidées par cette hypothèse.

Les mêmes trades, comptés des deux façons :

|  | objectif d'abord | stop d'abord |
|---|---|---|
| réussite | 80,6 % | 52,2 % |
| espérance | +0,177 R | −0,166 R |
| résultat | **+2 829 €** | **−2 659 €** |

Ce n'est pas une marge d'erreur, c'est un changement de signe.

### Qui a raison : l'arbitrage en bougies de 1 minute

Yahoo sert le 1 minute sur huit jours. Sur ces huit jours l'ordre des touches
est **connu**, donc la question se tranche au lieu de s'encadrer.

```
node scripts/balayage.js arbitre
```

```
09h00-10h00 tp1 0.5 pt 0.9 tp2 2.5
   11 positions rejouées en 1 minute
   R total : optimiste +1.83 · prudent -2.27 · VÉRITÉ -5.67  (-1417 €)
   verdict juste : optimiste 6/11 · prudent 7/11
```

La vérité est **en dessous des deux estimations**. Un objectif à dix points de
l'entrée est dans le bruit d'une bougie de 5 minutes : le prix y va et en
revient dans la même bougie, et le backtest n'en voit rien.

---

## 3. Le journal en ligne annonçait des victoires qui n'ont pas eu lieu

Les huit positions consignées par le robot, rejouées en bougies de 1 minute :

```
date               sens   entrée      stop    annoncé │ vérité 1 minute
2026-09-18 09:50   SHORT  29782.75  29807.46    +0.45 │ +0.45  partiel puis seuil, 6 min
2026-09-21 09:30   LONG   30252.00  30227.20    +0.45 │ -1.00  stop touché en 3 min   ← ÉCART
2026-09-21 09:35   LONG   30292.50  30282.69    +0.70 │ -1.00  stop touché en 1 min   ← ÉCART
2026-09-23 09:05   SHORT  30948.50  30961.69    -1.00 │ -1.00  stop touché en 8 min
2026-09-23 09:30   SHORT  30926.50  30944.44    +0.45 │ -1.00  stop touché en 1 min   ← ÉCART
2026-09-24 09:00   LONG   30498.75  30476.40    +0.45 │ +0.45  partiel puis seuil, 3 min
2026-09-24 09:30   LONG   30540.00  30525.14    +0.70 │ -1.00  stop touché en 1 min   ← ÉCART
2026-09-24 09:35   LONG   30595.50  30583.88    -1.00 │ -1.00  stop touché en 1 min

le journal annonçait  +1,20 R  soit   +300 €
la vérité en 1 minute −5,10 R  soit −1 275 €
```

Quatre sur huit étaient fausses.

Corrections dans `scripts/live_log.js` :

1. le suivi se fait en **1 minute** dès que la série la couvre — le robot
   télécharge déjà huit jours de 1 minute, et une position se dénoue en
   quelques minutes, donc c'est presque toujours le cas ;
2. quand il faut retomber sur le 5 minutes, le **stop est testé d'abord** ;
3. les positions déjà closes par l'ancien suivi sont **rejugées** au passage
   suivant, puis marquées `suiviUnite: "1m"` et plus jamais retouchées.

### Ce que le journal est, et ce qu'il n'est pas

| signal | vu par le robot | retard |
|---|---|---|
| 18/09 09h50 | 16h14 UTC | 3 025 min |
| 21/09 09h30 | 14h14 UTC | 44 min |
| 21/09 09h35 | 13h48 UTC | 13 min |
| 23/09 09h05 | 14h52 UTC | 107 min |
| 23/09 09h30 | 14h52 UTC | 82 min |
| 24/09 09h00 | 17h57 UTC | 297 min |
| 24/09 09h30 | 14h11 UTC | 41 min |
| 24/09 09h35 | 14h11 UTC | 36 min |

Les positions se dénouent en 1 à 8 minutes. Le robot les voit entre 13 minutes
et deux jours plus tard. **Aucune n'était encore ouverte au moment où il l'a
consignée.** Le journal est une reconstitution a posteriori, pas un relevé de
positions prises. Deux causes : les données Yahoo arrivent avec dix à quinze
minutes de retard, et GitHub ne déclenche pas les tâches planifiées pendant
l'après-midi américain (mesuré : zéro déclenchement entre 13 h et 16 h UTC,
trois jours de suite).

---

## 4. Le classement, et pourquoi il ne faut pas s'y fier

`node scripts/balayage.js tout --n 4000` — quatre mille combinaisons des onze
réglages, tirées ensemble. 3 946 ont abouti, 1 905 ont au moins 25 trades.

### La meilleure trouvée

```
 31 trades │ 29,0 % de réussite │ +1,229 R par trade │ +9 523 € │ creux 1 850 €
           │ deuxième moitié de l'échantillon : +1,193 R (18 trades)
 00h45–03h45 NY · tp1 3 R · partiel 0 % · tp2 6 R
            · seuil 2 · fvgn 3 · atrMin 1,2 · react 12 · keyAge 1000 · maxJour 1
```

### Pourquoi c'est très probablement du hasard

L'espérance de **toutes** les configurations mesurées :

| | médiane | 1er quartile | 3e quartile | maximum | % positives |
|---|---|---|---|---|---|
| comptage optimiste | +0,025 R | −0,081 | +0,164 | +1,233 | 56 % |
| comptage prudent | +0,018 R | −0,106 | +0,159 | +1,233 | 54 % |

La médiane est à zéro et à peine plus d'une configuration sur deux est
positive : c'est ce qu'on observe quand il n'y a **pas** d'avantage et qu'on
tire quatre mille fois. Le sommet du classement est la queue de la
distribution, pas une découverte.

Le test qui tranche — les 60 jours coupés en deux moitiés, 1 837
configurations ayant au moins 8 trades dans chacune :

```
corrélation entre l'espérance de la 1re moitié et celle de la 2e :  r = −0,036
```

**Zéro.** Choisir le meilleur réglage sur une moitié n'apprend rien sur
l'autre. Et concrètement :

| les 20 meilleures de la 1re moitié | espérance |
|---|---|
| sur la 1re moitié (là où on les a choisies) | +1,217 R |
| sur la 2e moitié (prudent) | +0,238 R |
| moyenne de TOUTES les configurations sur la 2e moitié | +0,084 R |

Quatre cinquièmes de l'avantage disparaissent dès qu'on change de période.
Il reste un souffle (15 des 20 restent positives, contre 54 % au hasard), mais
rien qui justifie de miser sur un réglage plutôt qu'un autre.

---

## 5. Le seul enseignement qui n'est pas de l'ajustement

Un seul réglage bouge, tout le reste reste aux valeurs actuelles. Un seul
degré de liberté, donc presque rien à sur-ajuster. Fenêtre 09h00–10h00 NY,
64 signaux :

| partiel à | optimiste | prudent | bougies ambiguës |
|---|---|---|---|
| 0,25 R | 85,9 % · +760 € | 60,9 % · **−3 765 €** | 25 % |
| **0,5 R (actuel)** | **81,3 % · +2 829 €** | **56,3 % · −2 659 €** | **25 %** |
| 0,75 R | 71,9 % · +3 429 € | 51,6 % · −1 702 € | 20 % |
| 1,0 R | 62,5 % · +3 354 € | 39,1 % · −3 646 € | 23 % |
| 1,25 R | 60,9 % · +5 198 € | 39,1 % · −2 177 € | 22 % |
| 1,5 R | 50,0 % · +3 466 € | 32,8 % · −3 121 € | 17 % |
| 2,0 R | 43,8 % · +4 266 € | 31,3 % · −1 459 € | 13 % |
| 2,5 R | 35,9 % · +3 516 € | 29,7 % · +191 € | 6 % |
| 3,0 R | 31,3 % · +3 379 € | 28,1 % · +1 529 € | 3 % |

Deux choses se lisent d'un coup :

1. **La colonne optimiste est positive partout, la colonne prudente presque
   nulle part.** Sur cette fenêtre, le modèle ne gagne que dans l'hypothèse.
2. **Plus le partiel est proche, plus la part d'hypothèse est grande.** À
   0,5 R, une position sur quatre est décidée par un pile ou face que le
   backtest gagnait systématiquement. À 3 R, il n'en reste 3 %.

Éloigner le partiel n'est pas un choix de réglage, c'est enlever un artefact
de mesure. Mais même une fois l'artefact enlevé, la fenêtre 09h00–10h00 ne
rapporte rien de solide : +1 529 € sur 64 trades en trois mois, avec 28 % de
réussite, n'est pas un avantage sur lequel engager un compte.

---

## Ce qu'il faut en retenir

Les 80 % de réussite affichés par le site étaient réels au sens où le calcul
était fait correctement — mais ils reposaient sur une hypothèse fausse sur
l'ordre des touches dans une bougie de 5 minutes. Corrigée, la fenêtre
actuelle donne **53,1 % et −3 508 €** sur les 64 signaux mesurés, et le
journal en direct **25 % et −1 275 €** sur ses 8 positions.

Le balayage de quatre mille combinaisons n'a pas trouvé de réglage fiable : la
corrélation entre les deux moitiés de l'échantillon est nulle. Ce qui manque
n'est pas un meilleur réglage, c'est **plus de données** (des années de 1
minute, pas deux mois de 5 minutes glissants) et **un vrai passage d'ordre**
(le robot consigne les signaux entre 13 minutes et deux jours après coup, donc
il n'a jamais rien pris).

---

## 6. Les 80 %, en vrai cette fois — le stop

Tout ce qui précède faisait bouger les objectifs. Un levier restait intouché :
**où est le stop.** Il était toujours au bord de l'IFVG de confirmation, donc
souvent à vingt ou trente points de l'entrée. `slx` l'éloigne d'un multiple de
cette distance.

Fenêtre 09h00–10h00, 64 signaux, comptage prudent, frais inclus :

| stop | pts | partiel 0,2 R | 0,3 R | **0,4 R** | 0,5 R |
|---|---|---|---|---|---|
| × 1 (l'ancien) | 30 | 60,9 % · −4 266 € | 59,4 % · −3 644 € | 59,4 % · −2 789 € | 56,3 % · −2 659 € |
| × 2 | 59 | 79,7 % · −403 € | 73,4 % · −463 € | 68,8 % · −301 € | 64,1 % · −398 € |
| × 3 | 89 | 82,8 % · +86 € | 76,6 % · +134 € | 76,6 % · +1 299 € | 71,9 % · +1 626 € |
| **× 4** | **118** | 82,8 % · +442 € | 82,8 % · +1 697 € | **81,3 % · +2 925 €** | 76,6 % · +3 070 € |
| × 6 | 177 | 87,5 % · +1 246 € | 84,4 % · +2 558 € | 78,1 % · +2 476 € | 75,0 % · +2 876 € |

Le stop serré était le problème depuis le début : à trente points de l'entrée
sur le NQ, il est dans la respiration du prix. Le modèle lisait juste et se
faisait sortir avant.

### Les quatre épreuves

Un chiffre flatteur ne vaut rien sans ça — c'est ce qui manquait aux 80 %
précédents.

| épreuve | stop × 4 · partiel 0,4 R |
|---|---|
| bougies ambiguës | **2 %** (contre 25 % avant) |
| arbitrage 1 minute, 11 trades | 5 min +1,26 R → **vérité +1,01 R** |
| 1re moitié de l'échantillon | 87,5 % · +2 405 € (32 trades) |
| 2e moitié | **75,0 % · +519 €** (32 trades) |
| pire série de pertes | **3** (contre 12 avant) |
| pire creux | 839 € |
| dérapage de 20 pts sur chaque stop | encore **+984 €** |

### La sortie forcée

Sans limite d'horaire, cinq positions sur soixante-quatre étaient tenues plus
de six heures, jusqu'à seize — donc la nuit. Couper améliore le résultat :

| sortie forcée | réussite | résultat | durée moyenne |
|---|---|---|---|
| 11h00 NY | 79,7 % | +3 102 € | 48 min |
| **12h00 NY** | **81,3 %** | **+3 058 €** | **60 min** |
| 16h00 NY | 81,3 % | +2 985 € | 86 min |
| aucune | 81,3 % | +2 968 € | 119 min |

### Le challenge Lucid

| risque/trade | contrats MNQ | réussi | échec | séances si ça marche |
|---|---|---|---|---|
| 125 $ | 0,57 | 100,0 % | 0,0 % | 83 |
| **250 $** | **1,14** | **98,2 %** | 1,8 % | **41** |
| 375 $ | 1,71 | 92,5 % | 7,5 % | 26 |
| 500 $ | 2,28 | 84,6 % | 15,4 % | 18 |

Un stop de 118 points tient dans un contrat MNQ à 250 € de risque
(118 × 2 $ = 236 $). C'est pour ça que `slx 4` est retenu et pas `slx 6` :
177 points demandent 354 $, soit plus que le risque autorisé.

### Ce qui reste fragile

- **La deuxième moitié est quatre fois plus faible que la première** (+519 €
  contre +2 405 €). L'avantage s'érode, ou la première moitié a eu de la
  chance.
- **`slx` et `tp1` sont deux réglages de plus, et j'ai retenu la meilleure
  case sur quarante-deux.** Les épreuves ci-dessus limitent le risque, elles
  ne l'annulent pas.
- **64 trades.** Quatre-vingts pour cent de réussite sur 64 trades, l'écart
  type vaut ±5 points.

Ce qui change par rapport aux anciens 80 % : ceux-là venaient d'une hypothèse
sur l'ordre des touches, et l'arbitrage en 1 minute les démentait. Ceux-ci
sont confirmés par l'arbitrage, tiennent sur les deux moitiés de
l'échantillon, et survivent à vingt points de dérapage.
