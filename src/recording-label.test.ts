/**
 * recording-label.test.ts — Tests purs sans mock de la logique de marqueur.
 */

import { describe, expect, it } from "vitest";
import {
  buildEmptyMeetingText,
  buildMarkerReplacement,
  buildMarkerText,
  computeFrame,
  findMarkerBlockRange,
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

describe("findMarkerBlockRange", () => {
  const id = "session-42";
  const marker = buildMarkerText(id);

  it("englobe les sauts de ligne encadrants insérés par insertMarker", () => {
    const content = `Avant\n\n${marker}\n\nAprès`;
    const range = findMarkerBlockRange(content, id);
    expect(range).not.toBeNull();
    expect(range!.start).toBe("Avant".length);
    expect(range!.end).toBe(content.length - "Après".length);
    expect(content.slice(range!.start, range!.end)).toBe(`\n\n${marker}\n\n`);
  });

  it("fonctionne en début de note", () => {
    const content = `${marker}\n\nAprès`;
    const range = findMarkerBlockRange(content, id);
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(content.slice(range!.start, range!.end)).toBe(`${marker}\n\n`);
  });

  it("fonctionne en fin de note", () => {
    const content = `Avant\n\n${marker}`;
    const range = findMarkerBlockRange(content, id);
    expect(range).not.toBeNull();
    expect(range!.end).toBe(content.length);
    expect(content.slice(range!.start, range!.end)).toBe(`\n\n${marker}`);
  });

  it("retombe sur la ligne seule si le padding est absent", () => {
    const content = `Avant\n${marker}\nAprès`;
    const range = findMarkerBlockRange(content, id);
    expect(range).not.toBeNull();
    expect(content.slice(range!.start, range!.end)).toBe(`${marker}`);
  });

  it("retourne null si l'id est absent", () => {
    expect(findMarkerBlockRange("Aucun marqueur", id)).toBeNull();
  });
});

describe("buildEmptyMeetingText", () => {
  it("retourne exactement la mention 'Réunion sans contenu' sans chevrons", () => {
    const text = buildEmptyMeetingText();
    expect(text).toBe("Réunion sans contenu");
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });
});

describe("buildMarkerReplacement", () => {
  const id = "session-42";
  const marker = buildMarkerText(id);

  it("efface le marqueur en fin de note sans laisser de double saut de ligne", () => {
    const content = `Avant\n\n${marker}`;
    const range = findMarkerBlockRange(content, id);
    expect(range).not.toBeNull();
    const replacement = buildMarkerReplacement(
      content.slice(0, range!.start),
      content.slice(range!.end),
      "",
    );
    const newContent = content.slice(0, range!.start) + replacement + content.slice(range!.end);
    expect(newContent).toBe("Avant");
  });

  it("efface le marqueur au milieu en recollant proprement les paragraphes", () => {
    const content = `Avant\n\n${marker}\n\nAprès`;
    const range = findMarkerBlockRange(content, id);
    expect(range).not.toBeNull();
    const replacement = buildMarkerReplacement(
      content.slice(0, range!.start),
      content.slice(range!.end),
      "",
    );
    const newContent = content.slice(0, range!.start) + replacement + content.slice(range!.end);
    expect(newContent).toBe("Avant\n\nAprès");
  });

  it("conserve le comportement de remplacement par du contenu non vide", () => {
    const content = `Avant\n\n${marker}\n\nAprès`;
    const range = findMarkerBlockRange(content, id);
    expect(range).not.toBeNull();
    const replacement = buildMarkerReplacement(
      content.slice(0, range!.start),
      content.slice(range!.end),
      "CONTENU",
    );
    const newContent = content.slice(0, range!.start) + replacement + content.slice(range!.end);
    expect(newContent).toBe("Avant\n\nCONTENU\n\nAprès");
  });
});
