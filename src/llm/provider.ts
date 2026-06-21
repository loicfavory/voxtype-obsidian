/**
 * provider.ts — Contrat d'abstraction des fournisseurs de LLM.
 *
 * Logique pure : aucun appel réseau direct. Le choix du fournisseur effectif
 * (Claude, Ollama, ou aucun) est décidé ici à partir des réglages utilisateur.
 */

import type { VoxtypeSettings } from "../settings";
import { ClaudeProvider } from "./claude-provider";
import { OllamaProvider } from "./ollama-provider";

/** Contrat commun pour tous les fournisseurs de LLM. */
export interface LlmProvider {
  /** Envoie le prompt système + le contenu utilisateur, renvoie le texte brut du LLM. */
  generate(systemPrompt: string, userContent: string): Promise<string>;
}

/** Catégories d'erreur homogénéisées pour tous les fournisseurs. */
export type LlmErrorKind = "network" | "http" | "malformed" | "timeout" | "empty";

/** Erreur levée par les providers en cas d'échec. */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "LlmError";
  }
}

/** Type injectable pour découpler les providers de `obsidian.requestUrl` (tests sans réseau). */
export type RequestFn = (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  contentType?: string;
  throw?: boolean;
}) => Promise<{ status: number; json: unknown; text: string }>;

/** Décide du fournisseur effectif. null = repli US-02a (aucun LLM exploitable). */
export function resolveProvider(
  settings: VoxtypeSettings,
  requestFn: RequestFn,
): LlmProvider | null {
  switch (settings.provider) {
    case "claude": {
      const key = settings.claudeApiKey.trim();
      if (key === "") return null;
      return new ClaudeProvider({ apiKey: key, model: settings.claudeModel, requestFn });
    }
    case "ollama": {
      const model = settings.ollamaModel.trim();
      if (model === "") return null;
      return new OllamaProvider({
        endpoint: settings.ollamaEndpoint.trim(),
        model,
        requestFn,
      });
    }
    case "none":
    default:
      return null;
  }
}
