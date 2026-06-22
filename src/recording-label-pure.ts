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
 * Calcule le préfixe à ajouter avant `text` quand on remplace un bloc marqueur,
 * de façon à préserver une séparation propre avec le paragraphe précédent.
 */
function computePrefix(before: string): string {
  if (before.length === 0) return "";
  if (!before.endsWith("\n")) return "\n\n";
  if (!before.endsWith("\n\n")) return "\n";
  return "";
}

/**
 * Calcule le suffixe à ajouter après `text` quand on remplace un bloc marqueur,
 * de façon à préserver une séparation propre avec le paragraphe suivant.
 */
function computeSuffix(after: string): string {
  if (after.length === 0) return "";
  if (!after.startsWith("\n")) return "\n\n";
  if (!after.startsWith("\n\n")) return "\n";
  return "";
}

/**
 * Calcule la chaîne de recollage (glue) à insérer entre `before` et `after`
 * quand le marqueur est effacé (remplacement vide).
 *
 * - Si l'un des deux côtés est vide, aucune glue n'est nécessaire.
 * - Sinon, la glue garantit un unique séparateur de paragraphe (`\n\n`) entre
 *   les deux blocs, sans en ajouter en trop si des sauts de ligne existent déjà
 *   à la jonction.
 */
function computeEmptyGlue(before: string, after: string): string {
  if (before === "" || after === "") return "";

  const beforeHasTrailingNewline = before.endsWith("\n");
  const afterHasLeadingNewline = after.startsWith("\n");
  if (beforeHasTrailingNewline && afterHasLeadingNewline) {
    return "";
  }
  if (beforeHasTrailingNewline || afterHasLeadingNewline) {
    return "\n";
  }
  return "\n\n";
}

/**
 * Construit la chaîne de remplacement à insérer à la place du bloc marqueur.
 *
 * - `before` : texte situé avant le bloc marqueur.
 * - `after` : texte situé après le bloc marqueur.
 * - `text` : contenu de remplacement (vide pour un effacement).
 *
 * Retourne la chaîne à injecter entre `before` et `after`, avec le padding
 * nécessaire pour éviter collage et lignes blanches résiduelles.
 */
export function buildMarkerReplacement(before: string, after: string, text: string): string {
  if (text === "") {
    return computeEmptyGlue(before, after);
  }
  const prefix = computePrefix(before);
  const suffix = computeSuffix(after);
  return `${prefix}${text}${suffix}`;
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
