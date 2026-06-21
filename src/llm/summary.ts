/**
 * summary.ts — Logique pure de génération du compte rendu de réunion.
 *
 * Aucun import Obsidian/Node : testable sans mock. L'appel réseau est injecté
 * via l'interface `LlmProvider`.
 */

import type { LlmProvider } from "./provider";
import { LlmError } from "./provider";

/** Prompt système figé imposant la structure verrouillée en français. */
export const SYSTEM_PROMPT = `Tu es un assistant de rédaction de compte rendu de réunion.
Tu reçois un transcript de réunion dont les locuteurs sont introduits par des en-têtes du type "### You", "### Remote", "### SPEAKER_00", "### SPEAKER_01", etc.
Le label "You" désigne le canal micro, c'est-à-dire l'utilisateur : nomme-le "Vous" dans le compte rendu.
Les autres labels ("Remote", "SPEAKER_00", "SPEAKER_01"…) peuvent couvrir une ou plusieurs personnes distinctes : déduis le nombre réel de personnes distinctes à partir du dialogue et nomme-les "Pers1", "Pers2", "Pers3"… dans l'ordre d'apparition de leurs premières interventions.

Réponds UNIQUEMENT en français, en Markdown, avec EXACTEMENT les sections suivantes dans CET ORDRE, sans rien ajouter avant la première section ni après la dernière :

## Interlocuteurs
Liste des participants : "Vous" puis "Pers1", "Pers2"…

## Résumé court
Les idées-forces, en liste à puces commençant par "- ".

## Description complète
Déroulé détaillé de la réunion. Mets en avant les temps forts.

## Actions à mener
Liste des actions à mener, chacune sous forme de case à cocher : "- [ ] …".

## Conclusion
Points focus, difficultés signalées ou sujets à lever.`;

/** Prompt de synthèse map-reduce : fusionne plusieurs résumés partiels. */
export const MAP_REDUCE_SYSTEM_PROMPT = `Tu es un assistant de rédaction de compte rendu de réunion.
Tu reçois plusieurs comptes rendus partiels d'une même réunion, correspondant à des tranches chronologiques successives.
Fusionne-les en UN SEUL compte rendu cohérent, en éliminant les redondances et en respectant STRICTEMENT la structure suivante, en français, sans rien ajouter avant la première section ni après la dernière :

## Interlocuteurs
Liste des participants : "Vous" puis "Pers1", "Pers2"…

## Résumé court
Les idées-forces, en liste à puces commençant par "- ".

## Description complète
Déroulé détaillé de la réunion. Mets en avant les temps forts.

## Actions à mener
Liste des actions à mener, chacune sous forme de case à cocher : "- [ ] …".

## Conclusion
Points focus, difficultés signalées ou sujets à lever.`;

/** Options de la génération de compte rendu. */
export interface SummaryOptions {
  /** Seuil au-delà duquel on passe en map-reduce (caractères). */
  chunkThresholdChars: number;
  /** Taille maximale d'un chunk (caractères). */
  maxChunkChars: number;
  /**
   * Timeout par appel LLM en ms.
   * Ce champ n'était pas dans le brief initial mais appartient logiquement aux options.
   */
  requestTimeoutMs: number;
}

/** Valeurs par défaut des options.
 *
 * Les seuils sont volontairement prudents : on découpe avant d'atteindre la
 * fenêtre de contexte, tout en laissant de la marge pour le prompt système.
 */
export const DEFAULT_SUMMARY_OPTIONS: SummaryOptions = {
  chunkThresholdChars: 24_000,
  maxChunkChars: 16_000,
  requestTimeoutMs: 60_000,
};

/** Estimation grossière de la taille en "tokens" (≈ 1 token / 4 caractères). */
export function estimateSize(transcript: string): number {
  return Math.ceil(transcript.length / 4);
}

/** Indique si le transcript dépasse le seuil et nécessite un découpage. */
export function needsChunking(transcript: string, threshold: number): boolean {
  return transcript.length > threshold;
}

/**
 * Découpe un transcript en chunks sans casser de segment de locuteur.
 *
 * - Coupe d'abord sur les frontières `### <locuteur>`.
 * - Si un bloc dépasse `maxChunkChars` à lui seul, il est découpé par lignes.
 * - Retourne `[]` pour un transcript vide.
 */
export function splitTranscript(transcript: string, maxChunkChars: number): string[] {
  if (transcript === "") return [];

  const blocks = transcript.split(/(?=^### )/m).filter((block) => block !== "");
  const chunks: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current !== "") {
      chunks.push(current);
      current = "";
    }
  };

  for (const block of blocks) {
    if (block.length > maxChunkChars) {
      flush();
      const lines = block.split("\n");
      for (const line of lines) {
        if (current.length + line.length + 1 > maxChunkChars && current !== "") {
          chunks.push(current);
          current = line;
        } else {
          current = current === "" ? line : `${current}\n${line}`;
        }
      }
      continue;
    }

    if (current.length + block.length > maxChunkChars && current !== "") {
      chunks.push(current);
      current = block;
    } else {
      current = current === "" ? block : `${current}\n${block}`;
    }
  }

  flush();
  return chunks;
}

/** Assemble le message utilisateur envoyé au LLM. */
export function buildSummaryUserContent(transcript: string): string {
  return transcript;
}

/**
 * Assemble le compte rendu final : sortie du LLM + wikilink terminal.
 * Garantit que le lien termine le bloc injecté.
 */
export function assembleFinalSummary(llmOutput: string, wikilink: string): string {
  const trimmed = llmOutput.trim();
  if (trimmed === "") return wikilink;
  return `${trimmed}${wikilink}`;
}

/**
 * Génère le compte rendu d'un transcript.
 *
 * - Chemin simple : un seul appel LLM si le transcript est court.
 * - Chemin map-reduce : résume chaque chunk, puis synthétise les résumés.
 *
 * Renvoie le compte rendu SANS le wikilink (celui-ci est ajouté par l'appelant).
 */
export async function generateSummary(
  provider: LlmProvider,
  transcript: string,
  opts: SummaryOptions = DEFAULT_SUMMARY_OPTIONS,
): Promise<string> {
  const chunks = splitTranscript(transcript, opts.maxChunkChars);
  if (chunks.length === 0) {
    return "";
  }

  if (chunks.length === 1 || !needsChunking(transcript, opts.chunkThresholdChars)) {
    return await withTimeout(
      provider.generate(SYSTEM_PROMPT, buildSummaryUserContent(transcript)),
      opts.requestTimeoutMs,
    );
  }

  const partialSummaries: string[] = [];
  for (const chunk of chunks) {
    const partial = await withTimeout(
      provider.generate(SYSTEM_PROMPT, buildSummaryUserContent(chunk)),
      opts.requestTimeoutMs,
    );
    partialSummaries.push(partial);
  }

  const synthesisContent = partialSummaries
    .map((summary, index) => `### Partie ${index + 1}\n\n${summary}`)
    .join("\n\n");

  return await withTimeout(
    provider.generate(MAP_REDUCE_SYSTEM_PROMPT, synthesisContent),
    opts.requestTimeoutMs,
  );
}

/** Enrobe une promesse avec un timeout ; rejette `LlmError("timeout")` au-delà. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    id = setTimeout(() => {
      reject(new LlmError("timeout", `Délai de ${ms} ms dépassé.`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (id !== undefined) clearTimeout(id);
  });
}
