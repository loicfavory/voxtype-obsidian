/**
 * recording-label.test.ts — Tests purs sans mock de la logique de marqueur.
 */

import { describe, expect, it } from "vitest";
import {
  buildEmptyMeetingText,
  buildMarkerText,
  computeFrame,
  findMarkerRange,
} from "./recording-label-pure";

describe("buildMarkerText", () => {
  it("retourne la ligne de callout exacte avec l'id brut", () => {
    const marker = buildMarkerText("1718900000000");
    expect(marker).toBe("> [!info] 🎙️ Transcription en cours… (voxtype:1718900000000)");
  });

  it("n'entoure pas l'id de chevrons", () => {
    const marker = buildMarkerText("abc123");
    expect(marker).toContain("voxtype:abc123");
    expect(marker).not.toContain("voxtype:<abc123>");
    expect(marker).not.toContain("<abc123>");
  });

  it("produit des marqueurs distincts pour des ids distincts", () => {
    const a = buildMarkerText("id-a");
    const b = buildMarkerText("id-b");
    expect(a).not.toBe(b);
  });
});

describe("findMarkerRange", () => {
  const id = "session-42";
  const marker = buildMarkerText(id);

  it("retourne les offsets de la ligne quand le marqueur est présent", () => {
    const content = `Avant\n${marker}\nAprès`;
    const range = findMarkerRange(content, id);
    expect(range).not.toBeNull();
    expect(content.slice(range!.start, range!.end)).toBe(marker);
  });

  it("retourne null quand l'id est absent", () => {
    const content = "Ligne sans marqueur.";
    expect(findMarkerRange(content, id)).toBeNull();
  });

  it("trouve le marqueur quand du texte a été ajouté avant", () => {
    const prefix = "Texte inséré au début.\n\n";
    const content = `${prefix}${marker}\nSuite`;
    const range = findMarkerRange(content, id);
    expect(range).not.toBeNull();
    expect(range!.start).toBe(prefix.length);
    expect(content.slice(range!.start, range!.end)).toBe(marker);
  });

  it("trouve le bon id parmi d'autres marqueurs ou bruit", () => {
    const other = buildMarkerText("autre-id");
    const content = `${other}\n${marker}\n> [!info] voxtype:encore-un-autre`;
    const range = findMarkerRange(content, id);
    expect(range).not.toBeNull();
    expect(content.slice(range!.start, range!.end)).toBe(marker);
  });

  it("retourne la première occurrence en cas de doublon dégénéré", () => {
    const content = `${marker}\nLigne intermédiaire\n${marker}`;
    const range = findMarkerRange(content, id);
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(content.slice(range!.start, range!.end)).toBe(marker);
  });
});

describe("computeFrame", () => {
  it("cycle correctement sur '.' / '..' / '...'", () => {
    expect(computeFrame(0)).toBe(".");
    expect(computeFrame(1)).toBe("..");
    expect(computeFrame(2)).toBe("...");
    expect(computeFrame(3)).toBe(".");
    expect(computeFrame(4)).toBe("..");
    expect(computeFrame(5)).toBe("...");
  });

  it("reste cohérent pour des ticks élevés", () => {
    expect(computeFrame(99)).toBe(computeFrame(99 % 3));
    expect(computeFrame(100)).toBe(computeFrame(100 % 3));
  });
});

describe("buildEmptyMeetingText", () => {
  it("mentionne 'Réunion sans contenu' sans chevrons", () => {
    const text = buildEmptyMeetingText();
    expect(text).toContain("Réunion sans contenu");
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });
});
