/**
 * CLI composition root.
 *
 * Wires all dependencies for the CLI commands:
 * - System adapters (Clock, IdGenerator)
 * - Infrastructure adapters (ProjectRepository, ProjectScaffolder)
 * - Application use cases (createProject, getProjectStatusUseCase)
 * - Error formatting
 *
 * This is the only place where concrete types are instantiated.
 * All other layers depend on interfaces.
 */

import { SystemClock } from "../infrastructure/system-adapters.js";
import { SystemIdGenerator } from "../infrastructure/system-adapters.js";
import { JsonProjectRepository } from "../infrastructure/json-project-repository.js";
import { FileSystemProjectScaffolder } from "../infrastructure/project-scaffolder.js";
import { createProject } from "../application/create-project.js";
import { getProjectStatusUseCase } from "../application/get-project-status.js";
import { getReviewProject } from "../application/get-review-project.js";
import { updateScene } from "../application/update-scene.js";
import { updateSceneQueries } from "../application/update-scene-queries.js";
import { validateProject } from "../application/validate-project.js";
import { formatError, formatUnexpectedError } from "./error-reporter.js";
import type { Clock } from "../application/ports/clock.js";
import type { IdGenerator } from "../application/ports/id-generator.js";
import type { ProjectRepository } from "../application/ports/project-repository.js";
import type { ProjectScaffolder } from "../application/ports/project-scaffolder.js";
import type { AppError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Composition root
// ---------------------------------------------------------------------------

export interface CommandContext {
  clock: Clock;
  idGenerator: IdGenerator;
  repository: ProjectRepository;
  scaffolder: ProjectScaffolder;
  createProject: typeof createProject;
  getProjectStatus: typeof getProjectStatusUseCase;
  getReviewProject: typeof getReviewProject;
  updateScene: typeof updateScene;
  updateSceneQueries: typeof updateSceneQueries;
  validateProject: typeof validateProject;
  formatError: (error: AppError) => string;
  formatUnexpectedError: (error: unknown) => string;
}

/**
 * Creates the CLI composition root with all production dependencies.
 */
export function createCommandContext(): CommandContext {
  const clock = new SystemClock();
  const idGenerator = new SystemIdGenerator();
  const repository = new JsonProjectRepository();
  const scaffolder = new FileSystemProjectScaffolder();

  return {
    clock,
    idGenerator,
    repository,
    scaffolder,
    createProject,
    getProjectStatus: getProjectStatusUseCase,
    getReviewProject,
    updateScene,
    updateSceneQueries,
    validateProject,
    formatError,
    formatUnexpectedError,
  };
}
