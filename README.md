# Launcher PokéFaction

Launcher du serveur Minecraft **PokéFaction** (PvP Faction Pokémon, COBBLEVERSE / Cobblemon, Minecraft 1.21.1 Fabric).

**Télécharger :** onglet [Releases](../../releases/latest) → `PokeFaction-win-x64.exe`

Le launcher installe Java, Fabric, les mods, les packs et les réglages, puis connecte directement au serveur.
Connexion avec un simple pseudo. Il se met à jour tout seul.

## Pour l'admin

| Je veux… | Je fais… |
|---|---|
| Ajouter/retirer/mettre à jour un mod, un pack de textures ou un shader, changer un réglage | Je le fais dans l'instance CurseForge, puis double-clic sur **`tools/envoyer-modifs.bat`** (« Envoyer mes modifs PokéFaction ») : serveur + launcher + GitHub, tout seul |
| Voir ce qui serait envoyé, sans rien changer | `tools/envoyer-modifs.bat --simulation` |
| Mettre le serveur en maintenance | `web/config` → `"maintenance": true` |
| Changer l'IP du serveur | `web/instances` → `status.ip` et `game_args` |
| Publier une actu | `web/articles` |
| Nouvelle version du launcher | Modifier `src/`, puis « Envoyer mes modifs » : il augmente la version, GitHub reconstruit le `.exe` et le launcher se met à jour tout seul chez les joueurs |

Les modifs dans `web/` sont prises en compte au prochain lancement des joueurs, sans rien reconstruire.

### Comment marche « Envoyer mes modifs »
- **Mods** (dossier `mods`) : copiés sur le serveur et dans le launcher. Les mods retirés sont gardés dans `sauvegardes-maj/` du serveur.
- **Packs de textures et shaders** : launcher seulement.
- **Réglages** (`config`) : seulement ceux modifiés depuis le dernier envoi. Sur le serveur s'il a ce fichier ; dans le launcher pour les **nouveaux** joueurs (on n'écrase pas les réglages perso des joueurs existants).
- Il **vérifie les dépendances** des mods (ex. logprot a besoin de cupboard) et refuse d'envoyer un modpack qui planterait.
- Liens de téléchargement : CurseForge si possible, sinon Modrinth, sinon le fichier est hébergé ici (50 Mo max).
- Jamais envoyés : `tools/exclusions.json` (bande-son de 179 Mo, dossiers de shaders décompressés…).
- Le serveur doit être arrêté si des mods ou réglages du serveur changent.
- Tests : `node --test "tools/tests/*.test.js"`.

## Crédits

Basé sur [Selvania Launcher](https://github.com/luuxis/Selvania-Launcher) de **Luuxis**, sous licence Luuxis License v1.0 (voir `LICENSE.md`) :
usage non commercial, code source public, attribution à Luuxis.
