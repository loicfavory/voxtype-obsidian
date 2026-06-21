/**
 * meeting-utils.ts — Helpers purs pour la gestion des réunions.
 * Aucun import Obsidian/Node : testable sans mock.
 */

/**
 * Génère le titre horodaté : "Réunion du dd/mm/YY à HH:ii" en heure locale.
 * Ex : "Réunion du 20/06/26 à 14:30"
 */
export function buildTimestampedTitle(now: Date = new Date()): string {
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  const HH = String(now.getHours()).padStart(2, "0");
  const ii = String(now.getMinutes()).padStart(2, "0");
  return `Réunion du ${dd}/${mm}/${yy} à ${HH}:${ii}`;
}

/**
 * Assainit un titre de réunion pour en faire un nom de fichier valide.
 * Remplace les caractères interdits ou ambigus (`/`, `:`) par des équivalents sûrs.
 * Ex : "Réunion du 20/06/26 à 14:30" → "Réunion du 20-06-26 à 14h30"
 */
export function sanitizeFileName(title: string): string {
  return title.replace(/\//g, "-").replace(/:/g, "h");
}

/**
 * Construit un wikilink Obsidian pointant vers une note dans un dossier.
 * Format de sortie : "\n\n[[<folderPath>/<basename>|<title>]]\n".
 */
export function buildWikilink(folderPath: string, basename: string, title: string): string {
  return `\n\n[[${folderPath}/${basename}|${title}]]\n`;
}

/**
 * Borne un offset caractère entre 0 et max (inclus).
 */
export function clampOffset(offset: number, max: number): number {
  return Math.max(0, Math.min(offset, max));
}
