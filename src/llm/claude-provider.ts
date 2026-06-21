/**
 * claude-provider.ts — Implémentation Claude (Anthropic Messages API).
 *
 * Utilise `requestUrl` d'Obsidian via une `RequestFn` injectable pour rester
 * testable sans réseau.
 */

import type { LlmProvider, RequestFn } from "./provider";
import { LlmError } from "./provider";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;

interface ClaudeProviderConfig {
  apiKey: string;
  model: string;
  requestFn: RequestFn;
}

export class ClaudeProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly requestFn: RequestFn;

  constructor(config: ClaudeProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.requestFn = config.requestFn;
  }

  async generate(systemPrompt: string, userContent: string): Promise<string> {
    let response: { status: number; json: unknown; text: string };
    try {
      response = await this.requestFn({
        url: ANTHROPIC_API_URL,
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError("network", `Échec de connexion à l'API Claude : ${message}`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new LlmError("http", `Claude a répondu HTTP ${response.status}.`);
    }

    const text = extractText(response.json);
    if (text === null) {
      throw new LlmError("malformed", "La réponse de Claude n'a pas le format attendu.");
    }
    if (text.trim() === "") {
      throw new LlmError("empty", "Claude a renvoyé une réponse vide.");
    }

    return text;
  }
}

function extractText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;

  const record = data as Record<string, unknown>;
  const content = record.content;
  if (!Array.isArray(content) || content.length === 0) return null;

  const first = content[0];
  if (typeof first !== "object" || first === null) return null;

  const firstRecord = first as Record<string, unknown>;
  if (firstRecord.type !== "text") return null;

  const text = firstRecord.text;
  if (typeof text !== "string") return null;

  return text;
}
