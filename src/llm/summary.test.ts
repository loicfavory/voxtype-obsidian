/**
 * summary.test.ts — Tests unitaires de la logique pure de génération de compte rendu.
 */

import { describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "./provider";
import {
  MAP_REDUCE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  assembleFinalSummary,
  buildSummaryUserContent,
  estimateSize,
  generateSummary,
  needsChunking,
  splitTranscript,
  withTimeout,
} from "./summary";

const SAMPLE_TRANSCRIPT = `# Réunion test
## Meeting Info
- **Date:** 2026-06-21
- **Word Count:** 12
- **Segments:** 2
## Transcript
### You
*[00:00]* Bonjour
### Remote
*[00:01]* Salut`;

const SAMPLE_SUMMARY = `## Interlocuteurs
Vous, Pers1

## Résumé court
- Échange de salutations

## Description complète
Vous dites bonjour, Remote répond salut.

## Actions à mener
- [ ] Suivre la discussion

## Conclusion
Rien de spécial.`;

function makeTranscriptOfLength(length: number): string {
  return "### You\n*[00:00]* " + "mot ".repeat(length);
}

function createFakeProvider(): {
  provider: LlmProvider;
  calls: { systemPrompt: string; userContent: string }[];
} {
  const calls: { systemPrompt: string; userContent: string }[] = [];
  const provider: LlmProvider = {
    async generate(systemPrompt: string, userContent: string): Promise<string> {
      calls.push({ systemPrompt, userContent });
      return SAMPLE_SUMMARY;
    },
  };
  return { provider, calls };
}

describe("estimateSize", () => {
  it("approxime le nombre de tokens", () => {
    expect(estimateSize("")).toBe(0);
    expect(estimateSize("abcd")).toBe(1);
    expect(estimateSize("abcdefghijklmnop")).toBe(4);
  });
});

describe("needsChunking", () => {
  it("renvoie false sous le seuil", () => {
    expect(needsChunking("abc", 10)).toBe(false);
  });

  it("renvoie true au-dessus du seuil", () => {
    expect(needsChunking("abc", 2)).toBe(true);
  });
});

describe("splitTranscript", () => {
  it("renvoie une liste vide pour un transcript vide", () => {
    expect(splitTranscript("", 1000)).toEqual([]);
  });

  it("renvoie un seul chunk pour un transcript court", () => {
    const chunks = splitTranscript(SAMPLE_TRANSCRIPT, 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("### You");
    expect(chunks[0]).toContain("### Remote");
    expect(chunks[0]).toContain("Bonjour");
    expect(chunks[0]).toContain("Salut");
  });

  it("découpe sur les frontières de locuteur sans casser de bloc", () => {
    const t = "### A\nline1\nline2\n### B\nline3\nline4\n### C\nline5\nline6";
    const chunks = splitTranscript(t, 40);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      // Aucun chunk ne commence au milieu d'un bloc ### (sauf le premier)
      if (chunk.startsWith("### ")) {
        const header = chunk.split("\n")[0];
        expect(header).toMatch(/^### (A|B|C)$/);
      }
    }
  });

  it("découpe un bloc surdimensionné par lignes", () => {
    const t = "### A\n" + "x".repeat(100);
    const chunks = splitTranscript(t, 50);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join("\n")).toBe(t);
  });
});

describe("buildSummaryUserContent", () => {
  it("inclut le transcript tel quel", () => {
    expect(buildSummaryUserContent(SAMPLE_TRANSCRIPT)).toBe(SAMPLE_TRANSCRIPT);
  });
});

describe("assembleFinalSummary", () => {
  it("termine le bloc par le wikilink fourni", () => {
    const link = "\n\n[[Transcripts/Réunion|Réunion]]\n";
    const result = assembleFinalSummary(SAMPLE_SUMMARY, link);
    expect(result.endsWith(link)).toBe(true);
  });

  it("supprime les espaces superflus en fin de sortie LLM", () => {
    const link = "\n\n[[Lien]]\n";
    const result = assembleFinalSummary("  " + SAMPLE_SUMMARY + "  ", link);
    expect(result).toBe(SAMPLE_SUMMARY + link);
  });

  it("renvoie seulement le lien si la sortie LLM est vide", () => {
    const link = "\n\n[[Lien]]\n";
    expect(assembleFinalSummary("", link)).toBe(link);
  });
});

describe("generateSummary", () => {
  it("fait un seul appel LLM pour un transcript court", async () => {
    const { provider, calls } = createFakeProvider();
    const result = await generateSummary(provider, SAMPLE_TRANSCRIPT);

    expect(calls).toHaveLength(1);
    expect(calls[0].systemPrompt).toBe(SYSTEM_PROMPT);
    expect(calls[0].userContent).toBe(SAMPLE_TRANSCRIPT);
    expect(result).toBe(SAMPLE_SUMMARY);
  });

  it("utilise le map-reduce quand le transcript dépasse le seuil", async () => {
    const { provider, calls } = createFakeProvider();
    const longTranscript = makeTranscriptOfLength(6_000);
    const opts = { chunkThresholdChars: 1_000, maxChunkChars: 2_000, requestTimeoutMs: 5_000 };

    const result = await generateSummary(provider, longTranscript, opts);

    expect(result).toBe(SAMPLE_SUMMARY);
    // Plusieurs appels : au moins 2 résumés partiels + 1 synthèse
    expect(calls.length).toBeGreaterThanOrEqual(3);

    // Les premiers appels utilisent le prompt principal ; le dernier le prompt de synthèse
    const lastCall = calls[calls.length - 1];
    expect(lastCall.systemPrompt).toBe(MAP_REDUCE_SYSTEM_PROMPT);
    expect(lastCall.userContent).toContain("Partie 1");
  });

  it("respecte le timeout par appel", async () => {
    const slowProvider: LlmProvider = {
      async generate(): Promise<string> {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return SAMPLE_SUMMARY;
      },
    };

    const opts = {
      chunkThresholdChars: 1_000,
      maxChunkChars: 2_000,
      requestTimeoutMs: 50,
    };

    await expect(generateSummary(slowProvider, SAMPLE_TRANSCRIPT, opts)).rejects.toThrow("Délai");
  });
});

describe("withTimeout", () => {
  it("annule le timer si la promesse résout avant l'expiration", async () => {
    vi.useFakeTimers();

    try {
      const promise = withTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 50)),
        100,
      );

      vi.advanceTimersByTime(50);
      await expect(promise).resolves.toBe("ok");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
