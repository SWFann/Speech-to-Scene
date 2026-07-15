/**
 * `s2s plan` command handler.
 *
 * Plans an existing Speech-to-Scene project using a selected provider.
 *
 * Usage:
 *   s2s plan <project-directory> [--provider fixture|deepseek] [--force] [--max-scenes <n>] [--dry-run] [--json]
 */

import { Command } from "commander";

import { type CommandContext } from "../command-context.js";
import { formatError, formatUnexpectedError } from "../error-reporter.js";
import { AppError, InvalidArgumentError } from "../../shared/errors.js";
import { planProject } from "../../application/plan-script.js";
import { FixtureScriptPlanner } from "../../planner/fixture-script-planner.js";
import { DeepSeekScriptPlanner } from "../../planner/deepseek-script-planner.js";
import { readPlannerEnv } from "../../infrastructure/env.js";
import type { ScriptPlanner } from "../../application/ports/script-planner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanCommandOptions {
  provider?: string;
  force: boolean;
  maxScenes: string;
  dryRun: boolean;
  json: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the planner provider from CLI options and environment.
 */
function resolveProvider(providerOption: string | undefined): {
  provider: ScriptPlanner;
  name: string;
} {
  const providerName = providerOption ?? readPlannerEnv().provider ?? "fixture";

  switch (providerName) {
    case "fixture":
      return { provider: new FixtureScriptPlanner(), name: "fixture" };
    case "deepseek": {
      const env = readPlannerEnv();
      if (!env.deepseekApiKey) {
        throw new InvalidArgumentError(
          "DEEPSEEK_API_KEY is required for deepseek provider",
          "请设置 DEEPSEEK_API_KEY 环境变量",
        );
      }
      if (!env.deepseekModel) {
        throw new InvalidArgumentError(
          "DEEPSEEK_MODEL is required for deepseek provider",
          "请设置 DEEPSEEK_MODEL 环境变量",
        );
      }
      const deepseekOptions: {
        apiKey: string;
        model: string;
        baseUrl?: string;
        timeoutMs?: number;
      } = {
        apiKey: env.deepseekApiKey,
        model: env.deepseekModel,
      };
      if (env.deepseekBaseUrl !== undefined) {
        deepseekOptions.baseUrl = env.deepseekBaseUrl;
      }
      return {
        provider: new DeepSeekScriptPlanner(deepseekOptions),
        name: "deepseek",
      };
    }
    default:
      throw new InvalidArgumentError(
        `Unknown planner provider: ${providerName}. Supported: fixture, deepseek`,
        `不支持的提供商：${providerName}，可选值：fixture, deepseek`,
      );
  }
}

/**
 * Formats human-readable output for a successful plan.
 */
function formatHumanOutput(result: {
  projectId: string;
  title: string;
  status: string;
  sceneCount: number;
  provider: string;
  promptVersion: string;
  projectRoot: string;
}): string {
  const lines = [
    `项目：${result.title}`,
    `状态：${result.status}`,
    `场景数：${result.sceneCount}`,
    `提供商：${result.provider}`,
    `提示词版本：${result.promptVersion}`,
  ];
  if (result.status === "planned") {
    lines.push(`项目路径：${result.projectRoot}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates and configures the `plan` subcommand.
 *
 * Returns the configured command for registration on the program.
 */
export function createPlanCommand(ctx: CommandContext): Command {
  const command = new Command("plan");

  command
    .description("Plan a Speech-to-Scene project (M2)")
    .argument("<project-directory>", "Path to the project directory")
    .option("--provider <name>", "Planner provider (fixture or deepseek)")
    .option("--force", "Force replan even if project is already planned")
    .option("--max-scenes <n>", "Maximum number of scenes", "20")
    .option("--dry-run", "Validate and print plan without saving")
    .option("--json", "Output plan as JSON")
    .action(async (projectDirectory: string, options: PlanCommandOptions) => {
      try {
        // Resolve provider
        const { provider, name: providerName } = resolveProvider(options.provider);

        // Parse maxScenes
        const maxScenes = parseInt(options.maxScenes, 10);
        if (isNaN(maxScenes) || maxScenes < 1) {
          throw new InvalidArgumentError(
            "--max-scenes must be a positive integer",
            "--max-scenes 必须是正整数",
          );
        }

        const result = await planProject(
          {
            projectRoot: projectDirectory,
            provider: providerName,
            force: options.force,
            maxScenes,
            dryRun: options.dryRun,
          },
          ctx.repository,
          provider,
          ctx.clock,
          ctx.idGenerator,
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2) + "\n");
        } else {
          console.log(formatHumanOutput(result));
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
