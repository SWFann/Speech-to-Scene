/**
 * Filesystem SettingsStore implementation.
 *
 * Reads/writes API keys from `<workspace>/.s2s/settings.json`.
 * Keys are never committed to git (.gitignore).
 *
 * Security:
 * - Atomic write via rename (no partial reads).
 * - toView() never returns plaintext keys (desensitized booleans).
 * - Missing file → empty defaults (plannerProvider=fixture).
 */

import fs from "node:fs/promises";
import path from "node:path";

import { atomicWrite } from "./atomic-write.js";
import type { Settings, SettingsStore, SettingsView } from "../application/ports/settings-store.js";

export interface FsSettingsStoreOptions {
  readonly settingsPath: string;
}

const EMPTY_SETTINGS: Settings = { plannerProvider: "fixture" };

export class FsSettingsStore implements SettingsStore {
  private readonly settingsPath: string;

  constructor(opts: FsSettingsStoreOptions) {
    this.settingsPath = opts.settingsPath;
  }

  async load(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.settingsPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return this.normalize(parsed);
    } catch {
      return { ...EMPTY_SETTINGS };
    }
  }

  async save(settings: Settings): Promise<void> {
    const dir = path.dirname(this.settingsPath);
    await fs.mkdir(dir, { recursive: true });
    const json = JSON.stringify(settings, null, 2) + "\n";
    const bytes = new TextEncoder().encode(json);
    await atomicWrite(this.settingsPath, bytes, "settings");
  }

  toView(settings: Settings): SettingsView {
    return {
      plannerProvider: settings.plannerProvider,
      hasDeepseekKey: Boolean(settings.deepseekApiKey),
      hasStepKey: Boolean(settings.stepApiKey),
      hasPexelsKey: Boolean(settings.pexelsApiKey),
      hasPixabayKey: Boolean(settings.pixabayApiKey),
      hasUnsplashKey: Boolean(settings.unsplashApiKey),
      hasOpenverseKey: Boolean(settings.openverseApiKey),
      deepseekBaseUrl: settings.deepseekBaseUrl ?? "",
      deepseekModel: settings.deepseekModel ?? "",
      stepBaseUrl: settings.stepBaseUrl ?? "",
      stepModel: settings.stepModel ?? "",
      stepImageModel: settings.stepImageModel ?? "",
      pexelsBaseUrl: settings.pexelsBaseUrl ?? "",
      pexelsVideoBaseUrl: settings.pexelsVideoBaseUrl ?? "",
    };
  }

  private normalize(parsed: Record<string, unknown>): Settings {
    const s: Record<string, unknown> = { ...parsed };
    if (typeof s.plannerProvider !== "string" || s.plannerProvider.trim() === "") {
      s.plannerProvider = "fixture";
    }
    return s as unknown as Settings;
  }
}
