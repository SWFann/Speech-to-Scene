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
import { InvalidArgumentError } from "../shared/errors.js";
import {
  normalizeOfficialProviderBaseUrl,
  type OfficialProvider,
} from "../shared/provider-base-url.js";

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
      const dir = path.dirname(this.settingsPath);
      await fs.chmod(dir, 0o700);
      await fs.chmod(this.settingsPath, 0o600);
      const raw = await fs.readFile(this.settingsPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return this.normalize(parsed);
    } catch (error) {
      if (error instanceof InvalidArgumentError) {
        throw error;
      }
      return { ...EMPTY_SETTINGS };
    }
  }

  async save(settings: Settings): Promise<void> {
    const dir = path.dirname(this.settingsPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700);
    const json = JSON.stringify(settings, null, 2) + "\n";
    const bytes = new TextEncoder().encode(json);
    await atomicWrite(this.settingsPath, bytes, "settings");
    await fs.chmod(this.settingsPath, 0o600);
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
    this.normalizeProviderUrl(s, "deepseek", "deepseekBaseUrl");
    this.normalizeProviderUrl(s, "stepfun", "stepBaseUrl");
    return s as unknown as Settings;
  }

  private normalizeProviderUrl(
    settings: Record<string, unknown>,
    provider: OfficialProvider,
    field: "deepseekBaseUrl" | "stepBaseUrl",
  ): void {
    const value = settings[field];
    if (value === undefined) {
      return;
    }
    const normalized =
      typeof value === "string" ? normalizeOfficialProviderBaseUrl(provider, value) : null;
    if (normalized === null) {
      const label = provider === "stepfun" ? "StepFun" : "DeepSeek";
      throw new InvalidArgumentError(
        `Unsafe ${label} base URL in local settings`,
        `请在设置页重新保存官方 ${label} API 地址`,
      );
    }
    settings[field] = normalized;
  }
}
