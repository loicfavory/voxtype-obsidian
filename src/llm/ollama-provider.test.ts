/**
 * ollama-provider.test.ts — Tests de l'implémentation Ollama avec requestFn factice.
 */

import { describe, expect, it } from "vitest";
import { OllamaProvider } from "./ollama-provider";
import { LlmError, type RequestFn } from "./provider";

function makeFakeRequestFn(response: { status: number; json: unknown; text: string } | Error): {
  requestFn: RequestFn;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const requestFn: RequestFn = async (options) => {
    calls.push(options);
    if (response instanceof Error) throw response;
    return response;
  };
  return { requestFn, calls };
}

function ollamaOkResponse(text: string): { status: number; json: unknown; text: string } {
  return {
    status: 200,
    json: {
      model: "llama3",
      message: { role: "assistant", content: text },
      done: true,
    },
    text: "",
  };
}

describe("OllamaProvider", () => {
  it("renvoie le texte d'une réponse 200 bien formée", async () => {
    const { requestFn, calls } = makeFakeRequestFn(ollamaOkResponse("Résumé local"));
    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "llama3",
      requestFn,
    });

    const result = await provider.generate("system", "user");

    expect(result).toBe("Résumé local");
    expect(calls).toHaveLength(1);
    const call = calls[0] as { url: string; body: string };
    expect(call.url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(call.body) as Record<string, unknown>;
    expect(body.model).toBe("llama3");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "user" },
    ]);
  });

  it("supprime le slash final de l'endpoint", async () => {
    const { requestFn, calls } = makeFakeRequestFn(ollamaOkResponse("ok"));
    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434/",
      model: "llama3",
      requestFn,
    });

    await provider.generate("s", "u");

    const call = calls[0] as { url: string };
    expect(call.url).toBe("http://localhost:11434/api/chat");
  });

  it("lève LlmError http en cas de status non-2xx", async () => {
    const { requestFn } = makeFakeRequestFn({ status: 500, json: { error: "bad" }, text: "" });
    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "llama3",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "http" });
  });

  it("lève LlmError malformed si message.content est absent", async () => {
    const { requestFn } = makeFakeRequestFn({ status: 200, json: { message: {} }, text: "" });
    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "llama3",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "malformed" });
  });

  it("lève LlmError empty si la réponse est vide", async () => {
    const { requestFn } = makeFakeRequestFn(ollamaOkResponse("   "));
    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "llama3",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "empty" });
  });

  it("lève LlmError network si requestFn lève", async () => {
    const { requestFn } = makeFakeRequestFn(new Error("Ollama offline"));
    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "llama3",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "network" });
  });
});
