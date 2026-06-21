/**
 * chunk-config.ts — Configuration du découpage par fournisseur LLM.
 *
 * Logique pure : aucun import Obsidian/Node, testable sans mock.
 * Un seul nombre est exposé à l'utilisateur (chunkSizeChars) ; le seuil de
 * bascule map-reduce et le timeout par appel sont dérivés de ce nombre.
 */

import type { LlmProviderKind, VoxtypeSettings } from "../settings";
import type { SummaryOptions } from "./summary";

/** Configuration de découpage propre à un fournisseur. */
export interface ChunkConfig {
  /** Taille cible d'un chunk en caractères = unique nombre exposé à l'utilisateur. */
  chunkSizeChars: number;
}

/**
 * Défauts PAR fournisseur, indexés sur l'union `LlmProviderKind`.
 * En utilisant `Record<LlmProviderKind, ChunkConfig>`, ajouter un fournisseur à
 * l'union SANS l'ajouter ici provoque une ERREUR DE COMPILATION TS (exigence US-03).
 * `none` n'appelle jamais de LLM mais doit exister pour satisfaire le Record :
 * lui donner une valeur prudente (ex. = défaut Ollama).
 */
export const CHUNK_DEFAULTS: Record<LlmProviderKind, ChunkConfig> = {
  none: { chunkSizeChars: 16_000 },
  ollama: { chunkSizeChars: 16_000 },
  claude: { chunkSizeChars: 120_000 },
};

/** Borne inférieure du timeout par appel LLM (ms). */
const REQUEST_TIMEOUT_MIN_MS = 60_000;

/** Borne supérieure du timeout par appel LLM (ms). */
const REQUEST_TIMEOUT_MAX_MS = 240_000;

/**
 * Sélectionne la taille de chunk du fournisseur actif.
 * Retombe sur le défaut si la valeur persistée est absente, 0, négative ou NaN.
 *
 * Cette fonction constitue une 2e barrière de compilation : sa logique de
 * sélection par fournisseur (`provider === 'claude'` / `provider === 'ollama'`)
 * ne couvrirait pas un nouveau membre ajouté à l'union `LlmProviderKind` sans
 * y être aussi référencé. Combinée au `Record<LlmProviderKind, ChunkConfig>`
 * de `CHUNK_DEFAULTS`, tout fournisseur ajouté à l'union et oublié ici provoque
 * une erreur de compilation, forçant sa déclaration explicite.
 */
export function resolveChunkSize(settings: VoxtypeSettings, provider: LlmProviderKind): number {
  const raw =
    provider === "claude"
      ? settings.chunkSizeCharsClaude
      : provider === "ollama"
        ? settings.chunkSizeCharsOllama
        : undefined;

  const value = typeof raw === "number" && !Number.isNaN(raw) && raw > 0 ? raw : undefined;
  return value ?? CHUNK_DEFAULTS[provider].chunkSizeChars;
}

/**
 * Timeout interne par appel LLM, dérivé du volume de caractères réellement envoyé.
 * Formule : clamp(perCallChars * 5, 60_000, 240_000).
 */
export function deriveRequestTimeoutMs(perCallChars: number): number {
  return Math.min(Math.max(perCallChars * 5, REQUEST_TIMEOUT_MIN_MS), REQUEST_TIMEOUT_MAX_MS);
}

/**
 * Dérive des SummaryOptions complets à partir de l'unique nombre « taille de chunk ».
 * Invariante garantie : maxChunkChars <= chunkThresholdChars (égalité ici).
 */
export function deriveSummaryOptions(chunkSizeChars: number): SummaryOptions {
  return {
    maxChunkChars: chunkSizeChars,
    chunkThresholdChars: chunkSizeChars,
    requestTimeoutMs: deriveRequestTimeoutMs(chunkSizeChars),
  };
}
