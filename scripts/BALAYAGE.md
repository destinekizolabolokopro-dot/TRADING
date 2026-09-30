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

---

## 7. Le backtest complet du réglage appliqué

`node scripts/balayage.js rapport` — le banc d'essai lit les réglages dans
`js/modele.js`, il n'en garde plus de copie : il mesurait un partiel à 0,5 R
pendant que le robot en passait un à 0,4 R.

### NQ, le contrat sur lequel le réglage a été choisi

```
fenêtre 09 h 00 → 10 h 00 New York · stop × 4 · partiel 0,4 R sur 90 %
runner 2,5 R · solde au marché à 12 h 00 · 2 trades/jour max

64 trades · stop moyen 118 pts · durée moyenne 40 min
réussite      optimiste 82,8 %   prudent 81,3 %
espérance     optimiste +0,182 R   prudent +0,191 R
résultat      optimiste +2 910 €   prudent +3 058 €
seuil d'équilibre 65,8 % → marge +15,5 points
gain moyen +0,42 R · perte moyenne −0,81 R · profit factor 2,26
pire creux 839 € · bougies ambiguës 2 %
intervalle de confiance à 95 % : +0,066 … +0,316 R   (t = 2,99)
```

L'intervalle exclut zéro. Mais le réglage a été choisi sur ces mêmes 64 trades,
donc ce test est complaisant : il mesure l'ajustement autant que l'avantage.

| par mois | trades | réussite | espérance | résultat |
|---|---|---|---|---|
| juillet 2026 | 12 | 91,7 % | +0,410 R | +1 229 € |
| août 2026 | 27 | 85,2 % | +0,203 R | +1 369 € |
| **septembre 2026** | 25 | **72,0 %** | **+0,074 R** | **+461 €** |

**L'avantage décroît de mois en mois.** C'est le fait le plus dérangeant du
rapport, et il n'a aucune explication rassurante.

| par famille de niveau | trades | réussite | espérance |
|---|---|---|---|
| RB (rejection block) | 13 | 92,3 % | +0,349 R |
| CISD | 32 | 84,4 % | +0,232 R |
| FVG | 11 | 72,7 % | +0,031 R |
| ITH | 5 | 60,0 % | +0,003 R |
| ITL | 3 | 66,7 % | −0,023 R |

Presque tout le résultat vient du CISD et du rejection block — les deux familles
dont la définition est de moi, faute de source. C'est une faiblesse, pas une
force : ce sont les deux briques les moins fondées qui portent le résultat.

### Les quatre autres contrats — le seul vrai hors-échantillon

Ils n'ont servi à **rien** dans le choix du réglage. Avec l'ancien stop serré,
tous les quatre perdaient (ES −0,114 R, RTY −0,199 R, GC −0,071 R par signal).
Avec le stop élargi :

| contrat | trades | réussite | espérance | résultat |
|---|---|---|---|---|
| NQ | 64 | 81,3 % | +0,191 R | +3 058 € |
| ES | 52 | 71,2 % | +0,004 R | +57 € |
| YM | 61 | 75,4 % | +0,100 R | +1 530 € |
| RTY | 60 | 75,0 % | +0,032 R | +477 € |
| GC | 59 | 69,5 % | +0,018 R | +266 € |
| **TOUT** | **296** | **74,7 %** | **+0,073 R** | **+5 388 €** |

```
seuil d'équilibre 68,5 % → marge +6,1 points
intervalle de confiance à 95 % : +0,009 … +0,136 R   (t = 2,25)
→ l'intervalle EXCLUT zéro
```

Cinq contrats positifs, dont quatre qui n'ont pas servi au réglage : c'est la
meilleure preuve disponible que l'élargissement du stop n'est pas un
ajustement au passé.

**Mais le NQ rend +0,191 R et l'ensemble +0,073 R.** L'écart, presque trois
fois, EST le biais de sélection. **+0,073 R est l'estimation honnête**, pas
+0,191.

### Le challenge, avec le chiffre honnête

| risque/trade | réussi | échec | séances si ça marche |
|---|---|---|---|
| 125 $ | 96,4 % | 0,7 % | 198 |
| **250 $** | **88,2 %** | 11,8 % | **92** |
| 375 $ | 76,0 % | 24,0 % | 52 |
| 500 $ | 67,4 % | 32,6 % | 33 |

Sur le NQ seul, le même calcul donnait 98,2 % en 41 séances. Avec la
distribution non biaisée : **88,2 % en 92 séances**, soit quatre mois et demi.
C'est ça qu'il faut retenir, pas les 98 %.

### Les 24 heures rebalayées avec le stop élargi

| fenêtre NY | trades | réussite | résultat | creux | 2e moitié |
|---|---|---|---|---|---|
| **01h00–02h30** | 57 | **93,0 %** | **+4 150 €** | **255 €** | +0,278 R |
| 01h00–03h00 | 63 | 92,1 % | +4 334 € | 255 € | +0,280 R |
| 01h00–02h00 | 47 | 93,6 % | +3 552 € | 255 € | +0,303 R |
| 07h30–09h30 | 78 | 85,9 % | +4 172 € | 756 € | +0,159 R |
| **09h00–10h00 (appliquée)** | 64 | 81,3 % | +3 058 € | 839 € | +0,191 R |

01h00–02h30 New York (07h00–08h30 à Paris) est meilleure sur tous les critères
à la fois : réussite, résultat, creux, et tenue sur la seconde moitié. Elle
était **déjà** dans les trois premières du balayage fait AVANT le changement de
stop, avec des objectifs complètement différents — donc ce n'est pas un choix
frais sur le même échantillon, c'est une confirmation.

La fenêtre appliquée reste 09h00–10h00 : changer la fenêtre est une décision de
trading, pas une correction de bug.

---

## 8. Le plan source « 10AM OXXC » — ce qu'il confirme, contredit et manque

Plan de trading systématique NQ / ES publié par la source (kinttnq). Confronté
au modèle, il donne trois listes.

### Ce qu'il CONFIRME

| règle du plan | ce qu'on avait trouvé |
|---|---|
| « **SL : sous le dernier mouvement** » | le stop au bord de l'IFVG était le bug central ; l'élargir × 4 fait passer 56,3 % → 81,3 % |
| « max **2 entrées / jour** sur ce setup » | `maxJour: 2` |
| « 1 % max par trade en challenge, **0,5 %** funded » | calibrage à 0,5 % d'un compte de 50 000 € |
| « **12h00 NY** = deadline secondaire ferme » | une limite horaire existe — mais chez lui c'est une limite d'ENTRÉE, chez nous une sortie forcée. Ce n'est pas la même chose. |

**Le stop structurel pris au pied de la lettre ne marche pas** : en plaçant le
stop à l'extrémité de la jambe depuis la touche du niveau,

| stop | 09h00–10h00 | creux |
|---|---|---|
| « jambe » (lecture littérale) | 71,9 % · **+70 €** | 2 111 € |
| × 4 (le multiplicateur mesuré) | 81,3 % · **+3 058 €** | 839 € |

Donc « le dernier mouvement » de la source n'est PAS la jambe depuis la touche
du niveau clé. C'est autre chose, et le plan ne le définit pas. Le
multiplicateur reste une béquille en attendant.

### Ce qu'il CONTREDIT

**La fenêtre.** Le plan impose 10h → 11h NY (primaire), étendue à 12h00. Nous
sommes sur 09h → 10h.

| fenêtre NY | trades | réussite | espérance | résultat | 2e moitié |
|---|---|---|---|---|---|
| 09h00–10h00 (appliquée) | 64 | 81,3 % | +0,191 R | +3 058 € | 77,8 % / +1 157 € |
| 10h00–11h00 (plan, primaire) | 51 | 74,5 % | +0,094 R | +1 198 € | **79,4 % / +1 282 €** |
| 10h00–12h00 (plan, étendue) | 64 | 71,9 % | +0,060 R | +960 € | **79,5 % / +1 594 €** |
| 09h30–12h00 | 80 | 77,5 % | +0,135 R | +2 702 € | **80,4 % / +1 857 €** |
| 09h00–12h00 (l'union) | 84 | 81,0 % | +0,175 R | +3 683 € | 78,7 % / +1 458 € |

La fenêtre du plan est **moins bonne sur l'ensemble et meilleure sur la
deuxième moitié**. Sur 60 jours, ça ne tranche pas — mais c'est la seule des
deux qui vienne d'une source plutôt que d'un balayage.

### Ce qui MANQUE, par ordre d'importance

1. **Confirmation conjointe NQ + ES.** Le plan l'exige partout : narrative
   confirmée sur les deux, IFVG + CISD présents sur les deux. On ne regarde
   que le NQ. C'est le filtre le plus lourd et le plus facile à ajouter — les
   données ES sont déjà téléchargées.
2. **IFVG ET CISD ensemble.** On prend l'un OU l'autre comme niveau clé. Le
   plan les veut tous les deux, dans le sens du trade.
3. **Objectif au haut/bas de session, PD High/Low, ou extrémité d'un CRT
   H1/H4.** On vise un multiple de R fixe. C'est structurellement différent.
4. **Passage au seuil (BE) sur structure** : quand une nouvelle jambe se forme
   sous un OB suivi d'un déplacement, ou qu'un OB est suivi d'un FVG comblé.
   On passe au seuil au partiel, mécaniquement.
5. **Ré-entrées** : seuil atteint puis nouveau sweep → 1 % ; stop touché puis
   nouveau sweep → 0,5 %, une seule tentative. Plafond 1,5 % cumulé par idée.
6. **Sweep du low/high de séance ou de la bougie de 9h** précisément — on a un
   balayage ITL/ITH générique.
7. **Gestion des LR adverses près d'un open** (§ 8bis).
8. **PD Array = FVG M15/M30/H1/H4 uniquement.** Testé : retirer le M5 coûte
   0,018 R (81,3 % → 80,0 %). Marginal, donc non appliqué.
9. Bonus explicitement NON requis : 2e plus bas/haut, Sharp Turn, SMT ES/NQ.

Les options `slMode` et `unites` sont ajoutées à `js/modele.js` pour pouvoir
mesurer ces variantes. Les valeurs appliquées ne changent pas.

---

## 9. Les trois règles du plan, construites et mesurées

Elles viennent d'un document, pas d'un balayage. C'est toute la différence :
il n'y a pas de « meilleure case » à choisir, on applique ou on n'applique pas.

| règle appliquée | trades | réussite | espérance | résultat | creux | 2e moitié |
|---|---|---|---|---|---|---|
| aucune (l'état d'avant) | 64 | 81,3 % | +0,191 R | +3 058 € | 839 € | 77,8 % / +1 157 € |
| **+ confirmation ES (biais)** | **42** | **83,3 %** | **+0,194 R** | +2 036 € | **756 €** | **85,2 % / +1 424 €** |
| + confirmation ES stricte | 38 | 78,9 % | +0,154 R | +1 467 € | 915 € | 78,3 % / +791 € |
| + IFVG ET CISD | 56 | 80,4 % | +0,181 R | +2 540 € | 1 007 € | 70,0 % / +159 € |
| + objectif au DOL | 64 | 81,3 % | +0,191 R | +3 050 € | 839 € | 77,8 % / +1 157 € |
| les trois ensemble | 35 | 82,9 % | +0,192 R | +1 676 € | 756 € | 76,2 % / +425 € |

Une seule des trois mérite d'être gardée.

### Retenue : la confirmation sur le second marché

> « Narrative journalière confirmée sur NQ et ES ensemble »

Elle écarte un tiers des signaux et **l'espérance ne bouge pas** : les trades
retirés valaient zéro. Le creux baisse, et la deuxième moitié de l'échantillon
s'améliore nettement. La décroissance mensuelle, qui était le fait le plus
inquiétant du rapport, s'aplatit :

| | sans confirmation | avec confirmation |
|---|---|---|
| juillet | 91,7 % · +0,410 R | 100,0 % · +0,416 R |
| août | 85,2 % · +0,203 R | 82,4 % · +0,179 R |
| **septembre** | 72,0 % · **+0,074 R** | 78,9 % · **+0,137 R** |

Le filtre retire surtout des trades qui échouaient récemment.

#### La validation croisée, qui nuance

Si « confirmer avec un second indice » était une règle universelle, elle
devrait aider partout. Elle n'aide pas partout.

| marché ← confirmé par | sans | avec |
|---|---|---|
| NQ ← ES | +0,191 R | +0,194 R |
| NQ ← YM | +0,191 R | **+0,156 R** |
| ES ← NQ | +0,004 R | **+0,101 R** |
| YM ← ES | +0,100 R | **+0,057 R** |
| RTY ← ES | +0,032 R | **+0,256 R** |
| YM ← NQ | +0,100 R | +0,117 R |

Quatre paires sur six s'améliorent, deux se dégradent. Et par fenêtre :

| fenêtre NY | sans | avec |
|---|---|---|
| 09h00–10h00 | +0,191 R | +0,194 R |
| **10h00–11h00 (fenêtre du plan)** | +0,094 R | **+0,214 R** |
| **10h00–12h00 (plan étendu)** | +0,060 R | **+0,163 R** |
| 01h00–02h30 | +0,291 R | +0,243 R |
| 07h30–09h00 | +0,168 R | +0,118 R |

**La confirmation aide surtout dans la fenêtre que le plan prescrit.** Ce n'est
pas un filtre universel : c'est une pièce d'un ensemble cohérent. Le plan dit
« 10h–12h ET confirmation sur les deux », et c'est là que ça marche.

### Écartées

**IFVG ET CISD ensemble** — 80,4 % contre 81,3 %, et la deuxième moitié
s'effondre (70,0 % / +159 €). Ma définition du CISD est probablement trop
lâche pour servir de second filtre.

**Objectif au DOL** — aucun effet mesurable (+3 050 € contre +3 058 €). Le DOL
est presque toujours plus loin que 2,5 R, donc le plafond mord et l'objectif ne
bouge pas. Pour appliquer vraiment la règle du plan il faudrait le haut/bas de
séance et les extrémités de CRT H1/H4, qui ne sont pas implémentés.

### Le coût : la vitesse

| configuration | trades | réussite | espérance | challenge à 250 $ |
|---|---|---|---|---|
| 09h–10h sans confirmation | 64 | 81,3 % | +0,191 R | 99,3 % en **50 séances** |
| **09h–10h avec confirmation** | **42** | **83,3 %** | **+0,194 R** | 99,1 % en **76 séances** |
| 10h–11h avec confirmation (plan) | 34 | 85,3 % | +0,214 R | 100,0 % en 84 séances |
| 10h–12h avec confirmation (plan) | 43 | 79,1 % | +0,163 R | 99,8 % en 88 séances |

Un tiers de signaux en moins, c'est vingt-six séances de plus pour atteindre
les 3 000 $. C'est le prix, et il est payé volontairement : la vitesse est
exactement ce qu'il ne faut pas optimiser.

### Ce que le modèle fait quand le second marché manque

Il ne filtre pas en silence. `evaluer()` rend `sansConfirmation: true`, le
robot consigne `confirmePar` dans l'instantané, et le pied du site écrit
« NQ seul — confirmation indisponible ». Sans ça, le site afficherait des
signaux que le robot écarte, et personne ne pourrait le voir.

---

## 10. Comment vérifier, et où la vérification s'arrête

```
node scripts/test.js                 79 vérifications, quelques secondes
node scripts/test.js --navigateur    + la page ouverte dans Chromium
node scripts/reference.js            le modèle produit-il la même chose qu'hier ?
node scripts/reference.js --ecrire   accepter un changement et le figer
```

Les deux premiers tournent dans le robot, **après la construction et avant la
poussée** : c'est le seul ordre qui empêche un chiffre faux d'atteindre le site.

### Les sept familles de vérifications

| famille | ce qu'elle attrape | le bug réel qui l'a motivée |
|---|---|---|
| réglages cohérents | fenêtre inversée, objectif plus près que le partiel, sortie forcée avant la fin de la fenêtre | — |
| valeur d'une position | la part déjà vendue ignorée | « +467 € » au lieu de +157 € |
| suivi d'une position | l'ordre des tests inversé | 4 positions sur 8 annoncées gagnantes alors qu'elles perdaient |
| sorties du modèle | stop du mauvais côté, signal hors fenêtre, plafond par jour | 4 à 9 % d'ordres impossibles à passer |
| affiché = mesuré | l'en-tête, les deux pages et le site doivent porter les mêmes chiffres | « 80,0 % » affiché à travers trois régénérations |
| données d'entrée | bougies désordonnées, haut < bas, cotation en cours prise pour une bougie, saut de prix absurde | la pseudo-bougie de Yahoo |
| pas de copie du suivi | une sixième réimplémentation | **la cause de tout** |

Plus la **référence** : l'empreinte exacte des 42 signaux. Tout écart fait
échouer les tests. L'accepter demande `--ecrire`, donc un geste délibéré,
visible dans un commit. Rien ne distinguait jusqu'ici « j'ai amélioré » de
« j'ai cassé sans m'en rendre compte ».

### Ce qui n'est PAS vérifié

Les tests le disent eux-mêmes à la fin de chaque exécution. C'est volontaire :
le pire défaut d'une batterie de tests est de laisser croire qu'elle couvre
tout.

- **La stratégie.** Les tests vérifient que le code fait ce qu'il dit, pas que
  ce qu'il dit soit rentable. 42 trades sur 60 jours ne prouvent rien.
- **Les définitions du CISD et du rejection block**, qui portent l'essentiel du
  résultat et qui sont de moi, faute de source précise.
- **La mise en page**, les couleurs, le radar — seulement que la page s'ouvre.
- **Le site en ligne** : rien ne compare ce dépôt à ce que GitHub Pages sert.
  La date en pied de page est là pour ça, elle se vérifie à l'œil.
- **Le déclenchement du robot** : GitHub n'honore pas les tâches planifiées
  entre 15 h et 18 h heure de Paris. Mesuré, jamais corrigé.
- **L'exécution réelle** : aucun ordre n'est passé. Le dérapage, les frais et
  le refus d'un courtier restent des hypothèses.
- **Les données Yahoo au-delà de leur forme** : fausses mais bien formées,
  rien ne le verra.

### Les trois trous qui restaient, et ce qui a été fait

**Le robot ne tournait pas pendant la séance.** GitHub n'honore presque jamais
les tâches planifiées entre 13 h et 16 h UTC — mesuré sur quarante-deux
déclenchements, et confirmé le lundi 28 septembre où les deux créneaux prévus
dans la fenêtre ne sont pas partis. `.github/workflows/seance.yml` contourne le
problème au lieu d'espérer : le travail démarre à **11 h 47 UTC**, hors zone
morte, **attend** jusqu'à 13 h 15, puis relève toutes les vingt minutes
jusqu'à 15 h 45. Un travail GitHub peut durer six heures, il en faut moins de
quatre, et le dépôt est public donc les minutes sont gratuites. Les passages du
soir restent comme filet.

Les vérifications y sont un **veto** : si elles échouent, rien n'est publié,
même si cela veut dire ne rien montrer.

**Le site en ligne n'était comparé à rien.** `node scripts/test.js --enligne`
télécharge la page publiée et vérifie qu'elle porte le même nombre de signaux,
la même date de mise à jour, et qu'elle ne parle pas en R. La question « est-ce
que c'est à jour ? » a enfin une réponse mécanique.

**Le rendu n'était pas vérifié.** `--navigateur` contrôle désormais que le
radar dessine vraiment (il compte les pixels du canvas : un canvas vide laisse
la page d'apparence normale et le cœur visuel mort), que rien ne déborde à la
largeur d'un téléphone, et que les repères d'affichage existent.

---

## 11. L'audit du mécanisme, avant la première séance automatique

Le travail qui couvre la séance n'avait jamais tourné. Relu ligne par ligne en
se demandant « qu'est-ce qui casse ? », six défauts sont sortis. Deux étaient
graves.

### Le backtest mesurait une autre stratégie que le robot

Le plus sérieux, et le plus discret. Le robot chargeait **60 minutes sur
3 mois** ; le banc d'essai, **1 heure sur 6 mois**. Le biais et les niveaux H4
sont agrégés depuis cette série. Sur les mêmes bougies d'exécution :

| | signaux |
|---|---|
| banc d'essai — 1h / 6 mois | **42** |
| robot — 60m / 3 mois | **37** |

Et pas les mêmes jours : le robot voyait deux achats du 22 juillet absents du
backtest, le backtest deux ventes du 24 juillet absentes du robot. **Tout ce
qui était mesuré décrivait donc autre chose que ce qui tournait.**

La liste des séries est désormais déclarée dans `js/modele.js`, puisque c'est
lui qui les consomme, et les quatre chargeurs la lisent là.

### Le travail se serait fait tuer au milieu de la séance

`timeout-minutes` valait 300. Départ au plus tôt à 10 h 17, attente jusqu'à
13 h 15 (178 min), relevés jusqu'à 15 h 45 (150 min) : **328 minutes**. GitHub
l'aurait arrêté à 15 h 17, en coupant la demi-heure où les positions sont
soldées. Porté à 350 ; la limite dure est 360.

### Les quatre autres

| défaut | conséquence | correction |
|---|---|---|
| départ très en retard | la boucle ne tournait pas une fois et le travail se terminait **en ayant l'air d'avoir réussi** | un relevé de rattrapage est forcé |
| deux workflows, deux groupes de concurrence | ils pouvaient pousser sur `main` en même temps | les créneaux de séance de `signaux.yml` sont retirés — ils n'avaient jamais rien déclenché |
| pas de cache dans l'action GitHub | les contrôles sur les **données d'entrée** étaient sautés là où le robot tourne vraiment | `live_log.js` dépose les séries dans `MECH_CACHE`, les deux workflows le définissent |
| `fixture.json` publié sur le site | 885 Ko de bougies imposés au visiteur | seuls `etat.json` et `signaux.json` sont publiés |

### La référence criait au loup tous les matins

Elle portait sur le cache vivant. Comme la fenêtre de Yahoo glisse, elle
échouait chaque jour — et un test qui alerte tous les matins finit par être
ignoré, c'est-à-dire par ne plus rien protéger.

Les bougies sont donc **gelées** dans `data/fixture.json` (huit jours, la
profondeur du 1 minute chez Yahoo). Un écart ne peut alors venir que du
**code**. Vérifié dans les deux sens :

```
trois exécutions d'affilée      → conforme, conforme, conforme
slx passé de 4 à 5              → réussite 85,7 % → 100 %, résultat +383 € → +779 €,
                                  réglage slx : 4 → 5        ← détecté
```

```
node scripts/fixture.js              regeler les bougies (geste délibéré)
node scripts/reference.js            comparer
node scripts/reference.js --ecrire   accepter un changement
```

---

## 12. KINTT — le plan source, suivi à la lettre

Deuxième stratégie, **à côté** de `js/modele.js`, pas à sa place. Les deux
tournent et se mesurent l'une contre l'autre.

| | `js/modele.js` | `js/kintt.js` |
|---|---|---|
| origine | un balayage, puis des corrections | **le plan « 10AM OXXC »** |
| fenêtre | 09h–10h | **10h–11h, étendue à 12h** |
| zones | M5 · M15 · M30 · H1 · H4 | **M15 · M30 · H1 · H4** (pas de M5) |
| zone | n'importe laquelle | **intacte** — jamais touchée |
| déclencheur | IFVG **ou** CISD | **IFVG *et* CISD** |
| stop | × 4 le bord de l'IFVG | **sous l'extrémité du balayage** |
| objectif | 2,5 fois le risque | **une zone** : haut/bas de séance, veille, ou bout du H4 |
| partiel | 90 % à 0,4 | **aucun** — tout court jusqu'à l'objectif |

### Ce que le plan produit vraiment

```
  modele (09h-10h)     41 trades ·  87,8 % ·  +64 € /trade ·  +2 622 €
  kintt  (10h-12h)      3 trades ·  33,3 % · +101 € /trade ·    +304 €
```

> ⚠️ **Le chiffre du modèle a d'abord été annoncé à +2 116 €, et c'était faux.**
> Le champ `rr` des signaux valait 0,61 — le **gain si tout est touché**, pas le
> rapport à l'objectif, qui vaut 2,50 — et `kintt_test.js` s'en servait comme
> plafond de suivi. Il mesurait donc le modèle avec un objectif final à 0,61
> fois le risque. Corrigé : les deux nombres portent deux noms, `rr` et
> `gainSiTout`, et six vérifications interdisent qu'ils se reconfondent.

**Trois trades en soixante jours.** Environ un par mois. L'entonnoir dit
pourquoi :

| étape | bougies écartées |
|---|---|
| biais neutre | 423 |
| ES en désaccord | 384 |
| **aucune zone intacte** | **442** |
| avant 10h | 67 |
| pas de balayage | 164 |
| pas de confirmation | 10 |
| **entrées** | **3** |

Desserrer les règles ne change presque rien — accepter les zones déjà
touchées, allonger l'âge maximum, ajouter le M5, doubler la fenêtre de
balayage : on reste à trois signaux. **C'est la rareté de la zone intacte qui
commande**, et c'est voulu : un FVG H4 jamais retouché n'apparaît que quelques
fois par trimestre. Le plan décrit un cas rare, pas une machine quotidienne.

### Conséquence, et elle est dure

**On ne peut pas juger kintt sur ces données.** +304 € sur trois trades ne veut
rien dire : un seul trade différent renverse le signe. Pour le mesurer il
faudrait des années, pas soixante jours.

C'est une information en soi, et elle vaut pour les deux stratégies : celle
qui produit quarante-et-un signaux est mesurable et probablement sur-ajustée ;
celle qui suit la source est honnête et invérifiable. Il n'y a pas de troisième
option avec deux mois de données.

### Les choix qu'il a fallu faire

Le plan se tait sur cinq points. Chacun est marqué `[CHOIX]` dans le code et
reste réglable :

| ce que le plan dit | ce que j'en ai fait |
|---|---|
| « SL : sous le dernier mouvement » | sous l'extrémité du **balayage** — le seul point que le plan rende identifiable |
| « PD High/Low » | **Previous Day** : haut et bas de la veille |
| « extrémité d'un CRT H1/H4 » | l'extrémité de la bougie H4 en cours |
| « IFVG M1/M3 » | 1m et 2m — Yahoo ne sert pas le 3 minutes au-delà de huit jours |
| âge maximum d'une zone | 400 bougies de son unité |

```
node scripts/kintt_test.js     mesure kintt et la compare au modèle
```

### Où kintt se voit, maintenant

La stratégie ne vit plus seulement dans un script de mesure : elle est
**branchée de bout en bout**.

| maillon | ce qu'il fait |
|---|---|
| `scripts/live_log.js` | évalue kintt à **chaque passage du robot**, sur les mêmes bougies que le modèle |
| `data/kintt.json` | son journal en direct, **séparé** de `data/signaux.json` |
| `data/etat.json` | porte un bloc `kintt` : chaîne du moment, dernier signal, entonnoir, reconstitution |
| le site | un panneau **KINTT** avec son propre lien de navigation et sa propre jauge |
| `scripts/reference.js` | fige une **seconde empreinte** : modifier `js/kintt.js` sans le vouloir se voit |
| `scripts/test.js` | vérifie que tout ça est réellement branché, et que le panneau se remplit |

Deux règles tenues à la lettre :

1. **Les journaux ne se mélangent jamais.** Un test échoue si un même signal
   apparaît dans les deux. Trois trades à 10 h et quarante-et-un à 9 h ne se
   moyennent pas : la moyenne ne décrirait ni l'une ni l'autre.
2. **Les bougies ne voyagent pas dans l'instantané.** La zone d'un signal
   porte la série entière ; recopiée telle quelle, `etat.json` pèserait
   plusieurs mégaoctets, téléchargés à chaque ouverture de la page. Un test
   mesure le poids du bloc et refuse au-delà de 50 Ko.

Le panneau affiche deux chiffres qu'il ne faut pas confondre :

- **« Relevé en direct »** — ce que le robot a réellement vu depuis qu'il tient
  ce journal. Aujourd'hui : rien, et c'est normal, la fenêtre est étroite.
- **« Reconstitution »** — le plan rejoué sur l'historique disponible, étiqueté
  comme tel. Trois trades. Le panneau écrit lui-même que ça ne veut rien dire,
  et pourquoi la perte moyenne de 4 € est un artefact du stop remonté au prix
  d'entrée, pas une prouesse.
