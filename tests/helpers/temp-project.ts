import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { Clock } from "../../src/application/ports/clock.js";
import type { IdGenerator } from "../../src/application/ports/id-generator.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { ProjectScaffolder } from "../../src/application/ports/project-scaffolder.js";
import { createProject } from "../../src/application/create-project.js";
import { FixedClock } from "./fixed-clock.js";
import { FixedIdGenerator } from "./fixed-id-generator.js";
import { JsonProjectRepository } from "../../src/infrastructure/json-project-repository.js";
import { FileSystemProjectScaffolder } from "../../src/infrastructure/project-scaffolder.js";

export async function createTempProject(options: {
  scriptContent: string;
  scriptFileName?: string;
  /** Parent directory to create the project in. If omitted, uses a system temp dir. */
  projectDirectory?: string;
  title?: string;
  clock?: Clock;
  idGenerator?: IdGenerator;
  repository?: ProjectRepository;
  scaffolder?: ProjectScaffolder;
}): Promise<{
  projectRoot: string;
  result: Awaited<ReturnType<typeof createProject>>;
  cleanup: () => Promise<void>;
}> {
  const parentDir = options.projectDirectory ?? os.tmpdir();
  // Generate a unique path — createProject will create this directory
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectRoot = path.join(parentDir, `s2s-test-${uniqueSuffix}`);
  const scriptContent = options.scriptContent;
  const scriptFileName = options.scriptFileName ?? "script.md";

  // Write the source script to a SEPARATE temp file (not inside the project dir).
  // createProject reads from this path and copies bytes into the (not-yet-existing) project dir.
  const scriptDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-script-"));
  const scriptPath = path.join(scriptDir, scriptFileName);
  await fs.writeFile(scriptPath, scriptContent, "utf-8");

  const clock = options.clock ?? new FixedClock();
  const idGenerator = options.idGenerator ?? new FixedIdGenerator();
  const repository = options.repository ?? new JsonProjectRepository();
  const scaffolder = options.scaffolder ?? new FileSystemProjectScaffolder();

  const result = await createProject(
    {
      projectDirectory: projectRoot,
      scriptPath,
      title: options.title ?? "",
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      intendedUse: "commercial_capable",
      willModify: true,
    },
    clock,
    idGenerator,
    repository,
    scaffolder,
  );

  return {
    projectRoot,
    result,
    cleanup: async () => {
      try {
        await fs.rm(projectRoot, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      try {
        await fs.rm(scriptDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}
