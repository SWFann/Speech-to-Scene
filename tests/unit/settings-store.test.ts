import fs from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { FsSettingsStore } from "../../src/infrastructure/settings-store.js";
import { InvalidArgumentError } from "../../src/shared/errors.js";

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

  it.skipIf(process.platform === "win32")(
    "save restricts the settings directory to 0700 and file to 0600",
    async () => {
      const settingsDir = path.join(workspace, ".s2s");
      const settingsPath = path.join(settingsDir, "settings.json");
      await fs.mkdir(settingsDir, { mode: 0o777 });
      await fs.writeFile(settingsPath, "{}\n", { mode: 0o666 });
      await fs.chmod(settingsDir, 0o777);
      await fs.chmod(settingsPath, 0o666);

      await store.save({
        plannerProvider: "stepfun",
        stepApiKey: "step-secret",
      });

      const dirMode = (await fs.stat(settingsDir)).mode & 0o777;
      const fileMode = (await fs.stat(settingsPath)).mode & 0o777;
      expect(dirMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "load repairs permissive settings permissions from an older installation",
    async () => {
      const settingsDir = path.join(workspace, ".s2s");
      const settingsPath = path.join(settingsDir, "settings.json");
      await fs.mkdir(settingsDir, { mode: 0o777 });
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ plannerProvider: "stepfun", stepApiKey: "step-secret" }),
        { mode: 0o666 },
      );
      await fs.chmod(settingsDir, 0o777);
      await fs.chmod(settingsPath, 0o666);

      const loaded = await store.load();

      expect("stepApiKey" in loaded).toBe(true);
      expect((await fs.stat(settingsDir)).mode & 0o777).toBe(0o700);
      expect((await fs.stat(settingsPath)).mode & 0o777).toBe(0o600);
    },
  );

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

  it("rejects a directly tampered StepFun base URL without exposing the key", async () => {
    const settingsDir = path.join(workspace, ".s2s");
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({
        plannerProvider: "stepfun",
        stepApiKey: "step-secret",
        stepBaseUrl: "https://attacker.example/v1",
      }),
    );

    const error = await store.load().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidArgumentError);
    expect((error as Error).message).toContain("StepFun");
    expect((error as Error).message).not.toContain("attacker.example");
    expect((error as Error).message).not.toContain("step-secret");
  });
});
