# Bots Discord — TRADEassist

5 bots ICT/SMC qui envoient leurs analyses dans Discord via **webhooks** (un salon = un webhook).
Données réelles et **gratuites** : Kraken (crypto) + Yahoo Finance (DXY, forex, or). Aucune clé requise.
Toutes les détections travaillent sur **bougies clôturées** (règle « attendre la clôture »).

## Les bots

| Fichier | Bot | Unités | Webhook (variable d'env) |
|---|---|---|---|
| `bot_zones.js` | **Radar Zones** — FVG, OB, Breaker, OTE, liquidité, structure, MSS, cycles AMD | H4 + D1 | `DISCORD_WEBHOOK_ZONES` |
| `bot_scalp.js` | **Scalp** — mêmes détections, filtré sur l'exploitable | H1 · M30 · M15 | `DISCORD_WEBHOOK_SCALP` |
| `bot_position.js` | **Position** — alignement D1→H4 + DXY + apprentissage | D1 → H4 | `DISCORD_WEBHOOK_POSITION` |
| `bot_auto.js` | **Autonome** — confluence D1, envoie ses meilleurs trades + apprentissage | D1 | `DISCORD_WEBHOOK_AUTO` |
| `bot_calendar.js` | **News Éco** — calendrier économique (dates, heures, importance) | — | `DISCORD_WEBHOOK_NEWS` |

## Lancer un bot

```bash
# Test sans envoyer (affiche le message dans le terminal) :
node scripts/bot_zones.js --dry

# Envoi réel : définir le webhook du salon voulu
DISCORD_WEBHOOK_ZONES="https://discord.com/api/webhooks/…" node scripts/bot_zones.js
```

Options utiles : `bot_calendar.js --days 30` (mois entier), `--all` (inclure importance faible).

## Apprentissage (bots Position & Auto)

Chaque trade est mémorisé dans `scripts/data/*.json`. À chaque exécution, le bot :
1. clôture les trades en cours au prix courant (gagné au TP, perdu au SL),
2. recalcule son taux de réussite par type de setup,
3. **évite** les setups qui perdent (sous 50 % après ≥ 5 trades).

Le dossier `scripts/data/` n'est pas versionné (état runtime).

## Planification

Pour un envoi automatique (ex. chaque matin), lancer les bots via un planificateur
(cron, service cloud, ou Routine Claude) en passant les webhooks en variables d'env.
