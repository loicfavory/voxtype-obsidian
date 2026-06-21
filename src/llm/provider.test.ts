/**
 * provider.test.ts — Tests de la résolution du fournisseur LLM.
 */

import { describe, expect, it } from "vitest";
import { resolveProvider, type RequestFn } from "./provider";
import { ClaudeProvider } from "./claude-provider";
import { OllamaProvider } from "./ollama-provider";
import { CHUNK_DEFAULTS } from "./chunk-config";
import type { VoxtypeSettings } from "../settings";

const fakeRequestFn: RequestFn = async () => ({
  status: 200,
  json: {},
  text: "",
});

const baseSettings: VoxtypeSettings = {
  provider: "none",
  claudeApiKey: "",
  claudeModel: "claude-sonnet-4-6",
  ollamaEndpoint: "http://localhost:11434",
  ollamaModel: "",
  chunkSizeCharsClaude: CHUNK_DEFAULTS.claude.chunkSizeChars,
  chunkSizeCharsOllama: CHUNK_DEFAULTS.ollama.chunkSizeChars,
};

describe("resolveProvider", () => {
  it("renvoie null quand provider = none", () => {
    expect(resolveProvider(baseSettings, fakeRequestFn)).toBeNull();
  });

  it("renvoie null pour Claude sans clé API", () => {
    const settings: VoxtypeSettings = { ...baseSettings, provider: "claude" };
    expect(resolveProvider(settings, fakeRequestFn)).toBeNull();
  });

  it("renvoie une instance Claude quand configurée", () => {
    const settings: VoxtypeSettings = {
      ...baseSettings,
      provider: "claude",
      claudeApiKey: "sk-test",
    };
    const provider = resolveProvider(settings, fakeRequestFn);
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it("renvoie null pour Ollama sans modèle", () => {
    const settings: VoxtypeSettings = { ...baseSettings, provider: "ollama" };
    expect(resolveProvider(settings, fakeRequestFn)).toBeNull();
  });

  it("renvoie une instance Ollama quand configurée", () => {
    const settings: VoxtypeSettings = {
      ...baseSettings,
      provider: "ollama",
      ollamaModel: "llama3",
    };
    const provider = resolveProvider(settings, fakeRequestFn);
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it("ignore les espaces autour de la clé et du modèle", () => {
    const settings: VoxtypeSettings = {
      ...baseSettings,
      provider: "claude",
      claudeApiKey: "  sk-test  ",
    };
    expect(resolveProvider(settings, fakeRequestFn)).toBeInstanceOf(ClaudeProvider);
  });
});
