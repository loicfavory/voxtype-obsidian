/**
 * main.ts — Point d'entrée du plugin Obsidian « Voxtype Meeting ».
 *
 * Enregistre les commandes de palette et l'icône ruban.
 * Délègue toute la logique métier à MeetingManager.
 */

import { Notice, Plugin, setIcon } from "obsidian";
import { MeetingManager } from "./meeting-manager";
import { DEFAULT_SETTINGS, VoxtypeSettingTab, type VoxtypeSettings } from "./settings";

// Icônes Lucide disponibles dans Obsidian pour les différents états
const ICON_IDLE = "mic";
const ICON_RECORDING = "mic-off";
const ICON_TRANSCRIBING = "loader";

export default class VoxtypeMeetingPlugin extends Plugin {
  declare settings: VoxtypeSettings;
  private manager!: MeetingManager;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.manager = new MeetingManager(
      this.app,
      (phase) => {
        this.updateRibbonIcon(phase);
      },
      () => this.settings,
    );

    // ── Icône ruban ──────────────────────────────────────────────────────────
    this.ribbonIconEl = this.addRibbonIcon(ICON_IDLE, "Voxtype : démarrer une réunion", () => {
      this.handleRibbonClick();
    });

    // ── Commandes palette ────────────────────────────────────────────────────
    this.addCommand({
      id: "start-meeting",
      name: "Démarrer une réunion",
      callback: () => {
        this.handleStartMeeting();
      },
    });

    this.addCommand({
      id: "stop-meeting",
      name: "Arrêter la réunion",
      callback: () => {
        this.handleStopMeeting();
      },
    });

    // ── Réglages ─────────────────────────────────────────────────────────────
    this.addSettingTab(new VoxtypeSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onunload(): void {
    // Nettoyage : avertir si une réunion est en cours lors du déchargement du plugin
    const phase = this.manager.currentPhase;
    if (phase === "recording") {
      new Notice(
        "Voxtype Meeting : plugin déchargé pendant un enregistrement. " +
          "Arrêtez la réunion manuellement via `voxtype meeting stop`.",
      );
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private handleRibbonClick(): void {
    const phase = this.manager.currentPhase;
    if (phase === "idle") {
      this.handleStartMeeting();
    } else if (phase === "recording") {
      this.handleStopMeeting();
    } else {
      new Notice("Voxtype : opération en cours, veuillez patienter…");
    }
  }

  private handleStartMeeting(): void {
    // no-floating-promises : on lance et gère l'erreur dans le manager via Notice
    this.manager.startRecording().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : erreur inattendue au démarrage.\n${message}`);
    });
  }

  private handleStopMeeting(): void {
    this.manager.stopRecording().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Voxtype : erreur inattendue à l'arrêt.\n${message}`);
    });
  }

  // ── Ruban dynamique ──────────────────────────────────────────────────────

  private updateRibbonIcon(phase: "idle" | "starting" | "recording" | "transcribing"): void {
    if (!this.ribbonIconEl) return;

    // Retirer les anciennes classes d'état
    this.ribbonIconEl.removeClass("voxtype-state-idle");
    this.ribbonIconEl.removeClass("voxtype-state-recording");
    this.ribbonIconEl.removeClass("voxtype-state-transcribing");
    this.ribbonIconEl.removeClass("voxtype-state-starting");

    switch (phase) {
      case "idle":
        this.ribbonIconEl.setAttribute("aria-label", "Voxtype : démarrer une réunion");
        this.ribbonIconEl.addClass("voxtype-state-idle");
        setIcon(this.ribbonIconEl, ICON_IDLE);
        break;
      case "starting":
        this.ribbonIconEl.setAttribute("aria-label", "Voxtype : démarrage en cours…");
        this.ribbonIconEl.addClass("voxtype-state-starting");
        setIcon(this.ribbonIconEl, ICON_RECORDING);
        break;
      case "recording":
        this.ribbonIconEl.setAttribute("aria-label", "Voxtype : arrêter la réunion");
        this.ribbonIconEl.addClass("voxtype-state-recording");
        setIcon(this.ribbonIconEl, ICON_RECORDING);
        break;
      case "transcribing":
        this.ribbonIconEl.setAttribute(
          "aria-label",
          "Voxtype : transcription en cours, veuillez patienter…",
        );
        this.ribbonIconEl.addClass("voxtype-state-transcribing");
        setIcon(this.ribbonIconEl, ICON_TRANSCRIBING);
        break;
    }
  }
}
