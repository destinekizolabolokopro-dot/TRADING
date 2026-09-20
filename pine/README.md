# Scripts TradingView (Pine Script v6)

4 fichiers, 2 modèles. Tout est en français, tout se règle dans les paramètres.

| Fichier | Type | À quoi ça sert |
|---|---|---|
| `BLAKE_MECH_indicator.pine` | `indicator()` | Blake Mech Model **en direct** : flèches, niveaux, alertes |
| `BLAKE_MECH_strategy.pine` | `strategy()` | Le **même** modèle, mais en backtest chiffré |
| `IFVG_MODEL_indicator.pine` | `indicator()` | Modèle IFVG **en direct** : zones, flèches, alertes |
| `IFVG_MODEL_strategy.pine` | `strategy()` | Le **même** modèle IFVG, en backtest chiffré |
| `MECH_MODEL_2_indicator.pine` | `indicator()` | Première version « MECHANICAL MODEL 2.0 » — **superseded** par `BLAKE_MECH_*`, gardée pour comparaison |

> ⚠️ **Honnêteté sur les sources.** Je n'ai pas pu visionner les vidéos YouTube
> citées (`mZIGMN4cRi0`, `5-oTN8HmPPg`). La **seule** source des règles codées
> ici, ce sont **tes spécifications écrites**. Aucune règle n'a été inventée
> pour « faire joli » : tout ce qui était ambigu est devenu un **paramètre**,
> pas une supposition déguisée en vérité.

---

## 1. Installer dans TradingView

1. Ouvre un graphique (pour le Mech Model : **NQ1!** ou **MNQ1!**, en **M5** ou **M15**).
2. En bas de l'écran → onglet **Pine Editor**.
3. **Open → New indicator** (ça ouvre un script vide).
4. Sélectionne tout (Ctrl+A) et **colle** le contenu d'un des fichiers `.pine`.
5. **Save** (donne-lui un nom), puis **Add to chart**.
6. Clique sur l'engrenage ⚙️ à côté du nom du script → tous les réglages sont là.

Répète pour chaque fichier. Un `strategy()` et un `indicator()` peuvent
cohabiter sur le même graphique.

**Compte gratuit :** tu peux avoir 2 scripts par graphique. Si tu veux les 4,
il faut ouvrir plusieurs graphiques ou passer à un plan payant.

---

## 2. Lancer le backtest

1. Ajoute le fichier `*_strategy.pine` au graphique.
2. Onglet **Strategy Tester** (en bas, à côté de Pine Editor).
3. Onglets à lire : **Overview**, **Performance Summary**, **List of Trades**.
4. Dans ⚙️ → **Properties** : mets le bon **capital initial**, la **commission**
   et le **slippage**. Un backtest sans frais est un mensonge.
   - NQ : compte ~2 à 4 $ aller-retour de commission, et 1 à 2 ticks de slippage.
5. Dans ⚙️ → **Inputs** → groupe « ⑧ Fenêtre de test » : coche
   **Limiter le backtest à une période** pour faire du **walk-forward**
   (voir §5).

### Le chiffre à regarder n'est PAS le win rate
Le tableau en haut à droite affiche **ESPÉRANCE / trade**. C'est la seule
ligne qui compte :

```
espérance = (win rate × gain moyen) − (taux de perte × perte moyenne)
```

- Espérance **positive** → le modèle gagne de l'argent sur la durée.
- Espérance **négative** → même avec 80 % de réussite, tu perds.

Le tableau affiche aussi le **win rate d'équilibre** : en dessous de ce
pourcentage, ton RR moyen ne suffit plus à couvrir les pertes.

Et la ligne **fiabilité** :
- moins de 20 trades → « Trop tôt », le résultat ne veut rien dire ;
- 20 à 50 → « Indicatif » ;
- 50+ → « Significatif ».

---

## 3. Explication de chaque module

### Blake Mech Model (`BLAKE_MECH_*`)

| Module | Rôle |
|---|---|
| **① Structure & liquidité** | Détecte les swings avec `ta.pivothigh/pivotlow`. Un swing n'existe qu'après `pivLen` bougies → aucun signal ne peut disparaître après coup. |
| **② Sources de liquidité** | Ce qui peut être « sweepé » : PDH/PDL, extrêmes de session (Asie, Londres, NY AM), swings, equal highs/lows. Chacun activable séparément. |
| **③ Sessions & macros** | Deux filtres cumulés. **(a)** Les fenêtres de trading : de l'**ouverture de Wall Street** (09:30 NY) à **17 h 00 heure de Paris**, puis **19 h 00 → 21 h 00** (Paris), qui correspond à 13 h – 15 h à New York. Les deux fuseaux sont lus séparément, donc le filtre reste juste même pendant les semaines où la France et les USA ne changent pas d'heure en même temps (l'ouverture tombe alors à 14 h 30 à Paris au lieu de 15 h 30). **(b)** Les macros 09:30–11:00 et 13:00–15:00 EST, qui excluent le lunch. Clôture forcée en fin de séance. |
| **④ Inversion** | **4 définitions au choix** (CISD / MSS / Engulfing+displacement / création de FVG). Aucune n'est « la » bonne : tu les testes une par une. |
| **⑤ FVG** | Le FVG **n'est pas** la liquidité : c'est la **cible**. Le script garde la liste des FVG non mitigés et prend le plus proche dans le sens du trade. |
| **⑥ SMT** | Divergence contre un actif corrélé (ES pour le NQ). Contre-sens = **pas de trade**. Définition également paramétrable. |
| **⑦ Risque** | Taille calculée depuis le % de risque et la valeur du point. Break-even à +1R. Partielle sur le FVG, runner vers la liquidité externe. |
| **⑧ Walk-forward** | Limite le backtest à une plage de dates. |

**La séquence, dans l'ordre :**
`sweep de liquidité` → `structure valide` → `inversion confirmée` →
`un FVG non mitigé existe comme cible` → `SMT ne s'y oppose pas` →
`on est dans une macro` → **ENTRÉE**.

Si une seule case manque, le tableau affiche **pourquoi** il n'y a pas de trade.

### Modèle IFVG (`IFVG_MODEL_*`)

| Module | Rôle |
|---|---|
| **① FVG / IFVG** | Machine à états : `0 = FVG` → `1 = IFVG` (le FVG a été cassé et s'inverse) → `2 = mort`. |
| **② Cassure** | **3 modes** : mèche / clôture / clôture + displacement. C'est le réglage le plus sensible du modèle. |
| **③ Retest** | **3 modes** : simple touche / 50 % de la zone / extrémité opposée. |
| **④ Filtres** | Structure, liquidité, displacement — **tous optionnels**, désactivés par défaut. À activer un par un pour voir ce que chacun apporte vraiment. |
| **⑤ Entrée / SL / TP** | 4 modes chacun. Aucun n'est présenté comme « celui de la vidéo ». |
| **⑥ Gestion** | Break-even, partielles, limites journalières, sessions. |

---

## 4. Les paramètres à optimiser (dans cet ordre)

Un seul à la fois. Si tu changes tout en même temps, tu n'apprends rien.

1. **Le mode d'inversion** (Mech) ou **le mode de cassure** (IFVG).
   C'est le paramètre qui change le plus les résultats. Teste les 4 / les 3,
   note l'espérance de chacun.
2. **La longueur des pivots** (3 / 5 / 8 / 13). Court = plus de signaux, plus de bruit.
3. **Le mode de retest / d'entrée.**
4. **Le RR minimum** (0,8 / 1,0 / 1,5 / 2,0). C'est le curseur direct
   « taux de réussite ↔ taille des gains ».
5. **Le break-even.** Active/désactive. Le BE monte le win rate mais coupe
   des trades qui seraient revenus gagnants — regarde l'espérance, pas le win rate.
6. **Les filtres optionnels** (IFVG). Un par un.
7. **Les macros.** Teste sans le filtre horaire pour voir s'il apporte vraiment.

### ⚠️ Le piège du surapprentissage
Trouver les réglages « parfaits » sur 2023-2024 ne prouve **rien**. Fais ça :

- **Optimise** sur 2022 → 2024 (période d'apprentissage).
- **Vérifie** sur 2025 → aujourd'hui, **sans rien retoucher** (période de test).
- Si l'espérance s'effondre entre les deux → tes réglages collent au passé,
  pas au marché.

C'est exactement à ça que sert le groupe « ⑧ Fenêtre de test ».

---

## 5. Les limites du modèle (les vraies)

1. **Même-bougie SL/TP.** Pine ne sait pas si le stop ou la cible a été touché
   en premier à l'intérieur d'une bougie. Sur un modèle intraday, ça peut
   **embellir** ou **abîmer** les résultats. Teste sur une timeframe plus fine
   pour réduire l'effet.
2. **Données historiques limitées.** Un compte gratuit TradingView donne peu de
   bougies M5. Sur M5, tu remonteras rarement à plus de quelques mois.
3. **Futures continus (`NQ1!`).** Les raccords entre contrats créent des gaps
   artificiels qui peuvent ressembler à des FVG.
4. **Les frais.** Si tu ne mets pas commission + slippage dans les Properties,
   ton backtest est faux, point.
5. **Le SMT dépend d'un second symbole.** Si `request.security` ne trouve pas
   l'actif corrélé, le filtre ne bloque plus rien — vérifie le ticker.
6. **Un backtest n'est pas un compte réel.** Pas de coupure de connexion, pas de
   refus d'ordre, pas d'émotion, pas de slippage sur news.

---

## 6. Ce que je n'ai PAS pu rendre parfaitement mécanique

Je préfère te le dire clairement plutôt que de te vendre un modèle « 100 %
mécanique » qui ne l'est pas.

| Notion | Pourquoi ce n'est pas mécanique | Ce que j'ai fait |
|---|---|---|
| **« Inversion »** | Aucune définition universelle. CISD, MSS, engulfing, création de FVG : chacun l'entend différemment. | 4 modes sélectionnables, à tester séparément |
| **« SMT »** | Même problème : sur quelle fenêtre ? quel actif ? quel type d'extrême ? | Actif + fenêtre paramétrables |
| **« Displacement »** | « Une grosse bougie » n'est pas une règle. | Seuil `corps > ATR(14) × N`, réglable |
| **« Mitigation » d'un FVG** | Première touche ou gap totalement rempli ? Les deux écoles existent. | 2 modes au choix |
| **Choix de la cible** | La spec dit « le FVG non mitigé le plus proche ». Sur une journée chargée, « le plus proche » dépend de la timeframe regardée. | Codé comme « le plus proche dans le sens du trade », sur la timeframe du graphique |
| **« Liquidité externe » (runner)** | Quelle liquidité exactement ? | Le plus extrême entre PDH/PDL et le dernier swing |
| **Taille de position sur futures** | Dépend du contrat (NQ = 20 $/pt, MNQ = 2 $/pt). | Paramètre « valeur du point », arrondi **vers le bas** |

---

## 7. Anti-repaint

Les deux modèles appliquent les mêmes garanties, documentées en bas de chaque
fichier :

- `request.security(..., lookahead = barmerge.lookahead_off)` — jamais de
  données du futur.
- PDH/PDL pris sur la **veille** (`[1]`) : valeur définitivement figée.
- Swings via `ta.pivothigh/pivotlow` : confirmés seulement après `pivLen`
  bougies, donc jamais « devinés » puis retirés.
- FVG enregistrés uniquement sur `barstate.isconfirmed`.
- Entrées sur clôture (`process_orders_on_close = true`, `calc_on_every_tick = false`).
- Alertes en `alert.freq_once_per_bar_close`.

**Test à faire toi-même :** note un signal en direct, reviens le lendemain sur
la même bougie. S'il est toujours là, au même endroit, il n'y a pas de repaint.

---

## 8. Ce qui reste à vérifier de ton côté

Je ne peux pas compiler du Pine Script ici — il n'y a pas de compilateur
TradingView hors de TradingView. Le code est écrit avec soin et relu, mais il
n'est **pas validé par un compilateur**.

Colle chaque fichier dans le Pine Editor. S'il y a une erreur, envoie-moi le
message exact (ligne + texte) et je corrige.

Et si tu récupères les **transcripts** ou des **captures** des deux vidéos, je
compare règle par règle avec ce qui est codé, et j'ajuste ce qui diffère.

---

## MECH_LIVE.pine — alertes temps réel

C'est **le seul fichier Pine à jour**. Les autres (`BLAKE_MECH_*`,
`IFVG_MODEL_*`, `MECH_MODEL_2_*`) encodent une compréhension antérieure du
modèle, avant le biais par respect des FVG, avant les quatre familles de
niveaux clés, avant la cible courte à 1 R plus runner, et avant la fenêtre
09 h 30 – 10 h 00. Ils sont conservés pour mémoire, pas pour être utilisés.

`MECH_LIVE.pine` porte `scripts/mech.js` avec la configuration mesurée dans
`scripts/REGLAGES.md`.

### Pourquoi TradingView plutôt que le site

Mesuré, pas supposé : **Yahoo Finance est différé de 10 minutes sur le NQ**.
La détention médiane de la stratégie est de 5 minutes — le signal arriverait
après la fin du trade.

QQQ, lui, est en temps réel sur Yahoo, mais ne sert pas de substitut : la
corrélation des variations en 5 minutes n'est que de 0,92, et l'avantage
tombe de +0,262 R à +0,013 R. Les FVG et les balayages vivent exactement dans
les 8 % qui diffèrent.

TradingView donne le NQ en temps réel (abonnement CME Level 1) et envoie les
alertes en notification sur le téléphone. C'est la seule voie gratuite en
dehors du flux Rithmic ou Tradovate fourni avec un compte prop firm.

### Mise en place

1. Graphique **NQ1!** en **5 minutes**, fuseau **New York**.
2. Coller le fichier dans l'éditeur Pine, enregistrer, ajouter au graphique.
3. Alertes → Créer une alerte → Condition : *MECH Live* → **Signal MECH** →
   cocher *Notifier sur l'application mobile*.

Le tableau en haut à droite affiche en continu le biais et son score, l'étape
en cours, le niveau clé retenu, le DOL et le nombre de signaux du jour.

### Ce qui diffère du moteur de backtest

Pine n'a pas les mêmes moyens que Node, deux approximations sont assumées :

- **ITL / ITH** sont approchés par un pivot de rang 2. La hiérarchie fractale
  complète d'ICT — un STL encadré de STL plus hauts — demanderait de
  reconstruire trois étages ; le pivot en est l'équivalent le plus proche
  directement disponible.
- **L'IFVG** est cherché sur l'unité du graphique seulement. Le moteur balaie
  1, 2 et 5 minutes et retient la plus haute valide ; dans la configuration
  retenue, 47 signaux sur 64 venaient déjà du 5 minutes.

### Avant de s'en servir

Le réglage est le meilleur de 263 essais menés sur la même période de 60
jours. Il tient sur deux blocs de 30 jours (83,3 % puis 85,0 %) et résiste au
déplacement de ses paramètres, mais il ne transfère ni à l'ES ni à une autre
unité d'exécution. L'avantage réel est probablement plus proche de +0,10 R
que de +0,237 R. Voir `scripts/REGLAGES.md`.

**Ce fichier n'a pas pu être compilé ici** — Pine ne s'exécute que sur
TradingView. La syntaxe a été relue, mais la première compilation peut
signaler des erreurs à corriger.
