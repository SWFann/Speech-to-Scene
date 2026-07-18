import fs from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { FsSettingsStore } from "../../src/infrastructure/settings-store.js";

describe("FsSettingsStore", () => {
  let workspace: string;
  let store: FsSettingsStore;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "s2s-settings-"));
    store = new FsSettingsStore({
      settingsPath: path.join(workspace, ".s2s", "settings.json"),
    });
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("load returns empty defaults when file missing", async () => {
    const s = await store.load();
    expect(s.plannerProvider).toBe("fixture");
    expect(s.pexelsApiKey).toBeUndefined();
  });

  it("save then load round-trips keys", async () => {
    await store.save({
      plannerProvider: "deepseek",
      deepseekApiKey: "sk-test",
      pexelsApiKey: "px-test",
    });
    const s = await store.load();
    expect(s.deepseekApiKey).toBe("sk-test");
    expect(s.pexelsApiKey).toBe("px-test");
  });

  it("toView never exposes plaintext keys", async () => {
    await store.save({
      plannerProvider: "deepseek",
      deepseekApiKey: "sk-secret",
      pexelsApiKey: "px-secret",
      stepApiKey: "step-secret",
    });
    const view = store.toView(await store.load());
    expect(JSON.stringify(view)).not.toContain("sk-secret");
    expect(JSON.stringify(view)).not.toContain("px-secret");
    expect(view.hasDeepseekKey).toBe(true);
    expect(view.hasPexelsKey).toBe(true);
    expect(view.hasStepKey).toBe(true);
    expect(view.plannerProvider).toBe("deepseek");
  });

  it("toView shows false when key absent", () => {
    const view = store.toView({ plannerProvider: "fixture" });
    expect(view.hasDeepseekKey).toBe(false);
    expect(view.hasPexelsKey).toBe(false);
  });
});
