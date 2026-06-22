/**
 * recording-label-pure.ts — Logique pure du marqueur visuel.
 *
 * Aucun import Obsidian ni CodeMirror : ce fichier est testable sans mock.
 */

/**
 * Construit la ligne de marqueur (callout visible) écrite UNE fois dans la note.
 * Forme EXACTE (sans chevrons) :
 *   > [!info] 🎙️ Transcription en cours… (voxtype:<id>)
 * où <id> est l'identifiant brut (ex. "1718900000000"), inséré tel quel.
 */
export function buildMarkerText(id: string): string {
  return `> [!info] 🎙️ Transcription en cours… (voxtype:${id})`;
}

/**
 * Localise le marqueur portant `id` dans `content`, par string match exact sur
 * la sous-chaîne `voxtype:<id>`. Retourne les offsets [start, end) de la LIGNE
 * de callout (sans le saut de ligne final), ou null si absent.
 */
export function findMarkerRange(
  content: string,
  id: string,
): { start: number; end: number } | null {
  const needle = `voxtype:${id}`;
  const idx = content.indexOf(needle);
  if (idx < 0) return null;

  const start = content.lastIndexOf("\n", idx) + 1;
  let end = content.indexOf("\n", idx);
  if (end < 0) end = content.length;

  return { start, end };
}

/**
 * Localise le bloc marqueur (ligne de callout + sauts de ligne encadrants éventuels)
 * afin de remplacer proprement la totalité de ce qui a été inséré par
 * `insertMarker` sans laisser de lignes blanches parasites.
 *
 * Mange jusqu'à deux sauts de ligne avant et après la ligne de callout, de façon
 * symétrique avec l'insertion `\n\n${markerText}\n\n`.
 */
export function findMarkerBlockRange(
  content: string,
  id: string,
): { start: number; end: number } | null {
  const lineRange = findMarkerRange(content, id);
  if (lineRange === null) return null;

  let start = lineRange.start;
  let end = lineRange.end;

  if (content.slice(start - 2, start) === "\n\n") {
    start -= 2;
  }

  if (content.slice(end, end + 2) === "\n\n") {
    end += 2;
  }

  return { start, end };
}

/**
 * Frame d'animation déterministe selon le tick (compteur incrémenté à chaque intervalle).
 * Cycle de période 3 : tick 0 -> ".", 1 -> "..", 2 -> "...", 3 -> "." (= tick % 3).
 */
export function computeFrame(tick: number): string {
  const frames = [".", "..", "..."] as const;
  return frames[((tick % 3) + 3) % 3];
}

/**
 * Contenu de remplacement du cas (c) transcript vide.
 * Le marqueur est remplacé par cette ligne.
 */
export function buildEmptyMeetingText(): string {
  return "Réunion sans contenu";
}
