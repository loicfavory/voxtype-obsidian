import { describe, it, expect } from "vitest";
import {
  buildTimestampedTitle,
  buildWikilink,
  clampOffset,
  sanitizeFileName,
} from "./meeting-utils";

describe("buildTimestampedTitle", () => {
  it("formats a typical date", () => {
    expect(buildTimestampedTitle(new Date(2026, 5, 20, 14, 30))).toBe(
      "Réunion du 20/06/26 à 14:30",
    );
  });

  it("pads single-digit day, month, hours and minutes", () => {
    expect(buildTimestampedTitle(new Date(2026, 0, 5, 9, 5))).toBe("Réunion du 05/01/26 à 09:05");
  });

  it("handles midnight", () => {
    expect(buildTimestampedTitle(new Date(2026, 0, 5, 0, 0))).toBe("Réunion du 05/01/26 à 00:00");
  });

  it("handles the end of the year", () => {
    expect(buildTimestampedTitle(new Date(2029, 11, 31, 23, 59))).toBe(
      "Réunion du 31/12/29 à 23:59",
    );
  });

  it("keeps only the last two digits of the year", () => {
    expect(buildTimestampedTitle(new Date(2100, 0, 1, 0, 0))).toBe("Réunion du 01/01/00 à 00:00");
  });
});

describe("sanitizeFileName", () => {
  it("replaces / with - and : with h", () => {
    expect(sanitizeFileName("Réunion du 20/06/26 à 14:30")).toBe("Réunion du 20-06-26 à 14h30");
  });

  it("replaces multiple slashes globally", () => {
    expect(sanitizeFileName("a/b/c")).toBe("a-b-c");
  });

  it("replaces multiple colons globally", () => {
    expect(sanitizeFileName("10:30:00")).toBe("10h30h00");
  });

  it("returns an empty string unchanged", () => {
    expect(sanitizeFileName("")).toBe("");
  });

  it("is idempotent", () => {
    const once = sanitizeFileName("Réunion du 20/06/26 à 14:30");
    expect(sanitizeFileName(once)).toBe(once);
  });

  it("handles combined slashes and colons", () => {
    expect(sanitizeFileName("2026/06/20 14:30")).toBe("2026-06-20 14h30");
  });
});

describe("buildWikilink", () => {
  it("builds a wikilink with folder, basename and display title", () => {
    expect(buildWikilink("Transcripts", "2026-06-20 14h30", "Réunion du 20/06/26 à 14:30")).toBe(
      "\n\n[[Transcripts/2026-06-20 14h30|Réunion du 20/06/26 à 14:30]]\n",
    );
  });

  it("produces a malformed link when the title contains a pipe", () => {
    // Documented limitation : a `|` in the display title breaks Obsidian wikilink syntax.
    expect(buildWikilink("Transcripts", "base", "A | B")).toBe("\n\n[[Transcripts/base|A | B]]\n");
  });
});

describe("clampOffset", () => {
  it("returns the offset when it is within bounds", () => {
    expect(clampOffset(50, 100)).toBe(50);
  });

  it("clamps the offset to max when it exceeds it", () => {
    expect(clampOffset(150, 100)).toBe(100);
  });

  it("returns 0 when both offset and max are 0", () => {
    expect(clampOffset(0, 0)).toBe(0);
  });

  it("returns 0 for a zero offset", () => {
    expect(clampOffset(0, 100)).toBe(0);
  });

  it("clamps a negative offset to 0", () => {
    expect(clampOffset(-10, 100)).toBe(0);
  });
});
