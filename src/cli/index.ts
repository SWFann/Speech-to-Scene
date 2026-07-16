#!/usr/bin/env node

/**
 * CLI entry point.
 *
 * Creates the program, registers all commands, and parses CLI arguments.
 * The `runCli` function is the primary export for testing and programmatic use.
 */

import { pathToFileURL } from "node:url";

import { Command } from "commander";
import { createCommandContext } from "./command-context.js";
import { createInitCommand } from "./commands/init-command.js";
import { createStatusCommand } from "./commands/status-command.js";
import { createPlanCommand } from "./commands/plan-command.js";
import { createSearchCommand } from "./commands/search-command.js";
import { createReviewCommand } from "./commands/review-command.js";
import { createValidateCommand } from "./commands/validate-command.js";

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

export const createProgram = (ctx = createCommandContext()): Command =>
  new Command()
    .name("s2s")
    .description("Plan and review visual assets for talking-head video scripts.")
    .version("0.0.0")
    .showHelpAfterError()
    // Register all subcommands
    .addCommand(createInitCommand(ctx))
    .addCommand(createPlanCommand(ctx))
    .addCommand(createSearchCommand(ctx))
    .addCommand(createReviewCommand(ctx))
    .addCommand(createValidateCommand(ctx))
    .addCommand(createStatusCommand(ctx));

export const runCli = async (args: readonly string[] = process.argv): Promise<void> => {
  const ctx = createCommandContext();
  const program = createProgram(ctx);
  await program.parseAsync([...args]);
};

const entryPath = process.argv[1];

if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  runCli().catch((error) => {
    console.error("Fatal error:", error);
    process.exitCode = 1;
  });
}
