/**
 * voxtype-parse.ts — Parsing pur de la sortie CLI `voxtype`.
 * Aucun import Node/Obsidian : testable sans mock.
 */

export interface MeetingShowResult {
  status: "active" | "completed" | "paused" | "unknown";
  words: number;
  segments: number;
  id: string | null;
}

export interface CliError {
  kind: "cli-error";
  message: string;
  code: number | null;
  stderr: string;
}

export type CliResult<T> = { ok: true; value: T } | { ok: false; error: CliError };

/** Parse la sortie de `voxtype meeting show` pour extraire status, words, segments, id. */
export function parseMeetingShow(output: string): MeetingShowResult {
  const statusMatch = /^Status:\s+(\S+)/im.exec(output);
  const wordsMatch = /^Words:\s+(\d+)/im.exec(output);
  const segmentsMatch = /^Segments:\s+(\d+)/im.exec(output);
  const idMatch = /^ID:\s+(\S+)/im.exec(output);

  const rawStatus = statusMatch?.[1]?.toLowerCase() ?? "unknown";
  let status: MeetingShowResult["status"] = "unknown";
  if (rawStatus === "active") status = "active";
  else if (rawStatus === "completed") status = "completed";
  else if (rawStatus === "paused") status = "paused";

  return {
    status,
    words: wordsMatch ? parseInt(wordsMatch[1], 10) : 0,
    segments: segmentsMatch ? parseInt(segmentsMatch[1], 10) : 0,
    id: idMatch?.[1] ?? null,
  };
}

/**
 * Classifie la disponibilité du daemon/CLI à partir du résultat d'une commande légère.
 * Retourne false seulement quand le binaire est introuvable (ENOENT).
 */
export function classifyAvailability(result: CliResult<string>): boolean {
  if (result.ok) return true;
  // ENOENT = binaire absent
  if (result.error.message.includes("ENOENT")) return false;
  // Autres erreurs : le binaire existe mais quelque chose cloche ; on considère disponible
  // pour laisser l'erreur se manifester lors de l'action réelle.
  return true;
}
