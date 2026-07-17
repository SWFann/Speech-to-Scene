/**
 * SettingsStore port.
 *
 * Persists API keys at the workspace level (./workspace/.s2s/settings.json),
 * NOT inside the project directory (which `create` overwrites).
 * Keys are never committed to git (.gitignore).
 *
 * Priority order for provider keys: settings.json > .env (backward compat).
 */
export interface Settings {
  readonly plannerProvider: string;
  readonly deepseekApiKey?: string;
  readonly deepseekBaseUrl?: string;
  readonly deepseekModel?: string;
  readonly stepApiKey?: string;
  readonly stepBaseUrl?: string;
  readonly stepModel?: string;
  readonly pexelsApiKey?: string;
  readonly pexelsBaseUrl?: string;
  readonly pexelsVideoBaseUrl?: string;
}

/**
 * Desensitized view returned by GET /api/settings.
 * Keys are reduced to booleans; non-secret config is preserved.
 */
export interface SettingsView {
  readonly plannerProvider: string;
  readonly hasDeepseekKey: boolean;
  readonly hasStepKey: boolean;
  readonly hasPexelsKey: boolean;
  readonly deepseekBaseUrl: string;
  readonly deepseekModel: string;
  readonly stepBaseUrl: string;
  readonly stepModel: string;
  readonly pexelsBaseUrl: string;
  readonly pexelsVideoBaseUrl: string;
}

export interface SettingsStore {
  /** Load settings; returns empty defaults if file missing. */
  load(): Promise<Settings>;
  /** Save settings (full replace, atomic write). */
  save(settings: Settings): Promise<void>;
  /** Return a desensitized view (no plaintext keys). */
  toView(settings: Settings): SettingsView;
}
