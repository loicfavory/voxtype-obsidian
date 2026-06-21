# Voxtype Meeting — Plugin Obsidian

Plugin Obsidian (TypeScript) qui pilote une réunion Voxtype depuis l'éditeur, archive la transcription dans un dossier dédié, génère un compte rendu par LLM et injecte le tout à la position du curseur dans la note active.

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
- La transcription Markdown est archivée dans une note du dossier `Transcripts/` (créé automatiquement s'il n'existe pas)
- Le nom de la note est le titre de la réunion (`Réunion du dd/mm/YY à HH:ii`)
- En cas de collision, le nom est suffixé avec ` (1)`, ` (2)`, etc.
- Si un LLM est configuré et disponible, un **compte rendu structuré** est généré et injecté à la position mémorisée, suivi du wikilink vers le transcript
- Si aucun LLM n'est configuré ou si la génération échoue, le plugin retombe sur le comportement précédent : seul le wikilink est injecté ; le transcript reste toujours archivé
- Si la note cible a été fermée, renommée ou supprimée, le transcript reste archivé et une notice propose d'insérer le contenu manuellement

### Configuration du fournisseur LLM

Ouvrir **Paramètres → Options du plugin → Voxtype Meeting**.

| Option | Description |
|--------|-------------|
| **Fournisseur** | `Aucun`, `Claude (Anthropic)` ou `Ollama (local)` |
| **Claude — clé API** | Clé API Anthropic (`sk-ant-…`). Champ masqué. |
| **Claude — modèle** | `claude-sonnet-4-6` (défaut), `claude-opus-4-8`, `claude-haiku-4-5` |
| **Ollama — endpoint** | URL de l'API locale, ex. `http://localhost:11434` |
| **Ollama — modèle** | Nom du modèle servi, ex. `llama3`, `mistral` |

> **Sécurité** : la clé API et les réglages sont stockés dans le fichier `data.json` du plugin. Obsidian ne chiffre pas ce fichier : ne partagez pas votre coffre sans précaution.

### Structure du compte rendu

Quand un LLM est utilisé, le compte rendu généré suit cette structure (en français) :

1. **Interlocuteurs** — `Vous` (canal micro) puis `Pers1`, `Pers2`… déduits du dialogue
2. **Résumé court** — idées-forces en liste à puces
3. **Description complète** — déroulé détaillé avec temps forts
4. **Actions à mener** — cases à cocher `- [ ] …`
5. **Conclusion** — points focus / difficultés
6. **Lien vers le transcript** — `[[Transcripts/Titre|Titre]]`

Le plugin transmet les labels de locuteurs tels quels au LLM (`You`/`Remote` ou `SPEAKER_00`/`SPEAKER_01` selon la configuration Voxtype). C'est le LLM qui les mappe vers `Vous`/`Pers1`/`Pers2`.

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
  main.ts              — Point d'entrée Plugin Obsidian (commandes, ruban, réglages)
  meeting-manager.ts   — Logique métier (start/stop, polling, archivage, injection)
  settings.ts          — Réglages du plugin et onglet de configuration
  voxtype.ts           — Interface CLI voxtype via child_process
  poller.ts            — Polling async générique (timer + timeout)
  meeting-utils.ts     — Helpers purs (titre, nom de fichier, wikilink)
  llm/
    provider.ts        — Contrat `LlmProvider` et résolution selon les réglages
    claude-provider.ts — Appel API Anthropic Messages via `requestUrl`
    ollama-provider.ts — Appel API Ollama locale via `requestUrl`
    summary.ts         — Prompts, découpage-synthèse et assemblage du compte rendu

Dossiers gérés dans le coffre :
- `Transcripts/` — Dossier racine où les transcripts sont archivés (créé automatiquement)
```

## Comportement sur les cas d'erreur

| Cas | Comportement |
|-----|-------------|
| Daemon Voxtype absent | Notice explicite, aucune cible mémorisée |
| Démarrage non confirmé (timeout 20 s) | Notice, retour en état idle |
| Transcription qui tarde | Notice continue, polling non bloquant |
| Timeout transcription (2 min) | Notice, retour idle, instruction d'export manuel |
| Transcription vide (0 mots) | Notice, rien archivé ni injecté |
| Aucun LLM configuré | Transcript archivé ; seul le wikilink est injecté ; Notice invitant à configurer un fournisseur |
| LLM configuré mais indisponible (HTTP, timeout, réseau) | Transcript archivé ; repli sur le wikilink seul ; Notice d'erreur sans la clé API |
| Transcript long | Découpage-synthèse automatique (map-reduce) ; pas de plantage |
| Note cible disparue / fermée / renommée | Transcript déjà archivé ; Notice proposant d'insérer le contenu manuellement |
| Échec création dossier `Transcripts/` | Notice, retour idle |
| Échec création note de transcript | Notice, retour idle |
| Échec CLI (stderr / code non-zéro) | Notice avec message d'erreur, état cohérent |

## Limites et hors périmètre (US suivantes)

- Pause / reprise de réunion
- Dictée hors réunion (`voxtype record`)
- Titre de réunion libre (saisi par l'utilisateur)
- Renommage des locuteurs via popin (remplacement de `Vous`/`Pers1`/… par les vrais noms)
- (Re)génération manuelle d'un compte rendu sur un transcript déjà archivé
- Édition / retraitement du compte rendu après injection
- Autres fournisseurs LLM (OpenAI, Groq…)
- Choix de la langue du compte rendu (français imposé pour l'instant)
- Activation de la diarisation `ml` côté Voxtype (config externe optionnelle)
- Multi-réunions simultanées
