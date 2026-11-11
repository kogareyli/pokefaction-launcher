# Launcher PokéFaction

Launcher du serveur Minecraft **PokéFaction** (PvP Faction Pokémon, COBBLEVERSE / Cobblemon, Minecraft 1.21.1 Fabric).

**Télécharger :** onglet [Releases](../../releases/latest) → `PokeFaction-win-x64.exe`

Le launcher installe Java, Fabric, les mods, les packs et les réglages, puis connecte directement au serveur.
Connexion avec un simple pseudo. Il se met à jour tout seul.

## Pour l'admin

| Je veux… | Je fais… |
|---|---|
| Ajouter/retirer un mod | Mets le `.jar` dans `web/files/mods/` (ou ajoute-le à `tools/externes.json`), puis `node tools/generer_manifest.js` |
| Mettre le serveur en maintenance | `web/config` → `"maintenance": true` |
| Changer l'IP du serveur | `web/instances` → `status.ip` et `game_args` |
| Publier une actu | `web/articles` |
| Nouvelle version du launcher | Augmente `version` dans `package.json` : GitHub reconstruit le `.exe` tout seul |

Les modifs dans `web/` sont prises en compte au prochain lancement des joueurs, sans rien reconstruire.

## Crédits

Basé sur [Selvania Launcher](https://github.com/luuxis/Selvania-Launcher) de **Luuxis**, sous licence Luuxis License v1.0 (voir `LICENSE.md`) :
usage non commercial, code source public, attribution à Luuxis.
