/**
 * `s2s status` command handler.
 *
 * Reads an existing project and displays its status.
 *
 * Usage:
 *   s2s status <project-directory> [--json]
 */

import { Command } from "commander";

import { type CommandContext } from "../command-context.js";
import { formatError, formatUnexpectedError } from "../error-reporter.js";
import { AppError } from "../../shared/errors.js";
import type { ProjectStatusView } from "../../application/get-project-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusCommandOptions {
  json: boolean;
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function formatHumanOutput(view: ProjectStatusView): string {
  const lines = [
    `项目：${view.project.title}`,
    `Schema：${view.schemaVersion}`,
    `状态：${view.status}`,
    `文稿：${view.source.path}`,
    `场景：${view.scenes.total}`,
    `更新时间：${view.updatedAt}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates and configures the `status` subcommand.
 *
 * Returns the configured command for registration on the program.
 */
export function createStatusCommand(ctx: CommandContext): Command {
  const command = new Command("status");

  command
    .description("Show the status of a Speech-to-Scene project")
    .argument("<project-directory>", "Path to the project directory")
    .option("--json", "Output status as JSON")
    .action(async (projectDirectory: string, options: StatusCommandOptions) => {
      try {
        const view = await ctx.getProjectStatus(projectDirectory, ctx.repository);

        if (options.json) {
          // JSON output to stdout - clean, no ANSI, no logs
          console.log(JSON.stringify(view, null, 2) + "\n");
        } else {
          console.log(formatHumanOutput(view));
        }
      } catch (error) {
        if (error instanceof AppError) {
          console.error(formatError(error));
        } else {
          console.error(formatUnexpectedError(error));
        }
        process.exitCode = (error as { exitCode?: number } | null)?.exitCode ?? 1;
      }
    });

  return command;
}
