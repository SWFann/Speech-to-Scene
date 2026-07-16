/**
 * `s2s validate` command handler.
 *
 * Validates a project for release readiness without modifying any files.
 *
 * Usage:
 *   s2s validate <project-directory> [--json]
 */

import { Command } from "commander";

import type { CommandContext } from "../command-context.js";
import { AppError } from "../../shared/errors.js";
import type { ValidateProjectResult } from "../../application/validate-project.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidateCommandOptions {
  json: boolean;
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function formatHumanOutput(result: ValidateProjectResult): string {
  const lines: string[] = [];

  if (result.errorCount > 0) {
    lines.push(`验证失败：${result.errorCount} 个错误，${result.warningCount} 个警告`);
  } else {
    lines.push("验证通过：未发现错误");
    if (result.warningCount > 0) {
      lines.push(`警告：${result.warningCount}`);
    }
  }

  for (const issue of result.issues) {
    lines.push(`[${issue.severity}] ${issue.code}: ${issue.message}`);
    if (issue.path !== undefined) {
      lines.push(`  path: ${issue.path}`);
    }
    if (issue.hint !== undefined) {
      lines.push(`  hint: ${issue.hint}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createValidateCommand(ctx: CommandContext): Command {
  const command = new Command("validate");

  command
    .description("Validate a Speech-to-Scene project for release readiness")
    .argument("<project-directory>", "Path to the project directory")
    .option("--json", "Output validation result as JSON")
    .action(async (projectDirectory: string, options: ValidateCommandOptions) => {
      try {
        const result = await ctx.validateProject(projectDirectory, ctx.repository);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatHumanOutput(result));
        }

        process.exitCode = result.ok ? 0 : 1;
      } catch (error) {
        if (error instanceof AppError) {
          console.error(ctx.formatError(error));
        } else {
          console.error(ctx.formatUnexpectedError(error));
        }
        process.exitCode = (error as { exitCode?: number } | null)?.exitCode ?? 1;
      }
    });

  return command;
}
