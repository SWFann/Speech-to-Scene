/**
 * `s2s status` command handler.
 *
 * Reads an existing project and displays its status, including review progress
 * and a validation summary.
 *
 * Usage:
 *   s2s status <project-directory> [--json]
 *
 * Exit codes:
 * - Project loads successfully: exit 0 (regardless of validation errors).
 * - Project cannot be loaded: exit code from AppError.
 */

import { Command } from "commander";

import { type CommandContext } from "../command-context.js";
import { formatError, formatUnexpectedError } from "../error-reporter.js";
import { AppError } from "../../shared/errors.js";
import type { ProjectStatusView } from "../../application/get-project-status.js";
import type { ValidateProjectResult } from "../../application/validate-project.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusCommandOptions {
  json: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of validation issues to display in human output. */
const MAX_HUMAN_ISSUES = 5;

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function formatHumanOutput(view: ProjectStatusView, validation: ValidateProjectResult): string {
  const processed = view.review.totalScenes - view.review.pending;
  const lines = [
    `项目：${view.project.title}`,
    `Schema：${view.schemaVersion}`,
    `状态：${view.status}`,
    `文稿：${view.source.path}`,
    `场景：${view.scenes.total}`,
    `审阅：${processed}/${view.review.totalScenes} 已处理`,
    `本地素材：${view.review.withLocalAsset}`,
    `Validate：${validation.errorCount} errors, ${validation.warningCount} warnings`,
    `更新时间：${view.updatedAt}`,
  ];

  if (validation.issues.length > 0) {
    lines.push("问题：");
    const shown = validation.issues.slice(0, MAX_HUMAN_ISSUES);
    for (const issue of shown) {
      lines.push(`  - [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    const remaining = validation.issues.length - shown.length;
    if (remaining > 0) {
      lines.push(`  …还有 ${remaining} 条问题未显示`);
    }
  }

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
        // Step 1: Load project status (throws if project cannot be loaded).
        const view = await ctx.getProjectStatus(projectDirectory, ctx.repository);

        // Step 2: Run validation for the release-readiness summary.
        // validateProject catches load errors internally, but since
        // getProjectStatus already succeeded, the project should load fine.
        // Filesystem checks (source existence, hash verification) may still
        // find issues. If validation throws unexpectedly, expose a safe
        // validation_unavailable issue instead of leaking raw error details.
        let validation: ValidateProjectResult;
        try {
          validation = await ctx.validateProject(projectDirectory, ctx.repository);
        } catch {
          validation = {
            ok: false,
            errorCount: 1,
            warningCount: 0,
            issues: [
              {
                severity: "error",
                code: "validation_unavailable",
                message: "项目验证未能完成",
                hint: "请重新运行 s2s validate 获取详细错误",
              },
            ],
          };
        }

        if (options.json) {
          const output = {
            ...view,
            validation,
          };
          console.log(JSON.stringify(output, null, 2) + "\n");
        } else {
          console.log(formatHumanOutput(view, validation));
        }

        // Status is a read-only command — always exit 0 when the project
        // loads successfully, regardless of validation errors.
        process.exitCode = 0;
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
