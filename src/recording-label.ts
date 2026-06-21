/**
 * recording-label.ts — Décoration CodeMirror 6 du marqueur visuel.
 *
 * Ce fichier importe la logique pure depuis `./recording-label-pure` et expose
 * l'extension CM6 plus les fonctions de pilotage de l'animation.
 */

import { App, MarkdownView } from "obsidian";
import { Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { computeFrame, findMarkerRange } from "./recording-label-pure";

export {
  buildEmptyMeetingText,
  buildMarkerText,
  computeFrame,
  findMarkerRange,
} from "./recording-label-pure";

interface LabelState {
  markerId: string | null;
  filePath: string | null;
  tick: number;
}

const DEFAULT_LABEL_STATE: LabelState = {
  markerId: null,
  filePath: null,
  tick: 0,
};

const recordingLabelEffect = StateEffect.define<Partial<LabelState>>();

const labelStateField = StateField.define<LabelState>({
  create: () => DEFAULT_LABEL_STATE,
  update: (value, tr) => {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(recordingLabelEffect)) {
        next = { ...next, ...effect.value };
      }
    }
    return next;
  },
});

/**
 * Widget qui affiche les points animés à la suite du marqueur.
 * Le contenu est textuel : aucune modification du document.
 */
class DotsWidget extends WidgetType {
  constructor(private readonly frame: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = this.frame;
    span.className = "voxtype-recording-dots";
    return span;
  }

  eq(other: DotsWidget): boolean {
    return this.frame === other.frame;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class RecordingLabelPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    const previous = update.startState.field(labelStateField);
    const current = update.state.field(labelStateField);
    if (previous !== current || update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const { markerId, tick } = view.state.field(labelStateField);
    if (markerId === null) return Decoration.none;

    const content = view.state.doc.toString();
    const range = findMarkerRange(content, markerId);
    if (range === null) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    const frame = computeFrame(tick);
    builder.add(
      range.end,
      range.end,
      Decoration.widget({ widget: new DotsWidget(frame), side: 1 }),
    );
    return builder.finish();
  }
}

/**
 * Extension CM6 à enregistrer via `Plugin.registerEditorExtension`.
 */
export function createRecordingLabelExtension(): Extension {
  return [
    labelStateField,
    ViewPlugin.fromClass(RecordingLabelPlugin, { decorations: (v) => v.decorations }),
  ];
}

/**
 * Récupère l'EditorView CM6 sous-jacent d'une MarkdownView Obsidian.
 * Cette propriété n'est pas publique, mais elle est stable dans Obsidian.
 */
function getEditorView(view: MarkdownView): EditorView | null {
  const candidate = view.editor as unknown as { cm?: EditorView };
  return candidate.cm ?? null;
}

/**
 * Applique une mise à jour partielle de l'état du label sur toutes les vues
 * Markdown dont le chemin correspond à `filePath` (ou sur toutes si `filePath`
 * vaut null, auquel cas le label est réinitialisé).
 */
export function setRecordingLabel(
  app: App,
  markerId: string | null,
  filePath: string | null,
): void {
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;

    const cm = getEditorView(view);
    if (cm === null) return;

    const isTarget = filePath !== null && view.file?.path === filePath;
    cm.dispatch({
      effects: recordingLabelEffect.of({
        markerId: isTarget ? markerId : null,
        filePath: isTarget ? filePath : null,
        tick: 0,
      }),
    });
  });
}

/**
 * Incrémente le tick d'animation sur les EditorView de la note cible.
 * Le document n'est pas modifié : seul l'effet CM6 change, ce qui redéclenche
 * le ViewPlugin et repositionne le widget avec la nouvelle frame.
 */
export function tickRecordingLabels(app: App, markerId: string, filePath: string): void {
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    if (view.file?.path !== filePath) return;

    const cm = getEditorView(view);
    if (cm === null) return;

    const current = cm.state.field(labelStateField);
    if (current.markerId !== markerId) return;
    cm.dispatch({
      effects: recordingLabelEffect.of({ tick: current.tick + 1 }),
    });
  });
}
