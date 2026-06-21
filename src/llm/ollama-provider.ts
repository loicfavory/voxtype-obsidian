/**
 * ollama-provider.ts — Implémentation Ollama locale (/api/chat).
 *
 * Utilise `requestUrl` d'Obsidian via une `RequestFn` injectable pour rester
 * testable sans réseau.
 */

import type { LlmProvider, RequestFn } from "./provider";
import { LlmError } from "./provider";

interface OllamaProviderConfig {
  endpoint: string;
  model: string;
  requestFn: RequestFn;
}

export class OllamaProvider implements LlmProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly requestFn: RequestFn;

  constructor(config: OllamaProviderConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.model = config.model;
    this.requestFn = config.requestFn;
  }

  async generate(systemPrompt: string, userContent: string): Promise<string> {
    let response: { status: number; json: unknown; text: string };
    try {
      response = await this.requestFn({
        url: `${this.endpoint}/api/chat`,
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          stream: false,
        }),
        throw: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError("network", `Échec de connexion à Ollama : ${message}`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new LlmError("http", `Ollama a répondu HTTP ${response.status}.`);
    }

    const text = extractText(response.json);
    if (text === null) {
      throw new LlmError("malformed", "La réponse d'Ollama n'a pas le format attendu.");
    }
    if (text.trim() === "") {
      throw new LlmError("empty", "Ollama a renvoyé une réponse vide.");
    }

    return text;
  }
}

function extractText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;

  const record = data as Record<string, unknown>;
  const message = record.message;
  if (typeof message !== "object" || message === null) return null;

  const messageRecord = message as Record<string, unknown>;
  const content = messageRecord.content;
  if (typeof content !== "string") return null;

  return content;
}
