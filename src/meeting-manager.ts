/**
 * meeting-manager.ts — Logique métier du plugin : start/stop, polling, archivage et injection de lien.
 */

import { App, Editor, MarkdownView, Notice, requestUrl, TFile } from "obsidian";
import {
  checkVoxtypeAvailable,
  exportLatestMarkdown,
  showLatestMeeting,
  startMeeting,
  stopMeeting,
} from "./voxtype";
import { poll } from "./poller";
import {
  buildTimestampedTitle,
  buildWikilink,
  clampOffset,
  sanitizeFileName,
} from "./meeting-utils";
import type { VoxtypeSettings } from "./settings";
import { LlmError, resolveProvider } from "./llm/provider";
import { deriveSummaryOptions, resolveChunkSize } from "./llm/chunk-config";
import { assembleFinalSummary, generateSummary, withTimeout } from "./llm/summary";
import {
  buildEmptyMeetingText,
  buildMarkerReplacement,
  buildMarkerText,
  findMarkerBlockRange,
  setRecordingLabel,
  tickRecordingLabels,
} from "./recording-label";

// ─── Constantes de timeout ────────────────────────────────────────────────────

/** Délai max pour confirmer qu'une réunion est devenue active après `start`. */
const START_CONFIRM_TIMEOUT_MS = 20_000;
/** Délai max pour attendre que la transcription soit Completed après `stop`. */
const TRANSCRIPT_COMPLETE_TIMEOUT_MS = 120_000;
/** Intervalle de polling. */
const POLL_INTERVAL_MS = 2_000;
/**
 * Délai max total pour la génération du compte rendu (map-reduce inclus).
 * `generateSummary` applique aussi un timeout par appel LLM ; ce timeout global
 * protège contre une accumulation imprévue d'appels en map-reduce.
 */
const SUMMARY_TOTAL_TIMEOUT_MS = 300_000;
/** Intervalle entre deux frames de l'animation du marqueur visuel. */
const LABEL_ANIMATION_INTERVAL_MS = 600;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Identifiant du marqueur visuel posé dans la note cible. */
interface RecordingMarker {
  id: string;
  filePath: string;
}

/** État interne du plugin : une réunion à la fois. */
type PluginState =
  | { phase: "idle" }
  | {
      phase: "starting";
      title: string;
      injectionTarget: InjectionTarget | null;
      marker?: RecordingMarker;
    }
  | {
      phase: "recording";
      title: string;
      meetingId: string | null;
      injectionTarget: InjectionTarget | null;
      marker?: RecordingMarker;
    }
  | { phase: "transcribing"; marker?: RecordingMarker };

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
  /** Getter vers les réglages courants du plugin (lecture au moment de l'arrêt). */
  private getSettings: () => VoxtypeSettings;
  /** Timer de l'animation du marqueur. */
  private animationTimer: number | null = null;
  /** Marqueur actuellement suivi (pour figer/reprendre selon le focus). */
  private currentMarker: RecordingMarker | null = null;

  constructor(
    app: App,
    onStateChange: (phase: PluginState["phase"]) => void,
    getSettings: () => VoxtypeSettings,
  ) {
    this.app = app;
    this.onStateChange = onStateChange;
    this.getSettings = getSettings;
  }

  /**
   * Libère les ressources du manager.
   * Appelé lors du déchargement du plugin.
   */
  dispose(): void {
    this.stopAnimation();
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
    let injectionTarget = captureInjectionTarget(this.app);

    // Si aucune note n'est active, créer une note dédiée dans le dossier réglable.
    if (injectionTarget === null) {
      injectionTarget = await this.createDedicatedMeetingNote(title);
      if (injectionTarget === null) {
        new Notice("Voxtype : impossible de créer une note dédiée pour la réunion.");
        this.setState({ phase: "idle" });
        return;
      }
    }

    const markerId = Date.now().toString();
    const marker: RecordingMarker = { id: markerId, filePath: injectionTarget.filePath };

    // Section non réentrante : on passe en starting AVANT l'écriture async du
    // marqueur. Cela bloque les double-clics et permet un rollback cohérent.
    this.setState({ phase: "starting", title, injectionTarget, marker });

    try {
      await this.insertMarker(injectionTarget, buildMarkerText(markerId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : impossible de poser le marqueur de réunion.\n${message}`);
      this.setState({ phase: "idle" });
      return;
    }

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
      marker,
    });
    this.startAnimation(marker);
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

    const { injectionTarget, title, marker } = this.state;

    const stopResult = await stopMeeting();
    if (!stopResult.ok) {
      new Notice(
        `Voxtype : échec de l'arrêt.\n${stopResult.error.stderr || stopResult.error.message}`,
      );
      return;
    }

    this.setState({ phase: "transcribing", marker });
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
        "Voxtype : la transcription est vide (aucun segment capté). Rien n'a été archivé ni injecté.",
      );
      if (marker !== undefined) {
        await this.injectText(
          buildEmptyMeetingText(),
          injectionTarget,
          {
            success: "Voxtype : la réunion était vide — mention insérée.",
            missingTarget:
              "Voxtype : la réunion était vide.\n" +
              "Aucune note cible n'était ouverte : insérez la mention manuellement.",
            inaccessibleTarget:
              "Voxtype : la réunion était vide.\n" +
              "La note cible n'est plus accessible : insérez la mention manuellement.",
            fallbackSuccess:
              "Voxtype : la réunion était vide — mention insérée (modification directe).",
            fallbackErrorPrefix:
              "Voxtype : la réunion était vide, mais impossible d'écrire la mention.",
          },
          marker.id,
        );
      }
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

    // Archiver le transcript dans Transcripts/ et injecter un wikilink
    await this.archiveAndLinkTranscription(markdown, title, injectionTarget, marker?.id);
    this.setState({ phase: "idle" });
  }

  // ── Archivage + lien ───────────────────────────────────────────────────────

  /**
   * Archive le transcript Markdown dans une note dédiée sous `Transcripts/`
   * puis injecte un wikilink vers cette note à la position mémorisée.
   */
  private async archiveAndLinkTranscription(
    markdown: string,
    title: string,
    target: InjectionTarget | null,
    markerId: string | undefined,
  ): Promise<void> {
    const folderPath = "Transcripts";
    const baseName = sanitizeFileName(title);

    try {
      await this.ensureFolder(folderPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : échec de la création du dossier Transcripts.\n${message}`);
      return;
    }

    const filePath = this.findUniquePath(folderPath, baseName);

    let transcriptFile: TFile;
    try {
      transcriptFile = await this.app.vault.create(filePath, markdown);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : échec de l'archivage du transcript.\n${message}`);
      return;
    }

    const linkText = buildWikilink(folderPath, transcriptFile.basename, title);
    await this.generateAndInjectSummary(markdown, linkText, target, transcriptFile.path, markerId);
  }

  /**
   * Tente de générer un compte rendu par LLM puis l'injecte avec le lien.
   * En cas d'absence de LLM ou d'échec, retombe sur le repli US-02a (lien seul).
   */
  private async generateAndInjectSummary(
    markdown: string,
    linkText: string,
    target: InjectionTarget | null,
    transcriptPath: string,
    markerId: string | undefined,
  ): Promise<void> {
    const settings = this.getSettings();
    const provider = resolveProvider(settings, requestUrl);

    if (provider === null) {
      new Notice(
        "Voxtype : aucun LLM configuré → lien seul inséré. " +
          "Configurez un fournisseur dans les réglages pour obtenir un compte rendu.",
      );
      await this.injectLink(linkText, target, transcriptPath, markerId);
      return;
    }

    new Notice("Voxtype : génération du compte rendu en cours…");

    try {
      const chunkSize = resolveChunkSize(settings, settings.provider);
      const summaryOptions = deriveSummaryOptions(chunkSize);
      const summary = await withTimeout(
        generateSummary(provider, markdown, summaryOptions),
        SUMMARY_TOTAL_TIMEOUT_MS,
      );

      if (summary.trim() === "") {
        throw new LlmError("empty", "Le LLM a renvoyé un compte rendu vide.");
      }

      const fullText = assembleFinalSummary(summary, linkText);
      await this.injectText(
        fullText,
        target,
        {
          success: `Voxtype : compte rendu généré et transcript archivé dans ${transcriptPath}.`,
          missingTarget:
            `Voxtype : transcript archivé dans ${transcriptPath}.\n` +
            "Aucune note cible n'était ouverte : insérez le compte rendu manuellement.",
          inaccessibleTarget:
            `Voxtype : transcript archivé dans ${transcriptPath}.\n` +
            "La note cible n'est plus accessible : insérez le compte rendu manuellement.",
          fallbackSuccess: `Voxtype : compte rendu généré et transcript archivé dans ${transcriptPath} (modification directe).`,
          fallbackErrorPrefix: `Voxtype : transcript archivé dans ${transcriptPath}, mais impossible d'écrire le compte rendu.`,
        },
        markerId,
      );
    } catch (err) {
      const message = err instanceof LlmError ? err.message : String(err);
      await this.injectLink(linkText, target, transcriptPath, markerId);
      new Notice(
        `Voxtype : échec de la génération du compte rendu. ${message}\n` +
          "Transcript archivé et lien seul inséré.",
      );
    }
  }

  /**
   * Crée un dossier s'il n'existe pas encore.
   * Ne plante pas si le dossier existe déjà.
   */
  private async ensureFolder(folderPath: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(folderPath);
    if (existing !== null) return;

    try {
      await this.app.vault.createFolder(folderPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Impossible de créer le dossier ${folderPath} : ${message}`);
    }
  }

  /**
   * Détermine un chemin de note unique dans `folderPath` à partir du nom de base.
   * En cas de collision, suffixe avec ` (1)`, ` (2)`, etc.
   */
  private findUniquePath(folderPath: string, baseName: string): string {
    let candidate = `${folderPath}/${baseName}.md`;
    let counter = 1;

    while (this.app.vault.getAbstractFileByPath(candidate) !== null) {
      candidate = `${folderPath}/${baseName} (${counter}).md`;
      counter++;
    }

    return candidate;
  }

  /**
   * Insère le marqueur dans la note cible.
   * Privilégie l'éditeur si la note est ouverte, sinon modifie le fichier.
   */
  private async insertMarker(target: InjectionTarget, markerText: string): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(target.filePath);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`Fichier cible inaccessible : ${target.filePath}`);
    }

    let inserted = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (inserted) return;
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      if (view.file?.path !== target.filePath) return;

      const editor = view.editor;
      const safeOffset = clampOffset(target.charOffset, editor.getValue().length);
      const pos = editor.offsetToPos(safeOffset);
      editor.replaceRange(`\n\n${markerText}\n\n`, pos);
      inserted = true;
    });

    if (inserted) return;

    const content = await this.app.vault.read(abstractFile);
    const safeOffset = clampOffset(target.charOffset, content.length);
    const newContent =
      content.slice(0, safeOffset) + `\n\n${markerText}\n\n` + content.slice(safeOffset);
    await this.app.vault.modify(abstractFile, newContent);
  }

  /**
   * Crée et ouvre une note dédiée quand aucune note n'est active au démarrage.
   * Retourne la cible d'injection, ou null en cas d'échec.
   */
  private async createDedicatedMeetingNote(title: string): Promise<InjectionTarget | null> {
    const settings = this.getSettings();
    const folderPath = settings.meetingsFolder;

    try {
      await this.ensureFolder(folderPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : échec de la création du dossier ${folderPath}.\n${message}`);
      return null;
    }

    const baseName = sanitizeFileName(title);
    const filePath = this.findUniquePath(folderPath, baseName);

    let file: TFile;
    try {
      file = await this.app.vault.create(filePath, "");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : échec de la création de la note ${filePath}.\n${message}`);
      return null;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);

    return { filePath: file.path, charOffset: 0 };
  }

  /**
   * Injecte un wikilink à la position mémorisée dans la note cible.
   * Gère les cas : note disparue/renommée, note non ouverte, offset invalide.
   */
  private async injectLink(
    linkText: string,
    target: InjectionTarget | null,
    transcriptPath: string,
    markerId: string | undefined,
  ): Promise<void> {
    return this.injectText(
      linkText,
      target,
      {
        success: `Voxtype : transcription archivée dans ${transcriptPath} et lien injecté.`,
        missingTarget:
          `Voxtype : transcript archivé dans ${transcriptPath}.\n` +
          "Aucune note cible n'était ouverte au démarrage : insérez le lien manuellement.",
        inaccessibleTarget:
          `Voxtype : transcript archivé dans ${transcriptPath}.\n` +
          "La note cible n'est plus accessible : insérez le lien manuellement.",
        fallbackSuccess: `Voxtype : transcription archivée dans ${transcriptPath} et lien injecté (modification directe).`,
        fallbackErrorPrefix: `Voxtype : transcription archivée dans ${transcriptPath}, mais impossible d'écrire le lien.`,
      },
      markerId,
    );
  }

  /**
   * Injecte du texte à la position mémorisée dans la note cible.
   * Gère les cas : note disparue/renommée, note non ouverte, offset invalide.
   * Si `markerId` est fourni, la localisation se fait d'abord par recherche du
   * marqueur dans la note ; en cas d'échec, on retombe gracieusement sur
   * l'offset mémorisé.
   */
  private async injectText(
    text: string,
    target: InjectionTarget | null,
    notices: {
      success: string;
      missingTarget: string;
      inaccessibleTarget: string;
      fallbackSuccess: string;
      fallbackErrorPrefix: string;
    },
    markerId: string | undefined,
  ): Promise<void> {
    // Cas : aucune cible mémorisée (pas de note ouverte au démarrage)
    if (target === null) {
      new Notice(notices.missingTarget);
      return;
    }

    // Chercher la note dans le vault par chemin
    const abstractFile = this.app.vault.getAbstractFileByPath(target.filePath);

    if (!(abstractFile instanceof TFile)) {
      new Notice(notices.inaccessibleTarget);
      return;
    }

    // Si un marqueur est suivi, tenter d'abord de localiser le texte par ce marqueur.
    if (markerId !== undefined) {
      const replaced = await this.tryReplaceMarker(abstractFile, markerId, text, notices.success);
      if (replaced) return;
      // Sinon, repli gracieux sur l'offset mémorisé ci-dessous.
    }

    // Tenter d'injecter via l'Editor si la note est ouverte dans une vue
    const injected = this.tryInjectViaEditor(abstractFile, target.charOffset, text);
    if (injected) {
      new Notice(notices.success);
      return;
    }

    // Fallback : modifier le fichier directement via l'API vault
    try {
      const content = await this.app.vault.read(abstractFile);
      const safeOffset = clampOffset(target.charOffset, content.length);
      const newContent = content.slice(0, safeOffset) + text + content.slice(safeOffset);
      await this.app.vault.modify(abstractFile, newContent);
      new Notice(notices.fallbackSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(
        `${notices.fallbackErrorPrefix}\n${message}\n` + "Insérez le contenu manuellement.",
      );
    }
  }

  /**
   * Tente de remplacer le marqueur `markerId` dans `targetFile` par `text`.
   * Retourne `true` si le remplacement a réussi, `false` sinon.
   */
  private async tryReplaceMarker(
    targetFile: TFile,
    markerId: string,
    text: string,
    successNotice: string,
  ): Promise<boolean> {
    // F-05 : privilégier le contenu de l'éditeur s'il est ouvert (évite le
    // snapshot stale si des modifications ne sont pas encore sauvegardées).
    const editorHolder: Editor[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (editorHolder.length > 0) return;
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      if (view.file?.path !== targetFile.path) return;
      editorHolder.push(view.editor);
    });

    const activeEditor = editorHolder[0] ?? null;
    const content = activeEditor?.getValue() ?? (await this.app.vault.read(targetFile));
    const range = findMarkerBlockRange(content, markerId);
    if (range === null) return false;

    // F-02 / TECH-03 : remplacement symétrique avec la pose. `insertMarker`
    // écrit `\n\n${marker}\n\n` ; on mange ce padding et on réinjecte `text`
    // avec le minimum nécessaire pour éviter collage et lignes blanches
    // résiduelles. En cas d'effacement (text vide), aucun padding n'est réintroduit.
    const before = content.slice(0, range.start);
    const after = content.slice(range.end);
    const replacement = buildMarkerReplacement(before, after, text);

    // TECH-03 : en cas d'effacement en fin de note, éliminer les sauts de ligne
    // résiduels en conservant au plus un saut de ligne final si le fichier en
    // avait un avant la pose du marqueur.
    let newContent = content.slice(0, range.start) + replacement + content.slice(range.end);
    if (text === "" && after === "") {
      const hadTrailingNewline = before.endsWith("\n");
      newContent = newContent.replace(/\n+$/, "");
      if (hadTrailingNewline) {
        newContent += "\n";
      }
    }

    if (activeEditor !== null) {
      const from = activeEditor.offsetToPos(range.start);
      if (text === "" && after === "") {
        const to = activeEditor.offsetToPos(content.length);
        activeEditor.replaceRange(newContent.slice(range.start), from, to);
      } else {
        const to = activeEditor.offsetToPos(range.end);
        activeEditor.replaceRange(replacement, from, to);
      }
      if (successNotice !== "") new Notice(successNotice);
      return true;
    }

    // Fallback : modification directe du fichier.
    try {
      await this.app.vault.modify(targetFile, newContent);
      if (successNotice !== "") new Notice(`${successNotice} (modification directe)`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : impossible de remplacer le marqueur.\n${message}`);
      return false;
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
      const safeOffset = clampOffset(charOffset, docContent.length);
      const pos = editor.offsetToPos(safeOffset);
      editor.replaceRange(text, pos);
      injected = true;
    });

    return injected;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Retire le marqueur de la note en le remplaçant par une chaîne vide.
   * Affiche une Notice si l'opération échoue ou si la note est inaccessible.
   */
  private async removeMarkerOrNotify(marker: RecordingMarker): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(marker.filePath);
    if (!(abstractFile instanceof TFile)) {
      new Notice("Voxtype : le marqueur de démarrage n'a pas pu être retiré (note inaccessible).");
      return;
    }

    const removed = await this.tryReplaceMarker(abstractFile, marker.id, "", "");
    if (!removed) {
      new Notice("Voxtype : le marqueur de démarrage n'a pas pu être retiré automatiquement.");
    }
  }

  private setState(next: PluginState): void {
    const previous = this.state;
    this.state = next;
    this.onStateChange(next.phase);
    if (next.phase === "idle") {
      // F-01 : si un démarrage est annulé, effacer le marqueur orphelin.
      if (previous.phase === "starting" && previous.marker !== undefined) {
        this.removeMarkerOrNotify(previous.marker).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          new Notice(`Voxtype : le marqueur de démarrage n'a pas pu être retiré.\n${message}`);
        });
      }
      this.stopAnimation();
    }
  }

  // ── Animation du marqueur ─────────────────────────────────────────────────

  private startAnimation(marker: RecordingMarker): void {
    this.stopAnimation();
    this.currentMarker = marker;
    this.refreshAnimationFocus();
  }

  private stopAnimation(): void {
    if (this.animationTimer !== null) {
      window.clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    this.currentMarker = null;
    setRecordingLabel(this.app, null, null);
  }

  /**
   * Redémarre ou arrête le timer selon le focus de la note cible.
   * Appelé à chaque changement de feuille active (via main.ts).
   *
   * F-06 : quand la note cible perd le focus, on arrête seulement le timer.
   * Le widget CM6 reste visible figé sur sa dernière frame : c'est le
   * comportement voulu (pas de reset du label qui le ferait disparaître).
   */
  refreshAnimationFocus(): void {
    if (this.currentMarker === null) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const inFocus = view !== null && view.file?.path === this.currentMarker.filePath;

    if (inFocus && this.animationTimer === null) {
      setRecordingLabel(this.app, this.currentMarker.id, this.currentMarker.filePath);
      this.animationTimer = window.setInterval(() => {
        tickRecordingLabels(this.app, this.currentMarker!.id, this.currentMarker!.filePath);
      }, LABEL_ANIMATION_INTERVAL_MS);
    } else if (!inFocus && this.animationTimer !== null) {
      window.clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }
}

// ─── Fonctions utilitaires ───────────────────────────────────────────────────

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
