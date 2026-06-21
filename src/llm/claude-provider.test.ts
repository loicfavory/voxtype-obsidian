/**
 * claude-provider.test.ts — Tests de l'implémentation Claude avec requestFn factice.
 */

import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "./claude-provider";
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

function claudeOkResponse(text: string): { status: number; json: unknown; text: string } {
  return {
    status: 200,
    json: {
      id: "msg-test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
    },
    text: "",
  };
}

describe("ClaudeProvider", () => {
  it("renvoie le texte d'une réponse 200 bien formée", async () => {
    const { requestFn, calls } = makeFakeRequestFn(claudeOkResponse("Résumé généré"));
    const provider = new ClaudeProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
      requestFn,
    });

    const result = await provider.generate("system", "user");

    expect(result).toBe("Résumé généré");
    expect(calls).toHaveLength(1);
    const call = calls[0] as { url: string; headers: Record<string, string>; body: string };
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe("test-key");
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(call.body) as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.system).toBe("system");
    expect(body.messages).toEqual([{ role: "user", content: "user" }]);
  });

  it("lève LlmError http en cas de status non-2xx", async () => {
    const { requestFn } = makeFakeRequestFn({ status: 401, json: { error: "bad" }, text: "" });
    const provider = new ClaudeProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "http" });
  });

  it("lève LlmError malformed si le champ texte est absent", async () => {
    const { requestFn } = makeFakeRequestFn({
      status: 200,
      json: { content: [{ type: "text" }] },
      text: "",
    });
    const provider = new ClaudeProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "malformed" });
  });

  it("lève LlmError empty si la réponse est vide", async () => {
    const { requestFn } = makeFakeRequestFn(claudeOkResponse("   "));
    const provider = new ClaudeProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "empty" });
  });

  it("lève LlmError network si requestFn lève", async () => {
    const { requestFn } = makeFakeRequestFn(new Error("Network down"));
    const provider = new ClaudeProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
      requestFn,
    });

    await expect(provider.generate("s", "u")).rejects.toThrow(LlmError);
    await expect(provider.generate("s", "u")).rejects.toMatchObject({ kind: "network" });
  });
});
