/**
 * voxtype.ts — Interface avec la CLI `voxtype` via child_process (Electron/Node).
 * Toutes les interactions avec Voxtype passent ici. Aucun chemin hardcodé.
 *
 * Format réel de `voxtype meeting show latest` (vérifié le 20/06/2026) :
 *   <Titre de la réunion>
 *   =============
 *   ID:       <uuid>
 *   Started:  2026-06-20 18:37 UTC
 *   Ended:    2026-06-20 18:39 UTC
 *   Duration: 2m 2s
 *   Status:   Completed
 *   Chunks:   8
 *
 *   Transcript:
 *   -----------
 *   Segments: 4
 *   Words:    99
 *   Speakers: You
 *
 * Format réel de `voxtype meeting status` quand inactif :
 *   "No meeting currently in progress."
 *
 * Format réel de `voxtype meeting export latest -f markdown --speakers --timestamps --metadata` :
 *   # <titre>
 *   ## Meeting Info
 *   - **Date:** ...
 *   - **Word Count:** <n>
 *   - **Segments:** <n>
 *   ## Transcript
 *   ### You
 *   *[00:00]* ...
 */

import type { ExecException } from "child_process";

// Accès Node via require (runtime Electron — plugin isDesktopOnly)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFile } = require("child_process") as typeof import("child_process");

import {
  type CliError,
  type CliResult,
  classifyAvailability,
  type MeetingShowResult,
  parseMeetingShow,
} from "./voxtype-parse";

export type { CliError, CliResult, MeetingShowResult };

/** Exécute `voxtype <args>` et retourne stdout ou une CliError. */
function runVoxtype(args: string[]): Promise<CliResult<string>> {
  return new Promise((resolve) => {
    execFile(
      "voxtype",
      args,
      { encoding: "utf8", timeout: 10_000 },
      (err: ExecException | null, stdout: string, stderr: string) => {
        if (err !== null) {
          // ExecException.code peut être string (signal) ou number (code de sortie)
          const rawCode = err.code;
          const exitCode = typeof rawCode === "number" ? rawCode : null;
          resolve({
            ok: false,
            error: {
              kind: "cli-error",
              message: err.message,
              code: exitCode,
              stderr: stderr.trim(),
            },
          });
          return;
        }
        resolve({ ok: true, value: stdout });
      },
    );
  });
}

/**
 * Démarre une réunion Voxtype. Asynchrone côté daemon : rend la main immédiatement
 * sans confirmer que la réunion est active. Appeler `pollUntilActive()` ensuite.
 */
export async function startMeeting(title: string): Promise<CliResult<void>> {
  const result = await runVoxtype(["meeting", "start", "--title", title]);
  if (!result.ok) return result;
  return { ok: true, value: undefined };
}

/**
 * Arrête la réunion en cours. Asynchrone côté daemon.
 * Appeler `pollUntilCompleted()` ensuite pour attendre la fin de la transcription.
 */
export async function stopMeeting(): Promise<CliResult<void>> {
  const result = await runVoxtype(["meeting", "stop"]);
  if (!result.ok) return result;
  return { ok: true, value: undefined };
}

/**
 * Retourne l'état de la dernière réunion via `voxtype meeting show latest`.
 * Renvoie status "unknown" si aucune réunion n'existe encore.
 */
export async function showLatestMeeting(): Promise<CliResult<MeetingShowResult>> {
  const result = await runVoxtype(["meeting", "show", "latest"]);
  if (!result.ok) {
    // Pas de réunion du tout → traiter comme unknown plutôt qu'erreur fatale
    if (result.error.stderr.toLowerCase().includes("no meeting")) {
      return {
        ok: true,
        value: { status: "unknown", words: 0, segments: 0, id: null },
      };
    }
    return result;
  }

  return { ok: true, value: parseMeetingShow(result.value) };
}

/**
 * Exporte la dernière réunion en Markdown (stdout).
 * Format : `voxtype meeting export latest -f markdown --speakers --timestamps --metadata`
 */
export async function exportLatestMarkdown(): Promise<CliResult<string>> {
  return runVoxtype([
    "meeting",
    "export",
    "latest",
    "-f",
    "markdown",
    "--speakers",
    "--timestamps",
    "--metadata",
  ]);
}

/**
 * Vérifie que le daemon/CLI Voxtype est disponible en exécutant une commande légère.
 * Retourne true si disponible, false sinon (commande introuvable / daemon absent).
 */
export async function checkVoxtypeAvailable(): Promise<boolean> {
  const result = await runVoxtype(["meeting", "status"]);
  return classifyAvailability(result);
}
