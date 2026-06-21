# Instructions pour les agents — Voxtype Obsidian

Ce fichier contient les règles de travail que tous les agents doivent suivre sur ce dépôt.

## Workflow Git

- **Interdiction formelle de pousser directement sur `master`.**
- Tout changement de code doit passer par une **Pull Request**.
- Utiliser l'agent `commit-push-mr` pour rédiger le message de commit, pousser la branche et ouvrir/mettre à jour la PR.

### Nomenclature des branches

| Type de changement | Format | Exemple |
|--------------------|--------|---------|
| Feature / User Story | `feature/<ref>` | `feature/us-02b` |
| Correction critique en prod | `hotfix/<ref>` | `hotfix/us-02a` |
| Correction de bug | `bugfix/<ref>` | `bugfix/us-02b` |

La `<ref>` doit toujours être la référence exacte de la tâche ou de la user story (par exemple `us-02b`, `tech-01`).

## Qualité

Avant toute PR, les commandes suivantes doivent être vertes :

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

## Déploiement local

Après un build réussi, copier `main.js` et `manifest.json` dans le coffre Obsidian :

```sh
cp main.js manifest.json "$HOME/Documents/Obsidian Vault/.obsidian/plugins/voxtype-meeting/"
```

Puis désactiver/réactiver le plugin dans Obsidian.
