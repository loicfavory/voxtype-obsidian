/**
 * chunk-config.test.ts — Tests unitaires de la configuration de découpage.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));

import { DEFAULT_SETTINGS, type VoxtypeSettings } from "../settings";
import {
  CHUNK_DEFAULTS,
  deriveRequestTimeoutMs,
  deriveSummaryOptions,
  resolveChunkSize,
} from "./chunk-config";

function makeSettings(partial: Partial<VoxtypeSettings> = {}): VoxtypeSettings {
  return {
    provider: "none",
    claudeApiKey: "",
    claudeModel: "claude-sonnet-4-6",
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "",
    chunkSizeCharsClaude: CHUNK_DEFAULTS.claude.chunkSizeChars,
    chunkSizeCharsOllama: CHUNK_DEFAULTS.ollama.chunkSizeChars,
    ...partial,
  };
}

describe("CHUNK_DEFAULTS", () => {
  it("définit les valeurs par fournisseur attendues", () => {
    expect(CHUNK_DEFAULTS.none.chunkSizeChars).toBe(16_000);
    expect(CHUNK_DEFAULTS.ollama.chunkSizeChars).toBe(16_000);
    expect(CHUNK_DEFAULTS.claude.chunkSizeChars).toBe(120_000);
  });

  it("propage la source unique de vérité jusqu'à DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS.chunkSizeCharsClaude).toBe(CHUNK_DEFAULTS.claude.chunkSizeChars);
    expect(DEFAULT_SETTINGS.chunkSizeCharsOllama).toBe(CHUNK_DEFAULTS.ollama.chunkSizeChars);
  });
});

describe("deriveSummaryOptions", () => {
  it("expose maxChunkChars égal à la taille configurée", () => {
    const opts = deriveSummaryOptions(16_000);
    expect(opts.maxChunkChars).toBe(16_000);
  });

  it("respecte l'invariante maxChunkChars <= chunkThresholdChars", () => {
    for (const size of [1, 16_000, 120_000, 1_000_000]) {
      const opts = deriveSummaryOptions(size);
      expect(opts.maxChunkChars).toBe(size);
      expect(opts.chunkThresholdChars).toBeGreaterThanOrEqual(opts.maxChunkChars);
    }
  });

  it("dérive un timeout dans les bornes attendues", () => {
    const opts = deriveSummaryOptions(120_000);
    expect(opts.requestTimeoutMs).toBe(240_000);
    expect(opts.requestTimeoutMs).toBeLessThan(300_000);
  });
});

describe("deriveRequestTimeoutMs", () => {
  it("calcule 5 ms par caractère pour un volume moyen", () => {
    expect(deriveRequestTimeoutMs(16_000)).toBe(80_000);
  });

  it("plafonne les gros volumes à 240 000 ms", () => {
    expect(deriveRequestTimeoutMs(120_000)).toBe(240_000);
    expect(deriveRequestTimeoutMs(1_000_000)).toBe(240_000);
  });

  it("planchonne les petits volumes à 60 000 ms", () => {
    expect(deriveRequestTimeoutMs(0)).toBe(60_000);
    expect(deriveRequestTimeoutMs(100)).toBe(60_000);
    expect(deriveRequestTimeoutMs(12_000)).toBe(60_000);
  });

  it("reste toujours dans [60_000, 240_000] et sous le timeout global", () => {
    for (const chars of [0, 100, 12_000, 16_000, 50_000, 120_000, 1_000_000]) {
      const timeout = deriveRequestTimeoutMs(chars);
      expect(timeout).toBeGreaterThanOrEqual(60_000);
      expect(timeout).toBeLessThanOrEqual(240_000);
      expect(timeout).toBeLessThan(300_000);
    }
  });
});

describe("resolveChunkSize", () => {
  it("retourne la valeur Claude quand le fournisseur est Claude", () => {
    const settings = makeSettings({ chunkSizeCharsClaude: 42_000 });
    expect(resolveChunkSize(settings, "claude")).toBe(42_000);
  });

  it("retourne la valeur Ollama quand le fournisseur est Ollama", () => {
    const settings = makeSettings({ chunkSizeCharsOllama: 8_000 });
    expect(resolveChunkSize(settings, "ollama")).toBe(8_000);
  });

  it("ignore la valeur Ollama pour le fournisseur Claude", () => {
    const settings = makeSettings({
      chunkSizeCharsClaude: 100_000,
      chunkSizeCharsOllama: 8_000,
    });
    expect(resolveChunkSize(settings, "claude")).toBe(100_000);
  });

  it("ignore la valeur Claude pour le fournisseur Ollama", () => {
    const settings = makeSettings({
      chunkSizeCharsClaude: 100_000,
      chunkSizeCharsOllama: 8_000,
    });
    expect(resolveChunkSize(settings, "ollama")).toBe(8_000);
  });

  it("retombe sur le défaut si la valeur est absente", () => {
    const settings = makeSettings({ chunkSizeCharsClaude: undefined as unknown as number });
    expect(resolveChunkSize(settings, "claude")).toBe(CHUNK_DEFAULTS.claude.chunkSizeChars);
  });

  it("retombe sur le défaut si la valeur vaut 0", () => {
    const settings = makeSettings({ chunkSizeCharsOllama: 0 });
    expect(resolveChunkSize(settings, "ollama")).toBe(CHUNK_DEFAULTS.ollama.chunkSizeChars);
  });

  it("retombe sur le défaut si la valeur est négative", () => {
    const settings = makeSettings({ chunkSizeCharsClaude: -5_000 });
    expect(resolveChunkSize(settings, "claude")).toBe(CHUNK_DEFAULTS.claude.chunkSizeChars);
  });

  it("retombe sur le défaut si la valeur est NaN", () => {
    const settings = makeSettings({ chunkSizeCharsOllama: Number.NaN });
    expect(resolveChunkSize(settings, "ollama")).toBe(CHUNK_DEFAULTS.ollama.chunkSizeChars);
  });
});
