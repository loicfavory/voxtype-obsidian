# Voxtype Meeting — Plugin Obsidian

Plugin Obsidian (TypeScript) qui pilote une réunion Voxtype depuis l'éditeur et injecte la transcription à la position du curseur dans la note active.

## Prérequis

- **Obsidian** >= 1.4.0 (desktop uniquement — `isDesktopOnly: true`)
- **Voxtype** installé et le daemon en cours d'exécution
  - La CLI `voxtype` doit être accessible dans le `PATH` de la session Obsidian
  - Vérifier : `voxtype meeting status` dans un terminal

## Installation dans le coffre

1. Construire le plugin (voir section Build) :
   ```sh
   npm run build
   ```

2. Copier les fichiers dans le coffre Obsidian :
   ```sh
   VAULT="$HOME/Documents/Obsidian Vault"
   PLUGIN_DIR="$VAULT/.obsidian/plugins/voxtype-meeting"
   mkdir -p "$PLUGIN_DIR"
   cp main.js manifest.json "$PLUGIN_DIR/"
   ```

3. Dans Obsidian : **Paramètres → Plugins communautaires → activer les plugins tiers**, puis activer **Voxtype Meeting** dans la liste.

## Usage

### Démarrer une réunion

- Via la **palette de commandes** (`Ctrl+P`) : `Voxtype : Démarrer une réunion`
- Via l'**icône microphone** dans le ruban latéral gauche

Au démarrage :
- Le titre est généré automatiquement (`Réunion du dd/mm/YY à HH:ii`)
- La note active et la position du curseur sont mémorisées comme cible d'injection
- Une notification confirme quand l'enregistrement est actif (polling)

### Arrêter une réunion

- Via la **palette de commandes** : `Voxtype : Arrêter la réunion`
- Via la même **icône ruban** (devient `mic-off` pendant l'enregistrement)

Après l'arrêt :
- Le plugin attend la fin de la transcription (polling `voxtype meeting show latest`)
- La transcription Markdown est injectée à la position mémorisée
- Si la note cible a été fermée, le plugin modifie le fichier directement via l'API vault

### Icône ruban — états visuels

| Icône | État |
|-------|------|
| `mic` | En attente (idle) |
| `mic-off` | Démarrage ou enregistrement en cours |
| `loader` | Transcription en cours |

## Build

```sh
npm install
npm run build       # build production → main.js
npm run dev         # watch mode (rebuild à chaque modification)
npm run typecheck   # tsc --noEmit (vérification des types)
npm run lint        # ESLint
npm run format      # Prettier (--write)
npm run format:check # Prettier (--check)
```

## Architecture

```
src/
  main.ts            — Point d'entrée Plugin Obsidian (commandes, ruban)
  meeting-manager.ts — Logique métier (start/stop, polling, injection)
  voxtype.ts         — Interface CLI voxtype via child_process
  poller.ts          — Polling async générique (timer + timeout)
```

## Comportement sur les cas d'erreur

| Cas | Comportement |
|-----|-------------|
| Daemon Voxtype absent | Notice explicite, aucune cible mémorisée |
| Démarrage non confirmé (timeout 20 s) | Notice, retour en état idle |
| Transcription qui tarde | Notice continue, polling non bloquant |
| Timeout transcription (2 min) | Notice, retour idle, instruction d'export manuel |
| Transcription vide (0 mots) | Notice, rien injecté |
| Note cible disparue / fermée | Fallback modification fichier direct ; Notice si impossible |
| Échec CLI (stderr / code non-zéro) | Notice avec message d'erreur, état cohérent |

## Hors périmètre (US suivantes)

- Pause / reprise de réunion
- Dictée hors réunion (`voxtype record`)
- Titre de réunion libre (saisi par l'utilisateur)
- Renommage des locuteurs (`voxtype meeting label`)
- Résumé IA (`voxtype meeting summarize`)
- Multi-réunions simultanées
