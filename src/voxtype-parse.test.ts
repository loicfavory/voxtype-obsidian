import { describe, it, expect } from "vitest";
import { classifyAvailability, parseMeetingShow, type MeetingShowResult } from "./voxtype-parse";

const sampleShowOutput = `Réunion du 20/06/26 à 14:30
=============
ID:       550e8400-e29b-41d4-a716-446655440000
Started:  2026-06-20 18:37 UTC
Ended:    2026-06-20 18:39 UTC
Duration: 2m 2s
Status:   Completed
Chunks:   8

Transcript:
-----------
Segments: 4
Words:    99
Speakers: You
`;

describe("parseMeetingShow", () => {
  it("parses a complete output", () => {
    expect(parseMeetingShow(sampleShowOutput)).toEqual({
      status: "completed",
      words: 99,
      segments: 4,
      id: "550e8400-e29b-41d4-a716-446655440000",
    } satisfies MeetingShowResult);
  });

  it("normalizes status to lowercase", () => {
    expect(parseMeetingShow("Status: ACTIVE")).toEqual({
      status: "active",
      words: 0,
      segments: 0,
      id: null,
    } satisfies MeetingShowResult);

    expect(parseMeetingShow("Status: Paused")).toEqual({
      status: "paused",
      words: 0,
      segments: 0,
      id: null,
    } satisfies MeetingShowResult);
  });

  it("returns unknown for unrecognized statuses", () => {
    expect(parseMeetingShow("Status: Transcribing")).toEqual({
      status: "unknown",
      words: 0,
      segments: 0,
      id: null,
    } satisfies MeetingShowResult);
  });

  it("defaults words and segments to 0 when absent", () => {
    expect(parseMeetingShow("Status: Completed")).toEqual({
      status: "completed",
      words: 0,
      segments: 0,
      id: null,
    } satisfies MeetingShowResult);
  });

  it("defaults id to null when absent", () => {
    expect(parseMeetingShow("Status: Completed\nWords: 10\nSegments: 2")).toEqual({
      status: "completed",
      words: 10,
      segments: 2,
      id: null,
    } satisfies MeetingShowResult);
  });

  it("returns defaults for empty output", () => {
    expect(parseMeetingShow("")).toEqual({
      status: "unknown",
      words: 0,
      segments: 0,
      id: null,
    } satisfies MeetingShowResult);
  });

  it("handles multiple spaces between label and value", () => {
    expect(parseMeetingShow("Status:\t Completed\nWords:\t\t 42\nSegments:  3")).toEqual({
      status: "completed",
      words: 42,
      segments: 3,
      id: null,
    } satisfies MeetingShowResult);
  });

  it("parses Words: 0 correctly", () => {
    expect(parseMeetingShow("Status: Completed\nWords: 0\nSegments: 0")).toEqual({
      status: "completed",
      words: 0,
      segments: 0,
      id: null,
    } satisfies MeetingShowResult);
  });
});

describe("classifyAvailability", () => {
  it("returns true for a successful result", () => {
    expect(classifyAvailability({ ok: true, value: "No meeting currently in progress." })).toBe(
      true,
    );
  });

  it("returns false when the binary is missing (ENOENT)", () => {
    expect(
      classifyAvailability({
        ok: false,
        error: {
          kind: "cli-error",
          message: "spawn voxtype ENOENT",
          code: null,
          stderr: "",
        },
      }),
    ).toBe(false);
  });

  it("returns true for any other error (binary exists but daemon is unreachable)", () => {
    expect(
      classifyAvailability({
        ok: false,
        error: {
          kind: "cli-error",
          message: "Connection refused",
          code: 1,
          stderr: "Connection refused",
        },
      }),
    ).toBe(true);
  });
});
