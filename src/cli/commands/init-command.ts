/**
 * `s2s init` command handler.
 *
 * Creates a new Speech-to-Scene project from a Markdown/TXT script.
 *
 * Usage:
 *   s2s init <project-directory> --script <script-path> [options]
 */

import { Command } from "commander";
import path from "node:path";

import { type CommandContext } from "../command-context.js";
import { formatError, formatUnexpectedError } from "../error-reporter.js";
import { AppError } from "../../shared/errors.js";
import { PROJECT_FILE_NAME } from "../../shared/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitCommandOptions {
  script: string;
  title?: string;
  language?: "zh-CN" | "en-US";
  aspectRatio?: "9:16" | "16:9" | "1:1";
  style?: "knowledge" | "story" | "commentary";
  intendedUse?: "commercial_capable" | "noncommercial" | "editorial";
  noModify?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LANGUAGE = "zh-CN" as const;
const DEFAULT_ASPECT_RATIO = "9:16" as const;
const DEFAULT_STYLE = "knowledge" as const;
const DEFAULT_INTENDED_USE = "commercial_capable" as const;
const DEFAULT_WILL_MODIFY = true;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates and configures the `init` subcommand.
 *
 * Returns the configured command for registration on the program.
 */
export function createInitCommand(ctx: CommandContext): Command {
  const command = new Command("init");

  command
    .description("Create a new Speech-to-Scene project from a script file")
    .argument("<project-directory>", "Target directory for the new project")
    .requiredOption("--script <path>", "Path to the Markdown or TXT script file")
    .option("--title <title>", "Project title (defaults to script filename)")
    .option(
      "--language <lang>",
      `Project language (default: ${DEFAULT_LANGUAGE})`,
      DEFAULT_LANGUAGE,
    )
    .option(
      "--aspect-ratio <ratio>",
      `Video aspect ratio (default: ${DEFAULT_ASPECT_RATIO})`,
      DEFAULT_ASPECT_RATIO,
    )
    .option(`--style <style>`, `Visual style (default: ${DEFAULT_STYLE})`, DEFAULT_STYLE)
    .option(
      "--intended-use <use>",
      `Intended asset use (default: ${DEFAULT_INTENDED_USE})`,
      DEFAULT_INTENDED_USE,
    )
    .option("--no-modify", "Disable asset modification (default: allow modification)")
    .action(async (projectDirectory: string, options: InitCommandOptions) => {
      try {
        const result = await ctx.createProject(
          {
            projectDirectory,
            scriptPath: options.script,
            title: options.title ?? "",
            language: options.language ?? DEFAULT_LANGUAGE,
            aspectRatio: options.aspectRatio ?? DEFAULT_ASPECT_RATIO,
            style: options.style ?? DEFAULT_STYLE,
            intendedUse: options.intendedUse ?? DEFAULT_INTENDED_USE,
            willModify: options.noModify ? false : DEFAULT_WILL_MODIFY,
          },
          ctx.clock,
          ctx.idGenerator,
          ctx.repository,
          ctx.scaffolder,
        );

        console.log(`✓ 已创建项目：${result.title}`);
        console.log(`✓ 已复制文稿：${path.basename(result.scriptPath)}`);
        console.log(`✓ 已写入项目文件：${PROJECT_FILE_NAME}`);
        console.log(`状态：created（运行 \`s2s plan\` 开始规划）`);
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
