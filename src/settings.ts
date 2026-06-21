/**
 * settings.ts — Réglages utilisateur du plugin Voxtype Meeting.
 *
 * Gère la persistance via loadData/saveData et l'interface de configuration
 * dans les préférences Obsidian (fournisseur LLM, clé Claude, endpoint Ollama…).
 */

import { Plugin, PluginSettingTab, Setting } from "obsidian";

/** Fournisseurs de LLM supportés. */
export type LlmProviderKind = "none" | "claude" | "ollama";

/** Réglages persistés du plugin. */
export interface VoxtypeSettings {
  provider: LlmProviderKind;
  claudeApiKey: string;
  claudeModel: string;
  ollamaEndpoint: string;
  ollamaModel: string;
}

/** Valeurs par défaut des réglages. */
export const DEFAULT_SETTINGS: VoxtypeSettings = {
  provider: "none",
  claudeApiKey: "",
  claudeModel: "claude-sonnet-4-6",
  ollamaEndpoint: "http://localhost:11434",
  ollamaModel: "",
};

/** Modèles Claude proposés dans la liste déroulante. */
export const CLAUDE_MODELS: readonly string[] = [
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-haiku-4-5",
];

/** Plugin minimal attendu par l'onglet de réglages. */
interface VoxtypePluginLike {
  settings: VoxtypeSettings;
  saveSettings: () => Promise<void>;
}

/** Onglet de réglages du plugin. */
export class VoxtypeSettingTab extends PluginSettingTab {
  constructor(
    app: Plugin["app"],
    private readonly plugin: VoxtypePluginLike,
  ) {
    super(app, plugin as unknown as Plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Voxtype Meeting" });

    // ── Fournisseur LLM ───────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Fournisseur de compte rendu")
      .setDesc(
        "Choisissez le LLM qui génèrera le compte rendu. « Aucun » se contente d'archiver le transcript et d'injecter le lien.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "Aucun")
          .addOption("claude", "Claude (Anthropic)")
          .addOption("ollama", "Ollama (local)")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as LlmProviderKind;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    // ── Réglages Claude ───────────────────────────────────────────────────────
    if (this.plugin.settings.provider === "claude") {
      new Setting(containerEl)
        .setName("Claude — clé API")
        .setDesc("Votre clé API Anthropic. Elle est stockée en clair dans data.json.")
        .addText((text) => {
          text
            .setPlaceholder("sk-ant-…")
            .setValue(this.plugin.settings.claudeApiKey)
            .onChange(async (value) => {
              this.plugin.settings.claudeApiKey = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          return text;
        });

      new Setting(containerEl)
        .setName("Claude — modèle")
        .setDesc("Modèle utilisé pour la génération du compte rendu.")
        .addDropdown((dropdown) => {
          for (const model of CLAUDE_MODELS) {
            dropdown.addOption(model, model);
          }
          dropdown.setValue(this.plugin.settings.claudeModel).onChange(async (value) => {
            this.plugin.settings.claudeModel = value;
            await this.plugin.saveSettings();
          });
        });
    }

    // ── Réglages Ollama ───────────────────────────────────────────────────────
    if (this.plugin.settings.provider === "ollama") {
      new Setting(containerEl)
        .setName("Ollama — endpoint")
        .setDesc("URL de l'API Ollama locale.")
        .addText((text) =>
          text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaEndpoint)
            .onChange(async (value) => {
              this.plugin.settings.ollamaEndpoint = value;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName("Ollama — modèle")
        .setDesc("Nom du modèle servi par Ollama (ex. llama3, mistral, etc.).")
        .addText((text) =>
          text
            .setPlaceholder("llama3")
            .setValue(this.plugin.settings.ollamaModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaModel = value;
              await this.plugin.saveSettings();
            }),
        );
    }
  }
}
