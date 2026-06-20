/**
 * meeting-manager.ts — Logique métier du plugin : start/stop, polling, injection.
 */

import { App, Editor, MarkdownView, Notice, TFile } from "obsidian";
import {
  checkVoxtypeAvailable,
  exportLatestMarkdown,
  showLatestMeeting,
  startMeeting,
  stopMeeting,
} from "./voxtype";
import { poll } from "./poller";

// ─── Constantes de timeout ────────────────────────────────────────────────────

/** Délai max pour confirmer qu'une réunion est devenue active après `start`. */
const START_CONFIRM_TIMEOUT_MS = 20_000;
/** Délai max pour attendre que la transcription soit Completed après `stop`. */
const TRANSCRIPT_COMPLETE_TIMEOUT_MS = 120_000;
/** Intervalle de polling. */
const POLL_INTERVAL_MS = 2_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** État interne du plugin : une réunion à la fois. */
type PluginState =
  | { phase: "idle" }
  | {
      phase: "starting";
      title: string;
      injectionTarget: InjectionTarget | null;
    }
  | {
      phase: "recording";
      title: string;
      meetingId: string | null;
      injectionTarget: InjectionTarget | null;
    }
  | { phase: "transcribing" };

/** Cible d'injection : note + offset de caractère mémorisés au démarrage. */
export interface InjectionTarget {
  /** Chemin de la note dans le vault. */
  filePath: string;
  /** Offset en nombre de caractères depuis le début du fichier. */
  charOffset: number;
}

// ─── MeetingManager ──────────────────────────────────────────────────────────

export class MeetingManager {
  private state: PluginState = { phase: "idle" };
  private app: App;
  /** Callback appelé à chaque changement d'état (pour mettre à jour l'icône ruban). */
  private onStateChange: (phase: PluginState["phase"]) => void;

  constructor(app: App, onStateChange: (phase: PluginState["phase"]) => void) {
    this.app = app;
    this.onStateChange = onStateChange;
  }

  get currentPhase(): PluginState["phase"] {
    return this.state.phase;
  }

  // ── Démarrage ──────────────────────────────────────────────────────────────

  /**
   * Démarre une réunion Voxtype.
   * - Vérifie que le daemon est disponible.
   * - Mémorise la cible d'injection (note + curseur actuels).
   * - Lance `voxtype meeting start`, puis poll jusqu'à active.
   */
  async startRecording(): Promise<void> {
    if (this.state.phase !== "idle") {
      new Notice("Voxtype : une réunion est déjà en cours.");
      return;
    }

    // Vérifier que la CLI est disponible
    const available = await checkVoxtypeAvailable();
    if (!available) {
      new Notice("Voxtype : daemon introuvable. Vérifiez que Voxtype est installé et lancé.");
      return;
    }

    const title = buildTimestampedTitle();
    const injectionTarget = captureInjectionTarget(this.app);

    this.setState({ phase: "starting", title, injectionTarget });

    const startResult = await startMeeting(title);
    if (!startResult.ok) {
      new Notice(
        `Voxtype : échec du démarrage.\n${startResult.error.stderr || startResult.error.message}`,
      );
      this.setState({ phase: "idle" });
      return;
    }

    new Notice("Voxtype : démarrage de la réunion…");

    // Polling jusqu'à réunion active
    const pollResult = await poll(
      async () => {
        const show = await showLatestMeeting();
        if (!show.ok) throw new Error(show.error.stderr || show.error.message);
        return show.value.status === "active" ? show.value : null;
      },
      { intervalMs: POLL_INTERVAL_MS, timeoutMs: START_CONFIRM_TIMEOUT_MS },
    );

    if (pollResult.outcome === "timeout") {
      new Notice("Voxtype : la réunion n'a pas démarré dans le délai imparti. Vérifiez le daemon.");
      this.setState({ phase: "idle" });
      return;
    }

    if (pollResult.outcome === "error") {
      new Notice(`Voxtype : erreur lors de la confirmation du démarrage.\n${pollResult.message}`);
      this.setState({ phase: "idle" });
      return;
    }

    const meetingId = pollResult.value.id;
    this.setState({
      phase: "recording",
      title,
      meetingId,
      injectionTarget,
    });
    new Notice(`Voxtype : enregistrement en cours — ${title}`);
  }

  // ── Arrêt ──────────────────────────────────────────────────────────────────

  /**
   * Arrête la réunion en cours.
   * - Lance `voxtype meeting stop`.
   * - Poll jusqu'à Status: Completed.
   * - Exporte et injecte la transcription dans la note cible.
   */
  async stopRecording(): Promise<void> {
    if (this.state.phase !== "recording") {
      new Notice("Voxtype : aucune réunion en cours.");
      return;
    }

    const { injectionTarget } = this.state;

    const stopResult = await stopMeeting();
    if (!stopResult.ok) {
      new Notice(
        `Voxtype : échec de l'arrêt.\n${stopResult.error.stderr || stopResult.error.message}`,
      );
      return;
    }

    this.setState({ phase: "transcribing" });
    new Notice("Voxtype : transcription en cours, veuillez patienter…");

    // Polling jusqu'à Status: Completed
    const pollResult = await poll(
      async () => {
        const show = await showLatestMeeting();
        if (!show.ok) throw new Error(show.error.stderr || show.error.message);
        return show.value.status === "completed" ? show.value : null;
      },
      { intervalMs: POLL_INTERVAL_MS, timeoutMs: TRANSCRIPT_COMPLETE_TIMEOUT_MS },
    );

    if (pollResult.outcome === "timeout") {
      new Notice(
        "Voxtype : la transcription n'est pas terminée dans le délai imparti (2 min).\n" +
          "Récupérez-la manuellement : `voxtype meeting export latest -f markdown --speakers --timestamps --metadata`",
      );
      this.setState({ phase: "idle" });
      return;
    }

    if (pollResult.outcome === "error") {
      new Notice(`Voxtype : erreur lors de l'attente de la transcription.\n${pollResult.message}`);
      this.setState({ phase: "idle" });
      return;
    }

    // Vérifier le transcript vide (0 mots ou 0 segments)
    if (pollResult.value.words === 0 || pollResult.value.segments === 0) {
      new Notice(
        "Voxtype : la transcription est vide (aucun segment capté). Rien n'a été injecté.",
      );
      this.setState({ phase: "idle" });
      return;
    }

    // Exporter le Markdown
    const exportResult = await exportLatestMarkdown();
    if (!exportResult.ok) {
      new Notice(
        `Voxtype : échec de l'export.\n${exportResult.error.stderr || exportResult.error.message}`,
      );
      this.setState({ phase: "idle" });
      return;
    }

    const markdown = exportResult.value.trim();

    // Injecter dans la note cible
    await this.injectTranscription(markdown, injectionTarget);
    this.setState({ phase: "idle" });
  }

  // ── Injection ──────────────────────────────────────────────────────────────

  /**
   * Injecte `markdown` à la position mémorisée dans la note cible.
   * Gère les cas : note disparue/renommée, note non ouverte, offset invalide.
   */
  private async injectTranscription(
    markdown: string,
    target: InjectionTarget | null,
  ): Promise<void> {
    const toInject = `\n\n${markdown}\n`;

    // Cas : aucune cible mémorisée (pas de note ouverte au démarrage)
    if (target === null) {
      new Notice(
        "Voxtype : aucune cible d'injection mémorisée.\n" +
          "Récupérez la transcription manuellement : " +
          "`voxtype meeting export latest -f markdown --speakers --timestamps --metadata`",
      );
      return;
    }

    // Chercher la note dans le vault par chemin
    const abstractFile = this.app.vault.getAbstractFileByPath(target.filePath);

    if (!(abstractFile instanceof TFile)) {
      new Notice(
        `Voxtype : la note cible "${target.filePath}" n'est plus accessible.\n` +
          "Récupérez la transcription manuellement : " +
          "`voxtype meeting export latest -f markdown --speakers --timestamps --metadata`",
      );
      return;
    }

    // Tenter d'injecter via l'Editor si la note est ouverte dans une vue
    const injected = this.tryInjectViaEditor(abstractFile, target.charOffset, toInject);
    if (injected) {
      new Notice("Voxtype : transcription injectée dans la note.");
      return;
    }

    // Fallback : modifier le fichier directement via l'API vault
    try {
      const content = await this.app.vault.read(abstractFile);
      const safeOffset = Math.min(target.charOffset, content.length);
      const newContent = content.slice(0, safeOffset) + toInject + content.slice(safeOffset);
      await this.app.vault.modify(abstractFile, newContent);
      new Notice("Voxtype : transcription injectée dans la note (modification directe).");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(
        `Voxtype : impossible d'écrire dans la note.\n${message}\n` +
          "Récupérez la transcription manuellement.",
      );
    }
  }

  /**
   * Tente d'injecter via l'`Editor` Obsidian si la note cible est ouverte.
   * Retourne `true` si l'injection a réussi, `false` sinon.
   */
  private tryInjectViaEditor(targetFile: TFile, charOffset: number, text: string): boolean {
    let injected = false;

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (injected) return;
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      if (view.file?.path !== targetFile.path) return;

      const editor: Editor = view.editor;
      const docContent = editor.getValue();
      const safeOffset = Math.min(charOffset, docContent.length);
      const pos = editor.offsetToPos(safeOffset);
      editor.replaceRange(text, pos);
      injected = true;
    });

    return injected;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private setState(next: PluginState): void {
    this.state = next;
    this.onStateChange(next.phase);
  }
}

// ─── Fonctions utilitaires ───────────────────────────────────────────────────

/**
 * Génère le titre horodaté : "Réunion du dd/mm/YY à HH:ii" en heure locale.
 * Ex : "Réunion du 20/06/26 à 14:30"
 */
export function buildTimestampedTitle(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  const HH = String(now.getHours()).padStart(2, "0");
  const ii = String(now.getMinutes()).padStart(2, "0");
  return `Réunion du ${dd}/${mm}/${yy} à ${HH}:${ii}`;
}

/**
 * Capture la cible d'injection : note active + offset curseur dans l'éditeur.
 * Retourne `null` si aucun éditeur Markdown n'est ouvert.
 */
export function captureInjectionTarget(app: App): InjectionTarget | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return null;

  const file = view.file;
  if (!file) return null;

  const editor: Editor = view.editor;
  const cursor = editor.getCursor();
  const charOffset = editor.posToOffset(cursor);

  return { filePath: file.path, charOffset };
}
